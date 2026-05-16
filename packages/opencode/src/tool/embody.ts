import { Effect, Schema } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"
import DESCRIPTION from "./embody.txt"

const Parameters = Schema.Struct({
  character: Schema.String.annotate({
    description: "Name of the character to embody (must be present in the scene)",
  }),
  l2View: Schema.String.annotate({
    description: "The L2 narrative view for this character — filtered narrative context that the character can perceive. Do NOT include any God Only content.",
  }),
  situation: Schema.String.annotate({
    description: "Current scene situation description — what is happening right now from this character's perspective",
  }),
})

type EmbodyMetadata = {
  character: string
  filtered: boolean
}

const GOD_ONLY_PATTERNS = [
  /access\s*:\s*["']?God\s+Only["']?/gi,
  /access\s*:\s*["']?god-only["']?/gi,
]

export function filterGodOnly(text: string): string {
  let result = text
  let filtered = false
  const lines = text.split("\n")
  const outputLines: string[] = []
  let suppressDepth = 0

  for (const line of lines) {
    const isGodOnly = GOD_ONLY_PATTERNS.some((pat) => pat.test(line))
    if (isGodOnly) {
      suppressDepth++
      filtered = true
    }

    const indentMatch = line.match(/^(\s*)/)
    const indent = indentMatch ? indentMatch[1].length : 0
    const nextIndent = outputLines.length > 0 ? (outputLines[outputLines.length - 1].match(/^(\s*)/)?.[1].length ?? 0) : 0

    if (suppressDepth > 0) {
      if (indent <= nextIndent && outputLines.length > 0 && !isGodOnly) {
        suppressDepth = Math.max(0, suppressDepth - 1)
        if (suppressDepth === 0) {
          outputLines.push("[已隐去]")
        }
      }
      continue
    }

    outputLines.push(line)
  }

  if (suppressDepth > 0) {
    outputLines.push("[已隐去]")
    filtered = true
  }

  if (filtered) {
    return outputLines.join("\n")
  }
  return result
}

export const EmbodyTool = Tool.define(
  "embody",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<EmbodyMetadata>) =>
        Effect.gen(function* () {
          const filteredView = filterGodOnly(params.l2View)

          const resultLines: string[] = [
            `## Embodying: ${params.character}`,
            "",
            "### Scene",
            params.situation,
            "",
            "### Your Perspective",
            filteredView,
            "",
            `Respond as ${params.character}. Stay in character at all times. Use the question tool if you need clarification from the player.`,
          ]

          return {
            title: `Embody: ${params.character}`,
            output: resultLines.join("\n"),
            metadata: { character: params.character, filtered: filteredView !== params.l2View },
          }
        }),
    }
  }),
)

export * as Embody from "./embody"