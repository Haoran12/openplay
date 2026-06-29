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
      { role: "TOOLS", text: "**Tools (1)**\n- **read**: Read files" },
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

    test("parses payload with type field as role", () => {
      const blocks = traceReadableBlocks(
        entry({
          kind: "custom.event",
          payload: {
            type: "notification",
            content: "Something happened",
          },
        }),
      )

      expect(blocks).toEqual([
        {
          role: "NOTIFICATION",
          text: "Something happened",
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

  describe("session.compose parsing", () => {
    test("parses session.compose with roleplay flag", () => {
      const blocks = traceReadableBlocks(
        entry({
          kind: "session.compose",
          payload: {
            roleplay: true,
            userMessageID: "msg_123",
            system: ["You are a helpful assistant"],
            modelMessages: [
              { role: "user", content: "Hello" },
            ],
            format: { type: "text" },
          },
        }),
      )

      expect(blocks.length).toBeGreaterThan(0)
      expect(blocks.find((b) => b.role === "META" && b.text === "Roleplay session")).toBeDefined()
      expect(blocks.find((b) => b.role === "SYSTEM")).toBeDefined()
      expect(blocks.find((b) => b.role === "USER")).toBeDefined()
    })

    test("parses session.compose with tools", () => {
      const blocks = traceReadableBlocks(
        entry({
          kind: "session.compose",
          payload: {
            tools: {
              read: { description: "Read a file" },
              write: { description: "Write a file" },
            },
          },
        }),
      )

      const toolsBlock = blocks.find((b) => b.role === "TOOLS")
      expect(toolsBlock).toBeDefined()
      expect(toolsBlock!.text).toContain("**Tools (2)**")
      expect(toolsBlock!.text).toContain("read")
      expect(toolsBlock!.text).toContain("write")
    })
  })

  describe("tools display", () => {
    test("displays tools with full descriptions in request", () => {
      const blocks = traceReadableBlocks(
        entry({
          kind: "llm.request",
          payload: {
            messages: [{ role: "user", content: "Hi" }],
            tools: {
              read: { description: "Read a file from the filesystem" },
              write: { description: "Write a file to the filesystem" },
            },
          },
        }),
      )

      const toolsBlock = blocks.find((b) => b.role === "TOOLS")
      expect(toolsBlock).toBeDefined()
      expect(toolsBlock!.text).toContain("Read a file from the filesystem")
      expect(toolsBlock!.text).toContain("Write a file to the filesystem")
    })

    test("displays tools in interaction", () => {
      const blocks = traceReadableBlocks(
        entry({
          kind: "llm.interaction",
          payload: {
            request: {
              messages: [{ role: "user", content: "Hi" }],
              tools: {
                calc: { description: "Calculate values" },
              },
            },
            response: {
              text: "Hello!",
            },
          },
        }),
      )

      const toolsBlock = blocks.find((b) => b.role === "TOOLS")
      expect(toolsBlock).toBeDefined()
      expect(toolsBlock!.text).toContain("calc")
    })
  })

  describe("no truncation in readable view", () => {
    test("does not truncate long messages", () => {
      const longContent = "x".repeat(2000)
      const blocks = traceReadableBlocks(
        entry({
          kind: "llm.request",
          payload: {
            messages: [{ role: "user", content: longContent }],
          },
        }),
      )

      expect(blocks).toEqual([{ role: "USER", text: longContent }])
    })

    test("traceDetailMarkdown shows full content in readable view", () => {
      const longContent = "y".repeat(1500)
      const markdown = traceDetailMarkdown(
        entry({
          kind: "llm.request",
          payload: {
            messages: [{ role: "user", content: longContent }],
          },
        }),
        "readable",
        false,
      )

      expect(markdown).toContain(longContent)
      expect(markdown).not.toContain("truncated")
    })
  })
})
