import { parse, stringify } from "yaml"

export const MEMORY_SCHEMA_VERSION = 1
export const MEMORY_COMPRESSION_BLOCK = 20
export const MEMORY_STRIKING_IMPRESSION_QUOTA = 3
export const MEMORY_ENGRAVED_IMPRESSION_QUOTA = 1

export const MEMORY_IMPRESSION_LABELS = {
  0: "faded",
  1: "fleeting",
  2: "noticeable",
  3: "deep",
  4: "striking",
  5: "engraved",
} as const

export type MemoryImpression = keyof typeof MEMORY_IMPRESSION_LABELS

export type MemoryEntry = {
  id: string
  created_at: string
  impression: MemoryImpression
  compression: number
  summary: string
  time: string
  location: string
  scene_feeling: string
  observed_people: string[]
  self_observation: string
  others_observation: string
}

export type MemoryFile = {
  version: number
  ordering: "newest-first"
  compression_policy: {
    block_size: number
    engraved_preserved: boolean
    impression_modulated: boolean
    max_level: number
  }
  impression_policy: {
    range: "0-5"
    block_size: number
    max_striking_per_block: number
    max_engraved_per_block: number
    overflow_demoted: boolean
  }
  entries: MemoryEntry[]
}

function emptyMemoryFile(): MemoryFile {
  return {
    version: MEMORY_SCHEMA_VERSION,
    ordering: "newest-first",
    compression_policy: {
      block_size: MEMORY_COMPRESSION_BLOCK,
      engraved_preserved: true,
      impression_modulated: true,
      max_level: 4,
    },
    impression_policy: {
      range: "0-5",
      block_size: MEMORY_COMPRESSION_BLOCK,
      max_striking_per_block: MEMORY_STRIKING_IMPRESSION_QUOTA,
      max_engraved_per_block: MEMORY_ENGRAVED_IMPRESSION_QUOTA,
      overflow_demoted: true,
    },
    entries: [],
  }
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function unwrapTextField(value: unknown): unknown {
  const obj = asRecord(value)
  if (!obj) return value

  for (const key of ["summary", "content", "current", "value", "text", "description", "apparent_content"] as const) {
    if (obj[key] !== undefined) return obj[key]
  }
  return value
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .flatMap((item) => {
      const text = asString(unwrapTextField(item))
      return text ? [text] : []
    })
}

function clampImpression(value: unknown): MemoryImpression {
  const num = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(num)) return 3
  return Math.max(0, Math.min(5, Math.round(num))) as MemoryImpression
}

function clampCompression(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.max(0, Math.min(4, Math.round(num)))
}

function fallbackSummary(parts: {
  time?: string
  location?: string
  sceneFeeling?: string
  observedPeople?: string[]
  selfObservation?: string
  othersObservation?: string
}) {
  const lines = [
    parts.time,
    parts.location,
    parts.sceneFeeling,
    parts.observedPeople && parts.observedPeople.length > 0 ? `人物: ${parts.observedPeople.join("、")}` : undefined,
    parts.selfObservation,
    parts.othersObservation,
  ].filter((item): item is string => !!item)
  return lines.join(" | ")
}

function normalizeLegacyEntry(value: unknown, index: number): MemoryEntry | undefined {
  if (typeof value === "string") {
    const text = value.trim()
    if (!text) return undefined
    return {
      id: `legacy-${index + 1}`,
      created_at: "",
      impression: 3,
      compression: 4,
      summary: text,
      time: "",
      location: "",
      scene_feeling: "",
      observed_people: [],
      self_observation: "",
      others_observation: "",
    }
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const obj = value as Record<string, unknown>
  const time = asString(unwrapTextField(obj.time)) ?? asString(unwrapTextField(obj.date)) ?? ""
  const location = asString(unwrapTextField(obj.location)) ?? asString(unwrapTextField(obj.place)) ?? ""
  const sceneFeeling =
    asString(unwrapTextField(obj.scene_feeling)) ??
    asString(unwrapTextField(obj.feeling)) ??
    asString(unwrapTextField(obj.impression_text)) ??
    ""
  const observedPeople =
    asStringList(obj.observed_people).length > 0
      ? asStringList(obj.observed_people)
      : asStringList(obj.people)
  const selfObservation =
    asString(unwrapTextField(obj.self_observation)) ??
    asString(unwrapTextField(obj.self_action)) ??
    asString(unwrapTextField(obj.self)) ??
    asString(unwrapTextField(obj.my_action)) ??
    ""
  const othersObservation =
    asString(unwrapTextField(obj.others_observation)) ??
    asString(unwrapTextField(obj.observed_actions)) ??
    asString(unwrapTextField(obj.others)) ??
    asString(unwrapTextField(obj.dialogue)) ??
    ""
  const summary =
    asString(unwrapTextField(obj.summary)) ??
    asString(unwrapTextField(obj.content)) ??
    fallbackSummary({
      time,
      location,
      sceneFeeling,
      observedPeople,
      selfObservation,
      othersObservation,
    })
  if (!summary) return undefined

  return {
    id: asString(obj.id) ?? `legacy-${index + 1}`,
    created_at: asString(obj.created_at) ?? "",
    impression: clampImpression(obj.impression),
    compression: clampCompression(obj.compression ?? 2),
    summary,
    time,
    location,
    scene_feeling: sceneFeeling,
    observed_people: observedPeople,
    self_observation: selfObservation,
    others_observation: othersObservation,
  }
}

function normalizeEntry(value: unknown, index: number): MemoryEntry | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return normalizeLegacyEntry(value, index)
  }
  const obj = value as Record<string, unknown>
  const summary = asString(unwrapTextField(obj.summary))
  if (!summary) return normalizeLegacyEntry(value, index)

  return {
    id: asString(unwrapTextField(obj.id)) ?? `memory-${index + 1}`,
    created_at: asString(unwrapTextField(obj.created_at)) ?? "",
    impression: clampImpression(obj.impression),
    compression: clampCompression(obj.compression),
    summary,
    time: asString(unwrapTextField(obj.time)) ?? "",
    location: asString(unwrapTextField(obj.location)) ?? "",
    scene_feeling: asString(unwrapTextField(obj.scene_feeling)) ?? "",
    observed_people: asStringList(obj.observed_people),
    self_observation: asString(unwrapTextField(obj.self_observation)) ?? "",
    others_observation: asString(unwrapTextField(obj.others_observation)) ?? "",
  }
}

function compareNewestFirst(a: MemoryEntry, b: MemoryEntry): number {
  const at = Date.parse(a.created_at)
  const bt = Date.parse(b.created_at)
  if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return bt - at
  if (a.created_at !== b.created_at) return b.created_at.localeCompare(a.created_at)
  return b.id.localeCompare(a.id)
}

function compressionOffset(impression: MemoryImpression): number {
  if (impression === 5) return Number.NEGATIVE_INFINITY
  if (impression === 4) return -1
  if (impression === 0 || impression === 1) return 1
  return 0
}

function degradeEntry(entry: MemoryEntry, steps: number): MemoryEntry {
  if (entry.impression === 5) return { ...entry, compression: 0 }
  const adjusted = Math.max(0, steps + compressionOffset(entry.impression))
  if (adjusted <= 0) return { ...entry, compression: 0 }

  const level = Math.max(entry.compression, Math.min(4, adjusted))
  if (level <= 0) return { ...entry, compression: 0 }
  if (level === 1) {
    return {
      ...entry,
      compression: 1,
      self_observation: entry.self_observation || entry.summary,
      others_observation: entry.others_observation || entry.summary,
    }
  }
  if (level === 2) {
    return {
      ...entry,
      compression: 2,
      time: entry.time,
      location: entry.location,
      scene_feeling: entry.scene_feeling,
      observed_people: entry.observed_people,
      self_observation: "",
      others_observation: "",
    }
  }
  if (level === 3) {
    return {
      ...entry,
      compression: 3,
      time: entry.time,
      location: entry.location,
      scene_feeling: entry.scene_feeling,
      observed_people: [],
      self_observation: "",
      others_observation: "",
    }
  }
  return {
    ...entry,
    compression: 4,
    time: "",
    location: "",
    scene_feeling: "",
    observed_people: [],
    self_observation: "",
    others_observation: "",
  }
}

function rebalanceHighImpressionEntries(entries: MemoryEntry[]): MemoryEntry[] {
  return entries.map((entry, index) => {
    const blockStart = Math.floor(index / MEMORY_COMPRESSION_BLOCK) * MEMORY_COMPRESSION_BLOCK
    const block = entries.slice(blockStart, index)
    const engravedUsed = block.filter((item) => item.impression === 5).length
    const strikingUsed = block.filter((item) => item.impression >= 4).length

    if (entry.impression < 4) return entry

    let impression = entry.impression
    if (impression === 5 && engravedUsed >= MEMORY_ENGRAVED_IMPRESSION_QUOTA) {
      impression = 4
    }
    if (impression >= 4 && strikingUsed >= MEMORY_STRIKING_IMPRESSION_QUOTA) {
      impression = 3
    }

    return impression === entry.impression ? entry : { ...entry, impression }
  })
}

export function compressMemoryEntries(entries: MemoryEntry[]): MemoryEntry[] {
  const sorted = [...entries].sort(compareNewestFirst)
  const rebalanced = rebalanceHighImpressionEntries(sorted)

  return rebalanced.map((entry, index) => {
    const ageTier = Math.floor(index / MEMORY_COMPRESSION_BLOCK)
    return degradeEntry(entry, ageTier)
  })
}

function normalizeParsedMemoryFile(parsed: unknown): MemoryFile | undefined {
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>
    const rawEntries = Array.isArray(obj.entries)
      ? obj.entries
      : Array.isArray(obj.items)
        ? obj.items
        : obj.summary !== undefined || obj.content !== undefined
          ? [obj]
          : []
    const entries = rawEntries
      .map((item, index) => normalizeEntry(item, index))
      .filter((item): item is MemoryEntry => !!item)
    return {
      ...emptyMemoryFile(),
      entries: compressMemoryEntries(entries),
    }
  }

  if (Array.isArray(parsed)) {
    const entries = parsed
      .map((item, index) => normalizeLegacyEntry(item, index))
      .filter((item): item is MemoryEntry => !!item)
    return {
      ...emptyMemoryFile(),
      entries: compressMemoryEntries(entries),
    }
  }
}

function unwrapMemoryFileInput(value: unknown): unknown {
  const obj = asRecord(value)
  if (!obj) return value
  if (Array.isArray(obj.entries) || Array.isArray(obj.items) || obj.summary !== undefined) return value

  const unwrapped = unwrapTextField(value)
  if (unwrapped === value) return value
  return unwrapMemoryFileInput(unwrapped)
}

export function normalizeMemoryFile(content: unknown): MemoryFile {
  if (content === undefined || content === null) {
    return emptyMemoryFile()
  }

  const input = unwrapMemoryFileInput(content)
  if (typeof input !== "string") {
    return normalizeParsedMemoryFile(input) ?? emptyMemoryFile()
  }

  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return emptyMemoryFile()
  }

  try {
    const normalized = normalizeParsedMemoryFile(parse(trimmed))
    if (normalized) return normalized
  } catch {
    // Fall through to plain-text migration.
  }

  const entries = trimmed
    .split(/\r?\n+/)
    .map((line, index) => normalizeLegacyEntry(line.replace(/^[-*]\s*/, "").trim(), index))
    .filter((item): item is MemoryEntry => !!item)

  return {
    ...emptyMemoryFile(),
    entries: compressMemoryEntries(entries),
  }
}

export function serializeMemoryFile(file: MemoryFile): string {
  return stringify({
    version: MEMORY_SCHEMA_VERSION,
    ordering: "newest-first",
    compression_policy: {
      block_size: MEMORY_COMPRESSION_BLOCK,
      engraved_preserved: true,
      impression_modulated: true,
      max_level: 4,
    },
    impression_policy: {
      range: "0-5",
      block_size: MEMORY_COMPRESSION_BLOCK,
      max_striking_per_block: MEMORY_STRIKING_IMPRESSION_QUOTA,
      max_engraved_per_block: MEMORY_ENGRAVED_IMPRESSION_QUOTA,
      overflow_demoted: true,
    },
    entries: compressMemoryEntries(file.entries).map((entry) => ({
      id: entry.id,
      created_at: entry.created_at,
      impression: entry.impression,
      impression_label: MEMORY_IMPRESSION_LABELS[entry.impression],
      compression: entry.compression,
      summary: entry.summary,
      time: entry.time,
      location: entry.location,
      scene_feeling: entry.scene_feeling,
      observed_people: entry.observed_people,
      self_observation: entry.self_observation,
      others_observation: entry.others_observation,
    })),
  })
}

export function formatMemoryEntry(entry: MemoryEntry): string {
  const details = [
    entry.time ? `时间=${entry.time}` : undefined,
    entry.location ? `地点=${entry.location}` : undefined,
    entry.scene_feeling ? `感受=${entry.scene_feeling}` : undefined,
    entry.observed_people.length > 0 ? `在场人物=${entry.observed_people.join("、")}` : undefined,
    entry.self_observation ? `自我所见所为=${entry.self_observation}` : undefined,
    entry.others_observation ? `他人言行=${entry.others_observation}` : undefined,
    entry.compression > 0 ? `压缩级别=${entry.compression}` : undefined,
  ].filter((item): item is string => !!item)

  const tail = details.length > 0 ? ` | ${details.join(" | ")}` : ""
  return `[印象 ${entry.impression}/5] ${entry.summary}${tail}`
}
