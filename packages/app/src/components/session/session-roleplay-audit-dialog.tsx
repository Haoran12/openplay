import { Dialog } from "@openplay-ai/ui/dialog"
import { Button } from "@openplay-ai/ui/button"
import { Markdown } from "@openplay-ai/ui/markdown"
import { createMemo, createResource, createSignal, For, Match, Show, Switch, type Component } from "solid-js"
import type { Message, Part, Session } from "@openplay-ai/sdk/v2/client"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"

type AuditScope = "main" | "subagent" | "tool"
type AuditCardKind = "request" | "response"

type AuditCard = {
  id: string
  sessionID: string
  sessionTitle: string
  directory: string
  timestamp: number
  scope: AuditScope
  kind: AuditCardKind
  actor: string
  label: string
  summary?: string
  requestText?: string
  responseText?: string
  toolName?: string
}

const INITIAL_VISIBLE_CARD_LIMIT = 160

function trimText(value: string | undefined) {
  const next = value?.trim()
  return next ? next : undefined
}

function firstLine(value: string | undefined, max = 120) {
  const text = trimText(value)
  if (!text) return undefined
  const line = text.split(/\r?\n/, 1)[0]?.trim() ?? ""
  if (!line) return undefined
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function readTextParts(parts: Part[] | undefined) {
  return trimText(
    (parts ?? [])
      .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n\n"),
  )
}

function readReasoningParts(parts: Part[] | undefined) {
  return trimText(
    (parts ?? [])
      .filter((part): part is Extract<Part, { type: "reasoning" }> => part.type === "reasoning")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n\n"),
  )
}

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

function prettifyJson(value: string | undefined) {
  const text = trimText(value)
  if (!text) return undefined
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function normalizeToolInput(value: unknown) {
  if (value === undefined) return undefined
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function scopeLabel(scope: AuditScope, session: Session, toolName?: string) {
  if (scope === "main") return "Main session"
  if (scope === "tool") return toolName ? `Tool: ${toolName}` : "Tool call"
  const character =
    session.title.startsWith("Character: ") ? session.title.replace(/^Character:\s*/, "").trim() : session.title
  return `SubAgent: ${character || session.title}`
}

function inferSessionScope(session: Session, toolName?: string): AuditScope {
  if (toolName) return "tool"
  if (session.parentID) return "subagent"
  return "main"
}

function buildMessageCards(session: Session, message: Message, parts: Part[] | undefined): AuditCard[] {
  if (message.role !== "user" && message.role !== "assistant") return []

  const scope = inferSessionScope(session)
  const directory = session.directory
  const timestamp = message.role === "assistant" ? (message.time.completed ?? message.time.created) : message.time.created
  const actor = session.parentID
    ? session.title.replace(/^Character:\s*/, "").trim() || session.title
    : (message.agent || session.agent || "Director")

  if (message.role === "user") {
    const requestText = readTextParts(parts)
    if (!requestText) return []
    return [
      {
        id: `${message.id}:request`,
        sessionID: session.id,
        sessionTitle: session.title,
        directory,
        timestamp,
        scope,
        kind: "request",
        actor,
        label: scopeLabel(scope, session),
        summary: firstLine(requestText),
        requestText,
      },
    ]
  }

  const responseText = readTextParts(parts)
  const reasoning = readReasoningParts(parts)
  const summary = firstLine(responseText) ?? firstLine(reasoning)
  const cards: AuditCard[] = []

  if (responseText || reasoning) {
    cards.push({
      id: `${message.id}:response`,
      sessionID: session.id,
      sessionTitle: session.title,
      directory,
      timestamp,
      scope,
      kind: "response",
      actor,
      label: scopeLabel(scope, session),
      summary,
      responseText: [responseText, reasoning ? `## Reasoning\n\n${reasoning}` : undefined].filter(Boolean).join("\n\n"),
    })
  }

  for (const part of parts ?? []) {
    if (part.type !== "tool") continue
    const toolName = part.tool
    if (part.state.status === "pending" || part.state.status === "running") continue
    const inputText = normalizeToolInput(part.state.input)
    const outputText =
      part.state.status === "completed"
        ? prettifyJson(part.state.output)
        : part.state.status === "error"
          ? trimText(part.state.error)
          : undefined
    if (!inputText && !outputText) continue
    cards.push({
      id: `${message.id}:${part.id}`,
      sessionID: session.id,
      sessionTitle: session.title,
      directory,
      timestamp,
      scope: "tool",
      kind: "response",
      actor,
      label: scopeLabel("tool", session, toolName),
      summary: firstLine(outputText) ?? firstLine(inputText),
      requestText: inputText,
      responseText: outputText,
      toolName,
    })
  }

  return cards
}

function detailMarkdown(card: AuditCard, language: ReturnType<typeof useLanguage>) {
  const sections: string[] = []
  sections.push(`## ${card.kind === "request" ? language.t("roleplay.audit.request") : language.t("roleplay.audit.response")}`)
  sections.push(
    [
      `${language.t("roleplay.audit.directory")}: \`${card.directory}\``,
      `${language.t("roleplay.audit.time")}: ${formatTimestamp(card.timestamp) || language.t("common.unknown")}`,
      `${language.t("roleplay.audit.scope")}: ${card.label}`,
      `${language.t("roleplay.audit.session")}: ${card.sessionTitle}`,
      `${language.t("roleplay.audit.actor")}: ${card.actor}`,
    ].join("\n\n"),
  )

  if (card.requestText) {
    sections.push(`## ${language.t("roleplay.audit.requestContent")}`)
    sections.push(`\`\`\`text\n${card.requestText}\n\`\`\``)
  }

  if (card.responseText) {
    sections.push(`## ${language.t("roleplay.audit.responseContent")}`)
    sections.push(`\`\`\`text\n${card.responseText}\n\`\`\``)
  }

  return sections.join("\n\n")
}

export const SessionRoleplayAuditDialog: Component<{
  sessionID: string
}> = (props) => {
  const language = useLanguage()
  const sync = useSync()
  const [selectedID, setSelectedID] = createSignal<string>()
  const [loadingMore, setLoadingMore] = createSignal(false)

  const rootSession = createMemo(() => sync.session.get(props.sessionID))

  const childSessions = createMemo(() =>
    (sync.data.session ?? []).filter((session) => session.parentID === props.sessionID && session.title.startsWith("Character: ")),
  )

  const knownSessions = createMemo(() => {
    const root = rootSession()
    return root ? [root, ...childSessions()] : childSessions()
  })

  const knownSessionKey = createMemo(() =>
    knownSessions()
      .map((session) => session.id)
      .sort()
      .join("\n"),
  )

  const [loading] = createResource(
    knownSessionKey,
    async (sessionKey) => {
      const sessionIDs = sessionKey
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean)
      await Promise.all(
        sessionIDs.map(async (sessionID) => {
          await sync.session.sync(sessionID)
        }),
      )
      return true
    },
  )

  const allCards = createMemo(() => {
    const list = knownSessions().flatMap((session) => {
      const messages = sync.data.message[session.id] ?? []
      return messages.flatMap((message) => buildMessageCards(session, message, sync.data.part[message.id]))
    })
    return [...list].sort((a, b) => {
      if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp
      return a.id.localeCompare(b.id)
    })
  })

  const cards = createMemo(() => allCards().slice(0, INITIAL_VISIBLE_CARD_LIMIT))

  const hasMoreHistory = createMemo(() => knownSessions().some((session) => sync.session.history.more(session.id)))

  const loadOlderHistory = async () => {
    if (loadingMore()) return
    setLoadingMore(true)
    try {
      await Promise.all(
        knownSessions().map(async (session) => {
          if (!sync.session.history.more(session.id)) return
          await sync.session.history.loadMore(session.id, 120)
        }),
      )
    } finally {
      setLoadingMore(false)
    }
  }

  const selected = createMemo(() => {
    const current = selectedID()
    return cards().find((card) => card.id === current) ?? cards()[0]
  })

  return (
    <Dialog
      title={language.t("roleplay.audit.title")}
      description={language.t("roleplay.audit.description")}
      size="x-large"
      fit
      class="w-[min(calc(100vw-32px),1240px)] h-[min(calc(100vh-24px),920px)] overflow-hidden"
    >
      <div
        class="grid h-full min-h-0 grid-cols-[400px_minmax(0,1fr)] gap-4"
        style={{
          "--roleplay-audit-wrap": "break-word",
        }}
      >
        <div class="min-h-0 overflow-hidden rounded-xl border border-border-weaker-base bg-surface-panel">
          <div class="border-b border-border-weaker-base px-4 py-3">
            <div class="flex items-center justify-between gap-3">
              <div class="text-12-medium uppercase tracking-wider text-text-weak">{language.t("roleplay.audit.entries")}</div>
              <Show when={hasMoreHistory()}>
                <Button variant="ghost" size="small" onClick={loadOlderHistory} disabled={loadingMore()}>
                  {loadingMore() ? language.t("roleplay.audit.loadingMore") : language.t("roleplay.audit.loadOlder")}
                </Button>
              </Show>
            </div>
          </div>
          <div class="h-full min-h-0 overflow-y-auto p-3">
            <Show
              when={!loading.loading}
              fallback={<div class="px-2 py-4 text-13-regular text-text-weak">{language.t("roleplay.audit.loading")}</div>}
            >
              <Show
                when={cards().length > 0}
                fallback={<div class="px-2 py-4 text-13-regular text-text-weak">{language.t("roleplay.audit.empty")}</div>}
              >
                <div class="flex flex-col gap-3">
                  <For each={cards()}>
                    {(card) => (
                      <button
                        type="button"
                        class="w-full rounded-xl border px-3 py-3 text-left transition-colors"
                        classList={{
                          "border-border-strong bg-background-base shadow-sm": selected()?.id === card.id,
                          "border-border-weaker-base bg-surface-base hover:bg-background-base": selected()?.id !== card.id,
                        }}
                        onClick={() => setSelectedID(card.id)}
                      >
                        <div class="flex items-start justify-between gap-3">
                          <div class="min-w-0">
                            <div class="text-13-medium text-text-strong">{card.label}</div>
                            <div class="mt-1 text-12-regular text-text-weak">{formatTimestamp(card.timestamp)}</div>
                          </div>
                          <span class="shrink-0 rounded-full bg-surface-weak px-2 py-0.5 text-11-medium text-text-weak">
                            {card.kind === "request"
                              ? language.t("roleplay.audit.request")
                              : language.t("roleplay.audit.response")}
                          </span>
                        </div>
                        <div class="mt-2 text-12-regular text-text-weak">{card.directory}</div>
                        <Show when={card.summary}>
                          <p class="mt-3 line-clamp-3 text-13-regular text-text-base">{card.summary}</p>
                        </Show>
                      </button>
                    )}
                  </For>
                  <Show when={allCards().length > cards().length}>
                    <div class="px-2 py-1 text-12-regular text-text-weak">
                      {language.t("roleplay.audit.showingRecent", {
                        count: String(cards().length),
                        total: String(allCards().length),
                      })}
                    </div>
                  </Show>
                </div>
              </Show>
            </Show>
          </div>
        </div>

        <div class="min-h-0 overflow-hidden rounded-xl border border-border-weaker-base bg-background-base">
          <Show
            when={selected()}
            fallback={<div class="px-6 py-8 text-13-regular text-text-weak">{language.t("roleplay.audit.empty")}</div>}
          >
            {(card) => (
              <div class="flex h-full min-h-0 flex-col">
                <div class="border-b border-border-weaker-base px-5 py-4">
                  <div class="flex items-start justify-between gap-4">
                    <div class="min-w-0">
                      <div class="text-15-medium text-text-strong">{card().label}</div>
                      <div class="mt-1 text-12-regular text-text-weak">
                        {formatTimestamp(card().timestamp)} · {card().sessionTitle}
                      </div>
                    </div>
                    <Switch>
                      <Match when={card().toolName}>
                        <span class="rounded-full bg-surface-weak px-2.5 py-1 text-11-medium text-text-weak">
                          {card().toolName}
                        </span>
                      </Match>
                    </Switch>
                  </div>
                </div>
                <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  <Markdown
                    text={detailMarkdown(card(), language)}
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
        [data-component="dialog"] [data-component="markdown"][data-roleplay-audit-detail] {
          min-width: 0;
        }

        [data-component="dialog"] [data-component="markdown"][data-roleplay-audit-detail] pre,
        [data-component="dialog"] [data-component="markdown"][data-roleplay-audit-detail] code,
        [data-component="dialog"] [data-component="markdown"][data-roleplay-audit-detail] .shiki {
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        [data-component="dialog"] [data-component="markdown"][data-roleplay-audit-detail] pre {
          overflow-x: hidden;
        }
      `}</style>
    </Dialog>
  )
}
