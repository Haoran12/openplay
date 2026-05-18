export * as Embody from "./embody"

import { Effect, Schema } from "effect"
import { parse } from "yaml"
import path from "path"
import { AppFileSystem } from "@openplay-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"
import DESCRIPTION from "./embody.txt"
import { GodOnlyFilter, filterL2View } from "./god-only-filter"
import type { ForbiddenSet } from "./god-only-filter"
import { Session } from "@/session/session"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { MessageID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import type { TaskPromptOps } from "./task"
import { deriveSubagentSessionPermission } from "@/agent/subagent-permissions"

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

type CharacterAgentContext = Pick<Agent.Info, "senses" | "knowledgeAccess">

const GOD_ONLY_ACCESS = new Set(["godonly"])
const SELF_KNOWLEDGE_FIELDS = new Map<string, string>([
  ["name", "Name"],
  ["姓名", "Name"],
  ["名字", "Name"],
  ["gender", "Gender"],
  ["sex", "Gender"],
  ["pronouns", "Pronouns"],
  ["性别", "Gender"],
  ["genderidentity", "Gender"],
  ["species", "Species"],
  ["race", "Species"],
  ["kind", "Species"],
  ["种族", "Species"],
  ["族属", "Species"],
  ["身份", "Identity"],
  ["identity", "Identity"],
  ["role", "Identity"],
  ["title", "Identity"],
  ["身份定位", "Identity"],
  ["职业", "Identity"],
  ["cultivation", "Cultivation"],
  ["cultivationlevel", "Cultivation"],
  ["realm", "Cultivation"],
  ["rank", "Cultivation"],
  ["tier", "Cultivation"],
  ["level", "Cultivation"],
  ["修为", "Cultivation"],
  ["境界", "Cultivation"],
  ["修为境界", "Cultivation"],
  ["阶位", "Cultivation"],
  ["faction", "Faction"],
  ["affiliation", "Faction"],
  ["sect", "Faction"],
  ["clan", "Faction"],
  ["group", "Faction"],
  ["阵营", "Faction"],
  ["势力", "Faction"],
  ["宗门", "Faction"],
  ["门派", "Faction"],
  ["所属", "Faction"],
  ["form", "Current form"],
  ["currentform", "Current form"],
  ["shape", "Current form"],
  ["body", "Current form"],
  ["形态", "Current form"],
  ["当前形态", "Current form"],
  ["化形", "Current form"],
  ["status", "Current state"],
  ["condition", "Current state"],
  ["state", "Current state"],
  ["当前状态", "Current state"],
  ["伤势", "Current state"],
  ["health", "Current state"],
])
const VALUE_FIELDS = ["content", "current", "value", "name", "text", "description"] as const

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[\s_\-]/g, "")
}

function isGodOnlyAccess(access: unknown): boolean {
  return typeof access === "string" && GOD_ONLY_ACCESS.has(normalizeToken(access))
}

function listIncludesCharacter(access: string, character: string): boolean {
  const index = access.indexOf(":")
  if (index === -1) return false
  const members = access
    .slice(index + 1)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  return members.includes(character)
}

function canUseSelfKnowledgeAccess(
  access: unknown,
  character: string,
  knowledgeAccess: readonly string[] | undefined,
): boolean {
  if (access === undefined) return true
  if (typeof access !== "string") return false
  const normalized = normalizeToken(access)
  if (isGodOnlyAccess(access)) return false
  if (normalized === "public" || normalized === "self") return true
  if (normalized === "participant") return false
  if (normalized.startsWith("list:")) return listIncludesCharacter(access, character)
  if (!normalized.startsWith("condition:")) return false

  const condition = access.slice(access.indexOf(":") + 1).trim()
  const tokens = new Set<string>()
  for (const item of knowledgeAccess ?? []) {
    tokens.add(normalizeToken(item))
    if (item.includes(":")) {
      tokens.add(normalizeToken(item.slice(item.indexOf(":") + 1)))
    }
  }
  return tokens.has(normalized) || tokens.has(normalizeToken(condition))
}

function formatPrimitive(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return undefined
}

function formatValue(value: unknown): string | undefined {
  const primitive = formatPrimitive(value)
  if (primitive) return primitive
  if (!Array.isArray(value)) return undefined

  const parts = value
    .map((item) => formatPrimitive(item))
    .filter((item): item is string => !!item)
  return parts.length > 0 ? parts.join("、") : undefined
}

function resolveSelfKnowledgeValue(
  value: unknown,
  character: string,
  knowledgeAccess: readonly string[] | undefined,
): string | undefined {
  const direct = formatValue(value)
  if (direct) return direct
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined

  const obj = value as Record<string, unknown>
  if (isGodOnlyAccess(obj.access)) return undefined

  const allowed = canUseSelfKnowledgeAccess(obj.access, character, knowledgeAccess)
  if (!allowed) {
    return formatValue(obj.apparent_content)
  }

  for (const field of VALUE_FIELDS) {
    const resolved = formatValue(obj[field])
    if (resolved) return resolved
  }

  return undefined
}

function collectSelfKnowledgeEntries(
  node: unknown,
  character: string,
  knowledgeAccess: readonly string[] | undefined,
  entries: Map<string, string>,
): void {
  if (typeof node !== "object" || node === null) return
  if (Array.isArray(node)) {
    for (const item of node) {
      collectSelfKnowledgeEntries(item, character, knowledgeAccess, entries)
    }
    return
  }

  const obj = node as Record<string, unknown>
  if (isGodOnlyAccess(obj.access)) return

  for (const [key, value] of Object.entries(obj)) {
    const label = SELF_KNOWLEDGE_FIELDS.get(normalizeToken(key))
    if (label && !entries.has(label)) {
      const resolved = resolveSelfKnowledgeValue(value, character, knowledgeAccess)
      if (resolved) entries.set(label, resolved)
    }

    if (typeof value === "object" && value !== null) {
      collectSelfKnowledgeEntries(value, character, knowledgeAccess, entries)
    }
  }
}

function sanitizeSelfKnowledgeValue(value: string, forbiddenSet: ForbiddenSet | undefined): string {
  return forbiddenSet ? filterL2View(value, forbiddenSet).trim() : value.trim()
}

export function buildCharacterSelfKnowledge(input: {
  character: string
  characterAgent?: CharacterAgentContext
  stateContent?: string
  forbiddenSet?: ForbiddenSet
}): string[] {
  const entries = new Map<string, string>()
  entries.set("Name", input.character)

  if (input.stateContent) {
    try {
      const parsed = parse(input.stateContent)
      collectSelfKnowledgeEntries(parsed, input.character, input.characterAgent?.knowledgeAccess, entries)
    } catch {
      // Ignore malformed YAML and fall back to agent metadata only.
    }
  }

  if (input.characterAgent?.senses && Object.keys(input.characterAgent.senses).length > 0) {
    const senses = Object.entries(input.characterAgent.senses)
      .map(([name, level]) => `${name}=${level}`)
      .join(", ")
    if (senses.length > 0) entries.set("Sensory capabilities", senses)
  }

  return Array.from(entries.entries())
    .map(([label, value]) => {
      const sanitized = sanitizeSelfKnowledgeValue(value, input.forbiddenSet)
      return sanitized.length > 0 && sanitized !== "[已隐去]" ? `- ${label}: ${sanitized}` : undefined
    })
    .filter((line): line is string => !!line)
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
    const fs = yield* AppFileSystem.Service

    const execute = (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<EmbodyMetadata>) =>
      Effect.gen(function* () {
        const ins = yield* InstanceState.context
        const worldPath = ins.world?.rootPath
        
        const forbiddenSet = worldPath 
          ? yield* filterService.getForbiddenSet(worldPath).pipe(Effect.orDie)
          : { strings: new Set<string>(), fileHashes: new Map<string, string>() }
        
        const filteredView = filterL2View(params.l2View, forbiddenSet)
        const wasFiltered = filteredView !== params.l2View
        const characterAgent = yield* agents.get(params.character).pipe(
          Effect.catchCause(() => Effect.succeed(undefined)),
        )
        const stateContent =
          worldPath && characterAgent?.statePath
            ? yield* fs.readFileStringSafe(path.join(worldPath, characterAgent.statePath)).pipe(Effect.orDie)
            : undefined
        const selfKnowledgeLines = buildCharacterSelfKnowledge({
          character: params.character,
          characterAgent,
          stateContent,
          forbiddenSet,
        })
        const selfKnowledgeSection =
          selfKnowledgeLines.length > 0 ? selfKnowledgeLines.join("\n") : `- Name: ${params.character}`

        const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
        if (!ops) {
          const resultLines: string[] = [
            `## Embodying: ${params.character}`,
            "",
            "### Core Self-Knowledge",
            selfKnowledgeSection,
            "",
            "### Scene",
            params.situation,
            "",
            "### What You Can Currently Perceive",
            filteredView,
            "",
            `Respond as ${params.character}. Stay in character at all times. Base your response only on the self-knowledge and current perception above. Use the question tool if you need clarification from the player.`,
          ]
          const metadata: EmbodyMetadata = { character: params.character, filtered: wasFiltered }
          return {
            title: `Embody: ${params.character}`,
            output: resultLines.join("\n"),
            metadata,
          }
        }

        const parentSession = yield* sessions.get(ctx.sessionID).pipe(Effect.orDie)
        const characterSubagent = yield* agents.get("character").pipe(Effect.orDie)
        if (!characterSubagent) return yield* Effect.die(new Error('Character subagent "character" is unavailable'))
        const parentAgent = parentSession.agent
          ? yield* agents.get(parentSession.agent).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
          : undefined

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
          agent: characterSubagent.name,
          permission: deriveSubagentSessionPermission({
            parentSessionPermission: parentSession.permission ?? [],
            parentAgent,
            subagent: characterSubagent,
          }),
        }).pipe(Effect.orDie)

        const subagentSessionID = subagentSession.id

        const systemPrompt = [
          `Character name: ${params.character}`,
          ...(characterAgent?.persona
            ? [
                "",
                "## Persona",
                characterAgent.persona,
              ]
            : []),
          "",
          "## Core Self-Knowledge",
          selfKnowledgeSection,
          "",
          "## Current Scene",
          params.situation,
          "",
          "## What You Can Currently Perceive",
          filteredView,
          "",
          "Treat Core Self-Knowledge as facts you know about yourself.",
          "Treat Current Scene and What You Can Currently Perceive as the full extent of what you know about the outside world right now.",
          "Do not infer hidden facts beyond these sections.",
          "",
          "Respond as this character would. Use the question tool only when the character would plausibly ask for clarification.",
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
              environmentOverride: `You are in a roleplay scene as ${params.character}. Your self-knowledge and current perception have already been filtered to remove hidden truths that only the Director should know.`,
              instructionOverride: "",
              skillsOverride: "",
            },
            parts: [
              {
                type: "text",
                text: `Respond as ${params.character} in character based only on the provided self-knowledge, scene, and current perception.`,
              },
            ],
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
