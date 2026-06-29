import type { Agent, Message, Part, ToolPart, WorldInfo } from "@openplay-ai/sdk/v2/client"

export type NarrativeEntry = {
  id: string
  messageID: string
  sessionID: string
  output: string
  heading?: string
  metaLabel?: string
  timestamp?: number
  timestampLabel?: string
  perspective?: string
  style?: string
  presentationVariant?: string
}

export function isRoleplayMode(world: WorldInfo | undefined): boolean {
  return world !== undefined && world !== null
}

export function getDirectorAgent(agents: readonly Agent[]): Agent | undefined {
  return agents.find((a) => a.isDirector === true)
}

export function getCharacterAgents(agents: readonly Agent[]): Agent[] {
  return agents.filter((a) => !a.isDirector && a.mode !== "subagent" && !a.hidden)
}

export function agentDisplayName(agent: Agent): string {
  if (agent.persona) return agent.persona.split("\n")[0]?.trim() ?? agent.name
  return agent.name
}

export function isNarrativeTool(tool: string): boolean {
  return tool === "embody" || tool === "narrate"
}

export function isRoleplayTool(tool: string): boolean {
  return (
    tool === "embody" ||
    tool === "narrate" ||
    tool === "calc" ||
    tool === "dice_roll" ||
    tool === "scene_update"
  )
}

function readToolMetadata(part: ToolPart) {
  const metadata = part.metadata ?? {}
  const presentationVariant =
    typeof metadata.presentationVariant === "string" ? metadata.presentationVariant : undefined
  const perspective = typeof metadata.perspective === "string" ? metadata.perspective : undefined
  const style = typeof metadata.style === "string" ? metadata.style : undefined
  return { presentationVariant, perspective, style }
}

function cleanLabel(value: string | undefined) {
  if (!value) return undefined
  const next = value.trim()
  return next.length > 0 ? next : undefined
}

export function narrativeEntriesFromMessages(messages: readonly Message[], partsByMessageID: Record<string, Part[] | undefined>) {
  const entries: NarrativeEntry[] = []

  for (const message of messages) {
    if (message.role !== "assistant") continue
    const parts = partsByMessageID[message.id] ?? []
    for (const part of parts) {
      if (part.type !== "tool" || part.tool !== "narrate") continue
      if (part.state.status !== "completed") continue
      const output = typeof part.state.output === "string" ? part.state.output.trim() : ""
      if (!output) continue
      const meta = readToolMetadata(part)
      const badges = [cleanLabel(meta.perspective), cleanLabel(meta.style)].filter(Boolean)
      entries.push({
        id: part.id,
        messageID: message.parentID ?? message.id,
        sessionID: message.sessionID,
        output,
        heading: undefined,
        metaLabel: badges.length > 0 ? badges.join(" · ") : undefined,
        timestamp: message.time.completed ?? message.time.created,
        perspective: meta.perspective,
        style: meta.style,
        presentationVariant: meta.presentationVariant,
      })
    }
  }

  return entries.sort((a, b) => {
    const left = a.timestamp ?? 0
    const right = b.timestamp ?? 0
    if (left !== right) return left - right
    return a.id.localeCompare(b.id)
  })
}
