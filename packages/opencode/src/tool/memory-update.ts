import { Effect, Schema } from "effect"
import path from "path"
import { AppFileSystem } from "@openplay-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import { Bus } from "@/bus"
import { File } from "@/file"
import { FileWatcher } from "@/file/watcher"
import { Session } from "@/session/session"
import * as Tool from "./tool"
import DESCRIPTION from "./memory-update.txt"
import { normalizeMemoryFile, serializeMemoryFile } from "./memory-schema"

const Parameters = Schema.Struct({
  content: Schema.String.annotate({
    description: "The complete YAML content to write to the memory file",
  }),
  create: Schema.optional(Schema.Boolean.annotate({
    description: "Whether to create the file if it doesn't exist (default: true)",
  })),
})

type MemoryUpdateMetadata = {
  path: string
  created: boolean
  size: number
}

export function characterMemoryPath(worldRoot: string, character: string) {
  return path.join(worldRoot, "memories", `${character}.yaml`)
}

export const MemoryUpdateTool = Tool.define(
  "memory_update",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const bus = yield* Bus.Service
    const sessions = yield* Session.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<MemoryUpdateMetadata>) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const shouldCreate = params.create !== false
          const worldRoot = ins.world?.rootPath ?? ins.directory
          const session = yield* sessions.get(ctx.sessionID).pipe(Effect.orDie)
          const match = session.title.match(/^Character:\s*(.+)$/)
          const character = match?.[1]?.trim()
          if (!character) {
            return {
              title: "memory_update: unavailable",
              output: "Memory updates are only available for character subagent sessions.",
              metadata: { path: "", created: false, size: 0 },
            }
          }
          const fullPath = characterMemoryPath(worldRoot, character)

          const exists = yield* fs.existsSafe(fullPath)
          if (!exists && !shouldCreate) {
            return {
              title: `memory_update: ${character} (not found)`,
              output: `File not found: ${path.relative(worldRoot, fullPath)}. Set create=true to create it.`,
              metadata: { path: path.relative(worldRoot, fullPath), created: false, size: 0 },
            }
          }

          const normalized = normalizeMemoryFile(params.content)
          const serialized = serializeMemoryFile(normalized)

          yield* fs.writeWithDirs(fullPath, serialized).pipe(Effect.orDie)
          yield* bus.publish(File.Event.Edited, { file: fullPath })
          yield* bus.publish(FileWatcher.Event.Updated, {
            file: fullPath,
            event: exists ? "change" : "add",
          })
          return {
            title: `memory_update: ${character}`,
            output: `Updated ${path.relative(worldRoot, fullPath)} (${serialized.length} bytes)`,
            metadata: { path: path.relative(worldRoot, fullPath), created: !exists, size: serialized.length },
          }
        }),
    }
  }),
)

export * as MemoryUpdate from "./memory-update"
