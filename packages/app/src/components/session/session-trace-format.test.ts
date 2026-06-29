import { describe, expect, test } from "bun:test"
import type { SessionTraceEntry } from "@openplay-ai/sdk/v2/client"
import { traceDetailMarkdown, traceReadableBlocks } from "./session-trace-format"

function entry(overrides: Partial<SessionTraceEntry>): SessionTraceEntry {
  return {
    id: "trace_1",
    sessionID: "ses_1",
    rootSessionID: "ses_1",
    timestamp: Date.now(),
    source: "model",
    kind: "llm.request",
    payload: {},
    ...overrides,
  }
}

describe("session trace formatting", () => {
  test("renders request entries as role-ordered conversation blocks", () => {
    const blocks = traceReadableBlocks(
      entry({
        kind: "llm.request",
        payload: {
          model: { id: "gpt-5", providerID: "openai" },
          system: ["You are helpful"],
          messages: [
            { role: "user", content: "hello" },
            { role: "assistant", content: [{ type: "text", text: "hi" }] },
          ],
          tools: { read: { description: "Read files" } },
        },
      }),
    )

    expect(blocks).toEqual([
      { role: "SYSTEM", text: "You are helpful" },
      { role: "USER", text: "hello" },
      { role: "ASSISTANT", text: "hi" },
    ])
  })

  test("renders completed response entries as assistant-first readable text", () => {
    const markdown = traceDetailMarkdown(
      entry({
        kind: "llm.response.completed",
        payload: {
          text: "final answer",
          reasoning: "hidden chain summary",
          readable: "final answer\n\nReasoning:\nhidden chain summary",
          finish: { finishReason: "stop" },
        },
      }),
      "readable",
      true,
    )

    expect(markdown).toContain("`ASSISTANT>`")
    expect(markdown).toContain("final answer")
    expect(markdown).not.toContain("`REASONING>`")
    expect(markdown).toContain("Reasoning:")
    expect(markdown).not.toContain("\"finishReason\"")
  })

  test("hides legacy stream-event chunks from readable view", () => {
    const markdown = traceDetailMarkdown(
      entry({
        kind: "llm.stream.event",
        payload: {
          type: "text-delta",
          text: "partial",
        },
      }),
      "readable",
      true,
    )

    expect(markdown).toBe("```json\n{\n  \"type\": \"text-delta\",\n  \"text\": \"partial\"\n}\n```")
  })
})
