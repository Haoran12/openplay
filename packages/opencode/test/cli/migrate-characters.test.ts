import { afterEach, expect, mock, test } from "bun:test"
import path from "path"
import { Filesystem } from "@/util/filesystem"
import { tmpdir } from "../fixture/fixture"

void mock.module("@clack/prompts", () => ({
  intro: () => undefined,
  log: {
    error: () => undefined,
    success: () => undefined,
    warn: () => undefined,
    info: () => undefined,
  },
  outro: () => undefined,
}))

const { MigrateCharactersCommand } = await import("../../src/cli/cmd/migrate-characters")

afterEach(() => {
  mock.restore()
})

test("migrates legacy flat character files into directory-based resources", async () => {
  await using tmp = await tmpdir()
  const worldPath = tmp.path

  await Filesystem.write(path.join(worldPath, "characters", "孟缘.yaml"), "name: 孟缘\nbio: 旧设定\n")
  await Filesystem.write(path.join(worldPath, "characters", "孟缘a.yaml"), "name: 孟缘\nnotes: 角色小记\n")
  await Filesystem.write(path.join(worldPath, "characters", "孟缘-secret.yaml"), "name: 孟缘\naccess: God Only\nnote: hidden\n")
  await Filesystem.write(path.join(worldPath, "memories", "孟缘.yaml"), "- id: 1\n  text: 旧记忆\n")

  await MigrateCharactersCommand.handler({ path: worldPath, _: [], $0: "test" } as any)

  expect(await Filesystem.readText(path.join(worldPath, "characters", "孟缘", "profile.yaml"))).toContain("name: 孟缘")
  expect(await Filesystem.readText(path.join(worldPath, "characters", "孟缘", "knowledge", "孟缘a.yaml"))).toContain(
    "notes: 角色小记",
  )
  expect(await Filesystem.readText(path.join(worldPath, "characters", "孟缘", "gm_notes.yaml"))).toContain("note: hidden")
  expect(await Filesystem.readText(path.join(worldPath, "characters", "孟缘", "memory.yaml"))).toContain("旧记忆")

  const report = await Filesystem.readJson<{
    migratedProfiles: string[]
    migratedMemories: string[]
    migratedKnowledge: string[]
    migratedDirectorFiles: string[]
    conflicts: unknown[]
    unclassified: string[]
  }>(path.join(worldPath, ".openplay", "migrate-characters-report.json"))

  expect(report.migratedProfiles).toEqual(["characters/孟缘.yaml -> characters/孟缘/profile.yaml"])
  expect(report.migratedMemories).toEqual(["memories/孟缘.yaml -> characters/孟缘/memory.yaml"])
  expect(report.migratedKnowledge).toEqual(["characters/孟缘a.yaml -> characters/孟缘/knowledge/孟缘a.yaml"])
  expect(report.migratedDirectorFiles).toEqual(["characters/孟缘-secret.yaml -> characters/孟缘/gm_notes.yaml"])
  expect(report.conflicts).toEqual([])
  expect(report.unclassified).toEqual([])
})
