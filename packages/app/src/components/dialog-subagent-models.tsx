import { Button } from "@openplay-ai/ui/button"
import { useDialog } from "@openplay-ai/ui/context/dialog"
import { Dialog } from "@openplay-ai/ui/dialog"
import { IconButton } from "@openplay-ai/ui/icon-button"
import { ProviderIcon } from "@openplay-ai/ui/provider-icon"
import { Tag } from "@openplay-ai/ui/tag"
import { Tooltip } from "@openplay-ai/ui/tooltip"
import { Show, createMemo } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLocal } from "@/context/local"
import { useModels, type ModelKey } from "@/context/models"
import { useProviders } from "@/hooks/use-providers"
import { useLanguage } from "@/context/language"
import type { Config } from "@openplay-ai/sdk/v2/client"
import { ModelSelectorPopover } from "./dialog-select-model"

type ModelState = ReturnType<typeof useLocal>["model"]

type SubagentSlot = "director" | "character" | "gm" | "narrate"

const SLOTS: SubagentSlot[] = ["director", "character", "gm", "narrate"]

function slotConfigPath(slot: SubagentSlot): { agent?: string; roleplayField?: string } {
  switch (slot) {
    case "director":
      return { agent: "director" }
    case "gm":
      return { agent: "gm" }
    case "character":
      return { roleplayField: "characterModel" }
    case "narrate":
      return { roleplayField: "narrateModel" }
  }
}

function getConfiguredModelID(config: Config | undefined, slot: SubagentSlot): string | undefined {
  if (!config) return
  const path = slotConfigPath(slot)
  if (path.agent) {
    const entry = config.agent?.[path.agent]
    if (entry && typeof entry === "object" && "model" in entry) {
      const model = (entry as { model?: string }).model
      if (typeof model === "string" && model.length > 0) return model
    }
    return
  }
  if (path.roleplayField) {
    const value = config.roleplay?.[path.roleplayField as keyof typeof config.roleplay]
    if (typeof value === "string" && value.length > 0) return value
  }
}

function buildPatch(slot: SubagentSlot, modelID: string | undefined): Partial<Config> {
  const path = slotConfigPath(slot)
  if (path.agent) {
    const next: Record<string, { model?: string | undefined }> = {
      [path.agent]: modelID === undefined ? { model: undefined } : { model: modelID },
    }
    return { agent: next as Config["agent"] }
  }
  if (path.roleplayField) {
    return {
      roleplay: {
        [path.roleplayField]: modelID,
      } as Config["roleplay"],
    }
  }
  return {}
}

export function DialogSubagentModels() {
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const models = useModels()
  const providers = useProviders()
  const language = useLanguage()

  const config = () => globalSync.data.config

  const currentModelEntry = (slot: SubagentSlot) => {
    const id = getConfiguredModelID(config(), slot)
    if (!id) return
    const slash = id.indexOf("/")
    if (slash === -1) return
    const key: ModelKey = { providerID: id.slice(0, slash), modelID: id.slice(slash + 1) }
    return models.find(key)
  }

  const makeAdapter = (slot: SubagentSlot): ModelState => {
    const visible = (item: ModelKey) => models.visible(item)
    return {
      ready: models.ready,
      list: () => models.list(),
      current: () => currentModelEntry(slot),
      recent: createMemo(() => models.recent.list().map(models.find).filter(Boolean)),
      visible,
      setVisibility: (item: ModelKey, state: boolean) => models.setVisibility(item, state),
      cycle: () => {},
      set: (item: ModelKey | undefined, _options?: { recent?: boolean }) => {
        const modelID = item ? `${item.providerID}/${item.modelID}` : undefined
        void globalSync.updateConfig(buildPatch(slot, modelID) as Config)
      },
      variant: {
        configured: () => undefined,
        selected: () => undefined,
        current: () => undefined,
        list: () => [],
        set: () => {},
        cycle: () => {},
      },
    } as unknown as ModelState
  }

  const slotLabel = (slot: SubagentSlot) => language.t(`subagent.slot.${slot}`)

  const configuredProviderID = (slot: SubagentSlot) => {
    const entry = currentModelEntry(slot)
    return entry?.provider?.id
  }

  const configuredModelName = (slot: SubagentSlot) => {
    const entry = currentModelEntry(slot)
    return entry?.name
  }

  const clearSlot = (slot: SubagentSlot) => {
    void globalSync.updateConfig(buildPatch(slot, undefined) as Config)
  }

  const close = () => dialog.close()

  return (
    <Dialog
      title={
        <div class="flex items-center gap-2">
          <IconButton
            tabIndex={-1}
            icon="arrow-left"
            variant="ghost"
            onClick={close}
            aria-label={language.t("common.goBack")}
          />
          <span class="text-16-medium text-text-strong">
            {language.t("dialog.subagentModels.title")}
          </span>
        </div>
      }
    >
      <div class="flex flex-col gap-3 px-2.5 pb-6 pt-2 overflow-y-auto max-h-[60vh]">
        <p class="text-13-regular text-text-base">{language.t("dialog.subagentModels.description")}</p>

        <div class="flex flex-col gap-2">
          {SLOTS.map((slot) => (
            <SubagentRow
              slot={slot}
              adapter={makeAdapter(slot)}
              providerID={configuredProviderID(slot)}
              modelName={configuredModelName(slot)}
              label={slotLabel(slot)}
              onClear={() => clearSlot(slot)}
            />
          ))}
        </div>

        <Button
          variant="ghost"
          class="self-start"
          icon="plus-small"
          onClick={() => {
            void import("./dialog-custom-provider").then((x) => {
              dialog.show(() => <x.DialogCustomProvider back="close" />)
            })
          }}
        >
          {language.t("subagent.addProvider")}
        </Button>
      </div>
    </Dialog>
  )
}

function SubagentRow(props: {
  slot: SubagentSlot
  adapter: ModelState
  providerID?: string
  modelName?: string
  label: string
  onClear: () => void
}) {
  const language = useLanguage()

  return (
    <div class="flex items-center gap-2 px-2 py-2 rounded-md border border-border-base bg-surface-raised-base">
      <div class="w-20 shrink-0 text-12-medium text-text-weak">{props.label}</div>
      <div class="flex-1 min-w-0 flex items-center gap-1">
        <Show when={props.providerID}>
          <ProviderIcon id={props.providerID ?? ""} class="size-4 shrink-0 opacity-60" />
        </Show>
        <ModelSelectorPopover
          model={props.adapter}
          triggerAs={Button}
          triggerProps={{
            variant: "ghost",
            size: "normal",
            class:
              "min-w-0 max-w-[260px] text-13-regular text-text-base group flex items-center gap-1",
          }}
        >
          <span class="truncate">
            {props.modelName ?? language.t("dialog.subagentModels.placeholder")}
          </span>
        </ModelSelectorPopover>
      </div>
      <Show when={props.modelName}>
        <Tooltip placement="top" value={language.t("subagent.clear")}>
          <IconButton
            icon="close-small"
            variant="ghost"
            iconSize="normal"
            class="size-6 shrink-0"
            aria-label={language.t("subagent.clear")}
            onClick={props.onClear}
          />
        </Tooltip>
      </Show>
      <Show when={!props.modelName}>
        <Tag>{language.t("subagent.inherit")}</Tag>
      </Show>
    </div>
  )
}

export type { SubagentSlot }