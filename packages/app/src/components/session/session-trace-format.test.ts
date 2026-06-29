import { describe, expect, test } from "bun:test"
import type { SessionTraceEntry } from "@openplay-ai/sdk/v2/client"
import { traceDetailMarkdown, traceReadableSections } from "./session-trace-format"

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
  test("renders request entries as request context instead of response", () => {
    const sections = traceReadableSections(
      entry({
        kind: "llm.request",
        payload: {
          model: { id: "gpt-5", providerID: "openai" },
          system: ["You are helpful"],
          messages: [{ role: "user", content: "hello" }],
          tools: { read: { description: "Read files" } },
        },
      }),
    )

    expect(sections.map((item) => item.label)).toEqual(["Model", "System", "Messages", "Tools"])
    expect(sections.some((item) => item.label === "Response Text")).toBe(false)
  })

  test("renders completed response entries with response text", () => {
    const markdown = traceDetailMarkdown(
      entry({
        kind: "llm.response.completed",
        payload: {
          text: "final answer",
          reasoning: "hidden chain summary",
          finish: { finishReason: "stop" },
        },
      }),
      "readable",
      true,
    )

    expect(markdown).toContain("## Response Text")
    expect(markdown).toContain("final answer")
    expect(markdown).not.toContain("## Messages")
  })
})
