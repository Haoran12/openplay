export * as World from "./world"

import { Effect, Layer, Context, Schema, Types } from "effect"
import { AppFileSystem } from "@openplay-ai/core/filesystem"
import { serviceUse } from "@/effect/service-use"
import { WorldID } from "./schema"

export const WorldInfo = Schema.Struct({
  id: WorldID,
  rootPath: Schema.String,
  configPath: Schema.String,
}).annotate({ identifier: "WorldInfo" })
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof WorldInfo>>

export interface Interface {
  readonly fromDirectory: (
    directory: string,
    worktree: string,
  ) => Effect.Effect<Info | undefined, AppFileSystem.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/World") {}

export const layer: Layer.Layer<Service, never, AppFileSystem.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    const fromDirectory = Effect.fn("World.fromDirectory")(function* (
      directory: string,
      worktree: string,
    ) {
      const openplayMatches = yield* fs
        .up({
          targets: ["openplay.jsonc", "openplay.json"],
          start: directory,
          stop: worktree,
        })
        .pipe(Effect.orDie)

      if (openplayMatches.length > 0) {
        const configPath: string = openplayMatches[0]
        const rootPath: string = configPath.endsWith("/openplay.jsonc")
          ? configPath.slice(0, -"/openplay.jsonc".length)
          : configPath.slice(0, -"/openplay.json".length)

        const raw = yield* fs.readFileStringSafe(configPath)
        if (raw) {
          try {
            const config = JSON.parse(raw)
            const id =
              typeof config.id === "string" && config.id.startsWith("wld_")
                ? WorldID.make(config.id)
                : WorldID.generate()
            if (!config.id || !config.id.startsWith("wld_")) {
              config.id = id
              yield* fs.writeWithDirs(configPath, JSON.stringify(config, null, 2))
            }
            return { id, rootPath, configPath } as Info
          } catch {
            return undefined
          }
        }
      }

      const runtimeMatches = yield* fs
        .up({
          targets: ["runtime.yaml"],
          start: directory,
          stop: worktree,
        })
        .pipe(Effect.orDie)

      if (runtimeMatches.length > 0) {
        const configPath: string = runtimeMatches[0]
        const rootPath: string = configPath.slice(0, -"/runtime.yaml".length)
        const id = WorldID.generate()
        return { id, rootPath, configPath } as Info
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