import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ProjectID } from "../../src/project/schema"
import { MessageID, SessionID } from "../../src/session/schema"
import { Session } from "../../src/session/session"

const info = {
  id: SessionID.descending(),
  slug: "test-session",
  projectID: ProjectID.global,
  workspaceID: undefined,
  directory: "/tmp/opencode",
  parentID: undefined,
  summary: undefined,
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  share: undefined,
  title: "Test session",
  version: "1.0.0",
  time: {
    created: 1,
    updated: 2,
    compacting: undefined,
    archived: undefined,
  },
  permission: undefined,
  revert: undefined,
  worldID: undefined,
  worldPath: undefined,
  roleplayCharacter: undefined,
  roleplaySceneKey: undefined,
  roleplayPurpose: undefined,
} satisfies Session.Info

describe("Session schema", () => {
  test("encodes undefined optional session fields as omitted keys", () => {
    const encoded = Schema.encodeUnknownSync(Session.Info)(info) as Record<string, unknown>

    for (const key of ["workspaceID", "parentID", "summary", "share", "permission", "revert", "worldID", "worldPath", "roleplayCharacter", "roleplaySceneKey", "roleplayPurpose"]) {
      expect(Object.hasOwn(encoded, key)).toBe(false)
    }
    expect(Object.hasOwn(encoded.time as Record<string, unknown>, "compacting")).toBe(false)
    expect(Object.hasOwn(encoded.time as Record<string, unknown>, "archived")).toBe(false)
    expect(JSON.stringify(encoded)).not.toContain("parentID")
  })

  test("encodes undefined optional global session project fields as omitted keys", () => {
    const encoded = Schema.encodeUnknownSync(Session.GlobalInfo)({
      ...info,
      project: {
        id: ProjectID.global,
        name: undefined,
        worktree: "/tmp/opencode",
      },
    }) as Record<string, unknown>

    expect(Object.hasOwn(encoded, "parentID")).toBe(false)
    expect(Object.hasOwn(encoded.project as Record<string, unknown>, "name")).toBe(false)
  })

  test("encodes nested undefined optional session fields as omitted keys", () => {
    const encoded = Schema.encodeUnknownSync(Session.Info)({
      ...info,
      summary: {
        additions: 1,
        deletions: 2,
        files: 3,
        diffs: undefined,
      },
      revert: {
        messageID: MessageID.ascending(),
        partID: undefined,
        snapshot: undefined,
        diff: undefined,
      },
    }) as Record<string, unknown>

    expect(Object.hasOwn(encoded.summary as Record<string, unknown>, "diffs")).toBe(false)
    for (const key of ["partID", "snapshot", "diff"]) {
      expect(Object.hasOwn(encoded.revert as Record<string, unknown>, key)).toBe(false)
    }
  })

  test("normalizes null roleplay session columns to undefined", () => {
    const decoded = Session.fromRow({
      id: SessionID.descending(),
      slug: "row-session",
      project_id: ProjectID.global,
      workspace_id: null,
      directory: "/tmp/opencode",
      path: null,
      parent_id: null,
      title: "Row session",
      agent: null,
      model: null,
      version: "1.0.0",
      share_url: null,
      summary_additions: null,
      summary_deletions: null,
      summary_files: null,
      summary_diffs: null,
      cost: 0,
      tokens_input: 0,
      tokens_output: 0,
      tokens_reasoning: 0,
      tokens_cache_read: 0,
      tokens_cache_write: 0,
      revert: null,
      permission: null,
      world_id: null,
      world_path: null,
      roleplay_character: null,
      roleplay_scene_key: null,
      roleplay_purpose: null,
      time_created: 1,
      time_updated: 2,
      time_compacting: null,
      time_archived: null,
    })

    expect(decoded.roleplayCharacter).toBeUndefined()
    expect(decoded.roleplaySceneKey).toBeUndefined()
    expect(decoded.roleplayPurpose).toBeUndefined()
  })
})
