import { randomUUID } from "crypto"
import path from "path"
import { Effect } from "effect"
import { parse } from "yaml"
import { AppFileSystem } from "@openplay-ai/core/filesystem"

type RuntimeData = Partial<{
  current_scene: unknown
  current_date: unknown
  currentDate: unknown
  date: unknown
  environment: unknown
}>

export type RoleplaySceneDescriptor = {
  sceneID?: string
  date?: string
  location?: string
}

export type RoleplaySceneState = {
  version: 1
  current?: RoleplaySceneDescriptor & {
    key: string
    ownerSessionID?: string
  }
}

export type SceneTransitionDirective = "keep" | "switch"

export const ROLEPLAY_SCENE_STATE_RELATIVE_PATH = ".openplay/scene-state.json"

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function scalarToString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim().length > 0 ? value.trim() : undefined
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  const record = readObject(value)
  if (!record) return undefined

  for (const key of ["current", "content", "value", "text"]) {
    const nested = record[key]
    if (nested === value) continue
    const parsed = scalarToString(nested)
    if (parsed) return parsed
  }

  return undefined
}

function slugPart(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
  return normalized || fallback
}

function createSceneKey(descriptor: RoleplaySceneDescriptor): string {
  const date = slugPart(descriptor.date, "unknown-date")
  const location = slugPart(descriptor.location ?? descriptor.sceneID, "unknown-scene")
  return `scene:${date}:${location}:${randomUUID().slice(0, 8)}`
}

export function sceneStatePath(worldRoot: string): string {
  return path.join(worldRoot, ROLEPLAY_SCENE_STATE_RELATIVE_PATH)
}

export function parseRuntimeData(content: string | undefined): RuntimeData | undefined {
  if (!content) return
  try {
    const parsed = parse(content)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return
    return parsed as RuntimeData
  } catch {
    return
  }
}

export function extractRuntimeSceneDescriptor(runtime: RuntimeData | undefined): RoleplaySceneDescriptor | undefined {
  if (!runtime) return

  const currentScene = readObject(runtime.current_scene)
  const environment = readObject(runtime.environment)
  const sceneID = scalarToString(currentScene?.scene_id)
  const date =
    scalarToString(currentScene?.date) ??
    scalarToString(runtime.current_date) ??
    scalarToString(runtime.currentDate) ??
    scalarToString(runtime.date) ??
    scalarToString(environment?.time)
  const location = scalarToString(currentScene?.location) ?? scalarToString(runtime.current_scene) ?? scalarToString(environment?.location)

  if (!sceneID && !date && !location) return
  return { sceneID, date, location }
}

export function resolveSceneKeyFromState(input: {
  stored: RoleplaySceneState["current"] | undefined
  sessionID?: string
}): string | undefined {
  if (input.sessionID && input.stored?.ownerSessionID && input.stored.ownerSessionID !== input.sessionID) return
  return input.stored?.key
}

export function parseSceneTransitionDirective(content: string): SceneTransitionDirective | undefined {
  const match = content.match(/^\s*#\s*openplay:\s*scene_transition\s*=\s*(keep|switch)\s*$/im)
  if (!match) return
  return match[1] === "switch" ? "switch" : "keep"
}

export const readRoleplaySceneState = Effect.fn("RoleplaySceneState.read")(function* (input: {
  fs: AppFileSystem.Interface
  worldRoot: string
}) {
  const content = yield* input.fs.readFileStringSafe(sceneStatePath(input.worldRoot)).pipe(Effect.orDie)
  if (!content) return undefined

  try {
    const parsed = JSON.parse(content) as RoleplaySceneState
    if (parsed?.version !== 1) return undefined
    if (parsed.current && typeof parsed.current.key !== "string") return undefined
    return parsed
  } catch {
    return undefined
  }
})

export const syncRoleplaySceneState = Effect.fn("RoleplaySceneState.sync")(function* (input: {
  fs: AppFileSystem.Interface
  worldRoot: string
  runtimeContent: string
  transition?: SceneTransitionDirective
  sessionID?: string
}) {
  const previous = yield* readRoleplaySceneState({ fs: input.fs, worldRoot: input.worldRoot })
  const runtime = parseRuntimeData(input.runtimeContent)
  const descriptor = extractRuntimeSceneDescriptor(runtime)
  if (!descriptor) return previous

  const currentKey =
    input.transition === "switch" ||
    !previous?.current?.key ||
    (!!input.sessionID && !!previous.current?.ownerSessionID && previous.current.ownerSessionID !== input.sessionID)
      ? createSceneKey(descriptor)
      : previous.current.key

  const next: RoleplaySceneState = {
    version: 1,
    current: {
      key: currentKey,
      sceneID: descriptor.sceneID,
      date: descriptor.date,
      location: descriptor.location,
      ownerSessionID: input.sessionID,
    },
  }

  const serialized = `${JSON.stringify(next, null, 2)}\n`
  const existing = previous ? `${JSON.stringify(previous, null, 2)}\n` : undefined
  if (serialized !== existing) {
    yield* input.fs.writeWithDirs(sceneStatePath(input.worldRoot), serialized).pipe(Effect.orDie)
  }
  return next
})
