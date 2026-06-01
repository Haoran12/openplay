import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./calc.txt"

const DEFAULT_TIERS: ReadonlyArray<readonly [number, string]> = [
  [0, "Mortal"],
  [100, "Novice"],
  [500, "Apprentice"],
  [1000, "Adept"],
  [2500, "Master"],
  [5000, "Grandmaster"],
  [10000, "Legendary"],
]

function calcDate(from: string, to: string): string {
  const fromDate = parseDate(from)
  const toDate = parseDate(to)
  if (!fromDate || !toDate) return `Error: invalid date format. Use YYYY-MM-DD or YYYY-MM-DD BC.`
  const diffDays = Math.round((toDate.ms - fromDate.ms) / 86400000)
  const absDays = Math.abs(diffDays)
  const absYears = absDays / 365.25
  const years = Math.floor(absYears)
  const remainDays = Math.round(absDays - years * 365.25)
  const parts: string[] = []
  if (years > 0) parts.push(`${years} year${years !== 1 ? "s" : ""}`)
  if (remainDays > 0 || parts.length === 0) parts.push(`${remainDays} day${remainDays !== 1 ? "s" : ""}`)
  return `${parts.join(", ")} ${diffDays > 0 ? "later" : "earlier"}.`
}

function calcTier(value: number, tiers?: ReadonlyArray<readonly [number, string]>): string {
  const table = tiers ?? DEFAULT_TIERS
  for (let i = table.length - 1; i >= 0; i--) {
    if (value >= table[i][0]) {
      const name = table[i][1]
      const next = i < table.length - 1 ? table[i + 1] : undefined
      let result = `${value} → ${name}`
      if (next) {
        const progress = ((value - table[i][0]) / (next[0] - table[i][0])) * 100
        result += ` (距 ${next[1]} ${progress.toFixed(1)}%)`
      }
      return result
    }
  }
  return `${value} → ${table[0]?.[1] ?? "Unknown"} (最低)`
}

function calcDelta(a: number, b: number): string {
  const diff = Math.abs(a - b)
  const ratio = a > b ? a / Math.max(b, 0.001) : b / Math.max(a, 0.001)
  let magnitude: string
  if (ratio < 1.1) magnitude = "几乎相同"
  else if (ratio < 1.5) magnitude = "差距较小"
  else if (ratio < 2) magnitude = "有明显差距"
  else if (ratio < 3) magnitude = "差距显著"
  else if (ratio < 5) magnitude = "差距很大"
  else if (ratio < 10) magnitude = "差距悬殊"
  else magnitude = "实力差距巨大"
  return `差值 ${diff}，倍率 ${ratio.toFixed(2)}x，${magnitude}。`
}

function calcAge(birthDate: string, currentDate: string): string {
  const from = parseDate(birthDate)
  const to = parseDate(currentDate)
  if (!from || !to) return `Error: invalid date format.`
  const ageDays = Math.round((to.ms - from.ms) / 86400000)
  return `年龄: ${Math.floor(ageDays / 365.25)} 岁`
}

function parseDate(s: string): { ms: number } | null {
  const trimmed = s.trim()
  const bc = trimmed.toUpperCase().endsWith("BC")
  const dateStr = bc ? trimmed.slice(0, -2).trim() : trimmed
  const parts = dateStr.split("-")
  if (parts.length < 1 || parts.length > 3) return null
  const year = parseInt(parts[0], 10)
  if (isNaN(year)) return null
  const month = parts.length > 1 ? parseInt(parts[1], 10) : 1
  const day = parts.length > 2 ? parseInt(parts[2], 10) : 1
  try {
    const ms = bc
      ? -new Date(-year, month - 1, day).getTime()
      : new Date(year, month - 1, day).getTime()
    return { ms }
  } catch {
    return null
  }
}

export const Parameters = Schema.Struct({
  type: Schema.Literals(["date", "tier", "delta", "age"]).annotate({
    description: "Operation type: date, tier, delta, or age",
  }),
  from: Schema.optional(Schema.String.annotate({ description: "Start date in YYYY-MM-DD or YYYY-MM-DD BC format" })),
  to: Schema.optional(Schema.String.annotate({ description: "End date in YYYY-MM-DD or YYYY-MM-DD BC format" })),
  value: Schema.optional(Schema.Number.annotate({ description: "Numeric value to classify into a tier" })),
  tiers: Schema.optional(
    Schema.mutable(Schema.Tuple([Schema.Number, Schema.String])),
  ).annotate({
    description: "Custom tier table as [threshold, name]. Defaults to standard cultivation tiers.",
  }),
  a: Schema.optional(Schema.Number.annotate({ description: "First value" })),
  b: Schema.optional(Schema.Number.annotate({ description: "Second value" })),
  birthDate: Schema.optional(Schema.String.annotate({ description: "Birth date in YYYY-MM-DD or YYYY-MM-DD BC format" })),
  currentDate: Schema.optional(Schema.String.annotate({ description: "Current date in YYYY-MM-DD or YYYY-MM-DD BC format" })),
})

type CalcResult = { type: string }

export const CalcTool = Tool.define(
  "calc",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context<CalcResult>) =>
        Effect.gen(function* () {
          let output: string
          if (params.type === "date") output = calcDate(params.from, params.to)
          else if (params.type === "tier") output = calcTier(params.value, params.tiers as any)
          else if (params.type === "delta") output = calcDelta(params.a, params.b)
          else if (params.type === "age") output = calcAge(params.birthDate, params.currentDate)
          else output = "Unknown calc type"
          return {
            title: `calc: ${params.type}`,
            output,
            metadata: { type: params.type },
          }
        }),
    }
  }),
)

export * as Calc from "./calc"
