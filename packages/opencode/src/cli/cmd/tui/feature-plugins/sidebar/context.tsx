import type { AssistantMessage } from "@openplay-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@openplay-ai/plugin/tui"
import type { InternalTuiPlugin } from "../../plugin/internal"
import { createMemo, For } from "solid-js"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const world = () => props.api.state.path.world

  const scene = () => world()?.scene
  const currentScene = () => world()?.currentScene
  const presentCharacters = () => world()?.presentCharacters ?? []
  const sceneLines = createMemo(() =>
    [
      scene()?.date ? `Date: ${scene()!.date}` : undefined,
      scene()?.location ?? currentScene() ? `Location: ${scene()?.location ?? currentScene()}` : undefined,
      scene()?.impression ? `Impression: ${scene()!.impression}` : undefined,
    ].filter((line): line is string => !!line),
  )

  const isRoleplayMode = () => !!world()

  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const session = createMemo(() => props.api.state.session.get(props.session_id))
  const cost = createMemo(() => session()?.cost ?? 0)

  const state = createMemo(() => {
    const last = msg().findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) {
      return {
        tokens: 0,
        percent: null,
      }
    }

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = props.api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    return {
      tokens,
      percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
    }
  })

  if (isRoleplayMode()) {
    return (
      <box>
        <text fg={theme().text}>
          <b>Context</b>
        </text>
        <For each={sceneLines().length > 0 ? sceneLines() : ["Scene: None"]}>
          {(line) => <text fg={theme().textMuted}>{line}</text>}
        </For>
        <text fg={theme().text}>
          <b>Characters</b>
        </text>
        <For each={presentCharacters()}>
          {(character) => <text fg={theme().textMuted}>• {character.name}</text>}
        </For>
        <text fg={theme().textMuted}>{state().tokens.toLocaleString()} tokens</text>
        <text fg={theme().textMuted}>{money.format(cost())} spent</text>
      </box>
    )
  }

  return (
    <box>
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <text fg={theme().textMuted}>{state().tokens.toLocaleString()} tokens</text>
      <text fg={theme().textMuted}>{state().percent ?? 0}% used</text>
      <text fg={theme().textMuted}>{money.format(cost())} spent</text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: InternalTuiPlugin = {
  id,
  tui,
}

export default plugin
