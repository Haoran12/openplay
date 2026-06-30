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

const COGNITION_MEMORY_BASENAME = "memory.yaml"
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
  "world_base.yaml",
  "social_and_world.md",
  "nature_and_body.md",
] as const

function buildStarterKnowledgeContent(character: string, relativePath: string): string {
  if (relativePath === "world_base.yaml") {
    return [
      `# ${character} 的世界观基础`,
      "",
      "记录对**整体**世界运行规则、自然法则的基础认知。",
      "针对特定人物、地区、势力的认知，请在单独的文件中记录。",
      "",
      "## 可记录内容",
      "- 世界的整体构造、运行逻辑",
      "- 普遍适用的自然法则、灵气规则",
      "- 跨地域通用的常识性知识",
      "",
      "## 特定对象请另建文件",
      "- 特定人物 → `<人物名>.md`",
      "- 特定地区 → `<地区名>.md`",
      "- 特定势力 → `<势力名>.md`",
      "",
      "## 更新原则",
      "- 只写角色已确认的稳定认知",
      "- 保持角色主观视角，不写全知视角的设定",
      "",
    ].join("\n")
  }

  if (relativePath === "social_and_world.md") {
    return [
      `# ${character} 对社会与世道的长期认知`,
      "",
      "记录对**整体**社会格局、政治文化、世道人情的长期观察。",
      "针对特定人物、地区、势力的认知，请在单独的文件中记录。",
      "",
      "## 可记录内容",
      "- 整体世道风气、普遍礼法、常见禁忌",
      "- 对某个国家/世界整体政治格局的认知",
      "- 某个阶层、职业群体的普遍印象",
      "",
      "## 特定对象请另建文件",
      "- 特定人物 → `<人物名>.md`",
      "- 特定地区 → `<地区名>.md`",
      "- 特定势力 → `<势力名>.md`",
      "",
      "## 更新原则",
      "- 写稳定认知，不写瞬时情绪",
      "- 保持角色主观视角",
      "",
    ].join("\n")
  }

  if (relativePath === "nature_and_body.md") {
    return [
      `# ${character} 对自然与身体感受的长期认知`,
      "",
      "记录对**整体**自然规则、身体感知的长期经验。",
      "针对特定地域、环境的认知，请在单独的文件中记录。",
      "",
      "## 可记录内容",
      "- 普遍气候规律、季节特点",
      "- 自身身体习惯、感官偏好、旧疾伤势",
      "- 对灵气、自然法则的整体理解",
      "",
      "## 特定地域请另建文件",
      "- 特定地区 → `<地区名>.md`",
      "",
      "## 更新原则",
      "- 写可复用经验，不写一次性细节",
      "- 若判断被新经历推翻，直接修订旧结论",
      "",
    ].join("\n")
  }

  return ""
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
    const dirPath = path.join(input.worldPath, relativeDir)

    const dirEntries = yield* input.fs.readDirectoryEntries(dirPath).pipe(Effect.orDie)
    const yamlFiles = dirEntries
      .filter((entry) => entry.type === "file" && entry.name.endsWith(".yaml"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))

    if (yamlFiles.length === 0) {
      warnings.push(`Ignored ${relativeDir}: no .yaml profile file found`)
      continue
    }

    let foundCharacter: string | undefined
    let foundProfileRelativePath: string | undefined
    let foundProfilePath: string | undefined

    for (const yamlFile of yamlFiles) {
      const profilePathCandidate = path.join(dirPath, yamlFile)
      const profileContent = yield* input.fs.readFileStringSafe(profilePathCandidate).pipe(Effect.orDie)
      if (!profileContent) continue

      const characterCandidate = parseCharacterNameFromProfileContent(profileContent)
      if (characterCandidate) {
        foundCharacter = characterCandidate
        foundProfileRelativePath = path.join(relativeDir, yamlFile)
        foundProfilePath = profilePathCandidate
        break
      }
    }

    if (!foundCharacter) {
      warnings.push(`Ignored ${relativeDir}: could not parse character name from any .yaml file`)
      continue
    }

    const cognitionDirName = `${foundCharacter}-cognition`
    const cognitionRelativeDir = path.join(relativeDir, cognitionDirName)
    const cognitionDirPath = path.join(dirPath, cognitionDirName)

    const info: CharacterDirectoryInfo = {
      character: foundCharacter,
      relativeDir,
      dirPath,
      profileRelativePath: foundProfileRelativePath!,
      profilePath: foundProfilePath!,
      memoryRelativePath: path.join(cognitionRelativeDir, COGNITION_MEMORY_BASENAME),
      memoryPath: path.join(cognitionDirPath, COGNITION_MEMORY_BASENAME),
      knowledgeRelativeDir: cognitionRelativeDir,
      knowledgeDirPath: cognitionDirPath,
    }

    const gmNotesPath = path.join(dirPath, GM_NOTES_BASENAME)
    if (yield* input.fs.existsSafe(gmNotesPath).pipe(Effect.orDie)) {
      info.gmNotesRelativePath = path.join(relativeDir, GM_NOTES_BASENAME)
      info.gmNotesPath = gmNotesPath
    }
    const gmNotesDirPath = path.join(dirPath, GM_NOTES_DIRNAME)
    if (yield* input.fs.existsSafe(gmNotesDirPath).pipe(Effect.orDie)) {
      info.gmNotesRelativeDir = path.join(relativeDir, GM_NOTES_DIRNAME)
      info.gmNotesDirPath = gmNotesDirPath
    }

    ordered.push(info)
    const existing = byCharacter.get(foundCharacter)
    if (!existing) {
      byCharacter.set(foundCharacter, info)
      continue
    }

    conflicts.push({
      character: foundCharacter,
      primaryRelativeDir: existing.relativeDir,
      duplicateRelativeDir: info.relativeDir,
    })
    warnings.push(
      `Duplicate character name "${foundCharacter}" found in ${info.relativeDir}; using ${existing.relativeDir} by directory order`,
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
  const profileBasename = path.basename(input.info.profileRelativePath)
  visible.push(profileBasename)

  const memoryExists = yield* input.fs.existsSafe(input.info.memoryPath).pipe(Effect.orDie)
  if (memoryExists) {
    const memoryBasename = path.basename(input.info.memoryRelativePath)
    visible.push(memoryBasename)
  }

  const knowledgeExists = yield* input.fs.existsSafe(input.info.knowledgeDirPath).pipe(Effect.orDie)
  if (knowledgeExists) {
    const entries = yield* input.fs.glob("**/*", {
      cwd: input.info.knowledgeDirPath,
      include: "file",
      dot: true,
    }).pipe(Effect.orDie)
    for (const entry of entries.toSorted((a, b) => a.localeCompare(b))) {
      if (!isTextLikeCharacterResource(entry)) continue
      visible.push(entry)
    }
  }

  return visible
})

export function isReadableKnowledgeResource(relativePath: string): boolean {
  return isSafeKnowledgePath(relativePath) && isTextLikeCharacterResource(relativePath)
}
