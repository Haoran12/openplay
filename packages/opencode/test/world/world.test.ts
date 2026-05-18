import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { CrossSpawnSpawner } from "@openplay-ai/core/cross-spawn-spawner"
import { World } from "../../src/world/world"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(CrossSpawnSpawner.defaultLayer, NodeFileSystem.layer, World.defaultLayer))

describe("World.fromDirectory", () => {
  it.live("prefers runtime.yaml as the world root signal over ancestor openplay.json", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(dir, "openplay.json"), JSON.stringify({ id: "wld_ancestor" })))
        yield* Effect.promise(() => fs.mkdir(path.join(dir, "nested"), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(path.join(dir, "nested", "runtime.yaml"), "scene: start\n"))

        const svc = yield* World.Service
        const world = yield* svc.fromDirectory(path.join(dir, "nested"), dir)

        expect(world?.rootPath).toBe(path.join(dir, "nested"))
        expect(world?.configPath).toBe(path.join(dir, "nested", "runtime.yaml"))
      }),
    ),
  )
})
