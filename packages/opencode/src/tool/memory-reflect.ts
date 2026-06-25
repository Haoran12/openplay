import { Effect, Schema } from "effect"
import { AppFileSystem } from "@openplay-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"
import DESCRIPTION from "./memory-reflect.txt"
import { Session } from "@/session/session"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { MessageID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import type { TaskPromptOps } from "./task"
import { deriveSubagentSessionPermission } from "@/agent/subagent-permissions"
import { buildCharacterSelfKnowledge, resolveCharacterWorldResources } from "./embody"
import { GodOnlyFilter } from "./god-only-filter"
import { readManifest, resolveForCharacter } from "./character-directory"

const Parameters = Schema.Struct({
  character: Schema.String.annotate({
    description: "Name of the character whose subjective memory should be updated",
  }),
  situation: Schema.String.annotate({
    description: "Concise current-scene summary from that character's perspective",
  }),
  event: Schema.String.annotate({
    description: "The event, realization, or relationship shift that may need to enter memory",
  }),
  guidance: Schema.optional(Schema.String).annotate({
    description: "Optional Director guidance about why this memory handling is being triggered",
  }),
})

type MemoryReflectMetadata = {
  character: string
  subagentSessionID?: string
}

function parseModelString(modelStr: string): { modelID: string; providerID: string } | undefined {
  const parts = modelStr.split("/")
  if (parts.length !== 2) return undefined
  return { providerID: parts[0], modelID: parts[1] }
}

const init: Effect.Effect<Tool.DefWithoutID<typeof Parameters, MemoryReflectMetadata>, never, any> = Effect.gen(function* () {
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const fs = yield* AppFileSystem.Service
    const filterService = yield* GodOnlyFilter.Service

    const execute = (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<MemoryReflectMetadata>) =>
      Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const worldPath = ins.world?.rootPath
          const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
          if (!ops) {
            return {
              title: `memory_reflect: ${params.character}`,
              output: "memory_reflect requires promptOps in ctx.extra.",
              metadata: { character: params.character } satisfies MemoryReflectMetadata,
            }
          }
          if (!worldPath) {
            return {
              title: `memory_reflect: ${params.character}`,
              output: "memory_reflect is only available in roleplay worlds.",
              metadata: { character: params.character } satisfies MemoryReflectMetadata,
            }
          }

          const parentSession = yield* sessions.get(ctx.sessionID).pipe(Effect.orDie)
          const characterSubagent = yield* agents.get("character").pipe(Effect.orDie)
          if (!characterSubagent) return yield* Effect.die(new Error('Character subagent "character" is unavailable'))
          const parentAgent = parentSession.agent
            ? yield* agents.get(parentSession.agent).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
            : undefined
          const characterAgent = yield* agents.get(params.character).pipe(Effect.catchCause(() => Effect.succeed(undefined)))

          const forbiddenSet = yield* filterService.getForbiddenSet(worldPath).pipe(Effect.orDie)
          const characterResources = yield* resolveCharacterWorldResources({
            fs,
            worldPath,
            character: params.character,
          })
          const stateContent = characterResources.stateContent
          const selfKnowledgeLines = buildCharacterSelfKnowledge({
            character: params.character,
            characterAgent,
            stateContent,
            forbiddenSet,
          })
          const selfKnowledgeSection =
            selfKnowledgeLines.length > 0 ? selfKnowledgeLines.join("\n") : `- Name: ${params.character}`
          const directoryInfo = (yield* resolveForCharacter({ fs, worldPath, character: params.character })).info
          const manifestItems = directoryInfo
            ? yield* readManifest({ fs, info: directoryInfo }).pipe(Effect.catch(() => Effect.succeed(["profile.yaml", "memory.yaml"])))
            : ["profile.yaml", "memory.yaml"]
          const manifestSection = manifestItems.length > 0 ? manifestItems.join("\n") : "(empty)"

          const cfg = yield* config.get().pipe(Effect.orDie)
          let model: { modelID: string; providerID: string }
          if (characterAgent?.model) {
            model = { modelID: characterAgent.model.modelID, providerID: characterAgent.model.providerID }
          } else if (parentSession.model) {
            model = { modelID: parentSession.model.id, providerID: parentSession.model.providerID }
          } else {
            model = parseModelString(cfg.model ?? "anthropic/claude-sonnet-4-20250514")!
          }

          const subagentSession = yield* sessions.create({
            parentID: ctx.sessionID,
            title: `Character: ${params.character}`,
            agent: characterSubagent.name,
            permission: deriveSubagentSessionPermission({
              parentSessionPermission: parentSession.permission ?? [],
              parentAgent,
              subagent: characterSubagent,
            }),
            roleplayCharacter: params.character,
            roleplayPurpose: "memory_reflect",
          }).pipe(Effect.orDie)

          const subagentSessionID = subagentSession.id
          const systemPrompt = [
            `Character name: ${params.character}`,
            ...(characterAgent?.persona ? ["", "## Persona", characterAgent.persona] : []),
            "",
            "## Core Self-Knowledge",
            selfKnowledgeSection,
            "",
            "## Visible Character Resources",
            manifestSection,
            "",
            "You are updating your own subjective long-term memory file.",
            "You, not the Director, are the authority over what belongs in that file.",
            "Start by reading your own manifest, then read whichever listed resources you need with character_view_read(target=\"resource\", path=...).",
            "Your own listed role resources are your source of self-understanding; the Director is not.",
            "If a file contains access tags other than God Only, interpret them cautiously in character instead of treating them as automatic facts.",
            "Use the memory_update tool when and only when you decide the memory file should change.",
            "If the event mainly changes a stable understanding instead of episodic memory, prefer revising a knowledge resource with knowledge_update instead.",
            "If the triggering event would not stick in memory, leave the file unchanged and say so briefly.",
            "Keep newest-first ordering and preserve the structured YAML format.",
            "Judge impression strictly from your own lived memorability, not omniscient plot importance.",
            "Reserve 4-5 as scarce, keep 5 for engraved memories only, and let weak memories blur faster over time.",
            "Do not write public records, omniscient narration, or scene transcripts.",
          ].join("\n")

          const userPrompt = [
            `Review whether ${params.character}'s subjective memory should change now.`,
            "",
            "## Current Scene",
            params.situation,
            "",
            "## Triggering Event",
            params.event,
            ...(params.guidance ? ["", "## Director Guidance", params.guidance] : []),
            "",
            "First inspect the listed role resources you need. Then decide whether this should enter or alter long-term memory.",
            "If this should change long-term memory, call memory_update with the full updated YAML content.",
            "If not, answer in plain text with one short sentence explaining that no memory update is needed.",
          ].join("\n")

          const result = yield* ops
            .prompt({
              messageID: MessageID.ascending(),
              sessionID: subagentSessionID,
              model: {
                modelID: ModelID.make(model.modelID),
                providerID: ProviderID.make(model.providerID),
              },
              agent: characterSubagent.name,
              tools: {
                read: false,
                glob: false,
                grep: false,
                shell: false,
                edit: false,
                write: false,
                task: false,
                calc: false,
                dice_roll: false,
                narrate: false,
                scene_update: false,
                character_view_read: true,
                memory_update: true,
                knowledge_update: true,
                embody: false,
                todowrite: false,
              },
              system: systemPrompt,
              roleplay: {
                environmentOverride: `You are in a roleplay scene as ${params.character}. Read your own listed role resources first, then update only your own subjective memory if the event would truly remain with you.`,
                instructionOverride: "",
                skillsOverride: "",
              },
              parts: [{ type: "text", text: userPrompt }],
            })
            .pipe(
              Effect.timeout("60 seconds"),
              Effect.catchCause(() =>
                Effect.succeed({
                  info: { role: "assistant" as const, structured: undefined },
                  parts: [{ type: "text" as const, text: "[Memory reflection timed out]" }],
                }),
              ),
            )

          const responseText =
            result.parts
              .filter((item) => item.type === "text")
              .map((item) => item.text)
              .join("\n")
              .trim() || "[No memory result returned]"

        return {
          title: `memory_reflect: ${params.character}`,
          output: responseText,
          metadata: { character: params.character, subagentSessionID } satisfies MemoryReflectMetadata,
        }
      }).pipe(Effect.orDie)
    const tool = {
      description: DESCRIPTION,
      parameters: Parameters,
      execute,
    }
    return tool satisfies Tool.DefWithoutID<typeof Parameters, MemoryReflectMetadata>
  }).pipe(Effect.orDie)

export const MemoryReflectTool = Tool.define(
  "memory_reflect",
  init as Effect.Effect<
    Tool.DefWithoutID<typeof Parameters, MemoryReflectMetadata>,
    never,
    Session.Service | Agent.Service | Config.Service | AppFileSystem.Service | GodOnlyFilter.Service
  >,
)

export * as MemoryReflect from "./memory-reflect"
