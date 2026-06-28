import { Effect, Schema } from "effect"
import { AppFileSystem } from "@openplay-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"
import DESCRIPTION from "./knowledge-reflect.txt"
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
    description: "Name of the character whose long-term knowledge should be reconsidered",
  }),
  situation: Schema.String.annotate({
    description: "Concise current-scene summary from that character's perspective",
  }),
  event: Schema.String.annotate({
    description: "The event, realization, or repeated pattern that may change durable understanding",
  }),
  guidance: Schema.optional(Schema.String).annotate({
    description: "Optional Director guidance about why this knowledge handling is being triggered",
  }),
})

type KnowledgeReflectMetadata = {
  character: string
  subagentSessionID?: string
}

function parseModelString(modelStr: string): { modelID: string; providerID: string } | undefined {
  const parts = modelStr.split("/")
  if (parts.length !== 2) return undefined
  return { providerID: parts[0], modelID: parts[1] }
}

const init: Effect.Effect<Tool.DefWithoutID<typeof Parameters, KnowledgeReflectMetadata>, never, any> = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const agents = yield* Agent.Service
  const config = yield* Config.Service
  const fs = yield* AppFileSystem.Service
  const filterService = yield* GodOnlyFilter.Service

  const execute = (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<KnowledgeReflectMetadata>) =>
    Effect.gen(function* () {
      const ins = yield* InstanceState.context
      const worldPath = ins.world?.rootPath
      const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
      if (!ops) {
        return {
          title: `knowledge_reflect: ${params.character}`,
          output: "knowledge_reflect requires promptOps in ctx.extra.",
          metadata: { character: params.character } satisfies KnowledgeReflectMetadata,
        }
      }
      if (!worldPath) {
        return {
          title: `knowledge_reflect: ${params.character}`,
          output: "knowledge_reflect is only available in roleplay worlds.",
          metadata: { character: params.character } satisfies KnowledgeReflectMetadata,
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
        roleplayPurpose: "knowledge_reflect",
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
        "You are updating your own long-term knowledge resources.",
        "You, not the Director, are the authority over what durable understanding belongs in those files.",
        "Start by reading your own manifest, then read whichever listed resources you need with character_view_read(target=\"resource\", path=...).",
        "Your own listed role resources are your source of self-understanding and accumulated judgment.",
        "Use knowledge_update when and only when a durable understanding should be added or revised.",
        "",
        "## Knowledge File Directory Contract",
        "",
        "Files under your `knowledge/` directory hold your durable understanding:",
        "",
        "- `world_base.yaml`: Overall worldview and natural laws — broad, general rules.",
        "- `social_and_world.md`: Overall social landscape and political culture.",
        "- `nature_and_body.md`: Natural environment and body/sensory experience.",
        "- `<name>.md`: Knowledge about a **specific** person, region, faction, or social phenomenon.",
        "",
        "**Self vs Others:**",
        "",
        "- `profile.yaml`: Your own attributes, abilities, experience, mindModel, role, appearance.",
        "- `knowledge/<name>.md`: Knowledge about **others** (specific persons, regions, factions).",
        "",
        "**Before creating a new file:**",
        "",
        "Check existing files to avoid duplicates (e.g., if `li_ming.md` exists, update it instead of creating `李明.md`).",
        "",
        "When updating knowledge:",
        "",
        "- Write to `world_base.yaml`/`social_and_world.md`/`nature_and_body.md` only for **broad, general** observations.",
        "- For **specific** persons, regions, factions, or social phenomena, create or update dedicated files.",
        "",
        "Do not write omniscient world truth, public records, or full scene transcripts.",
      ].join("\n")

      const userPrompt = [
        `Review whether ${params.character}'s long-term knowledge resources should change now.`,
        "",
        "## Current Scene",
        params.situation,
        "",
        "## Triggering Event",
        params.event,
        ...(params.guidance ? ["", "## Director Guidance", params.guidance] : []),
        "",
        "First inspect the listed role resources you need.",
        "Then decide whether this should revise durable understanding about society, nature, body/senses, or another person.",
        "If yes, call knowledge_update with the full updated content for the chosen file.",
        "If not, answer in plain text with one short sentence explaining that no knowledge update is needed.",
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
              memory_update: false,
              knowledge_update: true,
              embody: false,
              todowrite: false,
          },
          system: systemPrompt,
          roleplay: {
            environmentOverride: `You are in a roleplay scene as ${params.character}. Read your own listed role resources first, then update only your own durable knowledge if the event would truly change it.`,
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
              parts: [{ type: "text" as const, text: "[Knowledge reflection timed out]" }],
            }),
          ),
        )

      const responseText =
        result.parts
          .filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n")
          .trim() || "[No knowledge result returned]"

      return {
        title: `knowledge_reflect: ${params.character}`,
        output: responseText,
        metadata: { character: params.character, subagentSessionID } satisfies KnowledgeReflectMetadata,
      }
    }).pipe(Effect.orDie)

  return {
    description: DESCRIPTION,
    parameters: Parameters,
    execute,
  } satisfies Tool.DefWithoutID<typeof Parameters, KnowledgeReflectMetadata>
}).pipe(Effect.orDie)

export const KnowledgeReflectTool = Tool.define(
  "knowledge_reflect",
  init as Effect.Effect<
    Tool.DefWithoutID<typeof Parameters, KnowledgeReflectMetadata>,
    never,
    Session.Service | Agent.Service | Config.Service | AppFileSystem.Service | GodOnlyFilter.Service
  >,
)

export * as KnowledgeReflect from "./knowledge-reflect"
