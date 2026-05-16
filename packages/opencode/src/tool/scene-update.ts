import { Effect, Schema } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"
import DESCRIPTION from "./scene-update.txt"

const Parameters = Schema.Struct({
  path: Schema.String.annotate({
    description: "Path to the YAML file to update (relative to world root), e.g. 'runtime.yaml'",
  }),
  content: Schema.String.annotate({
    description: "The new content to write to the file",
  }),
  create: Schema.optional(Schema.Boolean.annotate({
    description: "Whether to create the file if it doesn't exist (default: true)",
  })),
})

type SceneUpdateMetadata = {
  path: string
  created: boolean
  size: number
}

export const SceneUpdateTool = Tool.define(
  "scene_update",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<SceneUpdateMetadata>) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const shouldCreate = params.create !== false
          const worldRoot = ins.world?.rootPath ?? ins.directory
          const fullPath = params.path.startsWith("/")
            ? params.path
            : `${worldRoot}/${params.path}`.replace(/\/+/g, "/")

          const exists = yield* fs.existsSafe(fullPath)
          if (!exists && !shouldCreate) {
            return {
              title: `scene_update: ${params.path} (not found)`,
              output: `File not found: ${params.path}. Set create=true to create it.`,
              metadata: { path: params.path, created: false, size: 0 },
            }
          }

          yield* fs.writeFileString(fullPath, params.content).pipe(Effect.orDie)
          return {
            title: `scene_update: ${params.path}`,
            output: `Updated ${params.path} (${params.content.length} bytes)`,
            metadata: { path: params.path, created: !exists, size: params.content.length },
          }
        }),
    }
  }),
)

export * as SceneUpdate from "./scene-update"