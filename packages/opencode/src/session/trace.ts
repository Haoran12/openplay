import fs from "node:fs"
import path from "node:path"
import { Global } from "@openplay-ai/core/global"
import { Context, Effect, Layer, Schema } from "effect"
import type { JSONSchema7 } from "@ai-sdk/provider"
import type { ModelMessage } from "ai"
import { RuntimeFlags } from "@/effect/runtime-flags"
import type { SessionID } from "./schema"
import * as Database from "@/storage/db"
import { SessionTable } from "./session.sql"
import { eq } from "drizzle-orm"
import { Config } from "@/config/config"

export const TraceSource = Schema.Literals(["main", "subagent", "tool", "other"]).annotate({
  identifier: "SessionTrace.Source",
})

const TraceEventKind = Schema.String.annotate({
  identifier: "SessionTrace.Kind",
})

const TracePayload = Schema.Unknown

export const TraceEntry = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  rootSessionID: Schema.String,
  timestamp: Schema.Number,
  source: TraceSource,
  kind: TraceEventKind,
  turn: Schema.optional(Schema.Number),
  title: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  parentSessionID: Schema.optional(Schema.String),
  toolName: Schema.optional(Schema.String),
  payload: TracePayload,
}).annotate({ identifier: "SessionTrace.Entry" })
export type TraceEntry = Schema.Schema.Type<typeof TraceEntry>

export const TraceListInput = Schema.Struct({
  sessionID: Schema.String,
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  source: Schema.optional(TraceSource),
  kind: Schema.optional(Schema.String),
  includeSubagents: Schema.optional(Schema.Boolean),
})
export type TraceListInput = Schema.Schema.Type<typeof TraceListInput>

export const TraceListResult = Schema.Struct({
  items: Schema.Array(TraceEntry),
  cursor: Schema.optional(Schema.String),
  meta: Schema.Struct({
    available: Schema.Boolean,
    retentionDays: Schema.Number,
  }),
})
export type TraceListResult = Schema.Schema.Type<typeof TraceListResult>

export type RequestPayload = {
  userMessageID?: string
  model: {
    id: string
    providerID: string
    variant?: string
  }
  system: string[]
  messages: ModelMessage[]
  toolChoice?: "auto" | "required" | "none"
  tools: Record<
    string,
    {
      description?: string
      inputSchema?: JSONSchema7
    }
  >
  options: Record<string, unknown>
}

type WriteInput = Omit<TraceEntry, "id" | "timestamp">

export interface Interface {
  readonly enabled: (sessionID: SessionID | string) => Effect.Effect<boolean>
  readonly available: () => Effect.Effect<boolean>
  readonly write: (input: WriteInput) => Effect.Effect<void>
  readonly list: (input: TraceListInput) => Effect.Effect<TraceListResult>
  readonly requestPayload: (input: RequestPayload) => RequestPayload
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionTrace") {}

function directory() {
  return path.join(Global.Path.log, "model-trace")
}

function latestFile() {
  return path.join(directory(), "latest.json")
}

function dateKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10).replaceAll("-", "")
}

function filePath(rootSessionID: string, timestamp: number) {
  return path.join(directory(), `${rootSessionID}-${dateKey(timestamp)}.jsonl`)
}

function cursorOf(item: TraceEntry) {
  return `${item.timestamp}:${item.id}`
}

function parseCursor(cursor: string) {
  const [timestampText, ...rest] = cursor.split(":")
  const timestamp = Number(timestampText)
  const id = rest.join(":")
  if (!Number.isFinite(timestamp) || !id) return
  return { timestamp, id }
}

function normalizedRetentionDays(value: number) {
  return Math.max(1, Math.trunc(value))
}

function stringify(value: unknown) {
  return JSON.stringify(
    value,
    (_key, item) => {
      if (typeof item === "bigint") return String(item)
      return item
    },
    0,
  )
}

function readLines(target: string) {
  if (!fs.existsSync(target)) return [] as string[]
  return fs
    .readFileSync(target, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const flags = yield* RuntimeFlags.Service
    const config = yield* Config.Service

    const resolveRootSessionID = Effect.fn("SessionTrace.resolveRootSessionID")(function* (
      sessionID: SessionID | string,
      fallback?: string,
    ) {
      let rootSessionID = fallback ?? String(sessionID)
      let currentSessionID: SessionID | undefined = sessionID as SessionID

      while (currentSessionID) {
        const lookupSessionID = currentSessionID as SessionID
        const row = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select({
                id: SessionTable.id,
                parentID: SessionTable.parent_id,
              })
              .from(SessionTable)
              .where(eq(SessionTable.id, lookupSessionID))
              .get(),
          ),
        )
        if (!row?.id) break
        rootSessionID = row.id
        currentSessionID = row.parentID ?? undefined
      }

      return rootSessionID
    })

    const available: Interface["available"] = Effect.fn("SessionTrace.available")(function* () {
      const cfg = yield* config.get()
      return cfg.server?.trace?.enabled ?? flags.modelTrace
    })

    const cleanup = Effect.fn("SessionTrace.cleanup")(function* () {
      const ttl = normalizedRetentionDays(flags.modelTraceRetentionDays) * 24 * 60 * 60 * 1000
      const cutoff = Date.now() - ttl
      const dir = directory()
      yield* Effect.sync(() => {
        fs.mkdirSync(dir, { recursive: true })
        for (const name of fs.readdirSync(dir)) {
          if (!name.endsWith(".jsonl")) continue
          const target = path.join(dir, name)
          const stat = fs.statSync(target)
          if (stat.mtimeMs < cutoff) fs.rmSync(target, { force: true })
        }
      })
    })

    const enabled: Interface["enabled"] = Effect.fn("SessionTrace.enabled")(function* (sessionID) {
      if (!(yield* available())) return false
      const row = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select({ trace: SessionTable.trace })
            .from(SessionTable)
            .where(eq(SessionTable.id, sessionID as SessionID))
            .get(),
        ),
      )
      return row?.trace?.enabled === true
    })

    const write: Interface["write"] = Effect.fn("SessionTrace.write")(function* (input) {
      if (!(yield* enabled(input.sessionID))) return
      const timestamp = Date.now()
      const rootSessionID = yield* resolveRootSessionID(input.sessionID, input.rootSessionID)
      const entry: TraceEntry = {
        ...input,
        rootSessionID,
        id: `${timestamp}:${Math.random().toString(36).slice(2, 10)}`,
        timestamp,
      }
      const target = filePath(entry.rootSessionID, timestamp)
      yield* cleanup()
      yield* Effect.sync(() => {
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.appendFileSync(target, stringify(entry) + "\n")
        fs.writeFileSync(
          latestFile(),
          stringify({
            time: new Date(timestamp).toISOString(),
            sessionID: entry.sessionID,
            rootSessionID: entry.rootSessionID,
            path: target,
          }) + "\n",
        )
      })
    })

    const list: Interface["list"] = Effect.fn("SessionTrace.list")(function* (input) {
      const requested = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select({
              id: SessionTable.id,
              parentID: SessionTable.parent_id,
            })
            .from(SessionTable)
            .where(eq(SessionTable.id, input.sessionID as SessionID))
            .get(),
        ),
      )
      if (!requested?.id) {
        const isAvailable = yield* available()
        return {
          items: [],
          cursor: undefined,
          meta: {
            available: isAvailable,
            retentionDays: normalizedRetentionDays(flags.modelTraceRetentionDays),
          },
        }
      }

      const rootSessionID = yield* resolveRootSessionID(requested.id, requested.id)

      const ids = new Set<string>([requested.id])
      if (input.includeSubagents !== false) {
        const queue = [requested.id]
        while (queue.length > 0) {
          const current = queue.shift()!
          const childRows = yield* Effect.sync(() =>
            Database.use((db) =>
              db
                .select({
                  id: SessionTable.id,
                })
                .from(SessionTable)
                .where(eq(SessionTable.parent_id, current as SessionID))
                .all(),
            ),
          )
          for (const child of childRows) {
            if (ids.has(child.id)) continue
            ids.add(child.id)
            queue.push(child.id)
          }
        }
      }

      const files = yield* Effect.sync(() => {
        const dir = directory()
        if (!fs.existsSync(dir)) return [] as string[]
        return fs
          .readdirSync(dir)
          .filter((name) => name.startsWith(`${rootSessionID}-`) && name.endsWith(".jsonl"))
          .map((name) => path.join(dir, name))
      })
      const parsed = files.flatMap((target) =>
        readLines(target).flatMap((line) => {
          try {
            const item = JSON.parse(line) as TraceEntry
            return ids.has(item.sessionID as SessionID) ? [item] : []
          } catch {
            return []
          }
        }),
      )

      let items = parsed
        .filter((item) => (input.source ? item.source === input.source : true))
        .filter((item) => (input.kind ? item.kind === input.kind : true))
        .sort((a, b) => (a.timestamp === b.timestamp ? a.id.localeCompare(b.id) : b.timestamp - a.timestamp))

      const cursor = input.cursor ? parseCursor(input.cursor) : undefined
      if (cursor) {
        items = items.filter(
          (item) => item.timestamp > cursor.timestamp || (item.timestamp === cursor.timestamp && item.id > cursor.id),
        )
      }

      const limit = Number.isFinite(input.limit) && input.limit && input.limit > 0 ? Math.trunc(input.limit) : 200
      const slice = items.slice(0, limit)
      const next = items.length > limit && slice.length > 0 ? cursorOf(slice[slice.length - 1]!) : undefined
      const isAvailable = yield* available()
      return {
        items: slice,
        cursor: next,
        meta: {
          available: isAvailable,
          retentionDays: normalizedRetentionDays(flags.modelTraceRetentionDays),
        },
      }
    })

    const requestPayload: Interface["requestPayload"] = (input) => {
      return structuredClone(input)
    }

    return Service.of({
      available,
      enabled,
      write,
      list,
      requestPayload,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer), Layer.provide(RuntimeFlags.defaultLayer))

export * as SessionTrace from "./trace"
