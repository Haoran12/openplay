import type { SessionTraceEntry } from "@openplay-ai/sdk/v2/client"

type TraceSection = {
  label: string
  text: string
}

export function traceSafeJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function pushSection(sections: TraceSection[], label: string, value: unknown) {
  if (value === undefined || value === null || value === "") return
  sections.push({
    label,
    text: typeof value === "string" ? value : traceSafeJson(value),
  })
}

function readableRequestSections(payload: Record<string, unknown>) {
  const sections: TraceSection[] = []
  pushSection(sections, "Model", payload.model)
  pushSection(sections, "System", payload.system)
  pushSection(sections, "Messages", payload.messages)
  pushSection(sections, "Tool Choice", payload.toolChoice)
  pushSection(sections, "Tools", payload.tools)
  pushSection(sections, "Options", payload.options)
  return sections
}

function readableResponseSections(payload: Record<string, unknown>) {
  const sections: TraceSection[] = []
  pushSection(sections, "Response Text", payload.text)
  pushSection(sections, "Reasoning", payload.reasoning)
  pushSection(sections, "Finish", payload.finish)
  return sections
}

function readableStreamEventSections(payload: Record<string, unknown>) {
  const sections: TraceSection[] = []
  pushSection(sections, "Event Type", payload.type)
  if (payload.type === "text-delta") {
    pushSection(sections, "Text Delta", payload.text)
    return sections
  }
  if (payload.type === "reasoning-delta") {
    pushSection(sections, "Reasoning Delta", payload.text)
    return sections
  }
  pushSection(sections, "Payload", payload)
  return sections
}

export function traceReadableSections(entry: SessionTraceEntry) {
  const payload = (entry.payload ?? {}) as Record<string, unknown>
  switch (entry.kind) {
    case "llm.request":
      return readableRequestSections(payload)
    case "llm.response.completed":
      return readableResponseSections(payload)
    case "llm.stream.event":
      return readableStreamEventSections(payload)
    default: {
      const sections: TraceSection[] = []
      pushSection(sections, "Payload", payload)
      return sections
    }
  }
}

export function traceDetailMarkdown(entry: SessionTraceEntry, view: "readable" | "raw", expandedSections: boolean) {
  if (view === "raw") return ["```json", traceSafeJson(entry), "```"].join("\n")
  const sections = traceReadableSections(entry)
  if (sections.length === 0) return ["```json", traceSafeJson(entry.payload), "```"].join("\n")
  return sections
    .map((section) =>
      expandedSections
        ? `## ${section.label}\n\n\`\`\`\n${section.text}\n\`\`\``
        : `## ${section.label}\n\n${section.text.slice(0, 800)}${section.text.length > 800 ? "\n\n[truncated in readable view]" : ""}`,
    )
    .join("\n\n")
}
