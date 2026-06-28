import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./calc.txt"

interface Tier {
  name: string
  min: number
  max: number | typeof Infinity
  description: string
}

const DEFAULT_TIERS: ReadonlyArray<Tier> = [
  { name: "Mundane", min: 0, max: 200, description: "没有锻炼/修行的普通人" },
  { name: "Apprentice", min: 200, max: 1000, description: "有基础锻炼/修行" },
  { name: "Adept", min: 1000, max: 1800, description: "中坚力量, 需要长时间锻炼/修行, 也是难以突破的瓶颈" },
  { name: "Master", min: 1800, max: 2600, description: "宗师级别, 寻常生灵的极限" },
  { name: "Ascendant", min: 2600, max: 6000, description: "突破凡俗界限, 仙灵的层级" },
  { name: "Transcendent", min: 6000, max: Infinity, description: "极少数存在" },
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

function calcTier(value: number, tiers?: ReadonlyArray<Tier>): string {
  const table = tiers ?? DEFAULT_TIERS
  for (let i = 0; i < table.length; i++) {
    const tier = table[i]
    if (value >= tier.min && (tier.max === Infinity || value < tier.max)) {
      let result = `${value} → ${tier.name} (${tier.description})`
      const next = i < table.length - 1 ? table[i + 1] : undefined
      if (next) {
        const progress = ((value - tier.min) / (next.min - tier.min)) * 100
        result += ` (距 ${next.name} ${progress.toFixed(1)}%)`
      }
      return result
    }
  }
  return `${value} → ${table[0]?.name ?? "Unknown"} (${table[0]?.description ?? ""}) (最低)`
}

function calcDelta(a: number, b: number): string {
  const diff = Math.abs(a - b)
  let description: string
  if (diff < 150) description = "难分高下, 更看临场发挥"
  else if (diff < 400) description = "有明显差距, 但是 环境适应性/心态差异/技能克制 可以弥补差距"
  else if (diff < 1000) description = "差距较大, 难以弥补"
  else description = "碾压, 无法抗衡"
  return `差值 ${diff}，${description}。`
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
    Schema.mutable(Schema.Array(Schema.Struct({
      name: Schema.String,
      min: Schema.Number,
      max: Schema.Number,
      description: Schema.String,
    }))),
  ).annotate({
    description: "Custom tier table. Defaults to standard cultivation tiers.",
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
          if (params.type === "date") output = calcDate(params.from ?? "", params.to ?? "")
          else if (params.type === "tier") output = calcTier(params.value ?? 0, params.tiers as any)
          else if (params.type === "delta") output = calcDelta(params.a ?? 0, params.b ?? 0)
          else if (params.type === "age") output = calcAge(params.birthDate ?? "", params.currentDate ?? "")
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
