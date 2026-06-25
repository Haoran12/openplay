import { Effect, Schema } from "effect"
import {
  TOOL_PRESENTATION_PRIMARY_OUTPUT,
  TOOL_PRESENTATION_VARIANT_NARRATIVE,
  type ToolPresentationMetadata,
} from "@openplay-ai/core/tool-presentation"
import * as Tool from "./tool"
import DESCRIPTION from "./narrate.txt"

const Parameters = Schema.Struct({
  content: Schema.String.annotate({
    description: "叙事文本内容",
  }),
  style: Schema.optional(Schema.String).annotate({
    description: "风格提示词，如'紧张'、'舒缓'、'简洁'",
  }),
  perspective: Schema.optional(Schema.String).annotate({
    description: "叙事视角，如'第三人称'、'第一人称'、'全知视角'",
  }),
})

type NarrateMetadata = ToolPresentationMetadata & {
  length: number
}

export const NarrateTool = Tool.define(
  "narrate",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context<NarrateMetadata>) =>
        Effect.gen(function* () {
          const parts: string[] = []
          if (params.perspective) parts.push(`[视角: ${params.perspective}]`)
          if (params.style) parts.push(`[风格: ${params.style}]`)
          parts.push(params.content)
          return {
            title: `叙事: ${params.content.slice(0, 50)}${params.content.length > 50 ? "..." : ""}`,
            output: params.content,
            metadata: {
              length: params.content.length,
              presentation: TOOL_PRESENTATION_PRIMARY_OUTPUT,
              presentationVariant: TOOL_PRESENTATION_VARIANT_NARRATIVE,
            },
          }
        }),
    }
  }),
)

export * as Narrate from "./narrate"
