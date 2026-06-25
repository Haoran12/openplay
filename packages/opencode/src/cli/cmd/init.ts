import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Filesystem } from "@/util/filesystem"
import { join, resolve } from "path"
import { randomUUID } from "crypto"
import { Effect } from "effect"
import { fail } from "../effect-cmd"

type Args = {
  path?: string
}

const DIRECTORIES = ["worldview", "characters", "social", "records", "location_and_faction", "prompts"]

interface RuntimeConfig {
  currentDate: string
  presentCharacters: string[]
  currentScene: string
}

async function checkExistingWorld(targetDir: string): Promise<boolean> {
  return Filesystem.exists(join(targetDir, "openplay.json"))
}

async function ensureDirectories(targetDir: string): Promise<string[]> {
  const created: string[] = []
  for (const dir of DIRECTORIES) {
    const dirPath = join(targetDir, dir)
    if (!(await Filesystem.exists(dirPath))) {
      await Filesystem.write(dirPath + "/.gitkeep", "")
      created.push(dir)
    }
  }
  return created
}

async function ensureCharacterReadme(targetDir: string): Promise<void> {
  const readmePath = join(targetDir, "characters", "README.md")
  if (await Filesystem.exists(readmePath)) return
  await Filesystem.write(
    readmePath,
    [
      "# Character Directories",
      "",
      "Each character lives in its own directory:",
      "",
      "```text",
      "characters/",
      "  your-character-dir/",
      "    profile.yaml",
      "    memory.yaml",
      "    knowledge/",
      "      social_and_world.md",
      "      nature_and_body.md",
      "      people/",
      "        README.md",
      "```",
      "",
      "- `profile.yaml`: role identity and self-knowledge source.",
      "- `memory.yaml`: subjective long-term memory.",
      "- `knowledge/`: extra role resources and character-owned long-term knowledge.",
      "- `knowledge/social_and_world.md`: society, customs, factions, worldly judgment.",
      "- `knowledge/nature_and_body.md`: nature, place, body, sensory, and environmental experience.",
      "- `knowledge/people/*.md`: stable knowledge and impressions about specific other people.",
      "",
    ].join("\n"),
  )
}

async function ensurePromptsReadme(targetDir: string): Promise<void> {
  const readmePath = join(targetDir, "prompts", "README.md")
  if (await Filesystem.exists(readmePath)) return
  await Filesystem.write(
    readmePath,
    [
      "# Prompt Templates",
      "",
      "Place custom prompt templates here to override the built-in defaults:",
      "",
      "- `character.txt`: overrides the default character subagent prompt",
      "- `director.txt`: overrides the default Director agent prompt",
      "",
      "If a file is not present, the built-in default prompt will be used automatically.",
      "",
    ].join("\n"),
  )
}

function generateOpenplayJson(currentDate: string): string {
  const id = `wld_${randomUUID().replace(/-/g, "")}`
  return JSON.stringify(
    {
      id,
      roleplay: {
        worldPath: ".",
        currentDate,
        narrativeStyle: {
          language: "early_modern",
          rhetoric: "balanced",
          psychology: "mixed",
          pacing: "varied",
        },
        recordThreshold: 5,
      },
      agent: {
        director: {
          model: { id: "claude-sonnet-4-20250514" },
          isDirector: true,
        },
      },
    },
    null,
    2,
  )
}

function generateRuntimeYaml(config: RuntimeConfig): string {
  const lines = ["# OpenPlay 运行时状态", "", `current_date: ${config.currentDate}`, ""]

  if (config.presentCharacters.length > 0) {
    lines.push("present_characters:")
    for (const char of config.presentCharacters) {
      lines.push(`  - ${char}`)
    }
  } else {
    lines.push("present_characters: []")
  }

  lines.push("")
  if (config.currentScene) {
    lines.push(`current_scene: ${config.currentScene}`)
  } else {
    lines.push("current_scene: null")
  }
  lines.push("")

  return lines.join("\n")
}

export const InitCommand = cmd({
  command: "init [path]",
  describe: "initialize an OpenPlay world in the current or specified directory",
  builder: (yargs) =>
    yargs.positional("path", {
      describe: "target directory (default: current working directory)",
      type: "string",
    }),
  async handler(args) {
    const rawArgs = args as unknown as Args
    const targetDir = rawArgs.path ? resolve(process.cwd(), rawArgs.path) : process.cwd()

    UI.empty()
    prompts.intro("OpenPlay Init")

    if (!(await Filesystem.exists(targetDir))) {
      prompts.log.error(`Directory does not exist: ${targetDir}`)
      prompts.outro("Aborted")
      return
    }

    const existingWorld = await checkExistingWorld(targetDir)
    if (existingWorld) {
      const shouldContinue = await prompts.confirm({
        message: "openplay.json already exists. Overwrite?",
        initialValue: false,
      })
      if (prompts.isCancel(shouldContinue) || !shouldContinue) {
        prompts.outro("Cancelled")
        return
      }
    }

    const today = new Date().toISOString().slice(0, 10)

    const currentDate = await prompts.text({
      message: "Game date (YYYY-MM-DD)",
      placeholder: today,
      initialValue: today,
      validate: (value) => {
        if (!value) return "Required"
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          return "Format must be YYYY-MM-DD"
        }
        return undefined
      },
    })
    if (prompts.isCancel(currentDate)) {
      prompts.outro("Cancelled")
      return
    }

    const charactersInput = await prompts.text({
      message: "Initial present characters (comma-separated, optional)",
      placeholder: "e.g., 宋祈, 孟缘",
    })
    if (prompts.isCancel(charactersInput)) {
      prompts.outro("Cancelled")
      return
    }

    const presentCharacters = charactersInput
      ? charactersInput
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : []

    const currentScene = await prompts.text({
      message: "Current scene/location (optional)",
      placeholder: "e.g., 云梦泽",
    })
    if (prompts.isCancel(currentScene)) {
      prompts.outro("Cancelled")
      return
    }

    const spinner = prompts.spinner()
    spinner.start("Creating world structure...")

    try {
      const createdDirs = await ensureDirectories(targetDir)
      await ensureCharacterReadme(targetDir)
      await ensurePromptsReadme(targetDir)

      const openplayJsonPath = join(targetDir, "openplay.json")
      await Filesystem.write(openplayJsonPath, generateOpenplayJson(currentDate as string))

      const runtimeYamlPath = join(targetDir, "runtime.yaml")
      if (!(await Filesystem.exists(runtimeYamlPath))) {
        const runtimeConfig: RuntimeConfig = {
          currentDate: currentDate as string,
          presentCharacters,
          currentScene: currentScene as string,
        }
        await Filesystem.write(runtimeYamlPath, generateRuntimeYaml(runtimeConfig))
      }

      spinner.stop("World initialized!")

      if (createdDirs.length > 0) {
        prompts.log.info(`Created directories: ${createdDirs.join(", ")}`)
      }
      prompts.log.success(`openplay.json → ${openplayJsonPath}`)
      if (!(await Filesystem.exists(join(targetDir, "runtime.yaml")).then((e) => !e || existingWorld))) {
        prompts.log.success(`runtime.yaml → ${runtimeYamlPath}`)
      }

      prompts.outro("OpenPlay world ready!")
    } catch (error) {
      spinner.stop("Failed to initialize world", 1)
      prompts.log.error(error instanceof Error ? error.message : String(error))
      prompts.outro("Error")
    }
  },
})
