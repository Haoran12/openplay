import { type Component, For, Show, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import { agentDisplayName } from "@/utils/roleplay"
import { agentColor } from "@/utils/agent"
import type { Agent } from "@openplay-ai/sdk/v2/client"

const CharacterCard: Component<{ agent: Agent }> = (props) => {
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
        class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-background-weaker-base transition-colors"
        onClick={() => setExpanded(!expanded())}
      >
        <span
          class="shrink-0 w-2 h-2 rounded-full"
          style={{ background: color() }}
        />
        <span class="text-14-medium text-text-strong flex-1 truncate">{name()}</span>
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
        <div class="px-3 pb-3 flex flex-col gap-2">
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
        </div>
      </Show>
    </div>
  )
}

export const SessionRoleplayPanel: Component = () => {
  const language = useLanguage()
  const sync = useSync()

  const world = () => sync.data.path.world
  const currentScene = () => world()?.currentScene
  const presentCharacters = () => world()?.presentCharacters ?? []

  const agents = (): Agent[] => {
    const all = sync.data.agent ?? []
    const charIds = new Set(presentCharacters())
    return all.filter((a) => charIds.has(a.name))
  }

  return (
    <aside class="h-full flex flex-col bg-background-base border-l border-border-weaker-base overflow-hidden">
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="p-4 border-b border-border-weaker-base">
          <h3 class="text-12-medium text-text-weak uppercase tracking-wider mb-2">
            {language.t("roleplay.panel.scene")}
          </h3>
          <Show
            when={currentScene()}
            fallback={
              <p class="text-14-regular text-text-weak italic">
                {language.t("roleplay.panel.noScene")}
              </p>
            }
          >
            <p class="text-14-regular text-text-strong">{currentScene()}</p>
          </Show>
        </div>

        <div class="p-4">
          <h3 class="text-12-medium text-text-weak uppercase tracking-wider mb-2">
            {language.t("roleplay.panel.characters")}
          </h3>
          <Show
            when={agents().length > 0}
            fallback={
              <p class="text-14-regular text-text-weak italic">
                {language.t("roleplay.panel.noCharacters")}
              </p>
            }
          >
            <div class="-mx-3 -mt-1">
              <For each={agents()}>
                {(agent) => <CharacterCard agent={agent} />}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </aside>
  )
}