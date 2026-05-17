export * as GodOnlyFilter from "./god-only-filter"

import { Effect, Context, Layer, Ref } from "effect"
import { parse } from "yaml"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import * as Log from "@opencode-ai/core/util/log"
import * as crypto from "crypto"
import { Glob } from "@opencode-ai/core/util/glob"

const log = Log.create({ service: "god-only-filter" })

export interface ForbiddenSet {
  strings: Set<string>
  fileHashes: Map<string, string>
}

export interface Interface {
  getForbiddenSet(worldPath: string): Effect.Effect<ForbiddenSet>
  refresh(worldPath: string): Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/GodOnlyFilter") {}

const GOD_ONLY_VALUES = ["god only", "godonly", "god-only"]

function isGodOnly(access: unknown): boolean {
  if (typeof access !== "string") return false
  const normalized = access.toLowerCase().replace(/[-\s]/g, "")
  return GOD_ONLY_VALUES.some((v) => normalized === v)
}

const CONTENT_FIELDS = ["content", "current", "description", "note", "value", "name", "text"]

function extractStringsFromNode(node: unknown, path: string[] = []): string[] {
  if (typeof node === "string") {
    return [node]
  }
  if (typeof node !== "object" || node === null) {
    return []
  }
  if (Array.isArray(node)) {
    return node.flatMap((item, i) => extractStringsFromNode(item, [...path, String(i)]))
  }
  const results: string[] = []
  const obj = node as Record<string, unknown>
  for (const [key, value] of Object.entries(obj)) {
    results.push(...extractStringsFromNode(value, [...path, key]))
  }
  return results
}

function extractForbiddenFromYaml(yamlContent: string, filePath: string): string[] {
  const forbidden: string[] = []
  try {
    const doc = parse(yamlContent)
    if (typeof doc !== "object" || doc === null) {
      return forbidden
    }
    if (isGodOnly((doc as Record<string, unknown>).access)) {
      forbidden.push(yamlContent)
      return forbidden
    }
    traverseForGodOnly(doc, forbidden)
  } catch (e) {
    log.warn("Failed to parse YAML", { filePath, error: String(e) })
  }
  return forbidden
}

function traverseForGodOnly(node: unknown, forbidden: string[], path: string[] = []): void {
  if (typeof node !== "object" || node === null) {
    return
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => traverseForGodOnly(item, forbidden, [...path, String(i)]))
    return
  }
  const obj = node as Record<string, unknown>
  if (isGodOnly(obj.access)) {
    for (const field of CONTENT_FIELDS) {
      if (typeof obj[field] === "string") {
        forbidden.push(obj[field] as string)
      }
    }
    for (const [key, value] of Object.entries(obj)) {
      if (key === "access") continue
      if (typeof value === "string" && !CONTENT_FIELDS.includes(key)) {
        forbidden.push(value)
      }
      if (typeof value === "object" && value !== null) {
        forbidden.push(...extractStringsFromNode(value, [...path, key]))
      }
    }
    return
  }
  for (const [key, value] of Object.entries(obj)) {
    traverseForGodOnly(value, forbidden, [...path, key])
  }
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex")
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const cacheRef = yield* Ref.make<Map<string, ForbiddenSet>>(new Map())
    
    const getForbiddenSet = Effect.fn("GodOnlyFilter.getForbiddenSet")(function* (worldPath: string) {
      const cache = yield* Ref.get(cacheRef)
      const cached = cache.get(worldPath)
      if (cached) {
        return cached
      }
      
      const yamlFiles = Glob.scanSync("**/*.yaml", { cwd: worldPath })
      const ymlFiles = Glob.scanSync("**/*.yml", { cwd: worldPath })
      const allFiles = [...yamlFiles, ...ymlFiles]
      const strings = new Set<string>()
      const fileHashes = new Map<string, string>()
      for (const file of allFiles) {
        const fullPath = `${worldPath}/${file}`
        const content = yield* fs.readFileStringSafe(fullPath).pipe(Effect.orDie)
        if (content) {
          fileHashes.set(fullPath, hashContent(content))
          const forbidden = extractForbiddenFromYaml(content, fullPath)
          for (const s of forbidden) {
            strings.add(s)
          }
        }
      }
      log.info("Built forbidden set", { worldPath, fileCount: allFiles.length, stringCount: strings.size })
      const forbiddenSet: ForbiddenSet = { strings, fileHashes }
      yield* Ref.update(cacheRef, (m) => {
        const newMap = new Map(m)
        newMap.set(worldPath, forbiddenSet)
        return newMap
      })
      return forbiddenSet
    })
    
    const refresh = Effect.fn("GodOnlyFilter.refresh")(function* (worldPath: string) {
      yield* Ref.update(cacheRef, (m) => {
        const newMap = new Map(m)
        newMap.delete(worldPath)
        return newMap
      })
    })
    
    return Service.of({ getForbiddenSet, refresh })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
)

export function filterL2View(l2View: string, forbiddenSet: ForbiddenSet): string {
  let result = l2View
  for (const forbidden of forbiddenSet.strings) {
    if (forbidden.length > 0 && result.includes(forbidden)) {
      result = result.split(forbidden).join("[已隐去]")
    }
  }
  return result
}
