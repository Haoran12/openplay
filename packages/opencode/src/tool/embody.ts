export * as Embody from "./embody"

import { Effect, Schema } from "effect"
import { parse, stringify } from "yaml"
import path from "path"
import { AppFileSystem } from "@openplay-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"
import DESCRIPTION from "./embody.txt"
import { GodOnlyFilter, filterL2View } from "./god-only-filter"
import type { ForbiddenSet } from "./god-only-filter"
import { Session } from "@/session/session"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { MessageID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import type { TaskPromptOps } from "./task"
import { deriveSubagentSessionPermission } from "@/agent/subagent-permissions"
import { characterMemoryPath } from "./memory-update"
import { formatMemoryEntry, normalizeMemoryFile, serializeMemoryFile } from "./memory-schema"

const Parameters = Schema.Struct({
  character: Schema.String.annotate({
    description: "Name of the character to embody (must be present in the scene)",
  }),
  sceneFacts: Schema.optional(
    Schema.String.annotate({
      description:
        "Objectively observable external facts this character can directly perceive right now. Do not include thoughts, conclusions, intentions, or hidden truth.",
    }),
  ),
  situationFrame: Schema.optional(
    Schema.String.annotate({
      description:
        "Objective frame of what is happening right now in the scene. Describe events, not the character's interpretation of them.",
    }),
  ),
  playerNudge: Schema.optional(
    Schema.String.annotate({
      description:
        "Optional weak external guidance about what the character may tend to focus on or lean toward. This is not a fact and must not be written as a completed inner conclusion.",
    }),
  ),
  focusHints: Schema.optional(
    Schema.String.annotate({
      description:
        "Optional objective focus hints for the subagent, such as which sensory channels or visible details deserve extra attention. Do not include inner thoughts or intentions.",
    }),
  ),
  l2View: Schema.optional(
    Schema.String.annotate({
      description:
        "@deprecated Use sceneFacts. Legacy filtered narrative context that the character can perceive. Do NOT include God Only content.",
    }),
  ),
  situation: Schema.optional(
    Schema.String.annotate({
      description:
        "@deprecated Use situationFrame. Legacy situation description. Keep it objective and avoid character interpretation.",
    }),
  ),
})

type EmbodyMetadata = {
  character: string
  filtered: boolean
  blocked?: boolean
  blockedReason?: string
  usedLegacyFields?: boolean
  subagentSessionID?: string
}

type CharacterAgentContext = Pick<Agent.Info, "senses" | "knowledgeAccess" | "senseTraits">
type CharacterSample = Partial<{
  inner_thought: string
  speech: string
  action_intent: string
  outward_action: string
}>

type RuntimeCharacter = Partial<{
  name: string
  age: unknown
  appearance: unknown
  activity: unknown
  state: unknown
  body_condition: unknown
  carried_items: unknown
  worn_items: unknown
  restraints: unknown
  impairments: unknown
  sensed_effects: unknown
}>

type RuntimeData = Partial<{
  current_scene: Record<string, unknown>
  present_characters: RuntimeCharacter[]
  environment: Record<string, unknown>
}>

type EffectiveInput = {
  sceneFacts: string
  situationFrame: string
  playerNudge?: string
  focusHints?: string
  usedLegacyFields: boolean
}

type CharacterBindingInfo = {
  statePath?: string
  memoryPath: string
}

type CharacterBindingsFile = {
  version: 1
  generatedAt: string
  characters: Record<string, CharacterBindingInfo>
}

type CharacterWorldResources = {
  binding: CharacterBindingInfo
  stateContent?: string
}

const GOD_ONLY_ACCESS = new Set(["godonly"])
const CHARACTER_BINDINGS_RELATIVE_PATH = path.join(".openplay", "character-bindings.json")
const CHARACTER_STATE_PATTERNS = ["characters/**/*.yaml", "characters/**/*.yml"] as const
const CHARACTER_SAMPLE_ALIASES = new Map<string, keyof CharacterSample>([
  ["innerthought", "inner_thought"],
  ["innermonologue", "inner_thought"],
  ["monologue", "inner_thought"],
  ["thought", "inner_thought"],
  ["thinking", "inner_thought"],
  ["dialogue", "speech"],
  ["line", "speech"],
  ["spokenwords", "speech"],
  ["words", "speech"],
  ["intent", "action_intent"],
  ["nextintent", "action_intent"],
  ["nextaction", "action_intent"],
  ["plan", "action_intent"],
  ["action", "outward_action"],
  ["gesture", "outward_action"],
  ["movement", "outward_action"],
])
const SELF_KNOWLEDGE_FIELDS = new Map<string, string>([
  ["name", "Name"],
  ["姓名", "Name"],
  ["名字", "Name"],
  ["gender", "Gender"],
  ["sex", "Gender"],
  ["pronouns", "Pronouns"],
  ["性别", "Gender"],
  ["genderidentity", "Gender"],
  ["species", "Species"],
  ["race", "Species"],
  ["kind", "Species"],
  ["种族", "Species"],
  ["族属", "Species"],
  ["身份", "Identity"],
  ["identity", "Identity"],
  ["role", "Identity"],
  ["title", "Identity"],
  ["身份定位", "Identity"],
  ["职业", "Identity"],
  ["cultivation", "Cultivation"],
  ["cultivationlevel", "Cultivation"],
  ["realm", "Cultivation"],
  ["rank", "Cultivation"],
  ["tier", "Cultivation"],
  ["level", "Cultivation"],
  ["修为", "Cultivation"],
  ["境界", "Cultivation"],
  ["修为境界", "Cultivation"],
  ["阶位", "Cultivation"],
  ["faction", "Faction"],
  ["affiliation", "Faction"],
  ["sect", "Faction"],
  ["clan", "Faction"],
  ["group", "Faction"],
  ["阵营", "Faction"],
  ["势力", "Faction"],
  ["宗门", "Faction"],
  ["门派", "Faction"],
  ["所属", "Faction"],
  ["form", "Current form"],
  ["currentform", "Current form"],
  ["shape", "Current form"],
  ["body", "Current form"],
  ["形态", "Current form"],
  ["当前形态", "Current form"],
  ["化形", "Current form"],
  ["status", "Current state"],
  ["condition", "Current state"],
  ["state", "Current state"],
  ["当前状态", "Current state"],
  ["伤势", "Current state"],
  ["health", "Current state"],
])
const VALUE_FIELDS = ["content", "current", "value", "name", "text", "description"] as const
const ACCESSIBLE_SETTING_SKIP_KEYS = new Set(["access", "apparent_content", "comment"])
const SENSE_TRAIT_FIELDS = new Set([
  "sensetrait",
  "sensetraits",
  "sensorytrait",
  "sensorytraits",
  "senseprofile",
  "senseprofiles",
  "sense",
  "senses",
  "感官",
  "感知",
  "嗅觉",
  "夜视",
  "灵觉",
  "神识",
  "魂感",
])
const SUBJECTIVE_LEAKAGE_RULES = [
  /你(?:意识到|明白|觉得|怀疑|猜到|认定|判断|想起|回忆起|决定|打算|想要)/,
  /(?:意识到|明白|觉得|怀疑|猜到|认定|判断|想起|回忆起|决定|打算|想要)了/,
  /\b(?:realize|realizes|realized|suspect|suspects|suspected|infer|infers|inferred|conclude|concludes|concluded|decide|decides|decided|intend|intends|intended|remember|remembers|remembered|think that)\b/i,
  /(?:让你|令你)(?:觉得|感到|意识到|明白|认定|确信|警惕|戒备|安心|不安|难过|愤怒|心软|动摇|犹豫|迟疑)/,
  /你(?:不由得|心里|本能地|顿时|越发|开始)?(?:警惕|戒备|安心|放松|不安|难过|愤怒|害怕|紧张|心软|动摇|犹豫|迟疑|确定|确信|认定)/,
  /(?:重点|特别|优先|着重)?(?:留意|注意|关注).{0,10}(?:试探|敌意|善意|警惕|戒备|不耐|轻蔑|犹豫|迟疑|紧张|害怕|悲伤|愤怒|心虚|算计|盘算|企图|打算|挑衅|安抚|安慰|威胁|撒谎|隐瞒)/,
  /(?:他|她|它|对方).{0,8}(?:显然|明显|分明|似乎|像是|仿佛|看来|带着|透着|满是).{0,10}(?:试探|敌意|善意|警惕|戒备|不耐|轻蔑|犹豫|迟疑|紧张|害怕|悲伤|愤怒|心虚|算计|盘算|企图|打算|挑衅|安抚|安慰|威胁|撒谎|隐瞒)/,
  /(?:他|她|它|对方).{0,8}(?:试图|想要|打算|企图|故意|存心).{0,10}(?:试探|误导|欺骗|隐瞒|撒谎|安抚|挑衅|威胁|施压|激怒|拖延)/,
]
const PLAYER_NUDGE_HARD_OVERRIDE_RULES = [
  /你(?:已经|其实)?(?:意识到|明白|认定|确定|知道)/,
  /\b(?:you now realize|you know that|this means that)\b/i,
  /(?:默认|先|直接)(?:把|将).{0,12}(?:视为|当成|认定为)/,
  /(?:更倾向于|倾向于|优先)(?:认为|认定|判断|怀疑|确信)/,
]

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[\s_\-]/g, "")
}

function stripMarkdownCodeFence(value: string): string {
  const trimmed = value.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) return
  return text.slice(start, end + 1)
}

function normalizeCharacterSampleObject(value: unknown): CharacterSample | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return
  const input = value as Record<string, unknown>
  const sample: CharacterSample = {}

  for (const [key, raw] of Object.entries(input)) {
    const normalizedKey = normalizeToken(key)
    const canonical =
      normalizedKey === "innerthought" ||
      normalizedKey === "speech" ||
      normalizedKey === "actionintent" ||
      normalizedKey === "outwardaction"
        ? ({
            innerthought: "inner_thought",
            speech: "speech",
            actionintent: "action_intent",
            outwardaction: "outward_action",
          } as const)[normalizedKey]
        : CHARACTER_SAMPLE_ALIASES.get(normalizedKey)
    if (!canonical) continue

    if (typeof raw === "string") {
      sample[canonical] = raw.trim()
      continue
    }
    if (typeof raw === "number" || typeof raw === "boolean") {
      sample[canonical] = String(raw)
    }
  }

  return Object.keys(sample).length > 0 ? sample : (input as CharacterSample)
}

export function tryParseCharacterSample(text: string): CharacterSample | undefined {
  const trimmed = stripMarkdownCodeFence(text)
  const candidates = [trimmed, extractJsonObject(trimmed)].filter((value): value is string => !!value)
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      const normalized = normalizeCharacterSampleObject(parsed)
      if (normalized) return normalized
    } catch {
      continue
    }
  }
  return undefined
}

function isGodOnlyAccess(access: unknown): boolean {
  return typeof access === "string" && GOD_ONLY_ACCESS.has(normalizeToken(access))
}

function characterMemoryRelativePath(character: string): string {
  return path.join("memories", `${character}.yaml`)
}

function isHiddenCharacterStatePath(relativePath: string): boolean {
  const normalized = normalizeToken(relativePath)
  return ["hidden", "godonly", "godonly", "secret", "private"].some((token) => normalized.includes(token))
}

function listIncludesCharacter(access: string, character: string): boolean {
  const index = access.indexOf(":")
  if (index === -1) return false
  const members = access
    .slice(index + 1)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  return members.includes(character)
}

function canUseSelfKnowledgeAccess(
  access: unknown,
  character: string,
  knowledgeAccess: readonly string[] | undefined,
): boolean {
  if (access === undefined) return true
  if (typeof access !== "string") return false
  const normalized = normalizeToken(access)
  if (isGodOnlyAccess(access)) return false
  if (normalized === "public" || normalized === "self") return true
  if (normalized === "participant") return false
  if (normalized.startsWith("list:")) return listIncludesCharacter(access, character)
  if (!normalized.startsWith("condition:")) return false

  const condition = access.slice(access.indexOf(":") + 1).trim()
  const tokens = new Set<string>()
  for (const item of knowledgeAccess ?? []) {
    tokens.add(normalizeToken(item))
    if (item.includes(":")) {
      tokens.add(normalizeToken(item.slice(item.indexOf(":") + 1)))
    }
  }
  return tokens.has(normalized) || tokens.has(normalizeToken(condition))
}

function formatPrimitive(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return undefined
}

function formatValue(value: unknown): string | undefined {
  const primitive = formatPrimitive(value)
  if (primitive) return primitive
  if (!Array.isArray(value)) return undefined

  const parts = value
    .map((item) => formatPrimitive(item))
    .filter((item): item is string => !!item)
  return parts.length > 0 ? parts.join("、") : undefined
}

function formatStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => formatPrimitive(item))
      .filter((item): item is string => !!item)
  }
  const primitive = formatPrimitive(value)
  return primitive ? [primitive] : []
}

function extractCharacterNames(record: Record<string, unknown>, fallbackKey?: string): string[] {
  const names = new Set<string>()
  const directName = formatPrimitive(record.name)
  if (directName) names.add(directName)
  for (const aliasField of ["aliases", "alias", "names"] as const) {
    for (const item of formatStringArray(record[aliasField])) names.add(item)
  }
  if (fallbackKey && fallbackKey.trim().length > 0) names.add(fallbackKey.trim())
  return Array.from(names).filter((name) => name.length > 0)
}

function collectBindingCandidatesFromParsed(parsed: unknown, relativePath: string): Map<string, number> {
  const result = new Map<string, number>()
  const hiddenPenalty = isHiddenCharacterStatePath(relativePath) ? -1000 : 0
  const basename = normalizeToken(path.basename(relativePath, path.extname(relativePath)))
  const root = readObject(parsed)
  if (!root) return result

  const pushNames = (record: Record<string, unknown>, fallbackKey?: string) => {
    const directName = formatPrimitive(record.name)
    for (const name of extractCharacterNames(record, fallbackKey)) {
      let score = hiddenPenalty
      if (directName === name) score += 120
      if (fallbackKey === name) score += 80
      const normalizedName = normalizeToken(name)
      if (basename.endsWith(normalizedName)) score += 40
      else if (basename.includes(normalizedName)) score += 20
      const prev = result.get(name)
      if (prev === undefined || score > prev) result.set(name, score)
    }
  }

  pushNames(root)
  for (const [key, value] of Object.entries(root)) {
    const nested = readObject(value)
    if (nested) pushNames(nested, key)
  }

  return result
}

export function inferCharacterBindingsFromFiles(
  files: Array<{ relativePath: string; content: string }>,
): Record<string, CharacterBindingInfo> {
  const best = new Map<string, { score: number; statePath: string }>()

  for (const file of files) {
    try {
      const parsed = parse(file.content)
      const candidates = collectBindingCandidatesFromParsed(parsed, file.relativePath)
      for (const [character, score] of candidates.entries()) {
        const prev = best.get(character)
        if (!prev || score > prev.score) {
          best.set(character, { score, statePath: file.relativePath })
        }
      }
    } catch {
      continue
    }
  }

  return Object.fromEntries(
    Array.from(best.entries()).map(([character, value]) => [
      character,
      {
        statePath: value.statePath,
        memoryPath: characterMemoryRelativePath(character),
      } satisfies CharacterBindingInfo,
    ]),
  )
}

function resolveSelfKnowledgeValue(
  value: unknown,
  character: string,
  knowledgeAccess: readonly string[] | undefined,
): string | undefined {
  const direct = formatValue(value)
  if (direct) return direct
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined

  const obj = value as Record<string, unknown>
  if (isGodOnlyAccess(obj.access)) return undefined

  const allowed = canUseSelfKnowledgeAccess(obj.access, character, knowledgeAccess)
  if (!allowed) {
    return formatValue(obj.apparent_content)
  }

  for (const field of VALUE_FIELDS) {
    const resolved = formatValue(obj[field])
    if (resolved) return resolved
  }

  return undefined
}

function collectSelfKnowledgeEntries(
  node: unknown,
  character: string,
  knowledgeAccess: readonly string[] | undefined,
  entries: Map<string, string>,
): void {
  if (typeof node !== "object" || node === null) return
  if (Array.isArray(node)) {
    for (const item of node) {
      collectSelfKnowledgeEntries(item, character, knowledgeAccess, entries)
    }
    return
  }

  const obj = node as Record<string, unknown>
  if (isGodOnlyAccess(obj.access)) return

  for (const [key, value] of Object.entries(obj)) {
    const label = SELF_KNOWLEDGE_FIELDS.get(normalizeToken(key))
    if (label && !entries.has(label)) {
      const resolved = resolveSelfKnowledgeValue(value, character, knowledgeAccess)
      if (resolved) entries.set(label, resolved)
    }

    if (typeof value === "object" && value !== null) {
      collectSelfKnowledgeEntries(value, character, knowledgeAccess, entries)
    }
  }
}

function collectSenseTraits(node: unknown, output: Set<string>): void {
  if (typeof node !== "object" || node === null) return
  if (Array.isArray(node)) {
    for (const item of node) collectSenseTraits(item, output)
    return
  }

  const obj = node as Record<string, unknown>
  for (const [key, value] of Object.entries(obj)) {
    if (SENSE_TRAIT_FIELDS.has(normalizeToken(key))) {
      for (const item of formatStringArray(value)) output.add(item)
    }
    if (typeof value === "object" && value !== null) collectSenseTraits(value, output)
  }
}

function unwrapCharacterSettingRoot(node: unknown, character: string): unknown {
  const root = readObject(node)
  if (!root) return node
  const direct = readObject(root[character])
  if (direct) return direct

  for (const [key, value] of Object.entries(root)) {
    const nested = readObject(value)
    if (!nested) continue
    const names = extractCharacterNames(nested, key)
    if (names.includes(character)) return nested
  }
  return node
}

function buildAccessibleSettingNode(node: unknown): unknown {
  const direct = formatValue(node)
  if (direct) return direct

  if (Array.isArray(node)) {
    const items = node
      .map((item) => buildAccessibleSettingNode(item))
      .filter((item) => item !== undefined)
    return items.length > 0 ? items : undefined
  }

  if (typeof node !== "object" || node === null) return undefined

  const obj = node as Record<string, unknown>
  if (isGodOnlyAccess(obj.access)) return undefined

  for (const field of VALUE_FIELDS) {
    const resolved = buildAccessibleSettingNode(obj[field])
    if (resolved !== undefined) return resolved
  }

  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (ACCESSIBLE_SETTING_SKIP_KEYS.has(key)) continue
    const resolved = buildAccessibleSettingNode(value)
    if (resolved !== undefined) output[key] = resolved
  }
  return Object.keys(output).length > 0 ? output : undefined
}

function sanitizeValue(value: string, forbiddenSet: ForbiddenSet | undefined): string {
  return forbiddenSet ? filterL2View(value, forbiddenSet).trim() : value.trim()
}

function sanitizeLines(lines: string[], forbiddenSet: ForbiddenSet | undefined): string[] {
  return lines
    .map((line) => sanitizeValue(line, forbiddenSet))
    .filter((line) => line.length > 0 && line !== "- [已隐去]" && line !== "[已隐去]")
}

function formatBulletSection(lines: string[]): string {
  if (lines.length === 0) return "- (none)"
  return lines.join("\n")
}

function formatMemorySection(lines: string[]): string {
  if (lines.length === 0) return "- (none)"
  return lines.map((line, index) => `- [${index + 1}] ${line}`).join("\n")
}

export function buildCharacterSelfKnowledge(input: {
  character: string
  characterAgent?: CharacterAgentContext
  stateContent?: string
  forbiddenSet?: ForbiddenSet
}): string[] {
  const entries = new Map<string, string>()
  const senseTraits = new Set<string>()
  entries.set("Name", input.character)

  if (input.stateContent) {
    try {
      const parsed = parse(input.stateContent)
      collectSelfKnowledgeEntries(parsed, input.character, input.characterAgent?.knowledgeAccess, entries)
      collectSenseTraits(parsed, senseTraits)
    } catch {
      // Ignore malformed YAML and fall back to agent metadata only.
    }
  }

  if (input.characterAgent?.senses && Object.keys(input.characterAgent.senses).length > 0) {
    const senses = Object.entries(input.characterAgent.senses)
      .map(([name, level]) => `${name}=${level}`)
      .join(", ")
    if (senses.length > 0) entries.set("Sensory capabilities", senses)
  }

  for (const trait of input.characterAgent?.senseTraits ?? []) {
    senseTraits.add(trait)
  }
  if (senseTraits.size > 0) {
    entries.set("Sensory traits", Array.from(senseTraits).join("、"))
  }

  return Array.from(entries.entries())
    .map(([label, value]) => {
      const sanitized = sanitizeValue(value, input.forbiddenSet)
      return sanitized.length > 0 && sanitized !== "[已隐去]" ? `- ${label}: ${sanitized}` : undefined
    })
    .filter((line): line is string => !!line)
}

export function buildCharacterSettingSection(input: {
  character: string
  stateContent?: string
  forbiddenSet?: ForbiddenSet
}): string | undefined {
  if (!input.stateContent) return
  try {
    const parsed = parse(input.stateContent)
    const root = unwrapCharacterSettingRoot(parsed, input.character)
    const accessible = buildAccessibleSettingNode(root)
    if (accessible === undefined) return
    const rendered = sanitizeValue(stringify(accessible).trim(), input.forbiddenSet)
    return rendered.length > 0 && rendered !== "[已隐去]" ? rendered : undefined
  } catch {
    return
  }
}

function parseCharacterBindingsFile(value: unknown): CharacterBindingsFile | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return
  const input = value as Record<string, unknown>
  const characters = readObject(input.characters)
  if (!characters) return

  const normalized: Record<string, CharacterBindingInfo> = {}
  for (const [character, raw] of Object.entries(characters)) {
    const entry = readObject(raw)
    if (!entry) continue
    const memoryPath = formatPrimitive(entry.memoryPath)
    const statePath = formatPrimitive(entry.statePath)
    if (!memoryPath) continue
    normalized[character] = { memoryPath, ...(statePath ? { statePath } : {}) }
  }

  return {
    version: 1,
    generatedAt: formatPrimitive(input.generatedAt) ?? new Date(0).toISOString(),
    characters: normalized,
  }
}

function bindingsEqual(a: CharacterBindingInfo | undefined, b: CharacterBindingInfo | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.statePath === b.statePath && a.memoryPath === b.memoryPath
}

function readBindingsFile(input: { fs: AppFileSystem.Interface; worldPath: string }) {
  return Effect.gen(function* () {
    const filepath = path.join(input.worldPath, CHARACTER_BINDINGS_RELATIVE_PATH)
    const content = yield* input.fs.readFileStringSafe(filepath).pipe(Effect.orDie)
    if (!content) return
    try {
      return parseCharacterBindingsFile(JSON.parse(content))
    } catch {
      return
    }
  })
}

function discoverCharacterBindings(input: { fs: AppFileSystem.Interface; worldPath: string }) {
  return Effect.gen(function* () {
    const relativePaths = new Set<string>()
    for (const pattern of CHARACTER_STATE_PATTERNS) {
      const matches = yield* input.fs.glob(pattern, { cwd: input.worldPath, include: "file", dot: true }).pipe(Effect.orDie)
      for (const match of matches) relativePaths.add(match)
    }

    const files: Array<{ relativePath: string; content: string }> = []
    for (const relativePath of relativePaths) {
      const fullPath = path.join(input.worldPath, relativePath)
      const content = yield* input.fs.readFileStringSafe(fullPath).pipe(Effect.orDie)
      if (content) files.push({ relativePath, content })
    }

    return inferCharacterBindingsFromFiles(files)
  })
}

export function ensureCharacterBinding(input: {
  fs: AppFileSystem.Interface
  worldPath: string
  character: string
  preferredStatePath?: string
}) {
  return Effect.gen(function* () {
    const bindingFilePath = path.join(input.worldPath, CHARACTER_BINDINGS_RELATIVE_PATH)
    const memoryPath = characterMemoryRelativePath(input.character)
    const existing = yield* readBindingsFile({ fs: input.fs, worldPath: input.worldPath })
    const current = existing?.characters[input.character]

    const preferredExists =
      input.preferredStatePath &&
      (yield* input.fs.existsSafe(path.join(input.worldPath, input.preferredStatePath)).pipe(Effect.orDie))

    const currentExists =
      current?.statePath &&
      (yield* input.fs.existsSafe(path.join(input.worldPath, current.statePath)).pipe(Effect.orDie))

    if (current && currentExists && (!preferredExists || current.statePath === input.preferredStatePath) && current.memoryPath === memoryPath) {
      return current
    }

    const discovered = yield* discoverCharacterBindings({ fs: input.fs, worldPath: input.worldPath })
    const mergedCharacters: Record<string, CharacterBindingInfo> = {
      ...(existing?.characters ?? {}),
      ...discovered,
    }
    const nextBinding: CharacterBindingInfo = {
      memoryPath,
      ...(preferredExists
        ? { statePath: input.preferredStatePath }
        : discovered[input.character]?.statePath
          ? { statePath: discovered[input.character].statePath }
          : current?.statePath && currentExists
            ? { statePath: current.statePath }
            : {}),
    }
    mergedCharacters[input.character] = nextBinding

    const nextFile: CharacterBindingsFile = {
      version: 1,
      generatedAt: new Date().toISOString(),
      characters: mergedCharacters,
    }

    const shouldWrite =
      !existing ||
      !bindingsEqual(existing.characters[input.character], nextBinding) ||
      Object.keys(mergedCharacters).length !== Object.keys(existing.characters).length

    if (shouldWrite) {
      yield* input.fs
        .writeWithDirs(bindingFilePath, JSON.stringify(nextFile, null, 2))
        .pipe(Effect.orDie)
    }

    return nextBinding
  })
}

export function resolveCharacterWorldResources(input: {
  fs: AppFileSystem.Interface
  worldPath: string
  character: string
  preferredStatePath?: string
}) {
  return Effect.gen(function* () {
    const binding = yield* ensureCharacterBinding(input)
    const stateContent =
      binding.statePath
        ? yield* input.fs.readFileStringSafe(path.join(input.worldPath, binding.statePath)).pipe(Effect.orDie)
        : undefined
    return {
      binding,
      stateContent,
    } satisfies CharacterWorldResources
  })
}

function readCharacterMemory(input: {
  fs: AppFileSystem.Interface
  worldPath: string
  character: string
  memoryPath?: string
  forbiddenSet?: ForbiddenSet
}) {
  return Effect.gen(function* () {
    const fullPath = input.memoryPath
      ? path.join(input.worldPath, input.memoryPath)
      : characterMemoryPath(input.worldPath, input.character)
    const exists = yield* input.fs.existsSafe(fullPath).pipe(Effect.orDie)
    if (!exists) {
      const empty = serializeMemoryFile(normalizeMemoryFile(undefined))
      yield* input.fs.writeWithDirs(fullPath, empty).pipe(Effect.orDie)
      return []
    }
    const content = yield* input.fs.readFileStringSafe(fullPath).pipe(Effect.orDie)
    if (!content) return []
    try {
      return sanitizeLines(normalizeMemoryFile(content).entries.map(formatMemoryEntry), input.forbiddenSet)
    } catch {
      return []
    }
  })
}

function parseModelString(modelStr: string): { modelID: string; providerID: string } | undefined {
  const parts = modelStr.split("/")
  if (parts.length !== 2) return undefined
  return { providerID: parts[0], modelID: parts[1] }
}

function parseRuntimeData(content: string | undefined): RuntimeData | undefined {
  if (!content) return
  try {
    const parsed = parse(content)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return
    return parsed as RuntimeData
  } catch {
    return
  }
}

function readObject(record: unknown): Record<string, unknown> | undefined {
  return typeof record === "object" && record !== null && !Array.isArray(record)
    ? (record as Record<string, unknown>)
    : undefined
}

function readRuntimeCharacter(runtime: RuntimeData | undefined, character: string): RuntimeCharacter | undefined {
  if (!runtime?.present_characters || !Array.isArray(runtime.present_characters)) return
  return runtime.present_characters.find((item) => {
    const name = formatPrimitive(readObject(item)?.name ?? item?.name)
    return name === character
  })
}

function buildObjectiveEnvironmentLines(input: {
  runtime: RuntimeData | undefined
  forbiddenSet?: ForbiddenSet
}): string[] {
  const currentScene = readObject(input.runtime?.current_scene)
  const environment = readObject(input.runtime?.environment)
  const weather = readObject(environment?.weather)
  const precipitation = readObject(environment?.precipitation)
  const illumination = readObject(environment?.illumination)
  const celestial = readObject(illumination?.celestial_bodies)
  const obstruction = readObject(illumination?.visibility_obstruction)
  const atmosphere = readObject(environment?.atmosphere)

  const lines: string[] = []
  const date = formatPrimitive(currentScene?.date)
  const location = formatPrimitive(currentScene?.location) ?? formatPrimitive(environment?.location)
  const impression = formatPrimitive(currentScene?.impression)
  const envTime = formatPrimitive(environment?.time)
  const timeOfDay = formatPrimitive(environment?.time_of_day)
  const season = formatPrimitive(environment?.season)
  if (date) lines.push(`- Date: ${date}`)
  if (envTime) lines.push(`- Runtime time: ${envTime}`)
  if (timeOfDay) lines.push(`- Time of day: ${timeOfDay}`)
  if (season) lines.push(`- Season: ${season}`)
  if (location) lines.push(`- Location: ${location}`)
  if (impression) lines.push(`- Scene impression: ${impression}`)

  const weatherParts = [
    weather && formatPrimitive(weather.temperature) ? `temperature ${formatPrimitive(weather.temperature)}C` : undefined,
    weather && formatPrimitive(weather.humidity) ? `humidity ${formatPrimitive(weather.humidity)}%` : undefined,
    weather && formatPrimitive(weather.wind_speed) ? `wind ${formatPrimitive(weather.wind_speed)} m/s` : undefined,
    weather && formatPrimitive(weather.wind_direction) ? `wind direction ${formatPrimitive(weather.wind_direction)}` : undefined,
  ].filter((item): item is string => !!item)
  if (weatherParts.length > 0) lines.push(`- Weather: ${weatherParts.join(", ")}`)

  const precipitationParts = [
    formatPrimitive(precipitation?.type),
    formatPrimitive(precipitation?.intensity),
    precipitation && formatPrimitive(precipitation.accumulated)
      ? `accumulated ${formatPrimitive(precipitation.accumulated)} mm`
      : undefined,
  ].filter((item): item is string => !!item)
  if (precipitationParts.length > 0) lines.push(`- Precipitation: ${precipitationParts.join(", ")}`)

  const lightParts = [
    formatPrimitive(illumination?.primary_source) ? `primary source ${formatPrimitive(illumination?.primary_source)}` : undefined,
    formatPrimitive(celestial?.moon_phase) ? `moon ${formatPrimitive(celestial?.moon_phase)}` : undefined,
    typeof celestial?.stars_visible === "boolean" ? `stars visible ${String(celestial.stars_visible)}` : undefined,
    formatPrimitive(illumination?.terrain_shadow) ? `terrain shadow ${formatPrimitive(illumination?.terrain_shadow)}` : undefined,
  ].filter((item): item is string => !!item)
  if (lightParts.length > 0) lines.push(`- Illumination: ${lightParts.join(", ")}`)

  const artificialLights = formatStringArray(illumination?.artificial_lights)
  if (artificialLights.length > 0) lines.push(`- Artificial lights: ${artificialLights.join("、")}`)

  const obstructionParts = [
    obstruction && formatPrimitive(obstruction.clouds) ? `clouds ${formatPrimitive(obstruction.clouds)}` : undefined,
    obstruction && formatPrimitive(obstruction.fog) ? `fog ${formatPrimitive(obstruction.fog)}` : undefined,
    obstruction && formatPrimitive(obstruction.dust) ? `dust ${formatPrimitive(obstruction.dust)}` : undefined,
    obstruction && formatPrimitive(obstruction.smoke) ? `smoke ${formatPrimitive(obstruction.smoke)}` : undefined,
  ].filter((item): item is string => !!item)
  if (obstructionParts.length > 0) lines.push(`- Visibility obstruction: ${obstructionParts.join(", ")}`)

  const atmosphereParts = [
    formatPrimitive(atmosphere?.quality),
    formatPrimitive(atmosphere?.special_particles),
  ].filter((item): item is string => !!item)
  if (atmosphereParts.length > 0) lines.push(`- Atmosphere: ${atmosphereParts.join(", ")}`)

  const magicalEffects = formatStringArray(environment?.magical_effects)
  if (magicalEffects.length > 0) lines.push(`- Magical effects: ${magicalEffects.join("、")}`)

  return sanitizeLines(lines, input.forbiddenSet)
}

function buildCharacterBodyStateLines(input: {
  runtimeCharacter: RuntimeCharacter | undefined
  forbiddenSet?: ForbiddenSet
}): string[] {
  const item = input.runtimeCharacter
  if (!item) return []

  const lines: string[] = []
  const appearance = formatPrimitive(item.appearance)
  const activity = formatPrimitive(item.activity)
  const state = formatPrimitive(item.state)
  if (appearance) lines.push(`- Appearance: ${appearance}`)
  if (activity) lines.push(`- Current activity: ${activity}`)
  if (state) lines.push(`- Current state: ${state}`)

  const groups: Array<[string, unknown]> = [
    ["Body condition", item.body_condition],
    ["Carried items", item.carried_items],
    ["Worn items", item.worn_items],
    ["Restraints", item.restraints],
    ["Impairments", item.impairments],
    ["Current sensed effects", item.sensed_effects],
  ]
  for (const [label, raw] of groups) {
    const values = formatStringArray(raw)
    if (values.length > 0) lines.push(`- ${label}: ${values.join("、")}`)
  }
  return sanitizeLines(lines, input.forbiddenSet)
}

function buildBaselineSensoryLines(input: {
  characterAgent?: CharacterAgentContext
  stateContent?: string
  forbiddenSet?: ForbiddenSet
}): string[] {
  const lines: string[] = []
  if (input.characterAgent?.senses && Object.keys(input.characterAgent.senses).length > 0) {
    lines.push(
      `- Sensory capabilities: ${Object.entries(input.characterAgent.senses)
        .map(([name, level]) => `${name}=${level}`)
        .join(", ")}`,
    )
  }
  const traits = new Set<string>()
  for (const item of input.characterAgent?.senseTraits ?? []) traits.add(item)
  if (input.stateContent) {
    try {
      collectSenseTraits(parse(input.stateContent), traits)
    } catch {
      // Ignore malformed YAML and keep explicit config traits only.
    }
  }
  if (traits.size > 0) lines.push(`- Sensory traits: ${Array.from(traits).join("、")}`)
  return sanitizeLines(lines, input.forbiddenSet)
}

function collectImpairmentSignals(runtimeCharacter: RuntimeCharacter | undefined): string[] {
  if (!runtimeCharacter) return []
  return [
    ...formatStringArray(runtimeCharacter.state),
    ...formatStringArray(runtimeCharacter.body_condition),
    ...formatStringArray(runtimeCharacter.restraints),
    ...formatStringArray(runtimeCharacter.impairments),
    ...formatStringArray(runtimeCharacter.sensed_effects),
  ]
}

function collectEnvironmentSignals(runtime: RuntimeData | undefined): string[] {
  const environment = readObject(runtime?.environment)
  const illumination = readObject(environment?.illumination)
  const obstruction = readObject(illumination?.visibility_obstruction)
  const atmosphere = readObject(environment?.atmosphere)
  return [
    formatPrimitive(environment?.time_of_day),
    formatPrimitive(illumination?.primary_source),
    formatPrimitive(illumination?.terrain_shadow),
    formatPrimitive(atmosphere?.quality),
    formatPrimitive(atmosphere?.special_particles),
    ...formatStringArray(environment?.magical_effects),
    formatPrimitive(obstruction?.fog),
    formatPrimitive(obstruction?.dust),
    formatPrimitive(obstruction?.smoke),
  ].filter((item): item is string => !!item)
}

function hasAnySignal(signals: string[], words: string[]): boolean {
  return signals.some((signal) => {
    const lower = signal.toLowerCase()
    return words.some((word) => lower.includes(word))
  })
}

function buildEffectiveSensoryStateLines(input: {
  runtime: RuntimeData | undefined
  runtimeCharacter: RuntimeCharacter | undefined
  characterAgent?: CharacterAgentContext
  forbiddenSet?: ForbiddenSet
}): string[] {
  const lines: string[] = []
  const impairmentSignals = collectImpairmentSignals(input.runtimeCharacter)
  const envSignals = collectEnvironmentSignals(input.runtime)
  const senses = input.characterAgent?.senses ?? {}
  const senseKeys = Object.keys(senses).map((key) => normalizeToken(key))
  const traits = (input.characterAgent?.senseTraits ?? []).map((item) => normalizeToken(item))
  const hasSense = (words: string[]) =>
    senseKeys.some((key) => words.some((word) => key.includes(word))) ||
    traits.some((key) => words.some((word) => key.includes(word)))

  const visualHindrance =
    hasAnySignal(envSignals, ["night", "夜", "dark", "昏", "shadow", "fog", "smoke", "dust"]) ||
    hasAnySignal(impairmentSignals, ["blind", "蒙眼", "遮眼", "失明", "眼伤"])
  const hearingHindrance = hasAnySignal(impairmentSignals, ["deaf", "耳鸣", "失聪", "耳伤"])
  const smellHindrance = hasAnySignal(impairmentSignals, ["嗅觉受损", "鼻塞", "smell impaired"])
  const cognitionHindrance =
    hasAnySignal(envSignals, ["extreme", "寒", "热", "freeze", "burn"]) ||
    hasAnySignal(impairmentSignals, ["剧痛", "虚弱", "疲惫", "昏沉", "寒冷", "炎热"])
  const spiritualHindrance = hasAnySignal(envSignals, ["illusion", "幻术", "suppression", "封印", "迷阵"])

  if (visualHindrance) {
    const reasons: string[] = []
    if (hasAnySignal(envSignals, ["night", "夜", "dark", "昏", "shadow"])) reasons.push("low light or shadow")
    if (hasAnySignal(envSignals, ["fog", "smoke", "dust"])) reasons.push("visibility obstruction")
    if (hasAnySignal(impairmentSignals, ["blind", "蒙眼", "遮眼", "失明", "眼伤"])) reasons.push("eye restraint or injury")
    lines.push(`- Vision: reduced by ${reasons.join(", ")}`)
  } else if (hasSense(["vision", "sight", "nightvision", "夜视"])) {
    lines.push("- Vision: stronger than ordinary baseline in current conditions")
  }

  if (hearingHindrance) {
    lines.push("- Hearing: reduced by current bodily impairment")
  } else if (hasSense(["hearing", "listen", "耳", "听"])) {
    lines.push("- Hearing: unusually sensitive to subtle sound")
  }

  if (smellHindrance) {
    lines.push("- Smell: reduced by current bodily impairment")
  } else if (hasSense(["smell", "scent", "nose", "嗅"])) {
    lines.push("- Smell: sharper than ordinary baseline")
  }

  if (spiritualHindrance) {
    lines.push("- Spiritual perception: partially disrupted by local magical interference")
  } else if (hasSense(["spirit", "soul", "qi", "灵", "魂", "神识"])) {
    lines.push("- Spiritual perception: more sensitive than ordinary baseline")
  }

  if (cognitionHindrance) {
    lines.push("- Focus and bodily comfort: dulled by harsh environmental or bodily stress")
  }

  return sanitizeLines(lines, input.forbiddenSet)
}

function resolveEffectiveInput(params: Schema.Schema.Type<typeof Parameters>): EffectiveInput | { error: string } {
  const sceneFacts = params.sceneFacts?.trim() || params.l2View?.trim()
  const situationFrame = params.situationFrame?.trim() || params.situation?.trim()
  if (!sceneFacts) {
    return { error: "embody requires sceneFacts (or deprecated l2View)." }
  }
  if (!situationFrame) {
    return { error: "embody requires situationFrame (or deprecated situation)." }
  }
  return {
    sceneFacts,
    situationFrame,
    playerNudge: params.playerNudge?.trim() || undefined,
    focusHints: params.focusHints?.trim() || undefined,
    usedLegacyFields: !params.sceneFacts || !params.situationFrame,
  }
}

export function detectSubjectiveLeakage(input: {
  sceneFacts: string
  situationFrame: string
  focusHints?: string
  playerNudge?: string
}): string | undefined {
  const objectiveFields: Array<[string, string | undefined]> = [
    ["sceneFacts", input.sceneFacts],
    ["situationFrame", input.situationFrame],
    ["focusHints", input.focusHints],
  ]
  for (const [field, value] of objectiveFields) {
    if (!value) continue
    for (const rule of SUBJECTIVE_LEAKAGE_RULES) {
      if (rule.test(value)) {
        return `${field} contains subjective interpretation or intention. Rewrite it as objectively perceptible facts only.`
      }
    }
  }

  if (input.playerNudge) {
    for (const rule of PLAYER_NUDGE_HARD_OVERRIDE_RULES) {
      if (rule.test(input.playerNudge)) {
        return "playerNudge must remain a weak external steer, not a completed inner conclusion or asserted fact."
      }
    }
  }
  return undefined
}

function buildBlockedResult(character: string, reason: string, metadata?: Partial<EmbodyMetadata>) {
  return {
    title: `Embody: ${character} (blocked)`,
    output: reason,
    metadata: {
      character,
      filtered: false,
      blocked: true,
      blockedReason: reason,
      ...metadata,
    } satisfies EmbodyMetadata,
  }
}

function buildSubagentSystemPrompt(input: {
  character: string
  persona?: string
  selfKnowledgeSection: string
  characterSettingSection: string
  memorySection: string
  objectiveEnvironmentSection: string
  bodyStateSection: string
  baselineSensorySection: string
  effectiveSensorySection: string
  situationFrame: string
  sceneFacts: string
  focusHints?: string
  playerNudge?: string
}): string {
  return [
    `Character name: ${input.character}`,
    ...(input.persona
      ? [
          "",
          "## Persona",
          input.persona,
        ]
      : []),
    "",
    "## Core Self-Knowledge",
    input.selfKnowledgeSection,
    "",
    "## Accessible Setting File",
    input.characterSettingSection,
    "",
    "## Subjective Memories",
    input.memorySection,
    "",
    "## Objective Environment",
    input.objectiveEnvironmentSection,
    "",
    "## Current Body State",
    input.bodyStateSection,
    "",
    "## Baseline Sensory Profile",
    input.baselineSensorySection,
    "",
    "## Effective Sensory State Right Now",
    input.effectiveSensorySection,
    "",
    "## Situation Frame",
    input.situationFrame,
    "",
    "## Scene Facts",
    input.sceneFacts,
    ...(input.focusHints
      ? [
          "",
          "## Objective Focus Hints",
          input.focusHints,
        ]
      : []),
    ...(input.playerNudge
      ? [
          "",
          "## Optional Player Nudge",
          input.playerNudge,
        ]
      : []),
    "",
    "Treat Core Self-Knowledge as facts you know about yourself.",
    "Treat Accessible Setting File as the non-God Only material from your own setting file. Use it as part of your personal background knowledge.",
    "Treat Subjective Memories as the current contents of your own memory file and as your own remembered experience history.",
    "You are the authority over what belongs in that memory file; the Director only decides when to trigger memory handling.",
    "Use Subjective Memories to recall patterns, relationships, promises, and prior impressions, but do not let them override the current scene.",
    "If the memory file is empty, treat that as a blank starting state rather than missing data.",
    "Only update subjective memory when a detail is stable, emotionally or relationally important, or would reasonably be remembered later; otherwise keep it in the current turn only.",
    "When memory grows long, compress it into the most important recent truths and enduring patterns, preferably newest-first or highest-importance-first.",
    "Treat Objective Environment, Current Body State, Effective Sensory State Right Now, Situation Frame, and Scene Facts as the full extent of what you currently know about the outside world.",
    "Generate your own inner thought, emotion, and intent from those objective inputs. The Director is not the authority over your subjective interpretation.",
    "If Optional Player Nudge is present, treat it as a weak external steer about emphasis or lean, not as a fact, command, or already-finished inner conclusion.",
    "Use a positive information-boundary rule: rely on what is present in these sections, and do not mention missing or hidden information in negated form.",
    "If these sections support a plausible in-character suspicion or inference, you may express that suspicion or inference.",
    "",
    "Return exactly one JSON object for the Director and nothing else.",
    'Required keys: "inner_thought", "speech", "action_intent", "outward_action".',
    'All four values must be strings. Use "" for silence or for no immediate outward action.',
    "Do not wrap the JSON in markdown or code fences.",
    "Do not include final scene narration, outcome plans, or scene summaries.",
    "Use the question tool only when the character would plausibly ask for clarification.",
  ].join("\n")
}

export const EmbodyTool = Tool.define(
  "embody",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const filterService = yield* GodOnlyFilter.Service
    const fs = yield* AppFileSystem.Service

    const execute = (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<EmbodyMetadata>) =>
      Effect.gen(function* () {
        const effective = resolveEffectiveInput(params)
        if ("error" in effective) {
          return buildBlockedResult(params.character, effective.error)
        }

        const leakage = detectSubjectiveLeakage(effective)
        if (leakage) {
          return buildBlockedResult(params.character, leakage, { usedLegacyFields: effective.usedLegacyFields })
        }

        const ins = yield* InstanceState.context
        const worldPath = ins.world?.rootPath

        const forbiddenSet = worldPath
          ? yield* filterService.getForbiddenSet(worldPath).pipe(Effect.orDie)
          : { strings: new Set<string>(), fileHashes: new Map<string, string>() }

        const sceneFacts = filterL2View(effective.sceneFacts, forbiddenSet)
        const situationFrame = filterL2View(effective.situationFrame, forbiddenSet)
        const focusHints = effective.focusHints ? filterL2View(effective.focusHints, forbiddenSet) : undefined
        const playerNudge = effective.playerNudge ? filterL2View(effective.playerNudge, forbiddenSet) : undefined
        const wasFiltered =
          sceneFacts !== effective.sceneFacts ||
          situationFrame !== effective.situationFrame ||
          focusHints !== effective.focusHints ||
          playerNudge !== effective.playerNudge

        const characterAgent = yield* agents.get(params.character).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        const characterResources =
          worldPath
            ? yield* resolveCharacterWorldResources({
                fs,
                worldPath,
                character: params.character,
                preferredStatePath: characterAgent?.statePath,
              })
            : undefined
        const stateContent = characterResources?.stateContent
        const runtimeContent = worldPath
          ? yield* fs.readFileStringSafe(path.join(worldPath, "runtime.yaml")).pipe(Effect.orDie)
          : undefined
        const runtime = parseRuntimeData(runtimeContent)
        const runtimeCharacter = readRuntimeCharacter(runtime, params.character)
        const memoryLines =
          worldPath
            ? yield* readCharacterMemory({
                fs,
                worldPath,
                character: params.character,
                memoryPath: characterResources?.binding.memoryPath,
                forbiddenSet,
              })
            : []
        const selfKnowledgeLines = buildCharacterSelfKnowledge({
          character: params.character,
          characterAgent,
          stateContent,
          forbiddenSet,
        })
        const characterSettingSection = buildCharacterSettingSection({
          character: params.character,
          stateContent,
          forbiddenSet,
        })
        const objectiveEnvironmentLines = buildObjectiveEnvironmentLines({ runtime, forbiddenSet })
        const bodyStateLines = buildCharacterBodyStateLines({ runtimeCharacter, forbiddenSet })
        const baselineSensoryLines = buildBaselineSensoryLines({
          characterAgent,
          stateContent,
          forbiddenSet,
        })
        const effectiveSensoryLines = buildEffectiveSensoryStateLines({
          runtime,
          runtimeCharacter,
          characterAgent,
          forbiddenSet,
        })

        const selfKnowledgeSection =
          selfKnowledgeLines.length > 0 ? selfKnowledgeLines.join("\n") : `- Name: ${params.character}`
        const accessibleSettingSection = characterSettingSection ?? "- (none)"
        const memorySection = formatMemorySection(memoryLines)
        const objectiveEnvironmentSection = formatBulletSection(objectiveEnvironmentLines)
        const bodyStateSection = formatBulletSection(bodyStateLines)
        const baselineSensorySection = formatBulletSection(baselineSensoryLines)
        const effectiveSensorySection = formatBulletSection(effectiveSensoryLines)

        const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
        if (!ops) {
          const resultLines: string[] = [
            `## Embodying: ${params.character}`,
            "",
            "### Core Self-Knowledge",
            selfKnowledgeSection,
            "",
            "### Accessible Setting File",
            accessibleSettingSection,
            "",
            "### Subjective Memories",
            memorySection,
            "",
            "Treat Subjective Memories as the current contents of your own memory file. You are the authority over what belongs there.",
            "The Director only decides when to trigger memory handling; you decide the actual subjective content and impression scoring.",
            "If the memory file is empty, treat that as a blank starting state rather than missing data.",
            "",
            "### Objective Environment",
            objectiveEnvironmentSection,
            "",
            "### Current Body State",
            bodyStateSection,
            "",
            "### Baseline Sensory Profile",
            baselineSensorySection,
            "",
            "### Effective Sensory State Right Now",
            effectiveSensorySection,
            "",
            "### Situation Frame",
            situationFrame,
            "",
            "### Scene Facts",
            sceneFacts,
            ...(focusHints
              ? [
                  "",
                  "### Objective Focus Hints",
                  focusHints,
                ]
              : []),
            ...(playerNudge
              ? [
                  "",
                  "### Optional Player Nudge",
                  playerNudge,
                ]
              : []),
            "",
            "### Preferred Output Shape",
            "Return exactly one JSON object for the Director.",
            'Use these keys: "inner_thought", "speech", "action_intent", "outward_action".',
            'Use empty strings for silence or no immediate outward action.',
            "Do not write omniscient narration or final outcome prose.",
          ]
          const metadata: EmbodyMetadata = {
            character: params.character,
            filtered: wasFiltered,
            usedLegacyFields: effective.usedLegacyFields,
          }
          return {
            title: `Embody: ${params.character}`,
            output: resultLines.join("\n"),
            metadata,
          }
        }

        const parentSession = yield* sessions.get(ctx.sessionID).pipe(Effect.orDie)
        const characterSubagent = yield* agents.get("character").pipe(Effect.orDie)
        if (!characterSubagent) return yield* Effect.die(new Error('Character subagent "character" is unavailable'))
        const parentAgent = parentSession.agent
          ? yield* agents.get(parentSession.agent).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
          : undefined

        const cfg = yield* config.get().pipe(Effect.orDie)
        let model: { modelID: string; providerID: string }

        if (characterAgent?.model) {
          const agentModel = characterAgent.model
          model = { modelID: agentModel.modelID, providerID: agentModel.providerID }
        } else if (parentSession.model) {
          const sessionModel = parentSession.model
          model = { modelID: sessionModel.id, providerID: sessionModel.providerID }
        } else {
          model = parseModelString(cfg.model ?? "anthropic/claude-sonnet-4-20250514")!
        }

        const subagentSession = yield* sessions
          .create({
            parentID: ctx.sessionID,
            title: `Character: ${params.character}`,
            agent: characterSubagent.name,
            permission: deriveSubagentSessionPermission({
              parentSessionPermission: parentSession.permission ?? [],
              parentAgent,
              subagent: characterSubagent,
            }),
          })
          .pipe(Effect.orDie)

        const subagentSessionID = subagentSession.id
        const systemPrompt = buildSubagentSystemPrompt({
          character: params.character,
          persona: characterAgent?.persona,
          selfKnowledgeSection,
          characterSettingSection: accessibleSettingSection,
          memorySection,
          objectiveEnvironmentSection,
          bodyStateSection,
          baselineSensorySection,
          effectiveSensorySection,
          situationFrame,
          sceneFacts,
          focusHints,
          playerNudge,
        })

        const result = yield* ops
          .prompt({
            messageID: MessageID.ascending(),
            sessionID: subagentSessionID,
            model: {
              modelID: ModelID.make(model.modelID),
              providerID: ProviderID.make(model.providerID),
            },
            agent: characterSubagent.name,
            tools: {
              read: false,
              glob: false,
              grep: false,
              shell: false,
              edit: false,
              write: false,
              task: false,
              calc: false,
              dice_roll: false,
              narrate: false,
              scene_update: false,
              memory_update: false,
              memory_reflect: false,
              embody: false,
              todowrite: false,
            },
            system: systemPrompt,
            roleplay: {
              environmentOverride: `You are in a roleplay scene as ${params.character}. Objective environment, body state, and current sensory conditions have already been filtered to remove hidden truths that only the Director should know.`,
              instructionOverride: "",
              skillsOverride: "",
            },
            parts: [
              {
                type: "text",
                text: `Respond as ${params.character} in character based only on the provided self-knowledge, objective environment, body state, sensory state, situation frame, scene facts, and any optional weak player nudge. Give the Director a compact character sample, not final narration.`,
              },
            ],
          })
          .pipe(
            Effect.timeout("60 seconds"),
            Effect.catchCause(() =>
              Effect.succeed({
                info: {
                  role: "assistant" as const,
                  structured: undefined,
                },
                parts: [{ type: "text" as const, text: "[Character response timed out]" }],
              }),
            ),
          )

        const rawResponseText =
          result.info.role === "assistant" && result.info.structured
            ? JSON.stringify(result.info.structured)
            : result.parts
                .filter((item): item is { type: "text"; text: string } => item.type === "text")
                .map((item) => item.text)
                .join("\n")
                .trim()
        const parsedSample = rawResponseText.length > 0 ? tryParseCharacterSample(rawResponseText) : undefined
        const responseText = parsedSample ? JSON.stringify(parsedSample, null, 2) : rawResponseText

        const metadata: EmbodyMetadata = {
          character: params.character,
          filtered: wasFiltered,
          usedLegacyFields: effective.usedLegacyFields,
          subagentSessionID,
        }
        return {
          title: `Embody: ${params.character}`,
          output: responseText || "[No character sample returned]",
          metadata,
        }
      })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute,
    } satisfies Tool.DefWithoutID<typeof Parameters, EmbodyMetadata>
  }),
)
