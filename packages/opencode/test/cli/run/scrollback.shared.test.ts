import { describe, expect, test } from "bun:test"
import type { ToolPart } from "@openplay-ai/sdk/v2"
import { entryBody } from "@/cli/cmd/run/entry.body"
import { entryColor, entryLook } from "@/cli/cmd/run/scrollback.shared"
import { entryLayout } from "@/cli/cmd/run/scrollback.writer"
import { RUN_THEME_FALLBACK } from "@/cli/cmd/run/theme"
import type { StreamCommit } from "@/cli/cmd/run/types"

function toolPart(tool: string, state: ToolPart["state"], id = `${tool}-1`, messageID = `msg-${tool}`): ToolPart {
  return {
    id,
    sessionID: "session-1",
    messageID,
    type: "tool",
    callID: `call-${id}`,
    tool,
    state,
  } as ToolPart
}

function toolCommit(input: {
  tool: string
  state: ToolPart["state"]
  phase?: StreamCommit["phase"]
  toolState?: StreamCommit["toolState"]
  text?: string
  id?: string
  messageID?: string
}): StreamCommit {
  return {
    kind: "tool",
    text: input.text ?? "",
    phase: input.phase ?? "final",
    source: "tool",
    partID: input.id ?? `${input.tool}-1`,
    messageID: input.messageID ?? `msg-${input.tool}`,
    tool: input.tool,
    toolState: input.toolState ?? "completed",
    part: toolPart(input.tool, input.state, input.id, input.messageID),
  }
}

describe("run scrollback semantics", () => {
  test("treats completed narrate output as assistant-style narrative", () => {
    const commit = toolCommit({
      tool: "narrate",
      state: {
        status: "completed",
        input: {
          content: "Moonlight spills across the courtyard.",
          perspective: "third-person",
          style: "lyrical",
        },
        output: "Moonlight spills across the courtyard.",
        title: "narrate: Moonlight spills across the courtyard.",
        metadata: {
          length: 39,
        },
        time: { start: 1, end: 2 },
      },
    })

    const body = entryBody(commit)
    expect(body).toEqual({
      type: "markdown",
      content: "Moonlight spills across the courtyard.",
    })

    expect(entryLayout(commit, body)).toBe("block")
    expect(entryLook(commit, RUN_THEME_FALLBACK.entry)).toEqual({
      fg: RUN_THEME_FALLBACK.entry.assistant.body,
    })
    expect(entryColor(commit, RUN_THEME_FALLBACK)).toBe(RUN_THEME_FALLBACK.entry.assistant.body)
  })
})
