export * as Embody from "./embody"

import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"
import DESCRIPTION from "./embody.txt"
import { GodOnlyFilter, filterL2View } from "./god-only-filter"
import { Session } from "@/session/session"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { MessageID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import type { TaskPromptOps } from "./task"

const Parameters = Schema.Struct({
  character: Schema.String.annotate({
    description: "Name of the character to embody (must be present in the scene)",
  }),
  l2View: Schema.String.annotate({
    description: "The L2 narrative view for this character — filtered narrative context that the character can perceive. Do NOT include any God Only content.",
  }),
  situation: Schema.String.annotate({
    description: "Current scene situation description — what is happening right now from this character's perspective",
  }),
})

type EmbodyMetadata = {
  character: string
  filtered: boolean
  subagentSessionID?: string
}

function parseModelString(modelStr: string): { modelID: string; providerID: string } | undefined {
  const parts = modelStr.split("/")
  if (parts.length !== 2) return undefined
  return { providerID: parts[0], modelID: parts[1] }
}

export const EmbodyTool = Tool.define(
  "embody",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const filterService = yield* GodOnlyFilter.Service

    const execute = (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<EmbodyMetadata>) =>
      Effect.gen(function* () {
        const ins = yield* InstanceState.context
        const worldPath = ins.world?.rootPath
        
        const forbiddenSet = worldPath 
          ? yield* filterService.getForbiddenSet(worldPath).pipe(Effect.orDie)
          : { strings: new Set<string>(), fileHashes: new Map<string, string>() }
        
        const filteredView = filterL2View(params.l2View, forbiddenSet)
        const wasFiltered = filteredView !== params.l2View

        const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
        if (!ops) {
          const resultLines: string[] = [
            `## Embodying: ${params.character}`,
            "",
            "### Scene",
            params.situation,
            "",
            "### Your Perspective",
            filteredView,
            "",
            `Respond as ${params.character}. Stay in character at all times. Use the question tool if you need clarification from the player.`,
          ]
          const metadata: EmbodyMetadata = { character: params.character, filtered: wasFiltered }
          return {
            title: `Embody: ${params.character}`,
            output: resultLines.join("\n"),
            metadata,
          }
        }

        const parentSession = yield* sessions.get(ctx.sessionID).pipe(Effect.orDie)
        const characterAgent = yield* agents.get(params.character).pipe(
          Effect.catchCause(() => Effect.succeed(undefined)),
        )

        const cfg = yield* config.get().pipe(Effect.orDie)
        let model: { modelID: string; providerID: string }
        
        if (characterAgent?.model) {
          const agentModel = characterAgent.model
          model = { modelID: agentModel.modelID, providerID: agentModel.providerID }
        } else if (parentSession.model) {
          const sessionModel = parentSession.model
          model = { modelID: sessionModel.id, providerID: sessionModel.providerID }
        } else {
          model = parseModelString(cfg.model ?? "anthropic/claude-sonnet-4-20250514")!
        }

        const subagentSession = yield* sessions.create({
          parentID: ctx.sessionID,
          title: `Character: ${params.character}`,
          agent: params.character,
        }).pipe(Effect.orDie)

        const subagentSessionID = subagentSession.id

        const systemPrompt = [
          `You are ${params.character}. Stay in character at all times.`,
          "",
          "## Current Scene",
          params.situation,
          "",
          "## Your Perspective",
          filteredView,
          "",
          "Respond as your character would. Use the question tool if you need clarification from the player.",
        ].join("\n")

        const result = yield* ops
          .prompt({
            messageID: MessageID.ascending(),
            sessionID: subagentSessionID,
            model: {
              modelID: ModelID.make(model.modelID),
              providerID: ProviderID.make(model.providerID),
            },
            agent: params.character,
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
            roleplay: {
              environmentOverride: `You are in a roleplay scene as ${params.character}. The current game date and world context will be provided by the Director.`,
              instructionOverride: "",
              skillsOverride: "",
            },
            parts: [{ type: "text", text: systemPrompt }],
          })
          .pipe(
            Effect.timeout("60 seconds"),
            Effect.catchCause(() =>
              Effect.succeed({
                parts: [{ type: "text" as const, text: "[Character response timed out]" }],
              }),
            ),
          )

        const responseText =
          result.parts.findLast((item) => item.type === "text")?.text ?? "[No response]"

        const metadata: EmbodyMetadata = {
          character: params.character,
          filtered: wasFiltered,
          subagentSessionID,
        }
        return {
          title: `Embody: ${params.character}`,
          output: responseText,
          metadata,
        }
      })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute,
    } satisfies Tool.DefWithoutID<typeof Parameters, EmbodyMetadata>
  }),
)