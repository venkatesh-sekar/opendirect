/**
 * The contract every provider adapter implements.
 *
 * Adapters live only in the main process — they hold the API keys and do the
 * HTTP. The renderer never sees this interface, only the normalized
 * `ModelDescriptor` / `ModelSummary` it produces.
 *
 * ⛔ `submit` / `poll` / `cancel` are the paid path. They are declared here and
 * implemented in Task 16, and are tested exclusively against `msw` handlers
 * backed by recorded fixtures — never against a live provider.
 */
import type {
  ModelDescriptor,
  ModelKind,
  ModelSummary,
  ProviderId,
} from "@opendirect/contract"

import type { GenerationParams } from "./cost"

/** One generation as the job runner hands it to an adapter. */
export interface GenerationRequest {
  /** Provider-local slug, e.g. `bytedance/seedance-2.5`. */
  slug: string
  /** Replicate version id to pin, when the adapter needs one. */
  versionId?: string | null
  /** Validated form values, shaped by the model's own input schema. */
  params: GenerationParams
}

/** The opaque handle an adapter needs to poll or cancel its own job. */
export interface ProviderJobRef {
  provider: ProviderId
  /** Provider-side job/prediction id. */
  id: string
  /** Polling URL when the provider hands one back, e.g. Replicate's `urls.get`. */
  pollUrl?: string | null
}

export type ProviderJobStatus =
  "queued" | "running" | "succeeded" | "failed" | "canceled"

/** A normalized snapshot of a provider-side job. */
export interface ProviderJobState {
  ref: ProviderJobRef
  status: ProviderJobStatus
  /** 0–1 when the provider reports progress; null when it does not. */
  progress: number | null
  /** Remote URLs of finished outputs; downloaded to the project folder later. */
  outputUrls: string[]
  /** Provider-reported actual cost in USD — exact, unlike a pre-flight estimate. */
  costUsd: number | null
  error: string | null
  /** The provider payload, verbatim, for debugging and the Details panel. */
  raw: unknown
}

export interface ListModelsOptions {
  kinds: ModelKind[]
}

export interface ModelProvider {
  readonly id: ProviderId
  /** False when no API key is configured; the registry filters on this. */
  isConfigured(): boolean
  listModels(opts: ListModelsOptions): Promise<ModelSummary[]>
  getModel(slug: string): Promise<ModelDescriptor>
  submit(req: GenerationRequest): Promise<ProviderJobRef>
  poll(ref: ProviderJobRef): Promise<ProviderJobState>
  cancel(ref: ProviderJobRef): Promise<void>
}
