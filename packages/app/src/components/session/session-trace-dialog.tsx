import { Button } from "@openplay-ai/ui/button"
import { Dialog } from "@openplay-ai/ui/dialog"
import { Markdown } from "@openplay-ai/ui/markdown"
import { Select } from "@openplay-ai/ui/select"
import { createMemo, createResource, createSignal, For, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { showToast } from "@openplay-ai/ui/toast"
import type { SessionTraceEntry } from "@openplay-ai/sdk/v2/client"
import { traceDetailMarkdown, traceSafeJson } from "./session-trace-format"

type TraceView = "readable" | "raw"

function formatTimestamp(value: number | undefined) {
  if (!value) return ""
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value))
}

export const SessionTraceDialog: Component<{
  sessionID: string
}> = (props) => {
  const language = useLanguage()
  const sdk = useSDK()
  const sync = useSync()
  const settings = useSettings()
  const [selectedID, setSelectedID] = createSignal<string>()
  const [view, setView] = createSignal<TraceView>(settings.trace.defaultView())
  const [source, setSource] = createSignal<"all" | "main" | "subagent" | "tool" | "model">("all")
  const [timeFilter, setTimeFilter] = createSignal<"all" | "1h" | "today">("all")
  const [includeSubagents, setIncludeSubagents] = createSignal(settings.trace.includeSubagentsByDefault())

  const [trace] = createResource(
    () => [props.sessionID, source(), includeSubagents()] as const,
    async ([sessionID, currentSource, currentIncludeSubagents]) => {
      const response = await sdk.client.session.trace({
        sessionID,
        includeSubagents: currentIncludeSubagents,
        ...(currentSource === "all" ? {} : { source: currentSource }),
      })
      return (
        response.data ?? {
          items: [],
          cursor: undefined,
          meta: {
            available: true,
            retentionDays: 7,
          },
        }
      )
    },
  )

  const sourceOptions = createMemo(() => [
    { value: "all" as const, label: language.t("trace.filter.all") },
    { value: "main" as const, label: language.t("trace.filter.main") },
    { value: "subagent" as const, label: language.t("trace.filter.subagent") },
    { value: "tool" as const, label: language.t("trace.filter.tool") },
    { value: "model" as const, label: language.t("trace.filter.model") },
  ])

  const timeFilterOptions = createMemo(() => [
    { value: "all" as const, label: language.t("trace.timeFilter.all") },
    { value: "1h" as const, label: language.t("trace.timeFilter.1h") },
    { value: "today" as const, label: language.t("trace.timeFilter.today") },
  ])

  const items = createMemo<SessionTraceEntry[]>(() => {
    const now = Date.now()
    const oneHourAgo = now - 60 * 60 * 1000
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayTimestamp = todayStart.getTime()

    return (trace.latest?.items ?? [])
      .filter((item) => item.kind !== "llm.stream.event")
      .filter((item) => {
        const filter = timeFilter()
        if (filter === "all") return true
        if (filter === "1h") return item.timestamp >= oneHourAgo
        if (filter === "today") return item.timestamp >= todayTimestamp
        return true
      })
  })
  const traceMeta = createMemo(
    () =>
      trace.latest?.meta ?? {
        available: true,
        retentionDays: 7,
      },
  )
  const selected = createMemo(() => items().find((item) => item.id === selectedID()) ?? items()[0])
  const currentSession = createMemo(() => sync.session.get(props.sessionID))
  const canCopy = () => typeof navigator === "object" && !!navigator.clipboard?.writeText

  const copyEntry = async (entry: SessionTraceEntry) => {
    if (!canCopy()) return
    try {
      await navigator.clipboard.writeText(traceSafeJson(entry))
      showToast({
        variant: "success",
        title: language.t("session.share.copy.copied"),
        description: language.t("trace.copySuccess"),
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return (
    <Dialog
      title={language.t("trace.dialog.title")}
      description={
        currentSession()?.title ??
        language.t("trace.dialog.description", {
          days: String(traceMeta().retentionDays),
        })
      }
      size="x-large"
      containerClass="w-[min(calc(100vw-32px),1380px)] h-[min(calc(100vh-16px),1040px)]"
      class="h-full min-h-0 overflow-hidden"
    >
      <div class="grid h-full min-h-0 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div class="min-h-0 overflow-hidden rounded-xl border border-border-weaker-base bg-surface-panel">
          <div class="border-b border-border-weaker-base px-4 py-3 space-y-3">
            <div class="flex items-center justify-between gap-3">
              <div class="text-12-medium uppercase tracking-wider text-text-weak">{language.t("trace.dialog.entries")}</div>
              <Button
                size="small"
                variant="ghost"
                onClick={() => setIncludeSubagents((value) => !value)}
              >
                {includeSubagents() ? language.t("trace.includeSubagents.on") : language.t("trace.includeSubagents.off")}
              </Button>
            </div>
            <Show when={!traceMeta().available}>
              <div class="rounded-lg border border-border-weaker-base bg-surface-weak px-3 py-2 text-12-regular text-text-weak">
                {language.t("trace.unavailable")}
              </div>
            </Show>
            <div class="flex items-center gap-2">
              <Select
                options={sourceOptions()}
                current={sourceOptions().find((item) => item.value === source())}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => item && setSource(item.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
              <Select
                options={timeFilterOptions()}
                current={timeFilterOptions().find((item) => item.value === timeFilter())}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => item && setTimeFilter(item.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </div>
          </div>
          <div class="h-full min-h-0 overflow-y-auto p-3">
            <Show when={items().length > 0} fallback={<div class="px-2 py-4 text-13-regular text-text-weak">{language.t("trace.empty")}</div>}>
              <div class="flex flex-col gap-3">
                <For each={items()}>
                  {(item) => (
                    <button
                      type="button"
                      class="w-full rounded-xl border px-3 py-3 text-left transition-colors"
                      classList={{
                        "border-border-strong bg-background-base shadow-sm": selected()?.id === item.id,
                        "border-border-weaker-base bg-surface-base hover:bg-background-base": selected()?.id !== item.id,
                      }}
                      onClick={() => setSelectedID(item.id)}
                    >
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <div class="text-13-medium text-text-strong [overflow-wrap:anywhere]">{item.kind}</div>
                          <div class="mt-1 text-12-regular text-text-weak">{formatTimestamp(item.timestamp)}</div>
                        </div>
                        <span class="shrink-0 rounded-full bg-surface-weak px-2 py-0.5 text-11-medium text-text-weak">
                          {item.source}
                        </span>
                      </div>
                      <div class="mt-2 text-12-regular text-text-weak [overflow-wrap:anywhere]">
                        {item.title ?? item.agent ?? item.sessionID}
                      </div>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>

        <div class="min-h-0 overflow-hidden rounded-xl border border-border-weaker-base bg-background-base">
          <Show when={selected()} fallback={<div class="px-6 py-8 text-13-regular text-text-weak">{language.t("trace.empty")}</div>}>
            {(entry) => (
              <div class="flex h-full min-h-0 flex-col">
                <div class="border-b border-border-weaker-base px-5 py-4">
                  <div class="flex items-start justify-between gap-4">
                    <div class="min-w-0">
                      <div class="text-15-medium text-text-strong [overflow-wrap:anywhere]">{entry().kind}</div>
                      <div class="mt-1 text-12-regular text-text-weak [overflow-wrap:anywhere]">
                        {formatTimestamp(entry().timestamp)} · {entry().source} · {entry().title ?? entry().sessionID}
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <Button size="small" variant={view() === "readable" ? "secondary" : "ghost"} onClick={() => setView("readable")}>
                        {language.t("trace.view.readable")}
                      </Button>
                      <Button size="small" variant={view() === "raw" ? "secondary" : "ghost"} onClick={() => setView("raw")}>
                        {language.t("trace.view.raw")}
                      </Button>
                      <Button size="small" variant="ghost" disabled={!canCopy()} onClick={() => void copyEntry(entry())}>
                        {language.t("trace.copy")}
                      </Button>
                    </div>
                  </div>
                </div>
                <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  <Markdown
                    text={traceDetailMarkdown(entry(), view(), settings.trace.defaultReadableSections())}
                    class="text-13-regular leading-6"
                    data-roleplay-audit-detail
                  />
                </div>
              </div>
            )}
          </Show>
        </div>
      </div>
      <style>{`
        [data-component="dialog"] [data-component="markdown"][data-roleplay-audit-detail] pre,
        [data-component="dialog"] [data-component="markdown"][data-roleplay-audit-detail] code,
        [data-component="dialog"] [data-component="markdown"][data-roleplay-audit-detail] .shiki {
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
      `}</style>
    </Dialog>
  )
}
