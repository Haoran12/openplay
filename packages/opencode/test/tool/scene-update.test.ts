import { afterEach, describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Deferred, Effect, Layer } from "effect"
import { SceneUpdateTool } from "../../src/tool/scene-update"
import { AppFileSystem } from "@openplay-ai/core/filesystem"
import { Bus } from "../../src/bus"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { SessionID, MessageID } from "../../src/session/schema"
import * as Tool from "../../src/tool/tool"
import { testEffect } from "../lib/effect"
import { FileWatcher } from "../../src/file/watcher"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"

const ctx = {
  sessionID: SessionID.make("ses_test-scene-update-session"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "director",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

afterEach(async () => {
  await disposeAllInstances()
})

const layer = Layer.mergeAll(AppFileSystem.defaultLayer, Bus.layer, Truncate.defaultLayer, Agent.defaultLayer)

const it = testEffect(layer)

const init = Effect.fn("SceneUpdateToolTest.init")(function* () {
  const info = yield* SceneUpdateTool
  return yield* info.init()
})

const run = Effect.fn("SceneUpdateToolTest.run")(function* (
  args: Tool.InferParameters<typeof SceneUpdateTool>,
  next: Tool.Context = ctx,
) {
  const tool = yield* init()
  return yield* tool.execute(args, next)
})

const onceBus = Effect.fn("SceneUpdateToolTest.onceBus")(function* (def: typeof FileWatcher.Event.Updated) {
  const bus = yield* Bus.Service
  const deferred = yield* Deferred.make<{ file: string; event: "add" | "change" | "unlink" }>()
  const unsub = yield* bus.subscribeCallback(def, (event) => Effect.runSync(Deferred.succeed(deferred, event.properties)))
  yield* Effect.addFinalizer(() => Effect.sync(unsub))
  return deferred
})

describe("tool.scene_update", () => {
  it.instance("writes runtime.yaml relative to the current world and emits watcher updates", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const runtimePath = path.join(test.directory, "runtime.yaml")
      const updated = yield* onceBus(FileWatcher.Event.Updated)

      const result = yield* run({
        path: "runtime.yaml",
        content: "current_scene: Tea House\npresent_characters:\n  - SongQi\n",
      })

      expect(result.metadata).toEqual({
        path: "runtime.yaml",
        created: true,
        size: "current_scene: Tea House\npresent_characters:\n  - SongQi\n".length,
      })
      expect(yield* Effect.promise(() => fs.readFile(runtimePath, "utf-8"))).toBe(
        "current_scene: Tea House\npresent_characters:\n  - SongQi\n",
      )
      expect(yield* Deferred.await(updated)).toEqual({
        file: runtimePath,
        event: "add",
      })
    }),
  )

  it.instance("emits change when updating an existing runtime.yaml", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const runtimePath = path.join(test.directory, "runtime.yaml")
      yield* Effect.promise(() => fs.writeFile(runtimePath, "current_scene: Old\n", "utf-8"))
      const updated = yield* onceBus(FileWatcher.Event.Updated)

      yield* run({
        path: "runtime.yaml",
        content: "current_scene: New\npresent_characters: []\n",
      })

      expect(yield* Deferred.await(updated)).toEqual({
        file: runtimePath,
        event: "change",
      })
    }),
  )

  it.instance("blocks writes to memories paths", () =>
    Effect.gen(function* () {
      const result = yield* run({
        path: "memories/孟缘.yaml",
        content: "entries: []\n",
      })

      expect(result.title).toContain("(blocked)")
      expect(result.output).toContain("cannot write memories/")
      expect(result.metadata).toEqual({
        path: "memories/孟缘.yaml",
        created: false,
        size: 0,
      })
    }),
  )

  it.instance("blocks absolute and parent-relative paths", () =>
    Effect.gen(function* () {
      const absolute = yield* run({
        path: "/tmp/escape.yaml",
        content: "bad: true\n",
      })
      const parent = yield* run({
        path: "../escape.yaml",
        content: "bad: true\n",
      })

      expect(absolute.title).toContain("(blocked)")
      expect(parent.title).toContain("(blocked)")
    }),
  )
})
