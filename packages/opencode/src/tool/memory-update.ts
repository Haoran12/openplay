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
import { parseCharacterSessionTitle } from "./character-session"
import { createEmptyCharacterMemory, getCharacterMemoryFilePath, getCharacterMemoryRelativePath, resolveForCharacter } from "./character-directory"

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

/**
 * @deprecated Use `resolveForCharacter` + `getCharacterMemoryFilePath` instead.
 * This function assumes the old directory structure (characters/{name}/memory.yaml)
 * and does not support the new cognition directory structure.
 */
export function characterMemoryPath(worldRoot: string, character: string) {
  return path.join(worldRoot, "characters", character, "memory.yaml")
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
          const worldRoot = ins.world?.rootPath
          const session = ctx.roleplayCharacter
            ? undefined
            : yield* sessions.get(ctx.sessionID).pipe(Effect.orDie)
          const character = ctx.roleplayCharacter ?? (session ? parseCharacterSessionTitle(session.title) : undefined)
          if (!character) {
            return {
              title: "memory_update: unavailable",
              output: "Memory updates are only available for character subagent sessions.",
              metadata: { path: "", created: false, size: 0 },
            }
          }
          if (!worldRoot) {
            return {
              title: "memory_update: unavailable",
              output: "Memory updates are only available in roleplay worlds.",
              metadata: { path: "", created: false, size: 0 },
            }
          }

          const resolved = yield* resolveForCharacter({ fs, worldPath: worldRoot, character })
          const info = resolved.info
          if (!info) {
            return {
              title: `memory_update: ${character} (not found)`,
              output: `Character directory not found for ${character}.`,
              metadata: { path: "", created: false, size: 0 },
            }
          }
          const fullPath = getCharacterMemoryFilePath(info)
          const relativePath = getCharacterMemoryRelativePath(info)

          const exists = yield* fs.existsSafe(fullPath)
          if (!exists && !shouldCreate) {
            return {
              title: `memory_update: ${character} (not found)`,
              output: `File not found: ${relativePath}. Set create=true to create it.`,
              metadata: { path: relativePath, created: false, size: 0 },
            }
          }

          const normalized = normalizeMemoryFile(params.content)
          const serialized = serializeMemoryFile(normalized)

          if (!exists && shouldCreate) {
            yield* fs.writeWithDirs(fullPath, `${createEmptyCharacterMemory()}\n`).pipe(Effect.orDie)
          }

          yield* fs.writeWithDirs(fullPath, serialized).pipe(Effect.orDie)
          yield* bus.publish(File.Event.Edited, { file: fullPath })
          yield* bus.publish(FileWatcher.Event.Updated, {
            file: fullPath,
            event: exists ? "change" : "add",
          })
          return {
            title: `memory_update: ${character}`,
            output: `Updated ${relativePath} (${serialized.length} bytes)`,
            metadata: { path: relativePath, created: !exists, size: serialized.length },
          }
        }),
    }
  }),
)

export * as MemoryUpdate from "./memory-update"
