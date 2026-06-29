import { createResource, createMemo, createSignal, For, Show, type Component } from "solid-js"
import type { Agent, Message, Part, ToolPart, UserMessage, WorldInfo } from "@openplay-ai/sdk/v2/client"
import { Dialog } from "@openplay-ai/ui/dialog"
import { Markdown } from "@openplay-ai/ui/markdown"
import { Button } from "@openplay-ai/ui/button"
import { Tooltip } from "@openplay-ai/ui/tooltip"
import { showToast } from "@openplay-ai/ui/toast"
import { useNavigate } from "@solidjs/router"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import { useFile } from "@/context/file"
import { useSDK } from "@/context/sdk"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { useSettings } from "@/context/settings"
import { useDialog } from "@openplay-ai/ui/context/dialog"
import { useSessionLayout } from "@/pages/session/session-layout"
import { agentDisplayName } from "@/utils/roleplay"
import { agentColor } from "@/utils/agent"
import { ensureSession, upsertSession } from "@/utils/ensure-session"
import { SessionTraceDialog } from "@/components/session/session-trace-dialog"

type RuntimeCharacter = NonNullable<WorldInfo["presentCharacters"]>[number]
const ROLEPLAY_PANEL_WIDTH = "clamp(340px, 30vw, 460px)"

type CharacterReplay = {
  input?: string
  speech?: string
  actionIntent?: string
  outwardAction?: string
  innerThought?: string
}

type SceneHistoryItem = {
  path: string
  date?: string
  location?: string
  impression?: string
  presentCharacters: string[]
  raw: string
}

type ProfilePreview = {
  title: string
  path: string
  content?: string
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function scalarToString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  const record = readObject(value)
  if (!record) return undefined
  for (const key of ["current", "content", "value", "text"]) {
    const parsed = scalarToString(record[key])
    if (parsed) return parsed
  }
}

function parseSceneObject(value: unknown) {
  const scene = readObject(value)
  if (!scene) return
  const result = {
    date: scalarToString(scene.date),
    location: scalarToString(scene.location),
    impression: scalarToString(scene.impression),
  }
  return result.date || result.location || result.impression ? result : undefined
}

function parseRuntimeScene(runtime: Record<string, unknown>) {
  const scene = parseSceneObject(runtime.current_scene)
  const environment = readObject(runtime.environment)
  const result = {
    date:
      scene?.date ??
      scalarToString(runtime.current_date) ??
      scalarToString(runtime.currentDate) ??
      scalarToString(runtime.date) ??
      scalarToString(environment?.time),
    location: scene?.location ?? scalarToString(runtime.current_scene) ?? scalarToString(environment?.location),
    impression: scene?.impression,
  }
  return result.date || result.location || result.impression ? result : undefined
}

function parsePresentCharacters(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry === "string") return entry.trim() ? [entry.trim()] : []
    const record = readObject(entry)
    const name = scalarToString(record?.name)
    return name ? [name] : []
  })
}

function parseRuntimePresentCharacters(runtime: Record<string, unknown>) {
  const topLevel = parsePresentCharacters(runtime.present_characters)
  if (topLevel.length > 0) return topLevel
  const currentScene = readObject(runtime.current_scene)
  return parsePresentCharacters(currentScene?.present_characters)
}

function parseSceneHistoryText(path: string, raw: string): SceneHistoryItem {
  const date =
    raw.match(/^\s*(?:current_date|currentDate|date)\s*:\s*(.+)\s*$/m)?.[1]?.trim() ||
    raw.match(/^\s*time\s*:\s*(.+)\s*$/m)?.[1]?.trim()
  const location =
    raw.match(/^\s*location\s*:\s*(.+)\s*$/m)?.[1]?.trim() ||
    raw.match(/^\s*current_scene\s*:\s*(.+)\s*$/m)?.[1]?.trim()
  const impression = raw.match(/^\s*impression\s*:\s*(.+)\s*$/m)?.[1]?.trim()
  const presentCharacters = [...raw.matchAll(/^\s*-\s*(.+)\s*$/gm)].map((match) => match[1]!.trim()).filter(Boolean)
  return { path, date, location, impression, presentCharacters, raw }
}

function extractText(parts: Part[] | undefined) {
  return (parts ?? [])
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim()
}

function parseCharacterReplayOutput(text: string | undefined) {
  if (!text) return
  const cleaned = text.trim()
  if (!cleaned) return
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>
    return {
      innerThought: scalarToString(parsed.inner_thought),
      speech: scalarToString(parsed.speech),
      actionIntent: scalarToString(parsed.action_intent),
      outwardAction: scalarToString(parsed.outward_action),
    } satisfies CharacterReplay
  } catch {
    return { speech: cleaned } satisfies CharacterReplay
  }
}

function profilePathFromStatePath(statePath: string | undefined) {
  if (!statePath) return undefined
  if (statePath.endsWith("/profile.yaml")) return statePath
  if (statePath.endsWith("/profile.yml")) return statePath.replace(/\.yml$/, ".yaml")
  const i = statePath.lastIndexOf("/")
  if (i < 0) return undefined
  return `${statePath.slice(0, i)}/profile.yaml`
}

const CharacterProfileDialog: Component<{
  profile: ProfilePreview
}> = (props) => {
  return (
    <Dialog
      title={props.profile.title}
      description={props.profile.path}
      size="x-large"
      fit
      class="w-[min(calc(100vw-40px),920px)] h-[min(calc(100vh-40px),760px)] overflow-hidden"
    >
      <div class="h-full min-h-0 overflow-auto rounded-lg border border-border-weaker-base bg-background-base p-4">
        <Markdown
          text={`\`\`\`yaml\n${props.profile.content?.trim() || "（空文件）"}\n\`\`\``}
          class="text-13-regular"
        />
      </div>
    </Dialog>
  )
}

const CharacterFacts: Component<{ character: RuntimeCharacter }> = (props) => {
  const rows = () =>
    [
      { label: "Age", value: props.character.age },
      { label: "Appearance", value: props.character.appearance },
      { label: "Activity", value: props.character.activity },
      { label: "State", value: props.character.state },
      { label: "Knowledge", value: props.character.knowledge },
      { label: "Commitment", value: props.character.commitment },
      { label: "Note", value: props.character.note },
    ].filter((row) => !!row.value)

  return (
    <Show when={rows().length > 0}>
      <div class="mt-2 flex flex-col gap-2">
        <For each={rows()}>
          {(row) => (
            <div class="flex gap-2 text-13-regular leading-5">
              <span class="shrink-0 text-12-medium text-text-weak whitespace-nowrap">{row.label}:</span>
              <p class="min-w-0 text-text-base whitespace-pre-wrap">{row.value}</p>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}

const RuntimeCharacterCard: Component<{ character: RuntimeCharacter }> = (props) => {
  return (
    <div class="p-3">
      <div class="text-14-medium text-text-strong">{props.character.name}</div>
      <CharacterFacts character={props.character} />
    </div>
  )
}

const CharacterCard: Component<{
  agent: Agent
  replay?: CharacterReplay
  onOpenProfile?: () => void
  onEdit?: () => void
  onOpenDirectory?: () => void
}> = (props) => {
  const language = useLanguage()
  const [expanded, setExpanded] = createSignal(false)
  const name = () => agentDisplayName(props.agent)
  const color = () => agentColor(props.agent.name, props.agent.color)
  const persona = () => {
    const p = props.agent.persona ?? ""
    const lines = p.split("\n")
    return lines.length > 1 ? lines.slice(1).join("\n").trim() : ""
  }
  const senses = () => props.agent.senses
  const knowledgeAccess = () => props.agent.knowledgeAccess
  const statePath = () => props.agent.statePath

  return (
    <div class="border-b border-border-weaker-base last:border-b-0">
      <div class="w-full flex items-center gap-3 px-3 py-2.5">
        <div class="relative shrink-0">
          <span
            class="block w-3 h-3 rounded-full ring-2 ring-offset-1 ring-offset-background-base"
            style={{ background: color(), "--ring-color": color() } as any}
          />
          <span class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[var(--color-success)] border border-background-base" />
        </div>
        <div class="flex-1 min-w-0">
          <button
            class="block max-w-full text-14-medium text-text-strong truncate text-left hover:text-text-interactive-base transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              props.onOpenProfile?.()
            }}
          >
            {name()}
          </button>
          <Show when={props.agent.persona}>
            <div class="text-12-regular text-text-weak truncate">{props.agent.persona!.split("\n")[0]?.trim()}</div>
          </Show>
        </div>
        <button
          class="shrink-0 text-text-weak hover:text-text-strong transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded(!expanded())
          }}
          aria-label={expanded() ? "Collapse character details" : "Expand character details"}
        >
          <svg
            class="transition-transform"
            classList={{ "rotate-90": expanded() }}
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
      <Show when={expanded()}>
        <div class="px-3 pb-3 flex flex-col gap-3">
          <Show when={persona()}>
            <div class="flex gap-2 text-13-regular leading-5">
              <span class="shrink-0 text-12-medium text-text-weak whitespace-nowrap">Persona:</span>
              <p class="min-w-0 text-text-base whitespace-pre-wrap">{persona()}</p>
            </div>
          </Show>
          <Show when={senses() && Object.keys(senses()!).length > 0}>
            <div class="flex gap-2 text-13-regular leading-5">
              <span class="shrink-0 text-12-medium text-text-weak whitespace-nowrap">Senses:</span>
              <p class="min-w-0 text-text-base">
                {Object.entries(senses()!)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(", ")}
              </p>
            </div>
          </Show>
          <Show when={knowledgeAccess() && knowledgeAccess()!.length > 0}>
            <div class="flex gap-2 text-13-regular leading-5">
              <span class="shrink-0 text-12-medium text-text-weak whitespace-nowrap">Knowledge:</span>
              <p class="min-w-0 text-text-base">{knowledgeAccess()!.join(", ")}</p>
            </div>
          </Show>
          <Show when={statePath()}>
            <div class="flex gap-2 text-13-regular leading-5">
              <span class="shrink-0 text-12-medium text-text-weak whitespace-nowrap">State:</span>
              <p class="min-w-0 text-text-base font-mono">{statePath()}</p>
            </div>
          </Show>
          <Show when={props.replay}>
            {(replay) => (
              <div class="rounded-lg border border-border-weaker-base bg-background-base p-3 flex flex-col gap-3">
                <div class="text-12-medium text-text-weak">{language.t("roleplay.panel.latestEmbodiment")}</div>
                <div class="grid grid-cols-1 gap-3">
                  <div>
                    <div class="text-11-medium text-text-weak uppercase tracking-wider mb-1">
                      {language.t("roleplay.panel.input")}
                    </div>
                    <p class="text-13-regular text-text-base whitespace-pre-wrap">
                      {replay().input || language.t("roleplay.panel.noEmbodiment")}
                    </p>
                  </div>
                  <div>
                    <div class="text-11-medium text-text-weak uppercase tracking-wider mb-1">
                      {language.t("roleplay.panel.output")}
                    </div>
                    <div class="text-13-regular text-text-base whitespace-pre-wrap flex flex-col gap-1">
                      <Show when={replay().speech}>
                        <p>{language.t("roleplay.panel.speech")}: {replay().speech}</p>
                      </Show>
                      <Show when={replay().outwardAction}>
                        <p>{language.t("roleplay.panel.outwardAction")}: {replay().outwardAction}</p>
                      </Show>
                      <Show when={replay().actionIntent}>
                        <p>{language.t("roleplay.panel.actionIntent")}: {replay().actionIntent}</p>
                      </Show>
                      <Show when={replay().innerThought}>
                        <p>{language.t("roleplay.panel.innerThought")}: {replay().innerThought}</p>
                      </Show>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Show>
          <Show when={props.onEdit || props.onOpenDirectory}>
            <div class="flex flex-wrap gap-3">
              <Show when={props.onEdit}>
                <button
                  class="text-12-medium text-text-interactive-base hover:text-text-interactive-hover transition-colors text-left"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onEdit?.()
                  }}
                >
                  {language.t("roleplay.panel.editProfile")}
                </button>
              </Show>
              <Show when={props.onOpenDirectory}>
                <button
                  class="text-12-medium text-text-interactive-base hover:text-text-interactive-hover transition-colors text-left"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onOpenDirectory?.()
                  }}
                >
                  {language.t("roleplay.panel.openCharacterDirectory")}
                </button>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}

const CharacterWithRuntimeCard: Component<{
  agent: Agent
  character: RuntimeCharacter
  replay?: CharacterReplay
  onOpenProfile?: () => void
  onEdit?: () => void
  onOpenDirectory?: () => void
}> = (props) => {
  return (
    <div>
      <CharacterCard agent={props.agent} replay={props.replay} onOpenProfile={props.onOpenProfile} onEdit={props.onEdit} onOpenDirectory={props.onOpenDirectory} />
      <div class="px-3 pb-1">
        <CharacterFacts character={props.character} />
      </div>
    </div>
  )
}

export const SessionRoleplayPanel: Component = () => {
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const file = useFile()
  const layout = useLayout()
  const settings = useSettings()
  const dialog = useDialog()
  const navigate = useNavigate()
  const { params, tabs, view } = useSessionLayout()

  const world = () => sync.data.path.world
  const scene = () => world()?.scene
  const currentScene = () => world()?.currentScene
  const presentCharacters = () => world()?.presentCharacters ?? []
  const sessionID = createMemo(() => params.id)
  const session = createMemo(() => {
    const id = sessionID()
    return id ? sync.session.get(id) : undefined
  })
  const traceEnabled = createMemo(() => session()?.trace?.enabled === true)
  const [traceMeta, { refetch: refetchTraceMeta }] = createResource(
    sessionID,
    async (id) => {
      if (!id) return undefined
      const response = await sdk.client.session.trace({
        sessionID: id,
        includeSubagents: false,
        limit: 1,
      })
      return response.data?.meta
    },
  )
  const traceAvailable = createMemo(() => traceMeta()?.available ?? true)
  const traceRetentionDays = createMemo(() => traceMeta()?.retentionDays ?? 7)
  const traceToggleVisible = createMemo(() => settings.trace.showSessionToggle() && !!params.dir)
  const worldRoot = createMemo(() => world()?.rootPath)
  const worldConfigPath = createMemo(() => world()?.configPath)

  const allAgents = () => sync.data.agent ?? []
  const agentsByName = createMemo(() => new Map(allAgents().map((agent) => [agent.name, agent] as const)))

  const openFile = (path: string) => {
    const tab = file.tab(path)
    tabs().open(tab)
    void file.load(path)
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
    tabs().setActive(tab)
  }

  const revealDirectory = async (path: string) => {
    layout.fileTree.setTab("all")
    if (!layout.fileTree.opened()) layout.fileTree.open()
    const parts = path.split("/").filter(Boolean)
    let current = ""
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      await file.tree.list(current === part ? "" : current.replace(/\/[^/]+$/, ""))
      file.tree.expand(current)
    }
  }

  const openCharacterDirectory = (path: string | undefined) => {
    if (!path) return
    const match = path.match(/^(characters\/[^/]+)/)
    if (!match) return
    void revealDirectory(match[1]!)
  }

  const openCharacterProfile = (statePath: string | undefined, name: string) => {
    const profilePath = profilePathFromStatePath(statePath)
    if (!profilePath) return
    void (async () => {
      const content = await sdk.client.file.read({ path: profilePath }).then((response) => response.data).catch(() => undefined)
      if (!content || content.type !== "text") return
      dialog.show(() => (
        <CharacterProfileDialog
          profile={{
            title: name,
            path: profilePath,
            content: content.content,
          }}
        />
      ))
    })()
  }

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
      currentSessionID: sessionID(),
      directory,
      createSession: async () => {
        const response = await sdk.client.session.create()
        return response.data ?? undefined
      },
      onCreated: (session) => {
        const [, setStore] = globalSync.child(directory)
        setStore("session", (list) => upsertSession(list, session))
      },
      promoteSession: (dir, id) => {
        local.session.promote(dir, id)
      },
      handoffTabs: (directorySlug, id) => {
        layout.handoff.setTabs(directorySlug, id)
      },
      navigate,
    })
  }

  const toggleTrace = async () => {
    const id = await ensureCurrentSession()
    if (!id) return
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
        sessionID: id,
        trace: { enabled: nextEnabled },
      })
      const response = await sdk.client.session.trace({
        sessionID: id,
        includeSubagents: false,
        limit: 1,
      })
      void refetchTraceMeta()
      await sync.session.sync(id, { force: true })
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

  const sceneRows = createMemo(() => {
    const info = scene()
    return [
      { label: "Date", value: info?.date },
      { label: "Location", value: info?.location ?? currentScene() },
      { label: "Impression", value: info?.impression },
    ].filter((row) => !!row.value)
  })

  const childSessionsByName = createMemo(() => {
    const rootID = sessionID()
    if (!rootID) return new Map<string, string>()
    return new Map(
      (sync.data.session ?? [])
        .filter((item) => item.parentID === rootID && item.title?.startsWith("Character: "))
        .map((item) => [item.title.replace(/^Character:\s*/, "").trim(), item.id] as const),
    )
  })

  const embodySubagentByName = createMemo(() => {
    const map = new Map<string, string>()
    const id = sessionID()
    if (!id) return map
    const messages = sync.data.message[id] ?? []
    for (const message of messages) {
      if (message.role !== "assistant") continue
      const parts = sync.data.part[message.id] ?? []
      for (const part of parts) {
        if (part.type !== "tool" || part.tool !== "embody" || part.state.status !== "completed") continue
        const character = scalarToString(part.state.input?.character)
        const subagentSessionID =
          typeof (part.metadata as Record<string, unknown> | undefined)?.subagentSessionID === "string"
            ? ((part.metadata as Record<string, unknown>).subagentSessionID as string)
            : undefined
        if (character && subagentSessionID) map.set(character, subagentSessionID)
      }
    }
    return map
  })

  const childSessionIDs = createMemo(() => {
    const ids = new Set<string>()
    for (const value of childSessionsByName().values()) ids.add(value)
    for (const value of embodySubagentByName().values()) ids.add(value)
    return [...ids]
  })

  createResource(
    childSessionIDs,
    async (ids) => {
      await Promise.all(
        ids.map(async (id) => {
          if (sync.data.message[id] !== undefined) return
          await sync.session.sync(id)
        }),
      )
    },
  )

  const characterReplayByName = createMemo(() => {
    const result = new Map<string, CharacterReplay>()
    for (const name of presentCharacters().map((item) => item.name)) {
      const childID = embodySubagentByName().get(name) ?? childSessionsByName().get(name)
      if (!childID) continue
      const messages = sync.data.message[childID] ?? []
      const assistant = [...messages].reverse().find((item): item is Message & { role: "assistant" } => item.role === "assistant")
      if (!assistant) continue
      const user = [...messages]
        .reverse()
        .find((item): item is UserMessage => item.role === "user" && item.id === assistant.parentID)
      const output = extractText(sync.data.part[assistant.id])
      const replay = parseCharacterReplayOutput(output)
      if (!replay) continue
      result.set(name, { ...replay, input: user ? extractText(sync.data.part[user.id]) : undefined })
    }
    return result
  })

  const [sceneHistory] = createResource(
    () => worldRoot(),
    async (root) => {
      if (!root) return []
      const list = await sdk.client.file.list({ path: "records" }).then((response) => response.data ?? []).catch(() => [])
      const files = list.filter((item) => item.type === "file" && /\.ya?ml$/i.test(item.path)).map((item) => item.path)
      const items = await Promise.all(
        files.map(async (path) => {
          const content = await sdk.client.file.read({ path }).then((response) => response.data).catch(() => undefined)
          if (!content || content.type !== "text") return undefined
          const raw = content.content
          return parseSceneHistoryText(path, raw)
        }),
      )
      return items.filter(Boolean).sort((a, b) => a!.path.localeCompare(b!.path)) as SceneHistoryItem[]
    },
  )

  const characters = createMemo(() =>
    presentCharacters().map((character) => ({
      runtime: character,
      agent: agentsByName().get(character.name),
      replay: characterReplayByName().get(character.name),
    })),
  )

  return (
    <aside
      class="h-full flex flex-col bg-background-base border-l border-border-weaker-base overflow-hidden md:shrink-0"
      style={{
        width: ROLEPLAY_PANEL_WIDTH,
        "min-width": "340px",
        "max-width": "460px",
      }}
    >
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="p-4 border-b border-border-weaker-base">
          <div class="flex items-center justify-between gap-3 mb-3">
            <div class="flex items-center gap-2">
              <h3 class="text-12-medium text-text-weak uppercase tracking-wider">{language.t("roleplay.panel.scene")}</h3>
              <Show when={sceneRows().length > 0}>
                <span class="inline-flex items-center px-1.5 py-0.5 rounded-full text-11-medium bg-surface-weak text-text-weak">
                  {presentCharacters().length} present
                </span>
              </Show>
              <span
                class="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-11-medium"
                classList={{
                  "bg-[color:color-mix(in_srgb,var(--color-success)_12%,transparent)] text-[var(--color-success)]":
                    traceEnabled(),
                  "bg-surface-weak text-text-weak": !traceEnabled(),
                }}
              >
                <span
                  class="inline-block h-1.5 w-1.5 rounded-full"
                  classList={{
                    "bg-[var(--color-success)]": traceEnabled(),
                    "bg-border-strong": !traceEnabled(),
                  }}
                />
                {traceEnabled() ? language.t("trace.status.on") : language.t("trace.status.off")}
              </span>
            </div>
            <div class="flex items-center gap-3">
              <Show when={traceToggleVisible()}>
                <Tooltip placement="bottom" value={traceTooltip()}>
                  <Button
                    variant="ghost"
                    class="min-w-[96px] h-7 px-2.5 box-border gap-1.5 border"
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
                        "bg-[var(--color-success)]": traceEnabled(),
                        "bg-[var(--syntax-warning)]": traceEnabled() && !traceAvailable(),
                        "bg-border-strong": !traceEnabled(),
                      }}
                    />
                    <span class="text-11-medium">
                      {traceEnabled() ? language.t("trace.status.on") : language.t("trace.status.off")}
                    </span>
                  </Button>
                </Tooltip>
              </Show>
              <Show when={sessionID()}>
                <button
                  class="text-12-medium text-text-interactive-base hover:text-text-interactive-hover transition-colors"
                  onClick={() => {
                    const id = sessionID()
                    if (!id) return
                    dialog.show(() => <SessionTraceDialog sessionID={id} />)
                  }}
                >
                  {language.t("trace.header.openButton")}
                </button>
              </Show>
              <Show when={worldConfigPath()}>
                <button
                  class="text-12-medium text-text-interactive-base hover:text-text-interactive-hover transition-colors"
                  onClick={() => openFile(worldConfigPath()!)}
                >
                  {language.t("roleplay.panel.editRuntime")}
                </button>
              </Show>
            </div>
          </div>
          <Show
            when={sceneRows().length > 0}
            fallback={<p class="text-14-regular text-text-weak italic">{language.t("roleplay.panel.noScene")}</p>}
          >
            <div class="rounded-lg border border-border-weaker-base bg-surface-base p-3 flex flex-col gap-2">
              <For each={sceneRows()}>
                {(row) => (
                  <div>
                    <div class="text-11-medium text-text-weak uppercase tracking-wider mb-0.5">{row.label}</div>
                    <p class="text-13-regular text-text-strong whitespace-pre-wrap">{row.value}</p>
                  </div>
                )}
              </For>
              <div class="pt-1 flex flex-wrap gap-3">
                <button
                  class="text-12-medium text-text-interactive-base hover:text-text-interactive-hover transition-colors"
                  onClick={() => void revealDirectory("characters")}
                >
                  {language.t("roleplay.panel.openCharacterDirectory")}
                </button>
              </div>
            </div>
          </Show>
          <Show when={(sceneHistory() ?? []).length > 0}>
            <details class="mt-3 rounded-lg border border-border-weaker-base bg-surface-base">
              <summary class="cursor-pointer list-none px-3 py-2.5 text-12-medium text-text-weak">
                {language.t("roleplay.panel.sceneHistory")}
              </summary>
              <div class="px-3 pb-3 flex flex-col gap-3">
                <For each={sceneHistory() ?? []}>
                  {(item) => (
                    <div class="rounded-md border border-border-weaker-base bg-background-base p-3">
                      <div class="text-12-medium text-text-weak">{item.path}</div>
                      <div class="mt-1 text-13-regular text-text-base whitespace-pre-wrap">
                        {[item.date, item.location].filter(Boolean).join(" -> ") || language.t("common.unknown")}
                      </div>
                      <Show when={item.presentCharacters.length > 0}>
                        <div class="mt-1 text-12-regular text-text-weak">
                          {language.t("roleplay.panel.presentCharacters")}: {item.presentCharacters.join(", ")}
                        </div>
                      </Show>
                      <Show when={item.impression}>
                        <div class="mt-1 text-12-regular text-text-weak whitespace-pre-wrap">{item.impression}</div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </details>
          </Show>
        </div>

        <div class="p-4">
          <h3 class="text-12-medium text-text-weak uppercase tracking-wider mb-3">{language.t("roleplay.panel.characters")}</h3>
          <Show
            when={characters().length > 0}
            fallback={<p class="text-14-regular text-text-weak italic">{language.t("roleplay.panel.noCharacters")}</p>}
          >
            <div class="flex flex-col gap-2">
              <For each={characters()}>
                {(item) => (
                  <div class="rounded-lg border border-border-weaker-base overflow-hidden bg-surface-base">
                    <Show when={item.agent} fallback={<RuntimeCharacterCard character={item.runtime} />}>
                      {(agent) => (
                        <CharacterWithRuntimeCard
                          agent={agent()}
                          character={item.runtime}
                          replay={item.replay}
                          onOpenProfile={
                            agent().statePath ? () => openCharacterProfile(agent().statePath, agent().name) : undefined
                          }
                          onEdit={agent().statePath ? () => openFile(agent().statePath!) : undefined}
                          onOpenDirectory={agent().statePath ? () => openCharacterDirectory(agent().statePath) : undefined}
                        />
                      )}
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </aside>
  )
}
