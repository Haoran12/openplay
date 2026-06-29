import { Button } from "@openplay-ai/ui/button"
import { Tooltip } from "@openplay-ai/ui/tooltip"
import { showToast } from "@openplay-ai/ui/toast"
import { useNavigate } from "@solidjs/router"
import { createMemo, createResource, type Component, type JSX, Show } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { ensureSession, upsertSession } from "@/utils/ensure-session"

type SessionTraceToggleProps = {
  class?: string
  style?: JSX.CSSProperties
}

export const SessionTraceToggle: Component<SessionTraceToggleProps> = (props) => {
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const layout = useLayout()
  const local = useLocal()
  const sdk = useSDK()
  const settings = useSettings()
  const sync = useSync()
  const navigate = useNavigate()
  const { params } = useSessionLayout()

  const session = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const traceEnabled = createMemo(() => session()?.trace?.enabled === true)
  const [traceMeta, { refetch: refetchTraceMeta }] = createResource(
    () => params.id,
    async (sessionID) => {
      if (!sessionID) return undefined
      const response = await sdk.client.session.trace({
        sessionID,
        includeSubagents: false,
        limit: 1,
      })
      return response.data?.meta
    },
  )
  const traceAvailable = createMemo(() => traceMeta()?.available ?? true)
  const traceToggleVisible = createMemo(() => settings.trace.showSessionToggle() && !!params.dir)
  const traceTooltip = createMemo(() => {
    if (traceEnabled() && !traceAvailable()) return language.t("trace.header.unavailable")
    if (!traceAvailable()) return language.t("trace.header.enableGlobal")
    return traceEnabled() ? language.t("trace.header.disable") : language.t("trace.header.enable")
  })

  const showRequestError = (err: unknown) => {
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: err instanceof Error ? err.message : String(err),
    })
  }

  const ensureCurrentSession = async () => {
    const directory = sdk.directory
    if (!directory) return
    return ensureSession({
      currentSessionID: params.id,
      directory,
      createSession: async () => {
        const response = await sdk.client.session.create()
        return response.data ?? undefined
      },
      onCreated: (created) => {
        const [, setStore] = globalSync.child(directory)
        setStore("session", (list) => upsertSession(list, created))
      },
      promoteSession: (dir, sessionID) => {
        local.session.promote(dir, sessionID)
      },
      handoffTabs: (directorySlug, sessionID) => {
        layout.handoff.setTabs(directorySlug, sessionID)
      },
      navigate,
    })
  }

  const toggleTrace = async () => {
    const sessionID = await ensureCurrentSession()
    if (!sessionID) return
    const nextEnabled = !traceEnabled()
    try {
      if (nextEnabled && !traceAvailable()) {
        await sdk.client.config.update({
          config: {
            ...sync.data.config,
            server: {
              ...(sync.data.config.server ?? {}),
              trace: {
                ...sync.data.config.server?.trace,
                enabled: true,
              },
            },
          },
        })
      }
      await sdk.client.session.update({
        sessionID,
        trace: { enabled: nextEnabled },
      })
      const response = await sdk.client.session.trace({
        sessionID,
        includeSubagents: false,
        limit: 1,
      })
      void refetchTraceMeta()
      await sync.session.sync(sessionID, { force: true })
      if (response.data?.meta.available === false) {
        showToast({
          variant: "error",
          title: language.t("trace.header.globalStillOff"),
          description: language.t("trace.header.globalStillOffDescription"),
        })
      }
    } catch (err: unknown) {
      showRequestError(err)
    }
  }

  return (
    <Show when={traceToggleVisible()}>
      <Tooltip placement="top" gutter={4} value={traceTooltip()}>
        <Button
          variant="ghost"
          class={props.class}
          style={props.style}
          classList={{
            "border-[var(--color-success)]/30 bg-[color:color-mix(in_srgb,var(--color-success)_16%,transparent)] text-text-strong":
              traceEnabled() && traceAvailable(),
            "border-[var(--syntax-warning)]/35 bg-[color:color-mix(in_srgb,var(--syntax-warning)_14%,transparent)] text-text-strong":
              traceEnabled() && !traceAvailable(),
            "border-border-weak-base bg-surface-panel text-text-weak": !traceEnabled(),
          }}
          onClick={() => void toggleTrace()}
          aria-pressed={traceEnabled()}
          aria-label={traceTooltip()}
        >
          <span
            class="inline-block h-2 w-2 rounded-full"
            classList={{
              "bg-[var(--color-success)]": traceEnabled() && traceAvailable(),
              "bg-[var(--syntax-warning)]": traceEnabled() && !traceAvailable(),
              "bg-border-strong": !traceEnabled(),
            }}
          />
          <span class="text-11-medium">{traceEnabled() ? language.t("trace.status.on") : language.t("trace.status.off")}</span>
        </Button>
      </Tooltip>
    </Show>
  )
}
