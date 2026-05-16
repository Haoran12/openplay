import { Effect, Schema } from "effect"
import { PositiveInt } from "@opencode-ai/core/schema"
import * as Tool from "./tool"
import DESCRIPTION from "./dice-roll.txt"

const Parameters = Schema.Struct({
  sides: Schema.optional(PositiveInt).annotate({
    description: "Number of sides on the die (default: 6)",
  }),
  count: Schema.optional(PositiveInt).annotate({
    description: "Number of dice to roll (default: 1)",
  }),
  modifier: Schema.optional(Schema.Number.annotate({
    description: "Modifier to add to the total result",
  })),
})

type DiceMetadata = {
  rolls: number[]
  total: number
  modifier: number
  final: number
}

export const DiceRollTool = Tool.define(
  "dice_roll",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context<DiceMetadata>) =>
        Effect.gen(function* () {
          const sides = params.sides ?? 6
          const count = params.count ?? 1
          const modifier = params.modifier ?? 0
          const rolls: number[] = []
          for (let i = 0; i < count; i++) {
            rolls.push(Math.floor(Math.random() * sides) + 1)
          }
          const total = rolls.reduce((sum, r) => sum + r, 0)
          const final = total + modifier
          const rollStr = rolls.join(", ")
          const resultParts: string[] = [
            `Rolling ${count}d${sides}${modifier !== 0 ? (modifier > 0 ? `+${modifier}` : `${modifier}`) : ""}`,
          ]
          if (count > 1) resultParts.push(`Rolls: [${rollStr}] = ${total}`)
          resultParts.push(`Result: ${final}`)
          return {
            title: `dice_roll: ${count}d${sides} = ${final}`,
            output: resultParts.join("\n"),
            metadata: { rolls, total, modifier, final },
          }
        }),
    }
  }),
)

export * as DiceRoll from "./dice-roll"