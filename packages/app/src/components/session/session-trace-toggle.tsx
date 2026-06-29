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
            "border-border-weak-base bg-surface-panel text-text-strong": traceEnabled(),
            "border-border-weak-base bg-surface-panel text-text-weak": !traceEnabled(),
          }}
          onClick={() => void toggleTrace()}
          aria-pressed={traceEnabled()}
          aria-label={traceTooltip()}
        >
          <span
            class="inline-block h-3.5 w-3.5 rounded-full border-2"
            classList={{
              "border-[#0B5D1E] bg-[#22C55E] shadow-[0_0_0_1px_rgba(255,255,255,0.92),0_0_0_4px_rgba(34,197,94,0.28)]":
                traceEnabled() && traceAvailable(),
              "border-[#9A6700] bg-[#F59E0B] shadow-[0_0_0_1px_rgba(255,255,255,0.92)]":
                traceEnabled() && !traceAvailable(),
              "border-[#5C6370] bg-[#9CA3AF] shadow-[0_0_0_1px_rgba(255,255,255,0.92)]":
                !traceEnabled(),
            }}
          />
          <span class="text-11-medium">{language.t("trace.header.label")}</span>
        </Button>
      </Tooltip>
    </Show>
  )
}
