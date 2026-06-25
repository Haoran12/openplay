import { For, Show, createMemo } from "solid-js"
import { Markdown } from "@openplay-ai/ui/markdown"
import { useLanguage } from "@/context/language"
import type { NarrativeEntry } from "@/utils/roleplay"

export function NarrativeReader(props: {
  entries: NarrativeEntry[]
  activeMessageID?: string
  onJump?: (messageID: string) => void
}) {
  const language = useLanguage()
  const total = createMemo(() => props.entries.length)
  const activeIndex = createMemo(() => {
    if (!props.activeMessageID) return total() > 0 ? total() - 1 : -1
    return props.entries.findIndex((entry) => entry.messageID === props.activeMessageID)
  })
  const progress = createMemo(() => {
    if (total() <= 0) return 0
    const index = activeIndex()
    if (index < 0) return 0
    return Math.max(0, Math.min(100, Math.round(((index + 1) / total()) * 100)))
  })

  return (
    <div class="w-full flex flex-col gap-4">
      <div class="sticky top-[calc(var(--session-title-height)+8px)] z-20 px-4 md:px-5">
        <div class="rounded-xl border border-border-weaker-base bg-[color-mix(in_srgb,var(--surface-raised-stronger-non-alpha)_92%,transparent)] backdrop-blur-sm p-3">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-12-medium text-text-weak uppercase tracking-wider">
                {language.t("roleplay.reader.title")}
              </div>
              <div class="text-13-regular text-text-base">
                {language.t("roleplay.reader.chapterCount", { count: String(total()) })}
              </div>
            </div>
            <div class="text-12-medium text-text-weak">{progress()}%</div>
          </div>
          <div class="mt-3 h-1.5 rounded-full bg-surface-weak overflow-hidden">
            <div
              class="h-full rounded-full bg-text-strong transition-[width] duration-200"
              style={{ width: `${progress()}%` }}
            />
          </div>
        </div>
      </div>

      <Show
        when={props.entries.length > 0}
        fallback={
          <div class="px-4 md:px-5">
            <div class="rounded-xl border border-dashed border-border-weaker-base bg-surface-base p-6 text-14-regular text-text-weak italic">
              {language.t("roleplay.reader.empty")}
            </div>
          </div>
        }
      >
        <div class="flex flex-col gap-8 px-4 md:px-5">
          <For each={props.entries}>
            {(entry, index) => (
              <article
                class="w-full max-w-3xl mx-auto"
                data-message-id={entry.messageID}
                data-active={entry.messageID === props.activeMessageID || undefined}
              >
                <Show when={entry.metaLabel || entry.timestampLabel || entry.heading}>
                  <div class="mb-3 flex flex-col gap-1">
                    <div class="flex items-center justify-between gap-3">
                      <div class="text-12-medium text-text-weak uppercase tracking-wider">
                        {language.t("roleplay.reader.chapter", { number: String(index() + 1) })}
                      </div>
                      <Show when={entry.timestampLabel}>
                        <div class="text-12-regular text-text-weak">{entry.timestampLabel}</div>
                      </Show>
                    </div>
                    <Show when={entry.heading}>
                      <h2 class="text-20-medium text-text-strong">{entry.heading}</h2>
                    </Show>
                    <Show when={entry.metaLabel}>
                      <div class="text-12-regular text-text-weak">{entry.metaLabel}</div>
                    </Show>
                  </div>
                </Show>
                <div data-component="narrative-output">
                  <Markdown text={entry.output} />
                </div>
                <Show when={props.onJump}>
                  <button
                    class="mt-3 text-12-medium text-text-interactive-base hover:text-text-interactive-hover transition-colors"
                    onClick={() => props.onJump?.(entry.messageID)}
                  >
                    {language.t("roleplay.reader.jumpToTurn")}
                  </button>
                </Show>
              </article>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
