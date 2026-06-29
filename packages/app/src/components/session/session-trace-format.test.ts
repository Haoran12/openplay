import { describe, expect, test } from "bun:test"
import type { SessionTraceEntry } from "@openplay-ai/sdk/v2/client"
import { traceDetailMarkdown, traceReadableBlocks } from "./session-trace-format"

function entry(overrides: Partial<SessionTraceEntry>): SessionTraceEntry {
  return {
    id: "trace_1",
    sessionID: "ses_1",
    rootSessionID: "ses_1",
    timestamp: Date.now(),
    source: "other",
    kind: "llm.interaction",
    payload: {},
    ...overrides,
  }
}

describe("session trace formatting", () => {
  test("renders interaction entries as role-ordered conversation blocks", () => {
    const blocks = traceReadableBlocks(
      entry({
        kind: "llm.interaction",
        payload: {
          request: {
            model: { id: "gpt-5", providerID: "openai" },
            system: ["You are helpful"],
            messages: [
              { role: "user", content: "hello" },
              { role: "assistant", content: [{ type: "text", text: "hi" }] },
            ],
            tools: { read: { description: "Read files" } },
          },
          response: {
            text: "final answer",
            reasoning: "hidden chain summary",
            readable: "final answer\n\nReasoning:\nhidden chain summary",
            finish: { finishReason: "stop" },
          },
          duration: 1234,
        },
      }),
    )

    expect(blocks).toEqual([
      { role: "SYSTEM", text: "You are helpful" },
      { role: "USER", text: "hello" },
      { role: "ASSISTANT", text: "hi" },
      { role: "ASSISTANT", text: "final answer\n\nReasoning:\nhidden chain summary" },
    ])
  })

  test("renders interaction entries with error as assistant error message", () => {
    const markdown = traceDetailMarkdown(
      entry({
        kind: "llm.interaction",
        payload: {
          request: {
            model: { id: "gpt-5", providerID: "openai" },
            system: ["You are helpful"],
            messages: [{ role: "user", content: "hello" }],
          },
          response: {
            text: "",
            reasoning: "",
            readable: "ERROR: Timeout",
            error: "Timeout",
          },
          duration: 30000,
        },
      }),
      "readable",
      true,
    )

    expect(markdown).toContain("`ASSISTANT>`")
    expect(markdown).toContain("ERROR: Timeout")
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

  describe("unknown payload parsing", () => {
    test("parses payload with direct role field", () => {
      const blocks = traceReadableBlocks(
        entry({
          kind: "custom.event",
          payload: {
            role: "user",
            content: "Hello\\nWorld\\n\\nThis is a \"test\" message",
          },
        }),
      )

      expect(blocks).toEqual([
        {
          role: "USER",
          text: 'Hello\nWorld\n\nThis is a "test" message',
        },
      ])
    })

    test("parses payload with messages array", () => {
      const blocks = traceReadableBlocks(
        entry({
          kind: "custom.event",
          payload: {
            messages: [
              { role: "system", content: "You are helpful" },
              { role: "user", content: "Hello" },
            ],
          },
        }),
      )

      expect(blocks).toEqual([
        { role: "SYSTEM", text: "You are helpful" },
        { role: "USER", text: "Hello" },
      ])
    })

    test("parses payload with text field", () => {
      const blocks = traceReadableBlocks(
        entry({
          kind: "custom.event",
          payload: {
            text: "Simple text content\\nwith newline",
          },
        }),
      )

      expect(blocks).toEqual([{ role: "PAYLOAD", text: "Simple text content\nwith newline" }])
    })

    test("parses payload with JSON string content", () => {
      const blocks = traceReadableBlocks(
        entry({
          kind: "custom.event",
          payload: {
            role: "assistant",
            content: '"This is a JSON string\\nwith escaped newlines"',
          },
        }),
      )

      expect(blocks).toEqual([{ role: "ASSISTANT", text: "This is a JSON string\nwith escaped newlines" }])
    })

    test("falls back to formatted JSON for unknown structure", () => {
      const blocks = traceReadableBlocks(
        entry({
          kind: "custom.event",
          payload: {
            customField: "value",
            nested: { data: "test" },
          },
        }),
      )

      expect(blocks.length).toBe(1)
      expect(blocks[0]!.role).toBe("PAYLOAD")
      expect(blocks[0]!.text).toContain("customField")
      expect(blocks[0]!.text).toContain("nested")
    })

    test("handles request/response structure in unknown payload", () => {
      const blocks = traceReadableBlocks(
        entry({
          kind: "custom.event",
          payload: {
            request: {
              system: ["Be helpful"],
              messages: [{ role: "user", content: "Hi" }],
            },
            response: {
              text: "Hello!",
            },
          },
        }),
      )

      expect(blocks).toEqual([
        { role: "SYSTEM", text: "Be helpful" },
        { role: "USER", text: "Hi" },
        { role: "ASSISTANT", text: "Hello!" },
      ])
    })
  })
})
