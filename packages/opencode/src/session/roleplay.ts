export * as Roleplay from "./roleplay"

export interface Context {
  environmentOverride?: string
  instructionOverride?: string
  skillsOverride?: string
}

export function applyEnvironmentOverride(
  env: string[],
  roleplay: Context | undefined,
): string[] {
  if (!roleplay) return env
  if (roleplay.environmentOverride === "") return []
  if (roleplay.environmentOverride !== undefined) return [roleplay.environmentOverride]
  return env
}

export function applyInstructionOverride(
  instructions: string[],
  roleplay: Context | undefined,
): string[] {
  if (!roleplay) return instructions
  if (roleplay.instructionOverride === "") return []
  if (roleplay.instructionOverride !== undefined) return [roleplay.instructionOverride]
  return instructions
}

export function applySkillsOverride(
  skills: string | undefined,
  roleplay: Context | undefined,
): string[] {
  if (!roleplay) return skills ? [skills] : []
  if (roleplay.skillsOverride === "") return []
  if (roleplay.skillsOverride !== undefined) return [roleplay.skillsOverride]
  return skills ? [skills] : []
}