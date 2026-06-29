import type { SessionTraceEntry } from "@openplay-ai/sdk/v2/client"

type TraceBlock = {
  role: string
  text: string
}

export function traceSafeJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
}

function roleName(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : "UNKNOWN"
}

function formatStructuredValue(value: unknown) {
  if (typeof value !== "string") return traceSafeJson(value)
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function formatMessagePart(part: unknown) {
  const item = asRecord(part)
  if (!item) return String(part)

  if (typeof item.text === "string" && item.type !== "tool-call" && item.type !== "tool-result") {
    return item.text
  }

  if (item.type === "tool-call") {
    const body = item.input ?? item.args ?? item.arguments
    const detail = body === undefined ? "" : `\n\n\`\`\`json\n${formatStructuredValue(body)}\n\`\`\``
    return `Tool call: ${typeof item.toolName === "string" ? item.toolName : "unknown"}${detail}`
  }

  if (item.type === "tool-result") {
    const body = item.output ?? item.result ?? item.content
    const detail = body === undefined ? "" : `\n\n\`\`\`\n${typeof body === "string" ? body : traceSafeJson(body)}\n\`\`\``
    return `Tool result: ${typeof item.toolName === "string" ? item.toolName : "unknown"}${detail}`
  }

  if (item.type === "reasoning" && typeof item.text === "string") return item.text
  if (item.type === "image") return `[Image${typeof item.mimeType === "string" ? `: ${item.mimeType}` : ""}]`
  if (item.type === "file") {
    const name = typeof item.filename === "string" ? item.filename : "attachment"
    return `[File: ${name}]`
  }

  if (typeof item.content === "string") return item.content
  return traceSafeJson(item)
}

function formatMessageContent(content: unknown) {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return content === undefined ? "" : traceSafeJson(content)
  return content
    .map((part) => formatMessagePart(part))
    .filter((part) => part.trim())
    .join("\n\n")
}

function pushBlock(blocks: TraceBlock[], role: string, text: unknown) {
  const rendered = typeof text === "string" ? text.trim() : String(text ?? "").trim()
  if (!rendered) return
  blocks.push({ role, text: rendered })
}

function readableRequestBlocks(payload: Record<string, unknown>) {
  const blocks: TraceBlock[] = []
  const system = payload.system
  if (Array.isArray(system)) {
    for (const item of system) pushBlock(blocks, "SYSTEM", item)
  }

  const messages = Array.isArray(payload.messages) ? payload.messages : []
  for (const message of messages) {
    const item = asRecord(message)
    if (!item) {
      pushBlock(blocks, "UNKNOWN", message)
      continue
    }
    pushBlock(blocks, roleName(item.role), formatMessageContent(item.content))
  }
  return blocks
}

function readableResponseBlocks(payload: Record<string, unknown>) {
  const blocks: TraceBlock[] = []
  pushBlock(blocks, "ASSISTANT", payload.text)
  pushBlock(blocks, "REASONING", payload.reasoning)
  return blocks
}

function readableStreamEventBlocks(payload: Record<string, unknown>) {
  const blocks: TraceBlock[] = []
  if (payload.type === "text-delta") {
    pushBlock(blocks, "ASSISTANT", payload.text)
    return blocks
  }
  if (payload.type === "reasoning-delta") {
    pushBlock(blocks, "REASONING", payload.text)
    return blocks
  }
  pushBlock(blocks, "EVENT", traceSafeJson(payload))
  return blocks
}

export function traceReadableBlocks(entry: SessionTraceEntry) {
  const payload = (entry.payload ?? {}) as Record<string, unknown>
  switch (entry.kind) {
    case "llm.request":
      return readableRequestBlocks(payload)
    case "llm.response.completed":
      return readableResponseBlocks(payload)
    case "llm.stream.event":
      return readableStreamEventBlocks(payload)
    default:
      return [{ role: "PAYLOAD", text: traceSafeJson(payload) }]
  }
}

export function traceDetailMarkdown(entry: SessionTraceEntry, view: "readable" | "raw", expandedSections: boolean) {
  if (view === "raw") return ["```json", traceSafeJson(entry), "```"].join("\n")
  const blocks = traceReadableBlocks(entry)
  if (blocks.length === 0) return ["```json", traceSafeJson(entry.payload), "```"].join("\n")
  return blocks
    .map((block) =>
      expandedSections
        ? `\`${block.role}>\`\n${block.text}`
        : `\`${block.role}>\`\n${block.text.slice(0, 800)}${block.text.length > 800 ? "\n\n[truncated in readable view]" : ""}`,
    )
    .join("\n\n")
}
