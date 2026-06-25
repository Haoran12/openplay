import { Effect } from "effect"
import type { AppFileSystem } from "@openplay-ai/core/filesystem"
import path from "path"

/**
 * Load a prompt template from the world's prompts/ directory.
 * Falls back to the built-in default if the world prompt doesn't exist.
 */
export const loadPrompt = Effect.fn("PromptLoader.loadPrompt")(
  function* (
    fs: AppFileSystem.Interface,
    worldPath: string | undefined,
    promptName: string,
    defaultContent: string,
  ) {
    if (!worldPath) return defaultContent

    const promptPath = path.join(worldPath, "prompts", `${promptName}.txt`)
    const content = yield* fs.readFileStringSafe(promptPath).pipe(
      Effect.catch(() => Effect.succeed(undefined)),
    )

    return content?.trim() ? content.trim() : defaultContent
  },
)

export * as PromptLoader from "./loader"
