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
import { KnowledgeUpdateTool } from "../../src/tool/knowledge-update"
import { FileWatcher } from "../../src/file/watcher"
import { tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

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

const onceBus = Effect.fn("KnowledgeUpdateToolTest.onceBus")(function* (def: typeof FileWatcher.Event.Updated) {
  const bus = yield* Bus.Service
  const deferred = yield* Deferred.make<{ file: string; event: "add" | "change" | "unlink" }>()
  const unsub = yield* bus.subscribeCallback(def, (event) => Effect.runSync(Deferred.succeed(deferred, event.properties)))
  yield* Effect.addFinalizer(() => Effect.sync(unsub))
  return deferred
})

const init = Effect.fn("KnowledgeUpdateToolTest.init")(function* () {
  const info = yield* KnowledgeUpdateTool
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

const run = Effect.fn("KnowledgeUpdateToolTest.run")(function* (
  args: Tool.InferParameters<typeof KnowledgeUpdateTool>,
  next?: Tool.Context,
) {
  const tool = yield* init()
  const ctx = next ?? sessionContext
  return yield* tool.execute(args, ctx)
})

describe("tool.knowledge_update", () => {
  it.effect("writes a character-owned knowledge file inside knowledge/", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => tmpdir())
      yield* Effect.addFinalizer(() => Effect.promise(() => dir[Symbol.asyncDispose]()))
      const instance = {
        directory: dir.path,
        worktree: dir.path,
        project: {} as any,
        world: { rootPath: dir.path } as any,
      }
      const charDir = path.join(dir.path, "characters", "云梦泽-孟缘")
      yield* Effect.promise(() => fs.mkdir(charDir, { recursive: true }))
      yield* Effect.promise(() => fs.writeFile(path.join(charDir, "profile.yaml"), "name: 孟缘\nrole: 云梦泽的大妖长老\n"))
      const fullPath = path.join(charDir, "knowledge", "people", "宋祈.md")

      const updated = yield* onceBus(FileWatcher.Event.Updated).pipe(Effect.provideService(InstanceRef, instance))
      const result = yield* (
        run({
          path: "people/宋祈.md",
          content: "# 宋祈\n\n她在真正危险时反而会先压住声音。\n",
        }).pipe(Effect.provideService(InstanceRef, instance))
      )

      const written = yield* Effect.promise(() => fs.readFile(fullPath, "utf-8"))
      expect(result.metadata.created).toBe(true)
      expect(result.metadata.path).toBe(path.join("characters", "云梦泽-孟缘", "knowledge", "people", "宋祈.md"))
      expect(written).toContain("真正危险时")
      expect(yield* Deferred.await(updated)).toEqual({
        file: fullPath,
        event: "add",
      })
    }),
  )

  it.effect("blocks traversal or non-knowledge paths", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => tmpdir())
      yield* Effect.addFinalizer(() => Effect.promise(() => dir[Symbol.asyncDispose]()))
      const instance = {
        directory: dir.path,
        worktree: dir.path,
        project: {} as any,
        world: { rootPath: dir.path } as any,
      }
      const charDir = path.join(dir.path, "characters", "云梦泽-孟缘")
      yield* Effect.promise(() => fs.mkdir(charDir, { recursive: true }))
      yield* Effect.promise(() => fs.writeFile(path.join(charDir, "profile.yaml"), "name: 孟缘\n"))

      const result = yield* (
        run({
          path: "../memory.yaml",
          content: "bad",
        }).pipe(Effect.provideService(InstanceRef, instance))
      )

      expect(result.title).toContain("(blocked)")
      expect(result.output).toContain("safe text resource")
    }),
  )
})
