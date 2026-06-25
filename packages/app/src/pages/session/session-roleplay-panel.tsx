import { createResource, createMemo, createSignal, For, Show, type Component } from "solid-js"
import type { Agent, Message, Part, ToolPart, UserMessage, WorldInfo } from "@openplay-ai/sdk/v2/client"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import { useFile } from "@/context/file"
import { useSDK } from "@/context/sdk"
import { useLayout } from "@/context/layout"
import { useSessionLayout } from "@/pages/session/session-layout"
import { agentDisplayName } from "@/utils/roleplay"
import { agentColor } from "@/utils/agent"

type RuntimeCharacter = NonNullable<WorldInfo["presentCharacters"]>[number]

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
            <div>
              <div class="text-12-medium text-text-weak mb-0.5">{row.label}</div>
              <p class="text-13-regular text-text-base whitespace-pre-wrap">{row.value}</p>
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
      <button
        class="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-background-weaker-base transition-colors"
        onClick={() => setExpanded(!expanded())}
      >
        <div class="relative shrink-0">
          <span
            class="block w-3 h-3 rounded-full ring-2 ring-offset-1 ring-offset-background-base"
            style={{ background: color(), "--ring-color": color() } as any}
          />
          <span class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[var(--color-success)] border border-background-base" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-14-medium text-text-strong truncate">{name()}</div>
          <Show when={props.agent.persona}>
            <div class="text-12-regular text-text-weak truncate">{props.agent.persona!.split("\n")[0]?.trim()}</div>
          </Show>
        </div>
        <svg
          class="shrink-0 text-text-weak transition-transform"
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
      <Show when={expanded()}>
        <div class="px-3 pb-3 flex flex-col gap-3">
          <Show when={persona()}>
            <div>
              <div class="text-12-medium text-text-weak mb-0.5">Persona</div>
              <p class="text-13-regular text-text-base whitespace-pre-wrap">{persona()}</p>
            </div>
          </Show>
          <Show when={senses() && Object.keys(senses()!).length > 0}>
            <div>
              <div class="text-12-medium text-text-weak mb-0.5">Senses</div>
              <p class="text-13-regular text-text-base">
                {Object.entries(senses()!)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(", ")}
              </p>
            </div>
          </Show>
          <Show when={knowledgeAccess() && knowledgeAccess()!.length > 0}>
            <div>
              <div class="text-12-medium text-text-weak mb-0.5">Knowledge</div>
              <p class="text-13-regular text-text-base">{knowledgeAccess()!.join(", ")}</p>
            </div>
          </Show>
          <Show when={statePath()}>
            <div>
              <div class="text-12-medium text-text-weak mb-0.5">State</div>
              <p class="text-13-regular text-text-base font-mono">{statePath()}</p>
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
  onEdit?: () => void
  onOpenDirectory?: () => void
}> = (props) => {
  return (
    <div>
      <CharacterCard
        agent={props.agent}
        replay={props.replay}
        onEdit={props.onEdit}
        onOpenDirectory={props.onOpenDirectory}
      />
      <div class="px-3 pb-1">
        <CharacterFacts character={props.character} />
      </div>
    </div>
  )
}

export const SessionRoleplayPanel: Component = () => {
  const language = useLanguage()
  const sync = useSync()
  const sdk = useSDK()
  const file = useFile()
  const layout = useLayout()
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
    <aside class="h-full flex flex-col bg-background-base border-l border-border-weaker-base overflow-hidden">
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
            </div>
            <Show when={worldConfigPath()}>
              <button
                class="text-12-medium text-text-interactive-base hover:text-text-interactive-hover transition-colors"
                onClick={() => openFile(worldConfigPath()!)}
              >
                {language.t("roleplay.panel.editRuntime")}
              </button>
            </Show>
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
