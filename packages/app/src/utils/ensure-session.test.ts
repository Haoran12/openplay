import { describe, expect, test } from "bun:test"
import type { Session } from "@openplay-ai/sdk/v2/client"
import { ensureSession, upsertSession } from "./ensure-session"

const makeSession = (id: string): Session =>
  ({
    id,
    slug: id,
    projectID: "project-1",
    directory: "/repo/worktree-a",
    title: `Session ${id}`,
    version: "1",
    time: {
      created: 1,
      updated: 1,
    },
  }) as Session

describe("ensureSession", () => {
  test("returns the current session id without creating a new session", async () => {
    let created = false

    const result = await ensureSession({
      currentSessionID: "session-existing",
      directory: "/repo/worktree-a",
      createSession: async () => {
        created = true
        return makeSession("session-new")
      },
      onCreated: () => undefined,
      promoteSession: () => undefined,
      navigate: () => undefined,
    })

    expect(result).toBe("session-existing")
    expect(created).toBe(false)
  })

  test("creates, seeds, promotes, and navigates for a new session", async () => {
    const calls: string[] = []

    const result = await ensureSession({
      directory: "/repo/worktree-a",
      createSession: async () => makeSession("session-new"),
      onCreated: (session) => calls.push(`created:${session.id}`),
      promoteSession: (directory, sessionID) => calls.push(`promote:${directory}:${sessionID}`),
      handoffTabs: (directorySlug, sessionID) => calls.push(`handoff:${directorySlug}:${sessionID}`),
      navigate: (href) => calls.push(`navigate:${href}`),
    })

    expect(result).toBe("session-new")
    expect(calls).toEqual([
      "created:session-new",
      "promote:/repo/worktree-a:session-new",
      "handoff:L3JlcG8vd29ya3RyZWUtYQ:session-new",
      "navigate:/L3JlcG8vd29ya3RyZWUtYQ/session/session-new",
    ])
  })

  test("upserts sessions by id", () => {
    const a = makeSession("a")
    const b = makeSession("b")
    const updatedA = { ...a, title: "Updated A" }

    expect(upsertSession([a], b).map((item) => item.id)).toEqual(["a", "b"])
    expect(upsertSession([a, b], updatedA)).toEqual([updatedA, b])
  })
})
