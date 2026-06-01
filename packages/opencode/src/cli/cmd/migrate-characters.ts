import * as prompts from "@clack/prompts"
import path from "path"
import { parse } from "yaml"
import { cmd } from "./cmd"
import { Filesystem } from "@/util/filesystem"
import {
  classifyLegacyCharacterFile,
  renderGodOnlyFilteredYaml,
  type CharacterConflict,
} from "@/tool/character-directory"

type Args = {
  path?: string
}

export type MigrationReport = {
  migratedProfiles: string[]
  migratedMemories: string[]
  migratedKnowledge: string[]
  migratedDirectorFiles: string[]
  conflicts: CharacterConflict[]
  unclassified: string[]
}

function sanitizeDirName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim() || "character"
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function readName(content: string): string | undefined {
  try {
    const parsed = parse(content)
    const root = readObject(parsed)
    if (!root) return
    if (typeof root.name === "string" && root.name.trim()) return root.name.trim()
    for (const [key, value] of Object.entries(root)) {
      const nested = readObject(value)
      if (nested && typeof nested.name === "string" && nested.name.trim()) return nested.name.trim()
      if (nested && key.trim()) return key.trim()
    }
  } catch {
    return
  }
  return
}

async function listLegacyFiles(worldPath: string) {
  const roots = ["characters", "memories"]
  const found: string[] = []
  for (const root of roots) {
    const rootPath = path.join(worldPath, root)
    if (!(await Filesystem.exists(rootPath))) continue
    const stack = [rootPath]
    while (stack.length > 0) {
      const current = stack.pop()!
      const entries = await import("fs/promises").then((fs) => fs.readdir(current, { withFileTypes: true }))
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name)
        if (entry.isDirectory()) {
          stack.push(fullPath)
          continue
        }
        if (!entry.isFile()) continue
        found.push(path.relative(worldPath, fullPath).replaceAll("\\", "/"))
      }
    }
  }
  return found.sort()
}

export async function migrateCharacters(worldPath: string): Promise<MigrationReport> {
  const files = await listLegacyFiles(worldPath)
  const report: MigrationReport = {
    migratedProfiles: [],
    migratedMemories: [],
    migratedKnowledge: [],
    migratedDirectorFiles: [],
    conflicts: [],
    unclassified: [],
  }
  const chosenDirByCharacter = new Map<string, string>()

  for (const relativePath of files) {
    if (relativePath.endsWith("/profile.yaml") || relativePath.endsWith("/memory.yaml")) continue
    const absolutePath = path.join(worldPath, relativePath)
    const content = await Filesystem.readText(absolutePath)

    if (relativePath.startsWith("memories/")) {
      const character = path.basename(relativePath, path.extname(relativePath))
      const dirName = sanitizeDirName(character)
      const target = path.join(worldPath, "characters", dirName, "memory.yaml")
      await Filesystem.write(target, content.endsWith("\n") ? content : `${content}\n`)
      report.migratedMemories.push(`${relativePath} -> ${path.relative(worldPath, target)}`)
      continue
    }

    if (!relativePath.startsWith("characters/")) continue
    if (path.basename(relativePath) === "README.md") continue

    const stats = classifyLegacyCharacterFile({ relativePath, content })
    const parsedName = readName(content)
    const character = parsedName ?? stats.characterNames[0]
    if (!character) {
      report.unclassified.push(relativePath)
      continue
    }

    const preferredDir = sanitizeDirName(character)
    const previous = chosenDirByCharacter.get(character)
    if (!previous) {
      chosenDirByCharacter.set(character, preferredDir)
    } else if (previous !== preferredDir) {
      report.conflicts.push({
        character,
        primaryRelativeDir: `characters/${previous}`,
        duplicateRelativeDir: `characters/${preferredDir}`,
      })
    }

    const targetDir = path.join(worldPath, "characters", chosenDirByCharacter.get(character)!)
    if (relativePath.endsWith(".yaml") || relativePath.endsWith(".yml")) {
      if (!stats.hiddenByName && !stats.topLevelGodOnly) {
        const profilePath = path.join(targetDir, "profile.yaml")
        const exists = await Filesystem.exists(profilePath)
        if (!exists) {
          await Filesystem.write(profilePath, content.endsWith("\n") ? content : `${content}\n`)
          report.migratedProfiles.push(`${relativePath} -> ${path.relative(worldPath, profilePath)}`)
        } else {
          const knowledgePath = path.join(targetDir, "knowledge", path.basename(relativePath))
          await Filesystem.write(knowledgePath, renderGodOnlyFilteredYaml(content) + "\n")
          report.migratedKnowledge.push(`${relativePath} -> ${path.relative(worldPath, knowledgePath)}`)
        }
      } else {
        const fileName = report.migratedDirectorFiles.some((item) => item.endsWith("gm_notes.yaml"))
          ? path.basename(relativePath)
          : "gm_notes.yaml"
        const notesPath =
          fileName === "gm_notes.yaml" ? path.join(targetDir, fileName) : path.join(targetDir, "gm_notes", fileName)
        await Filesystem.write(notesPath, content.endsWith("\n") ? content : `${content}\n`)
        report.migratedDirectorFiles.push(`${relativePath} -> ${path.relative(worldPath, notesPath)}`)
      }
      continue
    }

    const knowledgePath = path.join(targetDir, "knowledge", path.basename(relativePath))
    await Filesystem.write(knowledgePath, content)
    report.migratedKnowledge.push(`${relativePath} -> ${path.relative(worldPath, knowledgePath)}`)
  }

  return report
}

export const MigrateCharactersCommand = cmd({
  command: "migrate-characters [path]",
  describe: "migrate legacy flat character files into directory-based character resources",
  builder: (yargs) =>
    yargs.positional("path", {
      describe: "target world directory (default: current working directory)",
      type: "string",
    }),
  async handler(args) {
    const rawArgs = args as unknown as Args
    const worldPath = rawArgs.path ? path.resolve(process.cwd(), rawArgs.path) : process.cwd()

    prompts.intro("OpenPlay Character Migration")
    if (!(await Filesystem.exists(worldPath))) {
      prompts.log.error(`Directory does not exist: ${worldPath}`)
      prompts.outro("Aborted")
      return
    }

    const report = await migrateCharacters(worldPath)
    const reportPath = path.join(worldPath, ".openplay", "migrate-characters-report.json")
    await Filesystem.writeJson(reportPath, report)

    prompts.log.success(`Profiles migrated: ${report.migratedProfiles.length}`)
    prompts.log.success(`Memories migrated: ${report.migratedMemories.length}`)
    prompts.log.success(`Knowledge resources migrated: ${report.migratedKnowledge.length}`)
    prompts.log.success(`Director-only resources migrated: ${report.migratedDirectorFiles.length}`)
    if (report.conflicts.length > 0) prompts.log.warn(`Naming conflicts detected: ${report.conflicts.length}`)
    if (report.unclassified.length > 0) prompts.log.warn(`Unclassified files: ${report.unclassified.length}`)
    prompts.log.info(`Report written to ${reportPath}`)
    prompts.outro("Character migration complete")
  },
})
