export * as World from "./world"

import { Effect, Layer, Context, Schema, Types } from "effect"
import { parse } from "yaml"
import { AppFileSystem } from "@openplay-ai/core/filesystem"
import { serviceUse } from "@/effect/service-use"
import { WorldID } from "./schema"
import path from "path"
import { ConfigParse } from "@/config/parse"

export const WorldInfo = Schema.Struct({
  id: WorldID,
  rootPath: Schema.String,
  configPath: Schema.String,
  scene: Schema.optional(
    Schema.Struct({
      date: Schema.optional(Schema.String),
      location: Schema.optional(Schema.String),
      impression: Schema.optional(Schema.String),
    }),
  ),
  currentScene: Schema.optional(Schema.String),
  presentCharacters: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        age: Schema.optional(Schema.String),
        appearance: Schema.optional(Schema.String),
        activity: Schema.optional(Schema.String),
        state: Schema.optional(Schema.String),
        knowledge: Schema.optional(Schema.String),
        note: Schema.optional(Schema.String),
        commitment: Schema.optional(Schema.String),
      }),
    ),
  ),
}).annotate({ identifier: "WorldInfo" })
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof WorldInfo>>

export interface Interface {
  readonly fromDirectory: (
    directory: string,
    worktree: string,
  ) => Effect.Effect<Info | undefined, AppFileSystem.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/World") {}

function parseCurrentScene(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object") return undefined

  const scene = value as Record<string, unknown>
  if (typeof scene.location === "string" && scene.location.trim().length > 0) {
    return scene.location
  }
  if (typeof scene.impression === "string" && scene.impression.trim().length > 0) {
    return scene.impression
  }
  if (typeof scene.date === "string" && scene.date.trim().length > 0) {
    return scene.date
  }

  return undefined
}

function parseScene(value: unknown):
  | {
      date?: string
      location?: string
      impression?: string
    }
  | undefined {
  if (!value || typeof value !== "object") return undefined

  const scene = value as Record<string, unknown>
  const result = {
    date: typeof scene.date === "string" && scene.date.trim().length > 0 ? scene.date : undefined,
    location:
      typeof scene.location === "string" && scene.location.trim().length > 0 ? scene.location : undefined,
    impression:
      typeof scene.impression === "string" && scene.impression.trim().length > 0
        ? scene.impression
        : undefined,
  }

  return result.date || result.location || result.impression ? result : undefined
}

function scalarToString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim().length > 0 ? value : undefined
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return undefined
}

function parsePresentCharacters(value: unknown):
  | Array<{
      name: string
      age?: string
      appearance?: string
      activity?: string
      state?: string
      knowledge?: string
      note?: string
      commitment?: string
  }>
  | undefined {
  if (!Array.isArray(value)) return undefined

  const characters = value.flatMap((entry) => {
    if (typeof entry === "string") {
      return entry.trim().length > 0 ? [{ name: entry }] : []
    }
    if (!entry || typeof entry !== "object") return []

    const raw = entry as Record<string, unknown>
    const name = scalarToString(raw.name)
    if (!name) return []

    return [
      {
        name,
        age: scalarToString(raw.age),
        appearance: scalarToString(raw.appearance),
        activity: scalarToString(raw.activity),
        state: scalarToString(raw.state),
        knowledge: scalarToString(raw.knowledge),
        note: scalarToString(raw.note),
        commitment: scalarToString(raw.commitment),
      },
    ]
  })

  return characters.length > 0 ? characters : undefined
}

function parseRuntimePresentCharacters(runtime: Record<string, unknown>): ReturnType<typeof parsePresentCharacters> {
  const topLevel = parsePresentCharacters(runtime.present_characters)
  if (topLevel) return topLevel

  const currentScene = runtime.current_scene
  if (!currentScene || typeof currentScene !== "object") return undefined

  return parsePresentCharacters((currentScene as Record<string, unknown>).present_characters)
}

// Read roleplay.worldPath from config files directly (to avoid circular dependency with Config.Service)
async function readWorldPathConfig(directory: string): Promise<string | undefined> {
  const configFiles = [
    path.join(directory, "openplay.json"),
    path.join(directory, "openplay.jsonc"),
    path.join(directory, "opencode.json"),
    path.join(directory, "opencode.jsonc"),
  ]

  for (const configFile of configFiles) {
    try {
      const content = await Bun.file(configFile).text()
      if (!content) continue
      const parsed = ConfigParse.jsonc(content, configFile)
      if (parsed && typeof parsed === "object" && "roleplay" in parsed) {
        const roleplay = (parsed as { roleplay?: unknown }).roleplay
        if (roleplay && typeof roleplay === "object" && "worldPath" in roleplay) {
          const worldPath = (roleplay as { worldPath?: unknown }).worldPath
          if (typeof worldPath === "string") {
            return worldPath
          }
        }
      }
    } catch {
      // ignore errors
    }
  }
  return undefined
}

export const layer: Layer.Layer<Service, never, AppFileSystem.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    const fromDirectory = Effect.fn("World.fromDirectory")(function* (
      directory: string,
      worktree: string,
    ) {
      // Read worldPath from config files directly
      const worldPath = yield* Effect.promise(() => readWorldPathConfig(directory))

      // Determine the world directory: use worldPath if configured, otherwise use directory
      const worldDir = worldPath
        ? `${directory}/${worldPath}`.replace(/\/+/g, "/")
        : directory

      // Check for runtime.yaml in the world directory
      const runtimePath = `${worldDir}/runtime.yaml`
      const runtimeExists = yield* fs.existsSafe(runtimePath)

      if (runtimeExists) {
        let scene:
          | {
              date?: string
              location?: string
              impression?: string
            }
          | undefined
        let currentScene: string | undefined
        let presentCharacters:
          | Array<{
              name: string
              age?: string
              appearance?: string
              activity?: string
              state?: string
              knowledge?: string
              note?: string
              commitment?: string
            }>
          | undefined
        const runtimeContent = yield* fs.readFileStringSafe(runtimePath)
        if (runtimeContent) {
          try {
            const runtime = parse(runtimeContent) as Record<string, unknown>
            if (runtime && typeof runtime === "object") {
              scene = parseScene(runtime.current_scene)
              currentScene = parseCurrentScene(runtime.current_scene)
              presentCharacters = parseRuntimePresentCharacters(runtime)
            }
          } catch {
            // ignore parse errors
          }
        }

        return {
          id: WorldID.generate(),
          rootPath: worldDir,
          configPath: runtimePath,
          scene,
          currentScene,
          presentCharacters,
        } as Info
      }

      return undefined
    })

    return Service.of({
      fromDirectory,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

export const use = serviceUse(Service)
