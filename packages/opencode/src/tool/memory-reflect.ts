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
import { buildCharacterSelfKnowledge, buildCharacterSettingSection, resolveCharacterWorldResources } from "./embody"
import { GodOnlyFilter, filterL2View } from "./god-only-filter"
import path from "path"

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

export const MemoryReflectTool = Tool.define(
  "memory_reflect",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const fs = yield* AppFileSystem.Service
    const filterService = yield* GodOnlyFilter.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<MemoryReflectMetadata>) =>
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
            preferredStatePath: characterAgent?.statePath,
          })
          const stateContent = characterResources.stateContent
          const selfKnowledgeLines = buildCharacterSelfKnowledge({
            character: params.character,
            characterAgent,
            stateContent,
            forbiddenSet,
          })
          const characterSettingSection =
            buildCharacterSettingSection({
              character: params.character,
              stateContent,
              forbiddenSet,
            }) ?? "- (none)"
          const selfKnowledgeSection =
            selfKnowledgeLines.length > 0 ? selfKnowledgeLines.join("\n") : `- Name: ${params.character}`

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
          }).pipe(Effect.orDie)

          const subagentSessionID = subagentSession.id
          const memoryPath = characterResources.binding.memoryPath
          const currentMemory =
            filterL2View(
              (yield* fs.readFileStringSafe(path.join(worldPath, memoryPath)).pipe(Effect.orDie))
                ?.trim()
                .replaceAll("\r\n", "\n") || "version: 1\nordering: newest-first\nentries: []\n",
              forbiddenSet,
            ) ||
            "version: 1\nordering: newest-first\nentries: []\n"

          const systemPrompt = [
            `Character name: ${params.character}`,
            ...(characterAgent?.persona ? ["", "## Persona", characterAgent.persona] : []),
            "",
            "## Core Self-Knowledge",
            selfKnowledgeSection,
            "",
            "## Accessible Setting File",
            characterSettingSection,
            "",
            "## Current Subjective Memory File",
            currentMemory,
            "",
            "You are updating your own subjective long-term memory file.",
            "You, not the Director, are the authority over what belongs in that file.",
            "Use the memory_update tool when and only when you decide the memory file should change.",
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
                embody: false,
                todowrite: false,
              },
              system: systemPrompt,
              roleplay: {
                environmentOverride: `You are in a roleplay scene as ${params.character}. Update only your own subjective memory if the event would truly remain with you.`,
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
        }).pipe(Effect.orDie),
    }
  }),
)

export * as MemoryReflect from "./memory-reflect"
