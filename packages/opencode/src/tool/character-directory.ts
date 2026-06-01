export * as CharacterDirectory from "./character-directory"

import path from "path"
import { Effect } from "effect"
import { parse, stringify } from "yaml"
import { AppFileSystem } from "@openplay-ai/core/filesystem"
import { normalizeMemoryFile, serializeMemoryFile } from "./memory-schema"

export type CharacterDirectoryInfo = {
  character: string
  relativeDir: string
  dirPath: string
  profileRelativePath: string
  profilePath: string
  memoryRelativePath: string
  memoryPath: string
  knowledgeRelativeDir: string
  knowledgeDirPath: string
  gmNotesRelativePath?: string
  gmNotesPath?: string
  gmNotesRelativeDir?: string
  gmNotesDirPath?: string
}

export type CharacterConflict = {
  character: string
  primaryRelativeDir: string
  duplicateRelativeDir: string
}

export type CharacterDirectoryIndex = {
  ordered: CharacterDirectoryInfo[]
  byCharacter: Map<string, CharacterDirectoryInfo>
  conflicts: CharacterConflict[]
  warnings: string[]
}

const PROFILE_BASENAME = "profile.yaml"
const MEMORY_BASENAME = "memory.yaml"
const KNOWLEDGE_DIRNAME = "knowledge"
const GM_NOTES_BASENAME = "gm_notes.yaml"
const GM_NOTES_DIRNAME = "gm_notes"

const CHARACTER_RESOURCE_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".yaml",
  ".yml",
  ".json",
  ".csv",
])

const GOD_ONLY_VALUES = new Set(["godonly"])
const VALUE_FIELDS = ["content", "current", "value", "name", "text", "description"] as const

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[\s_\-]/g, "")
}

function isGodOnlyAccess(access: unknown): boolean {
  return typeof access === "string" && GOD_ONLY_VALUES.has(normalizeToken(access))
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function formatPrimitive(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return undefined
}

function extractCharacterNames(record: Record<string, unknown>, fallbackKey?: string): string[] {
  const names = new Set<string>()
  const directName = formatPrimitive(record.name)
  if (directName) names.add(directName)
  for (const aliasField of ["aliases", "alias", "names"] as const) {
    const raw = record[aliasField]
    if (!Array.isArray(raw)) continue
    for (const item of raw) {
      const value = formatPrimitive(item)
      if (value) names.add(value)
    }
  }
  if (fallbackKey?.trim()) names.add(fallbackKey.trim())
  return Array.from(names).filter((name) => name.length > 0)
}

function parseCharacterNameFromProfileContent(content: string): string | undefined {
  try {
    const parsed = parse(content)
    const root = readObject(parsed)
    if (!root) return

    const direct = formatPrimitive(root.name)
    if (direct) return direct

    for (const [key, value] of Object.entries(root)) {
      const nested = readObject(value)
      if (!nested) continue
      const match = extractCharacterNames(nested, key)[0]
      if (match) return match
    }
  } catch {
    return
  }
  return
}

function isTextLikeCharacterResource(relativePath: string): boolean {
  return CHARACTER_RESOURCE_EXTENSIONS.has(path.extname(relativePath).toLowerCase())
}

function pruneGodOnlyNode(node: unknown): unknown {
  if (Array.isArray(node)) {
    const items = node.map(pruneGodOnlyNode).filter((item) => item !== undefined)
    return items
  }
  if (typeof node !== "object" || node === null) return node

  const obj = node as Record<string, unknown>
  if (isGodOnlyAccess(obj.access)) return undefined

  for (const field of VALUE_FIELDS) {
    if (!(field in obj)) continue
    const value = pruneGodOnlyNode(obj[field])
    if (value !== undefined) {
      const clone: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(obj)) {
        if (key === field) continue
        const next = pruneGodOnlyNode(entry)
        if (next !== undefined) clone[key] = next
      }
      clone[field] = value
      return clone
    }
  }

  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const next = pruneGodOnlyNode(value)
    if (next !== undefined) output[key] = next
  }
  return Object.keys(output).length > 0 ? output : undefined
}

export function renderGodOnlyFilteredYaml(content: string): string {
  try {
    const parsed = parse(content)
    const filtered = pruneGodOnlyNode(parsed)
    if (filtered === undefined) return ""
  return stringify(filtered).trim()
  } catch {
    return content.trim()
  }
}

const STARTER_KNOWLEDGE_FILES = [
  "social_and_world.md",
  "nature_and_body.md",
  path.join("people", "README.md"),
] as const

function buildStarterKnowledgeContent(character: string, relativePath: string): string {
  if (relativePath === "social_and_world.md") {
    return [
      `# ${character} 对社会与世道的长期认知`,
      "",
      "记录较稳定的社会观察、世道体会、礼法判断、势力风向、风俗理解。",
      "只保留会持续影响你判断方式的内容，不写完整场景流水账。",
      "",
      "## 可记录内容",
      "- 某地风气、规矩、禁忌",
      "- 某个势力、阶层、职业群体给你的长期印象",
      "- 你对人情、权力、承诺、危险的体会",
      "",
      "## 更新原则",
      "- 写稳定认知，不写瞬时情绪",
      "- 重要变化可直接修订旧条目",
      "- 保持角色主观视角",
      "",
    ].join("\n")
  }

  if (relativePath === "nature_and_body.md") {
    return [
      `# ${character} 对自然与身体感受的长期认知`,
      "",
      "记录较稳定的自然观察、地理印象、气候体会、灵气环境判断、身体或感官层面的经验。",
      "只保留会持续影响你行动与感知方式的内容。",
      "",
      "## 可记录内容",
      "- 某片地域、季节、天气、植被、水土的长期印象",
      "- 对气味、光线、温度、声音、灵力波动的经验判断",
      "- 某种伤势、旧疾、习惯反应、身体偏好",
      "",
      "## 更新原则",
      "- 写可复用经验，不写一次性细节",
      "- 允许保留带体感的主观描述",
      "- 若判断被新经历推翻，直接修订旧结论",
      "",
    ].join("\n")
  }

  return [
    `# ${character} 对其他人物的认知`,
    "",
    "可在本目录下为每个重要人物单独建立一个文件，例如 `knowledge/people/宋祈.md`。",
    "记录长期印象、信任变化、相处规律、危险判断、熟悉的言行习惯。",
    "",
    "## 建议",
    "- 一人一文件，便于持续修订",
    "- 写你真正会长期记住并据此行动的认知",
    "- 区分你亲眼所见、亲身所感、以及你自己的推断",
    "",
  ].join("\n")
}

export function normalizeCharacterMemoryContent(content: string | undefined): string {
  return serializeMemoryFile(normalizeMemoryFile(content)).trim()
}

export function getKnowledgeAbsolutePath(info: CharacterDirectoryInfo, relativePath: string): string {
  return path.join(info.knowledgeDirPath, relativePath)
}

export function getKnowledgeRelativePath(info: CharacterDirectoryInfo, relativePath: string): string {
  return path.join(info.knowledgeRelativeDir, relativePath)
}

export function isSafeKnowledgePath(relativePath: string): boolean {
  if (!relativePath) return false
  if (path.isAbsolute(relativePath)) return false
  const normalized = path.posix.normalize(relativePath.replaceAll("\\", "/"))
  if (normalized.startsWith("../") || normalized === "..") return false
  return !normalized.split("/").some((segment) => segment === "..")
}

export function createEmptyCharacterMemory(): string {
  return normalizeCharacterMemoryContent(undefined)
}

export function getCharacterMemoryFilePath(info: CharacterDirectoryInfo): string {
  return info.memoryPath
}

export function getCharacterMemoryRelativePath(info: CharacterDirectoryInfo): string {
  return info.memoryRelativePath
}

export function classifyLegacyCharacterFile(input: { relativePath: string; content: string }) {
  const normalized = normalizeToken(path.basename(input.relativePath, path.extname(input.relativePath)))
  const hiddenByName = ["hidden", "godonly", "secret", "private"].some((token) => normalized.includes(token))
  let topLevelGodOnly = false
  let names: string[] = []
  try {
    const parsed = parse(input.content)
    const root = readObject(parsed)
    if (root) {
      topLevelGodOnly = isGodOnlyAccess(root.access)
      const direct = extractCharacterNames(root)
      if (direct.length > 0) names = direct
      if (names.length === 0) {
        for (const [key, value] of Object.entries(root)) {
          const nested = readObject(value)
          if (!nested) continue
          names = extractCharacterNames(nested, key)
          if (names.length > 0) break
        }
      }
    }
  } catch {
    // Ignore malformed YAML and let caller report it.
  }
  return {
    hiddenByName,
    topLevelGodOnly,
    characterNames: names,
  }
}

export const scanIndex = Effect.fn("CharacterDirectory.scanIndex")(function* (input: {
  fs: AppFileSystem.Interface
  worldPath: string
}) {
  const charactersRoot = path.join(input.worldPath, "characters")
  const exists = yield* input.fs.existsSafe(charactersRoot).pipe(Effect.orDie)
  if (!exists) {
    return {
      ordered: [],
      byCharacter: new Map(),
      conflicts: [],
      warnings: [],
    } satisfies CharacterDirectoryIndex
  }

  const entries = yield* input.fs.readDirectoryEntries(charactersRoot).pipe(Effect.orDie)
  const directories = entries
    .filter((entry) => entry.type === "directory")
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))

  const ordered: CharacterDirectoryInfo[] = []
  const byCharacter = new Map<string, CharacterDirectoryInfo>()
  const conflicts: CharacterConflict[] = []
  const warnings: string[] = []

  for (const directory of directories) {
    const relativeDir = path.join("characters", directory)
    const profileRelativePath = path.join(relativeDir, PROFILE_BASENAME)
    const profilePath = path.join(input.worldPath, profileRelativePath)
    const hasProfile = yield* input.fs.existsSafe(profilePath).pipe(Effect.orDie)
    if (!hasProfile) {
      warnings.push(`Ignored ${relativeDir}: missing ${PROFILE_BASENAME}`)
      continue
    }

    const profileContent = yield* input.fs.readFileStringSafe(profilePath).pipe(Effect.orDie)
    if (!profileContent) {
      warnings.push(`Ignored ${relativeDir}: empty ${PROFILE_BASENAME}`)
      continue
    }

    const character = parseCharacterNameFromProfileContent(profileContent)
    if (!character) {
      warnings.push(`Ignored ${relativeDir}: could not parse character name from ${PROFILE_BASENAME}`)
      continue
    }

    const info: CharacterDirectoryInfo = {
      character,
      relativeDir,
      dirPath: path.join(input.worldPath, relativeDir),
      profileRelativePath,
      profilePath,
      memoryRelativePath: path.join(relativeDir, MEMORY_BASENAME),
      memoryPath: path.join(input.worldPath, relativeDir, MEMORY_BASENAME),
      knowledgeRelativeDir: path.join(relativeDir, KNOWLEDGE_DIRNAME),
      knowledgeDirPath: path.join(input.worldPath, relativeDir, KNOWLEDGE_DIRNAME),
    }

    const gmNotesPath = path.join(input.worldPath, relativeDir, GM_NOTES_BASENAME)
    if (yield* input.fs.existsSafe(gmNotesPath).pipe(Effect.orDie)) {
      info.gmNotesRelativePath = path.join(relativeDir, GM_NOTES_BASENAME)
      info.gmNotesPath = gmNotesPath
    }
    const gmNotesDirPath = path.join(input.worldPath, relativeDir, GM_NOTES_DIRNAME)
    if (yield* input.fs.existsSafe(gmNotesDirPath).pipe(Effect.orDie)) {
      info.gmNotesRelativeDir = path.join(relativeDir, GM_NOTES_DIRNAME)
      info.gmNotesDirPath = gmNotesDirPath
    }

    ordered.push(info)
    const existing = byCharacter.get(character)
    if (!existing) {
      byCharacter.set(character, info)
      continue
    }

    conflicts.push({
      character,
      primaryRelativeDir: existing.relativeDir,
      duplicateRelativeDir: info.relativeDir,
    })
    warnings.push(
      `Duplicate character name "${character}" found in ${info.relativeDir}; using ${existing.relativeDir} by directory order`,
    )
  }

  return {
    ordered,
    byCharacter,
    conflicts,
    warnings,
  } satisfies CharacterDirectoryIndex
})

export const resolveForCharacter = Effect.fn("CharacterDirectory.resolveForCharacter")(function* (input: {
  fs: AppFileSystem.Interface
  worldPath: string
  character: string
}) {
  const index = yield* scanIndex(input)
  return {
    index,
    info: index.byCharacter.get(input.character),
  }
})

export const readManifest = Effect.fn("CharacterDirectory.readManifest")(function* (input: {
  fs: AppFileSystem.Interface
  info: CharacterDirectoryInfo
}) {
  for (const relativePath of STARTER_KNOWLEDGE_FILES) {
    const fullPath = getKnowledgeAbsolutePath(input.info, relativePath)
    const exists = yield* input.fs.existsSafe(fullPath).pipe(Effect.orDie)
    if (exists) continue
    const content = buildStarterKnowledgeContent(input.info.character, relativePath)
    yield* input.fs.writeWithDirs(fullPath, content.endsWith("\n") ? content : `${content}\n`).pipe(Effect.orDie)
  }

  const visible: string[] = []
  visible.push("profile.yaml")

  const memoryExists = yield* input.fs.existsSafe(input.info.memoryPath).pipe(Effect.orDie)
  if (memoryExists) visible.push("memory.yaml")

  const knowledgeExists = yield* input.fs.existsSafe(input.info.knowledgeDirPath).pipe(Effect.orDie)
  if (knowledgeExists) {
    const entries = yield* input.fs.glob("**/*", {
      cwd: input.info.knowledgeDirPath,
      include: "file",
      dot: true,
    }).pipe(Effect.orDie)
    for (const entry of entries.toSorted((a, b) => a.localeCompare(b))) {
      if (!isTextLikeCharacterResource(entry)) continue
      visible.push(path.join("knowledge", entry))
    }
  }

  return visible
})

export function isReadableKnowledgeResource(relativePath: string): boolean {
  return isSafeKnowledgePath(relativePath) && isTextLikeCharacterResource(relativePath)
}
