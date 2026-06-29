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
import { MessageID, SessionID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import type { TaskPromptOps } from "./task"
import { deriveSubagentSessionPermission } from "@/agent/subagent-permissions"
import { characterMemoryPath } from "./memory-update"
import { formatMemoryEntry, normalizeMemoryFile, serializeMemoryFile } from "./memory-schema"
import {
    createEmptyCharacterMemory,
    resolveForCharacter,
    readManifest as readCharacterManifest,
} from "./character-directory"
import { extractRuntimeSceneDescriptor, parseRuntimeData, readRoleplaySceneState, resolveSceneKeyFromState } from "./roleplay-scene-state"

const Parameters = Schema.Struct({
    character: Schema.String.annotate({
        description: "Name of the character to embody (must be present in the scene)",
    }),
    sceneEvents: Schema.optional(
        Schema.Array(Schema.Record(Schema.String, Schema.Unknown)).annotate({
            description:
                "Optional structured current-scene event feed. Use JSON objects for fully observable events happening right now, especially direct speech, outward actions, and objective results. Never include any character's inner thoughts, feelings, intentions, plans, or hidden truth.",
        }),
    ),
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

type SceneEvent = Record<string, unknown>

type EffectiveInput = {
    sceneFacts: string
    situationFrame: string
    sceneEvents?: SceneEvent[]
    playerNudge?: string
    focusHints?: string
    usedLegacyFields: boolean
}

type CharacterBindingInfo = {
    memoryPath: string
}

type CharacterWorldResources = {
    binding: CharacterBindingInfo
    stateContent?: string
}

type ScenePlacement = {
    date?: string
    location?: string
}

const GOD_ONLY_ACCESS = new Set(["godonly"])
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

const SCENE_EVENT_SUBJECTIVE_KEYS = new Set([
    "innerthought",
    "innermonologue",
    "monologue",
    "thought",
    "thinking",
    "feeling",
    "feelings",
    "emotion",
    "emotions",
    "mood",
    "intent",
    "intents",
    "intention",
    "intentions",
    "actionintent",
    "plan",
    "plans",
    "goal",
    "goals",
    "motivation",
    "motivations",
    "motive",
    "motives",
    "belief",
    "beliefs",
    "judgment",
    "judgement",
    "conclusion",
    "conclusions",
    "inference",
    "inferences",
    "suspicion",
    "suspicions",
    "private",
    "privateknowledge",
    "mentalstate",
    "mindstate",
])
const SCENE_EVENT_DIRECT_SPEECH_KEYS = new Set(["speech", "dialogue", "line", "quote", "words", "utterance", "text"])
const SCENE_EVENT_SUBJECTIVE_SUFFIXES = [
    "innerthought",
    "innermonologue",
    "thought",
    "thinking",
    "feeling",
    "feelings",
    "emotion",
    "emotions",
    "mood",
    "intent",
    "intents",
    "intention",
    "intentions",
    "actionintent",
    "plan",
    "plans",
    "goal",
    "goals",
    "motivation",
    "motivations",
    "motive",
    "motives",
    "belief",
    "beliefs",
    "judgment",
    "judgement",
    "conclusion",
    "conclusions",
    "inference",
    "inferences",
    "suspicion",
    "suspicions",
    "mentalstate",
    "mindstate",
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
                ? (
                      {
                          innerthought: "inner_thought",
                          speech: "speech",
                          actionintent: "action_intent",
                          outwardaction: "outward_action",
                      } as const
                  )[normalizedKey]
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

    const parts = value.map((item) => formatPrimitive(item)).filter((item): item is string => !!item)
    return parts.length > 0 ? parts.join("、") : undefined
}

function formatStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map((item) => formatPrimitive(item)).filter((item): item is string => !!item)
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
    const result = new Map<string, { binding: CharacterBindingInfo; score: number }>()
    for (const file of files) {
        const basename = path.basename(file.relativePath)
        if (basename !== "profile.yaml") continue
        try {
            const parsed = parse(file.content)
            const root = readObject(parsed)
            if (!root) continue
            let character = formatPrimitive(root.name)
            if (!character) {
                for (const [key, value] of Object.entries(root)) {
                    const nested = readObject(value)
                    if (!nested) continue
                    character = extractCharacterNames(nested, key)[0]
                    if (character) break
                }
            }
            if (!character) continue
            const relativeDir = path.dirname(file.relativePath)
            const score = isHiddenCharacterStatePath(file.relativePath) ? -1000 : 0
            const previous = result.get(character)
            if (previous && previous.score >= score) continue
            result.set(character, {
                binding: {
                    memoryPath: path.join(relativeDir, "memory.yaml"),
                },
                score,
            })
        } catch {
            continue
        }
    }
    return Object.fromEntries(Array.from(result.entries()).map(([character, value]) => [character, value.binding]))
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
        const items = node.map((item) => buildAccessibleSettingNode(item)).filter((item) => item !== undefined)
        return items.length > 0 ? items : undefined
    }

    if (typeof node !== "object" || node === null) return undefined

    const obj = node as Record<string, unknown>
    if (isGodOnlyAccess(obj.access)) return undefined

    const hasWrapperSemantics =
        "access" in obj ||
        "apparent_content" in obj ||
        (VALUE_FIELDS.some((field) => field in obj) &&
            Object.keys(obj).every(
                (key) =>
                    ACCESSIBLE_SETTING_SKIP_KEYS.has(key) ||
                    VALUE_FIELDS.includes(key as (typeof VALUE_FIELDS)[number]),
            ))

    if (hasWrapperSemantics) {
        for (const field of VALUE_FIELDS) {
            const resolved = buildAccessibleSettingNode(obj[field])
            if (resolved !== undefined) return resolved
        }
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

export function sanitizeSceneEvents(value: unknown, forbiddenSet: ForbiddenSet | undefined): unknown {
    if (typeof value === "string") {
        return forbiddenSet ? filterL2View(value, forbiddenSet) : value
    }
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeSceneEvents(item, forbiddenSet))
    }
    const obj = readObject(value)
    if (!obj) return value

    return Object.fromEntries(Object.entries(obj).map(([key, item]) => [key, sanitizeSceneEvents(item, forbiddenSet)]))
}

export function formatSceneEventsSection(events: SceneEvent[] | undefined): string | undefined {
    if (!events || events.length === 0) return
    return events
        .map((event) => {
            const actor = typeof event.actor === "string" && event.actor.trim() ? event.actor.trim() : "有人"
            const timing = typeof event.timing === "string" && event.timing.trim() ? event.timing.trim() : undefined
            const target = typeof event.target === "string" && event.target.trim() ? event.target.trim() : undefined
            const speech = typeof event.speech === "string" && event.speech.trim() ? event.speech.trim() : undefined
            const action = typeof event.action === "string" && event.action.trim() ? event.action.trim() : undefined
            const result = typeof event.result === "string" && event.result.trim() ? event.result.trim() : undefined

            const rendered: string[] = []
            if (timing) rendered.push(`时机=${timing}`)
            if (speech) rendered.push(`${actor}开口：“${speech}”`)
            if (action) rendered.push(`${actor}${speech ? "随后" : ""}${action}`)
            if (result) rendered.push(`结果：${result}`)
            if (target) rendered.push(`对象=${target}`)

            const usedKeys = new Set(["actor", "timing", "target", "speech", "action", "result"])
            for (const [key, value] of Object.entries(event)) {
                if (usedKeys.has(key)) continue
                if (value === undefined || value === null) continue
                if (typeof value === "string" && value.trim().length === 0) continue
                rendered.push(`${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
            }

            return `- ${rendered.join("；")}`
        })
        .join("\n")
}

function isSubjectiveSceneEventKey(key: string): boolean {
    const normalized = normalizeToken(key)
    return (
        SCENE_EVENT_SUBJECTIVE_KEYS.has(normalized) ||
        SCENE_EVENT_SUBJECTIVE_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
    )
}

function detectSceneEventLeakage(value: unknown, path = "sceneEvents", parentKey?: string): string | undefined {
    if (typeof value === "string") {
        if (parentKey && SCENE_EVENT_DIRECT_SPEECH_KEYS.has(normalizeToken(parentKey))) return
        for (const rule of SUBJECTIVE_LEAKAGE_RULES) {
            if (rule.test(value)) {
                return `${path} contains subjective interpretation or intention. Keep sceneEvents strictly to observable speech, outward action, and objective results.`
            }
        }
        return
    }
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
            const issue = detectSceneEventLeakage(value[index], `${path}[${index}]`, parentKey)
            if (issue) return issue
        }
        return
    }
    const obj = readObject(value)
    if (!obj) return

    for (const [key, item] of Object.entries(obj)) {
        if (isSubjectiveSceneEventKey(key)) {
            return `${path}.${key} exposes another character's private subjective state. sceneEvents may include only observable speech, outward action, and objective results.`
        }
        const issue = detectSceneEventLeakage(item, `${path}.${key}`, key)
        if (issue) return issue
    }
}

function formatBulletSection(lines: string[]): string {
    if (lines.length === 0) return "- (none)"
    return lines.join("\n")
}

export function buildScenePlacement(input: {
    runtime: RuntimeData | undefined
    forbiddenSet?: ForbiddenSet
}): ScenePlacement | undefined {
    const descriptor = extractRuntimeSceneDescriptor(input.runtime)
    const sanitize = (value: string | undefined) => {
        if (!value) return undefined
        return input.forbiddenSet ? filterL2View(value, input.forbiddenSet) : value
    }
    const date = sanitize(descriptor?.date)
    const location = sanitize(descriptor?.location)
    if (!date && !location) return
    return { date, location }
}

function formatScenePlacementSection(scenePlacement: ScenePlacement | undefined): string {
    const lines: string[] = []
    if (scenePlacement?.date) lines.push(`- 当前时间：${scenePlacement.date}`)
    if (scenePlacement?.location) lines.push(`- 当前地点：${scenePlacement.location}`)
    return lines.length > 0 ? lines.join("\n") : "- 当前时间地点未明确写入 runtime.yaml。"
}

export function buildRoleplayEnvironmentOverride(input: {
    character: string
    scenePlacement?: ScenePlacement
}): string {
    const lines = [
        `当前角色：${input.character}。你正身在这一幕之中；请面对此刻能感知到的现场，以及自己主动回忆到的个人资源，理解自己的处境。`,
    ]
    if (input.scenePlacement?.date) lines.push(`当前时间：${input.scenePlacement.date}。`)
    if (input.scenePlacement?.location) lines.push(`当前地点：${input.scenePlacement.location}。`)
    return lines.join(" ")
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

export function ensureCharacterBinding(input: { fs: AppFileSystem.Interface; worldPath: string; character: string }) {
    return Effect.gen(function* () {
        const resolved = yield* resolveForCharacter({
            fs: input.fs,
            worldPath: input.worldPath,
            character: input.character,
        })
        const info = resolved.info
        if (!info) {
            return {
                memoryPath: path.join("characters", input.character, "memory.yaml"),
            } satisfies CharacterBindingInfo
        }
        return {
            memoryPath: info.memoryRelativePath,
        } satisfies CharacterBindingInfo
    })
}

export function resolveCharacterWorldResources(input: {
    fs: AppFileSystem.Interface
    worldPath: string
    character: string
}) {
    return Effect.gen(function* () {
        const resolved = yield* resolveForCharacter({
            fs: input.fs,
            worldPath: input.worldPath,
            character: input.character,
        })
        const info = resolved.info
        const binding = info
            ? ({
                  memoryPath: info.memoryRelativePath,
              } satisfies CharacterBindingInfo)
            : yield* ensureCharacterBinding(input)
        const stateContent = info ? yield* input.fs.readFileStringSafe(info.profilePath).pipe(Effect.orDie) : undefined
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
        let fullPath = input.memoryPath
            ? path.join(input.worldPath, input.memoryPath)
            : characterMemoryPath(input.worldPath, input.character)
        const resolved = yield* resolveForCharacter({
            fs: input.fs,
            worldPath: input.worldPath,
            character: input.character,
        })
        if (resolved.info) {
            fullPath = resolved.info.memoryPath
        }
        const exists = yield* input.fs.existsSafe(fullPath).pipe(Effect.orDie)
        if (!exists) {
            const empty = `${createEmptyCharacterMemory()}\n`
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

export function resolveRuntimeSceneKey(input: {
    runtime: RuntimeData | undefined
    parentSessionID: string
    character: string
    storedScene?: {
        key: string
        sceneID?: string
        date?: string
        location?: string
        ownerSessionID?: string
    }
}): string {
    const storedKey = resolveSceneKeyFromState({
        stored: input.storedScene,
        sessionID: input.parentSessionID,
    })
    if (storedKey) return storedKey

    const descriptor = extractRuntimeSceneDescriptor(input.runtime)
    if (input.storedScene?.ownerSessionID && input.storedScene.ownerSessionID !== input.parentSessionID) {
        return `session:${input.parentSessionID}`
    }
    const rawSceneID = descriptor?.sceneID
    if (rawSceneID) return `scene:${rawSceneID}`

    const date = descriptor?.date
    const location = descriptor?.location
    if (date || location) {
        return `legacy:${date ?? ""}|${location ?? ""}`
    }

    // Fail open when runtime.yaml is missing or malformed. This avoids blocking roleplay
    // while still giving the current turn a deterministic lookup key.
    return `ephemeral:${input.parentSessionID}:${input.character}`
}

export function matchReusableRoleplaySession(input: {
    children: Session.Info[]
    character: string
    sceneKey: string
    purpose: NonNullable<Session.Info["roleplayPurpose"]>
}) {
    return input.children.find(
        (item) =>
            item.roleplayCharacter === input.character &&
            item.roleplaySceneKey === input.sceneKey &&
            item.roleplayPurpose === input.purpose,
    )
}

function createCharacterSubagentSession(input: {
    sessions: Session.Interface
    parentSessionID: SessionID
    character: string
    characterSubagent: Agent.Info
    parentSessionPermission: Session.Info["permission"]
    parentAgent: Agent.Info | undefined
    sceneKey: string
}) {
    return input.sessions
        .create({
            parentID: input.parentSessionID,
            title: `Character: ${input.character}`,
            agent: input.characterSubagent.name,
            permission: deriveSubagentSessionPermission({
                parentSessionPermission: input.parentSessionPermission ?? [],
                parentAgent: input.parentAgent,
                subagent: input.characterSubagent,
            }),
            roleplayCharacter: input.character,
            roleplaySceneKey: input.sceneKey,
            roleplayPurpose: "embody",
        })
        .pipe(Effect.orDie)
}

const resolveReusableCharacterSubagentSession = Effect.fn("Embody.resolveReusableCharacterSubagentSession")(function* (
    input: {
        sessions: Session.Interface
        parentSessionID: SessionID
        character: string
        characterSubagent: Agent.Info
        parentSessionPermission: Session.Info["permission"]
        parentAgent: Agent.Info | undefined
        sceneKey: string
    },
) {
    const fresh = () =>
        createCharacterSubagentSession({
            sessions: input.sessions,
            parentSessionID: input.parentSessionID,
            character: input.character,
            characterSubagent: input.characterSubagent,
            parentSessionPermission: input.parentSessionPermission,
            parentAgent: input.parentAgent,
            sceneKey: input.sceneKey,
        })

    const children = yield* input.sessions
        .children(SessionID.make(input.parentSessionID))
        .pipe(Effect.catchCause(() => Effect.succeed<Session.Info[]>([])))
    const reusable = matchReusableRoleplaySession({
        children,
        character: input.character,
        sceneKey: input.sceneKey,
        purpose: "embody",
    })
    if (reusable) return reusable
    return yield* fresh().pipe(
        Effect.catchCause(() =>
            // Roleplay continuity must never block the current embody sampling.
            // If continuity metadata or session lookup/creation misbehaves, fall back
            // to a plain fresh child session and continue the turn.
            createCharacterSubagentSession({
                sessions: input.sessions,
                parentSessionID: input.parentSessionID,
                character: input.character,
                characterSubagent: input.characterSubagent,
                parentSessionPermission: input.parentSessionPermission,
                parentAgent: input.parentAgent,
                sceneKey: `ephemeral:${input.parentSessionID}:${input.character}`,
            }),
        ),
    )
})

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
        weather && formatPrimitive(weather.temperature)
            ? `temperature ${formatPrimitive(weather.temperature)}C`
            : undefined,
        weather && formatPrimitive(weather.humidity) ? `humidity ${formatPrimitive(weather.humidity)}%` : undefined,
        weather && formatPrimitive(weather.wind_speed) ? `wind ${formatPrimitive(weather.wind_speed)} m/s` : undefined,
        weather && formatPrimitive(weather.wind_direction)
            ? `wind direction ${formatPrimitive(weather.wind_direction)}`
            : undefined,
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
        formatPrimitive(illumination?.primary_source)
            ? `primary source ${formatPrimitive(illumination?.primary_source)}`
            : undefined,
        formatPrimitive(celestial?.moon_phase) ? `moon ${formatPrimitive(celestial?.moon_phase)}` : undefined,
        typeof celestial?.stars_visible === "boolean" ? `stars visible ${String(celestial.stars_visible)}` : undefined,
        formatPrimitive(illumination?.terrain_shadow)
            ? `terrain shadow ${formatPrimitive(illumination?.terrain_shadow)}`
            : undefined,
    ].filter((item): item is string => !!item)
    if (lightParts.length > 0) lines.push(`- Illumination: ${lightParts.join(", ")}`)

    const artificialLights = formatStringArray(illumination?.artificial_lights)
    if (artificialLights.length > 0) lines.push(`- Artificial lights: ${artificialLights.join("、")}`)

    const obstructionParts = [
        obstruction && formatPrimitive(obstruction.clouds)
            ? `clouds ${formatPrimitive(obstruction.clouds)}`
            : undefined,
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
        if (hasAnySignal(impairmentSignals, ["blind", "蒙眼", "遮眼", "失明", "眼伤"]))
            reasons.push("eye restraint or injury")
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
        sceneEvents: params.sceneEvents?.filter((item) => Object.keys(item).length > 0),
        playerNudge: params.playerNudge?.trim() || undefined,
        focusHints: params.focusHints?.trim() || undefined,
        usedLegacyFields: !params.sceneFacts || !params.situationFrame,
    }
}

export function detectSubjectiveLeakage(input: {
    sceneFacts: string
    situationFrame: string
    sceneEvents?: SceneEvent[]
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

    if (input.sceneEvents) {
        const issue = detectSceneEventLeakage(input.sceneEvents)
        if (issue) return issue
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

const CHARACTER_SCENE_PROMPT_TEMPLATE = `
当前角色：{{character}}
请立刻进入这个角色的当下处境。

{{persona_section}}

## 作为{{character}}，你对自己的把握
{{self_knowledge_section}}

{{resources_section}}

## 先把自己放进这一刻
先用{{character}}自己的身体、经验、脾气、记忆去理解眼前这一幕。
你接下来生出的理解、情绪、戒心、渴望、迟疑或趣味，都必须从这些你此刻能感知到或主动回忆到的现实里自然长出来。

### 你此刻明确身在
{{scene_placement_section}}

### 你所处的环境
{{environment_section}}

### 你此刻的身体
{{body_section}}

### 你此刻的感知条件
{{senses_section}}

### 眼前的局势
{{situation_frame}}

### 你立刻能察觉到的细节
{{scene_facts}}

{{scene_events_section}}

{{focus_hints_section}}

{{player_nudge_section}}

## 现在，作为{{character}}来反应
思考：这件事先触碰到了你哪里，牵动了你什么，让你怎么想，打算怎么做。
然后把回答收束在角色此刻真实会冒出的反应上，让念头、话语、打算和外在动作都停留在当下这一刻。

只返回一个 JSON 对象，字段固定为：
- \`inner_thought\`: 此刻最先冒出的内心念头
- \`speech\`: 真正说出口的话；若沉默则返回空字符串
- \`action_intent\`: 你下一步最想做什么
- \`outward_action\`: 外人看得见的动作、神情或姿态；若没有则返回空字符串

不要用 markdown 包裹 JSON，也不要输出任何额外说明。
`.trim()

function renderPromptTemplate(template: string, variables: Record<string, string>): string {
    return template
        .replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables[key] ?? "")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
}

function optionalPromptSection(title: string, content?: string): string {
    if (!content) return ""
    const trimmed = content.trim()
    if (!trimmed) return ""
    return `${title}\n${trimmed}`
}

export function buildSubagentSystemPrompt(input: {
    character: string
    persona?: string
    selfKnowledgeSection: string
    visibleResourcesSection: string
    scenePlacementSection: string
    objectiveEnvironmentSection: string
    bodyStateSection: string
    baselineSensorySection: string
    effectiveSensorySection: string
    situationFrame: string
    sceneFacts: string
    sceneEventsSection?: string
    focusHints?: string
    playerNudge?: string
}): string {
    const personaSection = input.persona?.trim() ? `## 你的底色\n${input.persona.trim()}` : ""
    const resourcesSection =
        input.visibleResourcesSection && input.visibleResourcesSection !== "(empty)"
            ? [
                  "## 若要回忆或确认，你可以翻这些自己的资源",
                  "使用 `character_view_read` 去读真正需要的文件，不必一次全读。",
                  input.visibleResourcesSection,
              ].join("\n")
            : ""

    const environmentSection =
        input.objectiveEnvironmentSection && input.objectiveEnvironmentSection !== "- 无"
            ? input.objectiveEnvironmentSection
            : "- 你周围没有额外补充的环境线索。"
    const bodySection =
        input.bodyStateSection && input.bodyStateSection !== "- 无特殊状态"
            ? input.bodyStateSection
            : "- 你此刻没有额外补充的身体异常。"

    const hasBaselineSensory = input.baselineSensorySection && input.baselineSensorySection !== "- 感官正常"
    const hasEffectiveSensory = input.effectiveSensorySection && input.effectiveSensorySection !== "- 感官正常"
    const sensesSection = hasEffectiveSensory
        ? input.effectiveSensorySection
        : hasBaselineSensory
          ? input.baselineSensorySection
          : "- 你的感知没有额外异常，可按平常状态体验这一刻。"

    return renderPromptTemplate(CHARACTER_SCENE_PROMPT_TEMPLATE, {
        character: input.character,
        persona_section: personaSection,
        self_knowledge_section: input.selfKnowledgeSection.trim(),
        resources_section: resourcesSection,
        scene_placement_section: input.scenePlacementSection.trim(),
        environment_section: environmentSection,
        body_section: bodySection,
        senses_section: sensesSection,
        situation_frame: input.situationFrame.trim(),
        scene_facts: input.sceneFacts.trim(),
        scene_events_section: optionalPromptSection("### 你刚刚亲历的言行", input.sceneEventsSection),
        focus_hints_section: optionalPromptSection("### 你不妨额外留意的客观细节", input.focusHints),
        player_nudge_section: optionalPromptSection("### 玩家给你的引导", input.playerNudge),
    })
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
                    return buildBlockedResult(params.character, leakage, {
                        usedLegacyFields: effective.usedLegacyFields,
                    })
                }

                const ins = yield* InstanceState.context
                const worldPath = ins.world?.rootPath

                const forbiddenSet = worldPath
                    ? yield* filterService.getForbiddenSet(worldPath).pipe(Effect.orDie)
                    : { strings: new Set<string>(), fileHashes: new Map<string, string>() }

                const sceneFacts = filterL2View(effective.sceneFacts, forbiddenSet)
                const situationFrame = filterL2View(effective.situationFrame, forbiddenSet)
                const sceneEvents = effective.sceneEvents?.map(
                    (item) => sanitizeSceneEvents(item, forbiddenSet) as SceneEvent,
                )
                const focusHints = effective.focusHints ? filterL2View(effective.focusHints, forbiddenSet) : undefined
                const playerNudge = effective.playerNudge
                    ? filterL2View(effective.playerNudge, forbiddenSet)
                    : undefined
                const rawSceneEvents = effective.sceneEvents ? JSON.stringify(effective.sceneEvents) : undefined
                const filteredSceneEvents = sceneEvents ? JSON.stringify(sceneEvents) : undefined
                const wasFiltered =
                    sceneFacts !== effective.sceneFacts ||
                    situationFrame !== effective.situationFrame ||
                    rawSceneEvents !== filteredSceneEvents ||
                    focusHints !== effective.focusHints ||
                    playerNudge !== effective.playerNudge

                const characterAgent = yield* agents
                    .get(params.character)
                    .pipe(Effect.catchCause(() => Effect.succeed(undefined)))
                const characterResources = worldPath
                    ? yield* resolveCharacterWorldResources({
                          fs,
                          worldPath,
                          character: params.character,
                      })
                    : undefined
                const stateContent = characterResources?.stateContent
                const runtimeContent = worldPath
                    ? yield* fs.readFileStringSafe(path.join(worldPath, "runtime.yaml")).pipe(Effect.orDie)
                    : undefined
                const runtime = parseRuntimeData(runtimeContent) as RuntimeData | undefined
                const sceneState = worldPath
                    ? yield* readRoleplaySceneState({ fs, worldRoot: worldPath }).pipe(Effect.orDie)
                    : undefined
                const runtimeCharacter = readRuntimeCharacter(runtime, params.character)
                const selfKnowledgeLines = buildCharacterSelfKnowledge({
                    character: params.character,
                    characterAgent,
                    stateContent,
                    forbiddenSet,
                })
                const scenePlacement = buildScenePlacement({ runtime, forbiddenSet })
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
                const directoryInfo = worldPath
                    ? (yield* resolveForCharacter({ fs, worldPath, character: params.character })).info
                    : undefined
                const visibleResources = directoryInfo
                    ? yield* readCharacterManifest({ fs, info: directoryInfo }).pipe(
                          Effect.catch(() => Effect.succeed(["profile.yaml", "memory.yaml"])),
                      )
                    : ["profile.yaml", "memory.yaml"]
                const visibleResourcesSection = visibleResources.length > 0 ? visibleResources.join("\n") : "(empty)"
                const scenePlacementSection = formatScenePlacementSection(scenePlacement)
                const objectiveEnvironmentSection = formatBulletSection(objectiveEnvironmentLines)
                const bodyStateSection = formatBulletSection(bodyStateLines)
                const baselineSensorySection = formatBulletSection(baselineSensoryLines)
                const effectiveSensorySection = formatBulletSection(effectiveSensoryLines)
                const sceneEventsSection = formatSceneEventsSection(sceneEvents)

                const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
                if (!ops) {
                    const resultLines: string[] = [
                        `## Embodying: ${params.character}`,
                        "",
                        "### Core Self-Knowledge",
                        selfKnowledgeSection,
                        "",
                        "### Visible Character Resources",
                        visibleResourcesSection,
                        "",
                        'Read your own manifest first, then use character_view_read(target="resource", path=...) for whichever listed resources you need.',
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
                        ...(sceneEventsSection ? ["", "### Structured Scene Events", sceneEventsSection] : []),
                        ...(focusHints ? ["", "### Objective Focus Hints", focusHints] : []),
                        ...(playerNudge ? ["", "### Optional Player Nudge", playerNudge] : []),
                        "",
                        "### Preferred Output Shape",
                        "Return exactly one JSON object for the Director.",
                        'Use these keys: "inner_thought", "speech", "action_intent", "outward_action".',
                        "Use empty strings for silence or no immediate outward action.",
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
                if (!characterSubagent)
                    return yield* Effect.die(new Error('Character subagent "character" is unavailable'))
                const parentAgent = parentSession.agent
                    ? yield* agents.get(parentSession.agent).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
                    : undefined

                const cfg = yield* config.get().pipe(Effect.orDie)
                let model: { modelID: string; providerID: string }

                if (characterAgent?.model) {
                    const agentModel = characterAgent.model
                    model = { modelID: agentModel.modelID, providerID: agentModel.providerID }
                } else if (cfg.roleplay?.characterModel) {
                    model = parseModelString(cfg.roleplay.characterModel)!
                } else if (parentSession.model) {
                    const sessionModel = parentSession.model
                    model = { modelID: sessionModel.id, providerID: sessionModel.providerID }
                } else {
                    model = parseModelString(cfg.model ?? "anthropic/claude-sonnet-4-20250514")!
                }

                const sceneKey = resolveRuntimeSceneKey({
                    runtime,
                    parentSessionID: ctx.sessionID,
                    character: params.character,
                    storedScene: sceneState?.current,
                })
                const subagentSession = yield* resolveReusableCharacterSubagentSession({
                    sessions,
                    parentSessionID: ctx.sessionID,
                    character: params.character,
                    characterSubagent,
                    parentSessionPermission: parentSession.permission,
                    parentAgent,
                    sceneKey,
                })

                const subagentSessionID = subagentSession.id
                const systemPrompt = buildSubagentSystemPrompt({
                    character: params.character,
                    persona: characterAgent?.persona,
                    selfKnowledgeSection,
                    visibleResourcesSection,
                    objectiveEnvironmentSection,
                    scenePlacementSection,
                    bodyStateSection,
                    baselineSensorySection,
                    effectiveSensorySection,
                    situationFrame,
                    sceneFacts,
                    sceneEventsSection,
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
                            character_view_read: true,
                            memory_update: false,
                            memory_reflect: false,
                            embody: false,
                            todowrite: false,
                        },
                        system: systemPrompt,
                        roleplay: {
                            environmentOverride: buildRoleplayEnvironmentOverride({
                                character: params.character,
                                scenePlacement,
                            }),
                            instructionOverride: "",
                            skillsOverride: "",
                        },
                        parts: [
                            {
                                type: "text",
                                text: `Respond as ${params.character} in character. First inspect any listed role resources you need, then use the provided objective scene state to give the Director a compact character sample, not final narration.`,
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
