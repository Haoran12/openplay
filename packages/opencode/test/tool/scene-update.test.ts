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

      expect(result.metadata).toMatchObject({
        path: "runtime.yaml",
        created: true,
        size: "current_scene: Tea House\npresent_characters:\n  - SongQi\n".length,
        truncated: false,
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

  it.instance("keeps internal continuity state across short date/location updates unless explicitly switched", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const sceneStatePath = path.join(test.directory, ".openplay", "scene-state.json")

      yield* run({
        path: "runtime.yaml",
        content: ["current_scene:", "  date: 1003-07-14", "  location: 云梦泽 建木府 主卧", ""].join("\n"),
      })
      const first = JSON.parse(yield* Effect.promise(() => fs.readFile(sceneStatePath, "utf-8")))

      yield* run({
        path: "runtime.yaml",
        content: ["current_scene:", "  date: 1003-07-14", "  location: 云梦泽 建木府 主卧", "  impression: 夜深", ""].join(
          "\n",
        ),
      })
      const second = JSON.parse(yield* Effect.promise(() => fs.readFile(sceneStatePath, "utf-8")))

      yield* run({
        path: "runtime.yaml",
        content: ["current_scene:", "  date: 1003-07-15", "  location: 云梦泽 建木府 前庭", ""].join("\n"),
      })
      const third = JSON.parse(yield* Effect.promise(() => fs.readFile(sceneStatePath, "utf-8")))

      yield* run({
        path: "runtime.yaml",
        content: [
          "# openplay: scene_transition=switch",
          "current_scene:",
          "  date: 1003-07-15",
          "  location: 云梦泽 山门外",
          "",
        ].join("\n"),
      })
      const fourth = JSON.parse(yield* Effect.promise(() => fs.readFile(sceneStatePath, "utf-8")))

      expect(first.current?.key).toEqual(second.current?.key)
      expect(second.current?.key).toEqual(third.current?.key)
      expect(third.current).toMatchObject({
        date: "1003-07-15",
        location: "云梦泽 建木府 前庭",
      })
      expect(third.current?.key).not.toEqual(fourth.current?.key)
      expect(fourth.current).toMatchObject({
        date: "1003-07-15",
        location: "云梦泽 山门外",
      })
    }),
  )

  it.instance("rotates internal continuity state when a new parent session writes runtime.yaml", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const sceneStatePath = path.join(test.directory, ".openplay", "scene-state.json")

      yield* run({
        path: "runtime.yaml",
        content: ["current_scene:", "  date: 1003-07-14", "  location: 云梦泽 建木府 主卧", ""].join("\n"),
      })
      const first = JSON.parse(yield* Effect.promise(() => fs.readFile(sceneStatePath, "utf-8")))

      yield* run(
        {
          path: "runtime.yaml",
          content: ["current_scene:", "  date: 1003-07-14", "  location: 云梦泽 建木府 主卧", ""].join("\n"),
        },
        {
          ...ctx,
          sessionID: SessionID.make("ses_test-scene-update-session-2"),
        },
      )
      const second = JSON.parse(yield* Effect.promise(() => fs.readFile(sceneStatePath, "utf-8")))

      expect(first.current?.key).not.toEqual(second.current?.key)
      expect(second.current?.ownerSessionID).toBe("ses_test-scene-update-session-2")
    }),
  )

  it.instance("blocks writes to character resource paths", () =>
    Effect.gen(function* () {
      const result = yield* run({
        path: "characters/孟缘/memory.yaml",
        content: "entries: []\n",
      })

      expect(result.title).toContain("(blocked)")
      expect(result.output).toContain("cannot write character resource paths")
      expect(result.metadata).toMatchObject({
        path: "characters/孟缘/memory.yaml",
        created: false,
        size: 0,
        truncated: false,
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
