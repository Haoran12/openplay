import { Layer } from "effect"
import { TuiConfig } from "./config/tui"
import { Npm } from "@openplay-ai/core/npm"
import { Observability } from "@openplay-ai/core/effect/observability"

export const CliLayer = Observability.layer.pipe(Layer.merge(TuiConfig.layer), Layer.provide(Npm.defaultLayer))
