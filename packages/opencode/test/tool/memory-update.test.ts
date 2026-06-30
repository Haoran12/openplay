import { describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Deferred, Effect, Layer } from "effect"
import { AppFileSystem } from "@openplay-ai/core/filesystem"
import { Bus } from "../../src/bus"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { Session } from "../../src/session/session"
import { SessionID, MessageID } from "../../src/session/schema"
import { InstanceRef } from "../../src/effect/instance-ref"
import * as Tool from "../../src/tool/tool"
import { MemoryUpdateTool } from "../../src/tool/memory-update"
import { normalizeMemoryFile } from "../../src/tool/memory-schema"
import { testEffect } from "../lib/effect"
import { FileWatcher } from "../../src/file/watcher"
import { tmpdir } from "../fixture/fixture"

const layer = Layer.mergeAll(
  AppFileSystem.defaultLayer,
  Bus.layer,
  Truncate.defaultLayer,
  Agent.defaultLayer,
  Layer.succeed(
    Session.Service,
    Session.Service.of({
      get: () =>
        Effect.succeed({
          id: SessionID.make("ses_character"),
          title: "Character: 孟缘",
        } as any),
    } as any),
  ),
)

const it = testEffect(layer)

const onceBus = Effect.fn("MemoryUpdateToolTest.onceBus")(function* (def: typeof FileWatcher.Event.Updated) {
  const bus = yield* Bus.Service
  const deferred = yield* Deferred.make<{ file: string; event: "add" | "change" | "unlink" }>()
  const unsub = yield* bus.subscribeCallback(def, (event) => Effect.runSync(Deferred.succeed(deferred, event.properties)))
  yield* Effect.addFinalizer(() => Effect.sync(unsub))
  return deferred
})

const init = Effect.fn("MemoryUpdateToolTest.init")(function* () {
  const info = yield* MemoryUpdateTool
  return yield* info.init()
})

const sessionContext: Tool.Context = {
  sessionID: SessionID.make("ses_character"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "character",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const run = Effect.fn("MemoryUpdateToolTest.run")(function* (
  args: Tool.InferParameters<typeof MemoryUpdateTool>,
  next?: Tool.Context,
) {
  const tool = yield* init()
  const ctx = next ?? sessionContext
  return yield* tool.execute(args, ctx)
})

describe("tool.memory_update", () => {
  it.effect("creates the character memory file when it is missing and normalizes structured yaml", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => tmpdir())
      yield* Effect.addFinalizer(() => Effect.promise(() => dir[Symbol.asyncDispose]()))
      const charDir = path.join(dir.path, "characters", "云梦泽-孟缘")
      const cognitionDir = path.join(charDir, "孟缘-cognition")
      const fullPath = path.join(cognitionDir, "memory.yaml")
      yield* Effect.promise(() => fs.mkdir(charDir, { recursive: true }))
      yield* Effect.promise(() =>
        fs.writeFile(
          path.join(charDir, "孟缘.yaml"),
          ["name: 孟缘", "role: 云梦泽的大妖长老", ""].join("\n"),
        ),
      )
      const instance = {
        directory: dir.path,
        worktree: dir.path,
        project: {} as any,
        world: { rootPath: dir.path } as any,
      }
      const updated = yield* onceBus(FileWatcher.Event.Updated).pipe(Effect.provideService(InstanceRef, instance))

      const result = yield* run({
        content: `
version: 1
entries:
  - id: newest
    created_at: 2026-05-20T09:00:00.000Z
    impression: 4
    summary: 我在旧竹桥上再次听见她叫我的名字。
    time: 灵历1003年三月初三，黄昏
    location: 旧竹桥
    scene_feeling: 风很软，我却不敢回头太快
    observed_people: [宋祈]
    self_observation: 我停住脚步，手指无意识攥紧了袖口。
    others_observation: 她先开口叫我，尾音压得很轻。
`,
      }).pipe(Effect.provideService(InstanceRef, instance))

      const written = yield* Effect.promise(() => fs.readFile(fullPath, "utf-8"))
      const normalized = normalizeMemoryFile(written)

      expect(result.metadata.created).toBe(true)
      expect(normalized.entries).toHaveLength(1)
      expect(normalized.entries[0].summary).toContain("旧竹桥")
      expect(yield* Deferred.await(updated)).toEqual({
        file: fullPath,
        event: "add",
      })
    }),
  )

  it.effect("migrates legacy text content into the structured schema", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => tmpdir())
      yield* Effect.addFinalizer(() => Effect.promise(() => dir[Symbol.asyncDispose]()))
      const charDir = path.join(dir.path, "characters", "云梦泽-孟缘")
      const cognitionDir = path.join(charDir, "孟缘-cognition")
      const fullPath = path.join(cognitionDir, "memory.yaml")
      yield* Effect.promise(() => fs.mkdir(charDir, { recursive: true }))
      yield* Effect.promise(() =>
        fs.writeFile(
          path.join(charDir, "孟缘.yaml"),
          ["name: 孟缘", "role: 云梦泽的大妖长老", ""].join("\n"),
        ),
      )

      yield* run({
        content: `
- 她在雨夜递给我一盏灯。
- 我记得她说"回家再哭"。
`,
      }).pipe(
        Effect.provideService(InstanceRef, {
          directory: dir.path,
          worktree: dir.path,
          project: {} as any,
          world: { rootPath: dir.path } as any,
        }),
      )

      const written = yield* Effect.promise(() => fs.readFile(fullPath, "utf-8"))
      const normalized = normalizeMemoryFile(written)

      expect(normalized.entries).toHaveLength(2)
      expect(normalized.entries[0].summary).toContain("我记得她说\"回家再哭\"")
      expect(normalized.entries[1].summary).toContain("她在雨夜递给我一盏灯")
      expect(written).toContain("compression_policy")
      expect(written).toContain("ordering: newest-first")
    }),
  )
})
