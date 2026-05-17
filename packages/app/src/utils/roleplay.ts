import type { Agent, WorldInfo } from "@opencode-ai/sdk/v2/client"

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