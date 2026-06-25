import { Effect, Schema } from "effect"
import path from "path"
import { AppFileSystem } from "@openplay-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import { Bus } from "@/bus"
import { File } from "@/file"
import { FileWatcher } from "@/file/watcher"
import * as Tool from "./tool"
import DESCRIPTION from "./scene-update.txt"
import { parseSceneTransitionDirective, syncRoleplaySceneState } from "./roleplay-scene-state"

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

const ALLOWED_TOP_LEVEL = new Set(["runtime.yaml", "runtime.yml"])
const ALLOWED_PREFIXES = ["records/"]

function normalizeScenePath(input: string): string | undefined {
  const normalized = input.replace(/\\/g, "/").trim()
  if (!normalized || path.isAbsolute(normalized)) return
  const safe = path.posix.normalize(normalized)
  if (
    safe === "." ||
    safe === ".." ||
    safe.startsWith("../") ||
    safe.includes("/../") ||
    safe.startsWith("characters/") ||
    safe === "characters"
  ) {
    return
  }
  if (ALLOWED_TOP_LEVEL.has(safe)) return safe
  if (ALLOWED_PREFIXES.some((prefix) => safe.startsWith(prefix))) return safe
  return
}

export const SceneUpdateTool = Tool.define(
  "scene_update",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const bus = yield* Bus.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<SceneUpdateMetadata>) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const shouldCreate = params.create !== false
          const worldRoot = ins.world?.rootPath ?? ins.directory
          const relativePath = normalizeScenePath(params.path)
          if (!relativePath) {
            return {
              title: `scene_update: ${params.path} (blocked)`,
              output:
                "scene_update may only write runtime.yaml or files under records/. It cannot write character resource paths, absolute paths, or parent-relative paths.",
              metadata: { path: params.path, created: false, size: 0 },
            }
          }
          const fullPath = path.join(worldRoot, relativePath)

          const exists = yield* fs.existsSafe(fullPath)
          if (!exists && !shouldCreate) {
            return {
              title: `scene_update: ${relativePath} (not found)`,
              output: `File not found: ${relativePath}. Set create=true to create it.`,
              metadata: { path: relativePath, created: false, size: 0 },
            }
          }

          yield* fs.writeFileString(fullPath, params.content).pipe(Effect.orDie)
          if (relativePath === "runtime.yaml" || relativePath === "runtime.yml") {
            yield* syncRoleplaySceneState({
              fs,
              worldRoot,
              runtimeContent: params.content,
              transition: parseSceneTransitionDirective(params.content),
              sessionID: ctx.sessionID,
            })
          }
          yield* bus.publish(File.Event.Edited, { file: fullPath })
          yield* bus.publish(FileWatcher.Event.Updated, {
            file: fullPath,
            event: exists ? "change" : "add",
          })
          return {
            title: `scene_update: ${relativePath}`,
            output: `Updated ${relativePath} (${params.content.length} bytes)`,
            metadata: { path: relativePath, created: !exists, size: params.content.length },
          }
        }),
    }
  }),
)

export * as SceneUpdate from "./scene-update"
