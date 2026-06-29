export * as Narrate from "./narrate"

import { Effect, Schema } from "effect"
import { parse as parseYaml } from "yaml"
import {
  TOOL_PRESENTATION_PRIMARY_OUTPUT,
  TOOL_PRESENTATION_VARIANT_NARRATIVE,
  type ToolPresentationMetadata,
} from "@openplay-ai/core/tool-presentation"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Session } from "@/session/session"
import { MessageID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import type { TaskPromptOps } from "./task"
import * as Tool from "./tool"
import DESCRIPTION from "./narrate.txt"
import PROMPT_TEMPLATE from "./narrate-prompt.txt"

export const SceneSchema = Schema.Struct({
  time: Schema.String.annotate({
    description: "当前场景时间",
  }),
  location: Schema.String.annotate({
    description: "当前场景地点",
  }),
  environment: Schema.optional(Schema.String).annotate({
    description: "补充环境信息，如天气、气味、光线、声音",
  }),
})

export const CharacterSampleSchema = Schema.Struct({
  name: Schema.String.annotate({
    description: "角色名称",
  }),
  speech: Schema.optional(Schema.String).annotate({
    description: "角色说出的内容",
  }),
  outwardAction: Schema.optional(Schema.String).annotate({
    description: "角色可见的外在动作",
  }),
  innerThought: Schema.optional(Schema.String).annotate({
    description: "角色内心，仅在允许的叙事视角下提供给 narrate",
  }),
})

export const PerspectiveSchema = Schema.Literals([
  "第三人称客观",
  "第三人称全知",
  "第三人称限知",
  "第一人称",
  "电影视角",
]).annotate({
  description: "叙事视角",
})

const RawSceneSchema = Schema.Union([SceneSchema, Schema.String])
const RawCharacterSamplesSchema = Schema.Union([
  Schema.Array(CharacterSampleSchema),
  CharacterSampleSchema,
  Schema.String,
])

const Parameters = Schema.Struct({
  scene: Schema.optional(RawSceneSchema).annotate({
    description: "当前场景信息",
  }),
  characterSamples: Schema.optional(RawCharacterSamplesSchema).annotate({
    description: "角色言行样本",
  }),
  outcomes: Schema.optional(Schema.String).annotate({
    description: "Director 对本轮事件走向的综合判断",
  }),
  additionalNotes: Schema.optional(Schema.String).annotate({
    description: "额外叙事补充要求",
  }),
  content: Schema.optional(Schema.String).annotate({
    description: "已写好的叙事文本；当 LLM 生成不可用时可直接回退输出",
  }),
  style: Schema.optional(Schema.String).annotate({
    description: "风格提示词，如'紧张'、'舒缓'、'简洁'",
  }),
  perspective: Schema.optional(PerspectiveSchema).annotate({
    description: "叙事视角",
  }),
  povCharacter: Schema.optional(Schema.String).annotate({
    description: "限知或第一人称叙事时的 POV 角色名",
  }),
})

type NarrateMetadata = ToolPresentationMetadata & {
  length: number
  source: "generated" | "fallback"
  perspective: Schema.Schema.Type<typeof PerspectiveSchema>
}

const DEFAULT_PERSPECTIVE = "第三人称客观" as const
const DEFAULT_MODEL = "anthropic/claude-sonnet-4-20250514"

type NarrateParameters = Schema.Schema.Type<typeof Parameters>
type Perspective = Schema.Schema.Type<typeof PerspectiveSchema>
type Scene = Schema.Schema.Type<typeof SceneSchema>
type CharacterSample = Schema.Schema.Type<typeof CharacterSampleSchema>
type NormalizedNarrateParameters = Omit<NarrateParameters, "scene" | "characterSamples"> & {
  scene?: Scene
  characterSamples?: CharacterSample[]
}

function parseModelString(modelStr: string): { modelID: string; providerID: string } | undefined {
  const parts = modelStr.split("/")
  if (parts.length !== 2) return undefined
  return { providerID: parts[0], modelID: parts[1] }
}

function renderPromptTemplate(template: string, variables: Record<string, string>): string {
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables[key] ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function optionalSection(title: string, content?: string): string {
  const trimmed = content?.trim()
  if (!trimmed) return ""
  return `${title}\n${trimmed}`
}

function decodeYamlBlock<T>(raw: string, schema: Schema.Schema<T>): T | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  try {
    const decoded = parseYaml(trimmed)
    return Schema.decodeUnknownSync(schema)(decoded)
  } catch {
    return undefined
  }
}

function normalizeScene(scene?: NarrateParameters["scene"]): Scene | undefined {
  if (!scene) return undefined
  if (typeof scene !== "string") return scene
  return decodeYamlBlock(scene, SceneSchema)
}

function normalizeCharacterSamples(samples?: NarrateParameters["characterSamples"]): CharacterSample[] | undefined {
  if (!samples) return undefined
  if (typeof samples === "string") {
    const single = decodeYamlBlock(samples, CharacterSampleSchema)
    if (single) return [single]
    return decodeYamlBlock(samples, Schema.Array(CharacterSampleSchema))
  }
  return Array.isArray(samples) ? samples : [samples]
}

function normalizeNarrateParameters(params: NarrateParameters): NormalizedNarrateParameters {
  return {
    ...params,
    scene: normalizeScene(params.scene),
    characterSamples: normalizeCharacterSamples(params.characterSamples),
  }
}

function summarizeScene(scene?: Scene): string {
  if (!scene) return "（未提供）"
  const lines = [`- 时间: ${scene.time}`, `- 地点: ${scene.location}`]
  if (scene.environment?.trim()) lines.push(`- 环境: ${scene.environment.trim()}`)
  return lines.join("\n")
}

export function formatCharacterSamplesSection(
  samples: readonly CharacterSample[] = [],
  perspective: Perspective = DEFAULT_PERSPECTIVE,
  povCharacter?: string,
): string {
  if (samples.length === 0) return "（未提供）"

  return samples
    .map((sample) => {
      const lines = [`人物: ${sample.name}`]
      if (sample.speech?.trim()) lines.push(`说话: ${sample.speech.trim()}`)
      if (sample.outwardAction?.trim()) lines.push(`动作: ${sample.outwardAction.trim()}`)

      const canUseInnerThought =
        perspective === "第三人称全知" ||
        ((perspective === "第三人称限知" || perspective === "第一人称") && sample.name === povCharacter)

      if (canUseInnerThought && sample.innerThought?.trim()) {
        lines.push(`内心: ${sample.innerThought.trim()}`)
      }

      return lines.join("\n")
    })
    .join("\n\n")
}

export function getPerspectiveInstruction(perspective: Perspective = DEFAULT_PERSPECTIVE, povCharacter?: string): string {
  switch (perspective) {
    case "第三人称客观":
      return "只描写可见、可闻、可感的外部行为与对话，不直接写任何角色的内心活动。用动作、停顿、神态与语气折射心理。"
    case "第三人称全知":
      return "以第三人称叙述。可适度使用提供的内心活动，但仍以场面推进、对话与动作描写为主。"
    case "第三人称限知":
      return `以第三人称限知叙述。只允许展现 ${povCharacter} 的内心活动，其他角色只能描写外在表现。`
    case "第一人称":
      return `以 ${povCharacter} 的第一人称叙述，只能表达此角色的感受、观察与内心活动，其他角色只能从外部观察。`
    case "电影视角":
      return "采用纯镜头化外部描写，不写任何角色内心。强调景别、动作衔接、声音与画面感。"
  }
}

export function buildNarrateSystemPrompt(params: NormalizedNarrateParameters): string {
  return renderPromptTemplate(PROMPT_TEMPLATE, {
    scene_section: summarizeScene(params.scene),
    character_samples_section: formatCharacterSamplesSection(
      params.characterSamples ?? [],
      params.perspective ?? DEFAULT_PERSPECTIVE,
      params.povCharacter,
    ),
    outcomes_section: params.outcomes?.trim() || "（未提供）",
    additional_notes_section: optionalSection("### 补充说明", params.additionalNotes),
    style_instruction_section: optionalSection("### 额外风格提示", params.style),
    perspective_instruction: getPerspectiveInstruction(params.perspective ?? DEFAULT_PERSPECTIVE, params.povCharacter),
  })
}

function resolveFallbackContent(params: NarrateParameters) {
  return params.content?.trim() ?? ""
}

export function emitDirectly(params: NormalizedNarrateParameters): Tool.ExecuteResult<NarrateMetadata> {
  const content = resolveFallbackContent(params)
  const perspective = params.perspective ?? DEFAULT_PERSPECTIVE
  return {
    title: `叙事: ${content.slice(0, 50)}${content.length > 50 ? "..." : ""}`,
    output: content,
    metadata: {
      length: content.length,
      source: "fallback",
      perspective,
      presentation: TOOL_PRESENTATION_PRIMARY_OUTPUT,
      presentationVariant: TOOL_PRESENTATION_VARIANT_NARRATIVE,
    },
  }
}

function generateNarrative(
  params: NormalizedNarrateParameters,
  ctx: Tool.Context<NarrateMetadata>,
  deps: {
    sessions: Session.Interface
    agents: Agent.Interface
    config: Config.Interface
  },
) {
  return Effect.gen(function* () {
    const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
    const fallbackContent = resolveFallbackContent(params)
    if (!ops) {
      if (fallbackContent) return emitDirectly(params)
      return yield* Effect.fail(new Error("narrate requires promptOps when using structured inputs without content fallback"))
    }

    const cfg = yield* deps.config.get().pipe(Effect.orDie)
    const parentSession = yield* deps.sessions.get(ctx.sessionID).pipe(Effect.orDie)
    const directorAgent = yield* deps.agents.get("director").pipe(Effect.catchCause(() => Effect.succeed(undefined)))

    const configuredNarrateModel = cfg.roleplay?.narrateModel ? parseModelString(cfg.roleplay.narrateModel) : undefined
    const configuredDefaultModel = parseModelString(cfg.model ?? DEFAULT_MODEL)
    const model =
      configuredNarrateModel ??
      (parentSession.model
        ? { modelID: parentSession.model.id, providerID: parentSession.model.providerID }
        : configuredDefaultModel)

    if (!model) {
      return yield* Effect.fail(new Error("narrate could not resolve a valid provider/model pair"))
    }

    const result = yield* ops
      .prompt({
        messageID: MessageID.ascending(),
        sessionID: ctx.sessionID,
        model: {
          modelID: ModelID.make(model.modelID),
          providerID: ProviderID.make(model.providerID),
        },
        agent: directorAgent?.name ?? parentSession.agent ?? ctx.agent,
        tools: { "*": false },
        system: buildNarrateSystemPrompt(params),
        parts: [{ type: "text", text: "请直接输出叙事正文。" }],
      })
      .pipe(
        Effect.timeout("30 seconds"),
        Effect.catchCause(() => {
          if (fallbackContent) return Effect.succeed(undefined)
          return Effect.fail(new Error("narrate LLM generation failed and no fallback content was provided"))
        }),
      )

    if (!result) return emitDirectly(params)

    const narrativeText = result.parts
      .filter((item): item is { type: "text"; text: string } => item.type === "text")
      .map((item) => item.text)
      .join("\n")
      .trim()

    if (!narrativeText && fallbackContent) return emitDirectly(params)
    if (!narrativeText) {
      return yield* Effect.fail(new Error("narrate LLM generation returned empty text"))
    }

    return {
      title: `叙事: ${narrativeText.slice(0, 50)}${narrativeText.length > 50 ? "..." : ""}`,
      output: narrativeText,
      metadata: {
        length: narrativeText.length,
        source: "generated" as const,
        perspective: params.perspective ?? DEFAULT_PERSPECTIVE,
        presentation: TOOL_PRESENTATION_PRIMARY_OUTPUT,
        presentationVariant: TOOL_PRESENTATION_VARIANT_NARRATIVE,
      },
    } satisfies Tool.ExecuteResult<NarrateMetadata>
  })
}

export const NarrateTool = Tool.define(
  "narrate",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: NarrateParameters, ctx: Tool.Context<NarrateMetadata>) =>
        Effect.gen(function* () {
          const normalized = normalizeNarrateParameters(params)
          const hasStructuredInput =
            normalized.scene !== undefined ||
            (normalized.characterSamples?.length ?? 0) > 0 ||
            Boolean(normalized.outcomes?.trim())
          const hasFallbackContent = Boolean(resolveFallbackContent(normalized))
          if (!hasStructuredInput && !hasFallbackContent) {
            return yield* Effect.fail(
              new Error("narrate requires at least one of scene, characterSamples, outcomes, or content"),
            )
          }

          const perspective = params.perspective ?? DEFAULT_PERSPECTIVE
          if ((perspective === "第三人称限知" || perspective === "第一人称") && !params.povCharacter?.trim()) {
            return yield* Effect.fail(new Error(`narrate requires povCharacter when perspective is ${perspective}`))
          }

          if (hasStructuredInput) {
            return yield* generateNarrative(normalized, ctx, { sessions, agents, config })
          }

          return emitDirectly(normalized)
        }),
    }
  }),
)
