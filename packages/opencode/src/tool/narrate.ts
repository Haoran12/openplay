import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./narrate.txt"

const Parameters = Schema.Struct({
  content: Schema.String.annotate({
    description: "The narrative content to produce",
  }),
  style: Schema.optional(Schema.String).annotate({
    description: "Narrative style hint, e.g. 'suspenseful', 'lyrical', 'terse'",
  }),
  perspective: Schema.optional(Schema.String).annotate({
    description: "Narrative perspective, e.g. 'third-person', 'first-person', 'omniscient'",
  }),
})

type NarrateMetadata = {
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
          if (params.perspective) parts.push(`[Perspective: ${params.perspective}]`)
          if (params.style) parts.push(`[Style: ${params.style}]`)
          parts.push(params.content)
          return {
            title: `narrate: ${params.content.slice(0, 50)}${params.content.length > 50 ? "..." : ""}`,
            output: params.content,
            metadata: { length: params.content.length },
          }
        }),
    }
  }),
)

export * as Narrate from "./narrate"