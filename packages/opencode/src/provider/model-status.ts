import { Schema } from "effect"

export { CatalogModelStatus } from "@openplay-ai/core/models"

export const ModelStatus = Schema.Literals(["alpha", "beta", "deprecated", "active"])
export type ModelStatus = typeof ModelStatus.Type

export * as ProviderModelStatus from "./model-status"
