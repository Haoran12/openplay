export * as KnowledgeUpdate from "./knowledge-update"

import { Effect, Schema } from "effect"
import path from "path"
import { AppFileSystem } from "@openplay-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import { Bus } from "@/bus"
import { File } from "@/file"
import { FileWatcher } from "@/file/watcher"
import { Session } from "@/session/session"
import * as Tool from "./tool"
import DESCRIPTION from "./knowledge-update.txt"
import {
  getKnowledgeAbsolutePath,
  getKnowledgeRelativePath,
  isReadableKnowledgeResource,
  isSafeKnowledgePath,
  readManifest,
  resolveForCharacter,
} from "./character-directory"
import { parseCharacterSessionTitle } from "./character-session"

const Parameters = Schema.Struct({
  path: Schema.String.annotate({
    description: "Path relative to the current character's knowledge/ directory",
  }),
  content: Schema.String.annotate({
    description: "The complete text content to write",
  }),
  create: Schema.optional(Schema.Boolean.annotate({
    description: "Whether to create the file if it doesn't exist (default: true)",
  })),
})

type KnowledgeUpdateMetadata = {
  path: string
  created: boolean
  size: number
}

export const KnowledgeUpdateTool = Tool.define(
  "knowledge_update",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const bus = yield* Bus.Service
    const sessions = yield* Session.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<KnowledgeUpdateMetadata>) =>
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
              title: "knowledge_update: unavailable",
              output: "Knowledge updates are only available for character subagent sessions.",
              metadata: { path: "", created: false, size: 0 },
            }
          }
          if (!worldRoot) {
            return {
              title: "knowledge_update: unavailable",
              output: "Knowledge updates are only available in roleplay worlds.",
              metadata: { path: "", created: false, size: 0 },
            }
          }

          const resolved = yield* resolveForCharacter({ fs, worldPath: worldRoot, character })
          const info = resolved.info
          if (!info) {
            return {
              title: `knowledge_update: ${character} (not found)`,
              output: `Character directory not found for ${character}.`,
              metadata: { path: "", created: false, size: 0 },
            }
          }

          const knowledgePath = params.path.trim().replaceAll("\\", "/")
          if (!isSafeKnowledgePath(knowledgePath) || !isReadableKnowledgeResource(knowledgePath)) {
            return {
              title: `knowledge_update: ${character} (blocked)`,
              output: "path must be a safe text resource under your own knowledge/ directory.",
              metadata: { path: knowledgePath, created: false, size: 0 },
            }
          }

          const manifest = yield* readManifest({ fs, info }).pipe(Effect.orDie)
          if (!shouldCreate && !manifest.includes(knowledgePath)) {
            return {
              title: `knowledge_update: ${character} (blocked)`,
              output: "path must already exist in your current manifest when create=false.",
              metadata: { path: knowledgePath, created: false, size: 0 },
            }
          }

          const fullPath = getKnowledgeAbsolutePath(info, knowledgePath)
          const relativePath = getKnowledgeRelativePath(info, knowledgePath)
          const exists = yield* fs.existsSafe(fullPath).pipe(Effect.orDie)
          if (!exists && !shouldCreate) {
            return {
              title: `knowledge_update: ${character} (not found)`,
              output: `File not found: ${relativePath}. Set create=true to create it.`,
              metadata: { path: relativePath, created: false, size: 0 },
            }
          }

          const content = params.content.endsWith("\n") ? params.content : `${params.content}\n`
          yield* fs.writeWithDirs(fullPath, content).pipe(Effect.orDie)
          yield* bus.publish(File.Event.Edited, { file: fullPath })
          yield* bus.publish(FileWatcher.Event.Updated, {
            file: fullPath,
            event: exists ? "change" : "add",
          })

          return {
            title: `knowledge_update: ${character}`,
            output: `Updated ${relativePath} (${content.length} bytes)`,
            metadata: { path: relativePath, created: !exists, size: content.length },
          }
        }),
    }
  }),
)
