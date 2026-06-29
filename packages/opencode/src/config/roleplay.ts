export * as ConfigRoleplay from "./roleplay"

import { Schema } from "effect"
import { PositiveInt } from "@openplay-ai/core/schema"
import { ConfigModelID } from "./model-id"

const NarrativeStyle = Schema.Struct({
  language: Schema.optional(Schema.String).annotate({
    description: "Narrative language style, e.g. 'early_modern', 'colloquial'",
  }),
  rhetoric: Schema.optional(Schema.String).annotate({
    description: "Rhetoric style, e.g. 'balanced', 'flowery', 'terse'",
  }),
  psychology: Schema.optional(Schema.String).annotate({
    description: "Psychology depth, e.g. 'mixed', 'deep', 'surface'",
  }),
  pacing: Schema.optional(Schema.String).annotate({
    description: "Narrative pacing, e.g. 'varied', 'slow', 'fast'",
  }),
})

export const Info = Schema.Struct({
  worldPath: Schema.optional(Schema.String).annotate({
    description: "Relative path to the world directory from the project root",
  }),
  currentDate: Schema.optional(Schema.String).annotate({
    description: "Current in-game date",
  }),
  narrativeStyle: Schema.optional(NarrativeStyle).annotate({
    description: "Narrative style configuration",
  }),
  recordThreshold: Schema.optional(PositiveInt).annotate({
    description: "Event record trigger threshold",
  }),
  narrateModel: Schema.optional(ConfigModelID).annotate({
    description: "Optional model for narrate tool (defaults to Director's model)",
  }),
  narrateTimeoutSeconds: Schema.optional(PositiveInt).annotate({
    description: "Narrate tool LLM timeout in seconds (default 90; raised from previous 30s to accommodate slow providers)",
  }),
  characterModel: Schema.optional(ConfigModelID).annotate({
    description: "Optional fallback model for character subagents when no per-character agent model is set (defaults to parent session model)",
  }),
}).annotate({ identifier: "ConfigRoleplay" })
export type Info = Schema.Schema.Type<typeof Info>
