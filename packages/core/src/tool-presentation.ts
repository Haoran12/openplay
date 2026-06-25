export const TOOL_PRESENTATION_DEFAULT = "default" as const
export const TOOL_PRESENTATION_PRIMARY_OUTPUT = "primary_output" as const
export const TOOL_PRESENTATION_VARIANT_NARRATIVE = "narrative" as const

export type ToolPresentation = typeof TOOL_PRESENTATION_DEFAULT | typeof TOOL_PRESENTATION_PRIMARY_OUTPUT
export type ToolPresentationVariant = typeof TOOL_PRESENTATION_VARIANT_NARRATIVE

export type ToolPresentationMetadata = {
  presentation?: ToolPresentation
  presentationVariant?: ToolPresentationVariant
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function readToolPresentationMetadata(input: unknown): ToolPresentationMetadata {
  if (!isRecord(input)) return {}

  const presentation =
    input.presentation === TOOL_PRESENTATION_PRIMARY_OUTPUT
      ? TOOL_PRESENTATION_PRIMARY_OUTPUT
      : input.presentation === TOOL_PRESENTATION_DEFAULT
        ? TOOL_PRESENTATION_DEFAULT
        : undefined
  const presentationVariant =
    input.presentationVariant === TOOL_PRESENTATION_VARIANT_NARRATIVE
      ? TOOL_PRESENTATION_VARIANT_NARRATIVE
      : undefined

  return {
    ...(presentation ? { presentation } : {}),
    ...(presentationVariant ? { presentationVariant } : {}),
  }
}

export function isPrimaryOutputPresentation(input: unknown) {
  return readToolPresentationMetadata(input).presentation === TOOL_PRESENTATION_PRIMARY_OUTPUT
}

export function isNarrativePresentation(input: unknown) {
  if (!isPrimaryOutputPresentation(input)) return false
  const { presentationVariant } = readToolPresentationMetadata(input)
  return presentationVariant === undefined || presentationVariant === TOOL_PRESENTATION_VARIANT_NARRATIVE
}
