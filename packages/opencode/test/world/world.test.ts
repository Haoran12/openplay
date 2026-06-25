import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { CrossSpawnSpawner } from "@openplay-ai/core/cross-spawn-spawner"
import { World } from "../../src/world/world"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(CrossSpawnSpawner.defaultLayer, NodeFileSystem.layer, World.defaultLayer))

describe("World.fromDirectory", () => {
  it.live("prefers runtime.yaml as the world root signal over ancestor openplay.json", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* Effect.promise(() => fs.writeFile(path.join(dir, "openplay.json"), JSON.stringify({ id: "wld_ancestor" })))
      yield* Effect.promise(() => fs.mkdir(path.join(dir, "nested"), { recursive: true }))
      yield* Effect.promise(() => fs.writeFile(path.join(dir, "nested", "runtime.yaml"), "scene: start\n"))

      const svc = yield* World.Service
      const world = yield* svc.fromDirectory(path.join(dir, "nested"), dir)

      expect(world?.rootPath).toBe(path.join(dir, "nested"))
      expect(world?.configPath).toBe(path.join(dir, "nested", "runtime.yaml"))
    }),
  )

  it.live("parses structured runtime scene and character objects for the roleplay panel", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* Effect.promise(() =>
        fs.writeFile(
          path.join(dir, "runtime.yaml"),
          [
            "current_scene:",
            '  date: "1003-07-14"',
            '  location: "今庭 - 荆州 - 云梦泽 - 建木府 - 主卧"',
            '  impression: "夜间, 阴凉惬意的房间"',
            "present_characters:",
            '  - name: "孟缘"',
            "    age: 582",
            '  - name: "宋祈"',
            "    age: 632",
            "",
          ].join("\n"),
        ),
      )

      const svc = yield* World.Service
      const world = yield* svc.fromDirectory(dir, dir)

      expect(world?.scene).toEqual({
        date: "1003-07-14",
        location: "今庭 - 荆州 - 云梦泽 - 建木府 - 主卧",
        impression: "夜间, 阴凉惬意的房间",
      })
      expect(world?.currentScene).toBe("今庭 - 荆州 - 云梦泽 - 建木府 - 主卧")
      expect(world?.presentCharacters).toEqual([
        { name: "孟缘", age: "582" },
        { name: "宋祈", age: "632" },
      ])
    }),
  )

  it.live("still supports legacy scalar runtime scene and character lists", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* Effect.promise(() =>
        fs.writeFile(
          path.join(dir, "runtime.yaml"),
          ['current_scene: "云梦泽"', "present_characters:", '  - "孟缘"', '  - "宋祈"', ""].join("\n"),
        ),
      )

      const svc = yield* World.Service
      const world = yield* svc.fromDirectory(dir, dir)

      expect(world?.currentScene).toBe("云梦泽")
      expect(world?.presentCharacters).toEqual([{ name: "孟缘" }, { name: "宋祈" }])
    }),
  )

  it.live("derives date from legacy current_date and location from scalar current_scene", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* Effect.promise(() =>
        fs.writeFile(
          path.join(dir, "runtime.yaml"),
          ["current_date: 1003-07-14", 'current_scene: "云梦泽"', "present_characters:", '  - "孟缘"', ""].join("\n"),
        ),
      )

      const svc = yield* World.Service
      const world = yield* svc.fromDirectory(dir, dir)

      expect(world?.scene).toEqual({
        date: "1003-07-14",
        location: "云梦泽",
      })
      expect(world?.currentScene).toBe("云梦泽")
      expect(world?.presentCharacters).toEqual([{ name: "孟缘" }])
    }),
  )

  it.live("reads nested current_scene.present_characters for runtime files that embed the list", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* Effect.promise(() =>
        fs.writeFile(
          path.join(dir, "runtime.yaml"),
          [
            "current_scene:",
            "  date: 1003-07-19",
            "  location: 今庭-荆州-江夏县-市集",
            "  impression: 三人在市集逛",
            "  present_characters:",
            "    - name: 许宁",
            "      age: 37",
            "    - name: 沈烟",
            "      age: 14",
            "",
          ].join("\n"),
        ),
      )

      const svc = yield* World.Service
      const world = yield* svc.fromDirectory(dir, dir)

      expect(world?.currentScene).toBe("今庭-荆州-江夏县-市集")
      expect(world?.presentCharacters).toEqual([
        { name: "许宁", age: "37" },
        { name: "沈烟", age: "14" },
      ])
    }),
  )

  it.live("falls back to environment fields when current_scene omits date or location", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* Effect.promise(() =>
        fs.writeFile(
          path.join(dir, "runtime.yaml"),
          [
            "current_scene:",
            '  impression: "夜雨压枝"',
            "present_characters:",
            '  - name: "孟缘"',
            "environment:",
            '  location: "建木府主卧"',
            '  time: "1003-07-14T20:30"',
            "",
          ].join("\n"),
        ),
      )

      const svc = yield* World.Service
      const world = yield* svc.fromDirectory(dir, dir)

      expect(world?.scene).toEqual({
        date: "1003-07-14T20:30",
        location: "建木府主卧",
        impression: "夜雨压枝",
      })
      expect(world?.currentScene).toBe("建木府主卧")
      expect(world?.presentCharacters).toEqual([{ name: "孟缘" }])
    }),
  )
})
