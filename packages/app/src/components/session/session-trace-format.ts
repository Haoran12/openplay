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
  if (typeof value !== "string") {
    try {
      return JSON.stringify(unescapedStrings(value), null, 2)
    } catch {
      return traceSafeJson(value)
    }
  }
  try {
    const parsed = JSON.parse(value)
    return JSON.stringify(unescapedStrings(parsed), null, 2)
  } catch {
    return unescapeString(value)
  }
}

function unescapeString(text: string): string {
  return text
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\")
}

function unescapedStrings(value: unknown): unknown {
  if (typeof value === "string") return unescapeString(value)
  if (Array.isArray(value)) return value.map(unescapedStrings)
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      result[k] = unescapedStrings(v)
    }
    return result
  }
  return value
}

function formatPayloadContent(content: unknown): string {
  if (content === undefined || content === null) return ""
  if (typeof content === "string") {
    try {
      const parsed = JSON.parse(content)
      if (typeof parsed === "string") return unescapeString(parsed)
      return formatReadableJson(parsed)
    } catch {
      return unescapeString(content)
    }
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => formatMessagePart(part))
      .filter((part) => part.trim())
      .join("\n\n")
  }
  return formatReadableJson(content)
}

function formatReadableJson(value: unknown): string {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return formatReadableJson(parsed)
    } catch {
      return unescapeString(value)
    }
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatToolsDisplay(tools: Record<string, unknown>): string {
  const names = Object.keys(tools)
  if (names.length === 0) return ""
  const lines = names.map((name) => {
    const tool = tools[name] as Record<string, unknown> | undefined
    const desc =
      typeof tool?.description === "string"
        ? `: ${tool.description}`
        : ""
    return `- **${name}**${desc}`
  })
  return `**Tools (${names.length})**\n${lines.join("\n")}`
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
    const detail = body === undefined ? "" : `\n\n\`\`\`\n${typeof body === "string" ? unescapeString(body) : formatStructuredValue(body)}\n\`\`\``
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

function readableInteractionBlocks(payload: Record<string, unknown>) {
  const blocks: TraceBlock[] = []

  const request = payload.request as Record<string, unknown> | undefined
  if (request) {
    const system = request.system
    if (Array.isArray(system)) {
      for (const item of system) pushBlock(blocks, "SYSTEM", item)
    }

    const messages = Array.isArray(request.messages) ? request.messages : []
    for (const message of messages) {
      const item = asRecord(message)
      if (!item) {
        pushBlock(blocks, "UNKNOWN", message)
        continue
      }
      pushBlock(blocks, roleName(item.role), formatMessageContent(item.content))
    }

    if (request.tools && typeof request.tools === "object") {
      pushBlock(blocks, "TOOLS", formatToolsDisplay(request.tools as Record<string, unknown>))
    }
  }

  const response = payload.response as Record<string, unknown> | undefined
  if (response) {
    if (typeof response.readable === "string" && response.readable.trim()) {
      pushBlock(blocks, "ASSISTANT", response.readable)
    } else if (typeof response.text === "string" || typeof response.reasoning === "string") {
      pushBlock(blocks, "ASSISTANT", response.text)
      pushBlock(blocks, "REASONING", response.reasoning)
    }
  }

  return blocks
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

  if (payload.tools && typeof payload.tools === "object") {
    pushBlock(blocks, "TOOLS", formatToolsDisplay(payload.tools as Record<string, unknown>))
  }
  return blocks
}

function readableResponseBlocks(payload: Record<string, unknown>) {
  const blocks: TraceBlock[] = []
  if (typeof payload.readable === "string" && payload.readable.trim()) {
    pushBlock(blocks, "ASSISTANT", payload.readable)
    return blocks
  }
  pushBlock(blocks, "ASSISTANT", payload.text)
  pushBlock(blocks, "REASONING", payload.reasoning)
  return blocks
}

function readableStreamEventBlocks(payload: Record<string, unknown>) {
  const blocks: TraceBlock[] = []
  return blocks
}

function readableSessionComposeBlocks(payload: Record<string, unknown>): TraceBlock[] {
  const blocks: TraceBlock[] = []

  if (payload.roleplay === true) {
    pushBlock(blocks, "META", "Roleplay session")
  }
  if (payload.userMessageID) {
    pushBlock(blocks, "META", `User message: ${payload.userMessageID}`)
  }

  const system = payload.system
  if (Array.isArray(system)) {
    for (const item of system) pushBlock(blocks, "SYSTEM", item)
  }

  const messages = Array.isArray(payload.modelMessages) ? payload.modelMessages : []
  for (const message of messages) {
    const item = asRecord(message)
    if (!item) continue
    pushBlock(blocks, roleName(item.role), formatMessageContent(item.content))
  }

  if (payload.format) {
    pushBlock(blocks, "FORMAT", formatReadableJson(payload.format))
  }

  if (payload.tools && typeof payload.tools === "object") {
    pushBlock(blocks, "TOOLS", formatToolsDisplay(payload.tools as Record<string, unknown>))
  }

  return blocks
}

function readablePayloadBlocks(payload: Record<string, unknown>): TraceBlock[] {
  const blocks: TraceBlock[] = []

  if (typeof payload.type === "string" && typeof payload.role !== "string") {
    const content = payload.content ?? payload.text ?? payload.message ?? payload.data
    pushBlock(blocks, roleName(payload.type), formatPayloadContent(content))
    return blocks
  }

  if (typeof payload.role === "string") {
    const content = payload.content ?? payload.text ?? payload.message
    pushBlock(blocks, roleName(payload.role), formatPayloadContent(content))
    return blocks
  }

  if (Array.isArray(payload.messages)) {
    for (const msg of payload.messages) {
      const item = asRecord(msg)
      if (!item) continue
      pushBlock(blocks, roleName(item.role), formatPayloadContent(item.content ?? item.text))
    }
    if (blocks.length > 0) return blocks
  }

  if (payload.request || payload.response) {
    return readableInteractionBlocks(payload)
  }

  if (typeof payload.text === "string" || typeof payload.content === "string") {
    pushBlock(blocks, "PAYLOAD", formatPayloadContent(payload.text ?? payload.content))
    return blocks
  }

  pushBlock(blocks, "PAYLOAD", formatReadableJson(payload))
  return blocks
}

export function traceReadableBlocks(entry: SessionTraceEntry) {
  const payload = (entry.payload ?? {}) as Record<string, unknown>
  switch (entry.kind) {
    case "llm.interaction":
      return readableInteractionBlocks(payload)
    case "llm.request":
      return readableRequestBlocks(payload)
    case "llm.response.completed":
      return readableResponseBlocks(payload)
    case "llm.stream.event":
      return readableStreamEventBlocks(payload)
    case "session.compose":
      return readableSessionComposeBlocks(payload)
    default:
      return readablePayloadBlocks(payload)
  }
}

export function traceDetailMarkdown(entry: SessionTraceEntry, view: "readable" | "raw", expandedSections: boolean) {
  if (view === "raw") return ["```json", traceSafeJson(entry), "```"].join("\n")
  const blocks = traceReadableBlocks(entry)
  if (blocks.length === 0) return ["```json", traceSafeJson(entry.payload), "```"].join("\n")
  return blocks.map((block) => `\`${block.role}>\`\n${block.text}`).join("\n\n")
}
