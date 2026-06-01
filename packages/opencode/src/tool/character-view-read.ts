export * as CharacterViewRead from "./character-view-read"

import path from "path"
import { Effect, Schema } from "effect"
import { AppFileSystem } from "@openplay-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import * as Tool from "./tool"
import DESCRIPTION from "./character-view-read.txt"
import {
  createEmptyCharacterMemory,
  normalizeCharacterMemoryContent,
  readManifest,
  renderGodOnlyFilteredYaml,
  resolveForCharacter,
} from "./character-directory"
import { parseCharacterSessionTitle } from "./character-session"

const Parameters = Schema.Struct({
  target: Schema.Literals(["manifest", "resource"]).annotate({
    description: "Which character resource to read",
  }),
  path: Schema.optional(Schema.String).annotate({
    description: "Resource path from your manifest when target=resource",
  }),
  refresh: Schema.optional(Schema.Boolean).annotate({
    description: "Bypass any cached state and re-read from disk",
  }),
})

type CharacterViewReadMetadata = {
  character: string
  target: "manifest" | "resource"
  path?: string
}

function blocked(target: string, output: string, metadata: CharacterViewReadMetadata) {
  return {
    title: `character_view_read: ${target} (blocked)`,
    output,
    metadata,
  }
}

export const CharacterViewReadTool = Tool.define(
  "character_view_read",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const sessions = yield* Session.Service
    const execute = (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<CharacterViewReadMetadata>) =>
      Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const worldPath = instance.world?.rootPath
          const session = ctx.roleplayCharacter
            ? undefined
            : yield* sessions.get(ctx.sessionID).pipe(Effect.orDie)
          const character = ctx.roleplayCharacter ?? (session ? parseCharacterSessionTitle(session.title) : undefined)

          if (!worldPath || !character) {
            return blocked(params.target, "character_view_read is only available inside character roleplay sessions.", {
              character: character ?? "",
              target: params.target,
              ...(params.path ? { path: params.path } : {}),
            })
          }

          const resolved = yield* resolveForCharacter({
            fs,
            worldPath,
            character,
          })
          const info = resolved.info
          if (!info) {
            return blocked(params.target, `Character directory not found for ${character}.`, {
              character,
              target: params.target,
              ...(params.path ? { path: params.path } : {}),
            })
          }

          const manifestItems = yield* readManifest({ fs, info })

          if (params.target === "manifest") {
            return {
              title: `character_view_read: ${character} manifest`,
              output: manifestItems.length > 0 ? manifestItems.join("\n") : "(empty)",
              metadata: { character, target: "manifest" } satisfies CharacterViewReadMetadata,
            }
          }

          const relativePath = params.path?.trim() ?? ""
          if (!manifestItems.includes(relativePath)) {
            return blocked("resource", "resource path must match an entry from your current manifest.", {
              character,
              target: "resource",
              path: params.path,
            })
          }

          let fullPath = path.join(info.dirPath, relativePath)
          if (relativePath === "profile.yaml") fullPath = info.profilePath
          if (relativePath === "memory.yaml") fullPath = info.memoryPath

          if (relativePath === "memory.yaml") {
            const exists = yield* fs.existsSafe(info.memoryPath).pipe(Effect.orDie)
            if (!exists) {
              const empty = createEmptyCharacterMemory()
              yield* fs.writeWithDirs(info.memoryPath, `${empty}\n`).pipe(Effect.orDie)
              return {
                title: `character_view_read: ${character} ${relativePath}`,
                output: empty,
                metadata: { character, target: "resource", path: relativePath } satisfies CharacterViewReadMetadata,
              }
            }
          }

          const exists = yield* fs.existsSafe(fullPath).pipe(Effect.orDie)
          if (!exists) {
            return blocked("resource", `Resource file not found: ${relativePath}`, {
              character,
              target: "resource",
              path: relativePath,
            })
          }

          const content = (yield* fs.readFileStringSafe(fullPath).pipe(Effect.orDie)) ?? ""
          let output = content.trim()
          if (relativePath === "memory.yaml") {
            output = normalizeCharacterMemoryContent(content)
          } else {
            const ext = path.extname(relativePath).toLowerCase()
            if (ext === ".yaml" || ext === ".yml" || ext === ".json") {
              output = renderGodOnlyFilteredYaml(content)
            }
          }

          return {
            title: `character_view_read: ${character} ${relativePath}`,
            output: output || "(empty)",
            metadata: { character, target: "resource", path: relativePath } satisfies CharacterViewReadMetadata,
          }
        }).pipe(Effect.orDie)

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute,
    }
  }),
)
