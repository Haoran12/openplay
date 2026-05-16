import { Schema } from "effect"
import { withStatics } from "@opencode-ai/core/schema"

const worldIdSchema = Schema.String.pipe(
  Schema.check(Schema.isStartsWith("wld_")),
  Schema.brand("WorldID"),
)

export type WorldID = typeof worldIdSchema.Type

export const WorldID = worldIdSchema.pipe(
  withStatics((schema: typeof worldIdSchema) => ({
    generate: () => schema.make(`wld_${crypto.randomUUID().replace(/-/g, "")}`),
  })),
)