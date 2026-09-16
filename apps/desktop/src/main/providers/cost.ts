/**
 * Cost estimation for a single generation.
 *
 * ⚠️ REPLICATE PRICING IS HAND-MAINTAINED. Replicate's API exposes no pricing
 * field (verified 2026-09-16 — `GET /v1/models/{owner}/{name}` returns
 * `run_count` but no price). The numbers in `REPLICATE_PRICING` below are
 * transcribed by hand from each model's Replicate page and MUST be re-verified
 * by the implementer against https://replicate.com/<slug> before release.
 * Anything not listed here shows as "cost unknown" in the UI.
 *
 * OpenRouter is different: it publishes `pricing_skus` per model and returns
 * the actual `usage.cost` when a job completes, so its pre-flight number is an
 * estimate that is later replaced by an exact figure.
 *
 * The rule this module never breaks: **never invent a price**. If a rate or
 * the quantity it multiplies is missing, the result is
 * `{ amount: 0, confidence: "unknown", source: "none" }`.
 */
import type {
  CostConfidence,
  ModelKind,
  PricingBasis,
  PricingSource,
  ProviderId,
} from "@opendirect/contract"

/** Free-form generation parameters, straight off the schema-driven form. */
export type GenerationParams = Record<string, unknown>

export interface EstimateCostInput {
  provider: ProviderId
  kind: ModelKind
  /** Provider-local slug; required to hit the Replicate pricing table. */
  slug?: string
  /** OpenRouter's `pricing_skus`, verbatim. Empty for Replicate. */
  pricingSkus: Record<string, string>
  params: GenerationParams
}

export interface CostEstimateResult {
  amount: number
  currency: "USD"
  basis: PricingBasis
  confidence: CostConfidence
  source: PricingSource
  /** Shown next to the number; explains why it is an estimate, or why absent. */
  note: string | null
  /** The pricing key the number came from, for the Details panel. */
  sku: string | null
}

export interface ReplicatePrice {
  basis: Extract<PricingBasis, "per_second" | "per_output">
  /** Human unit for the UI: `second`, `output`. */
  unit: string
  usd: number
  note: string
}

/**
 * Hand-transcribed Replicate rates. See the file header — these are unverified
 * defaults, every entry carries its own caveat, and a missing slug is a
 * deliberate "cost unknown" rather than a guess.
 */
export const REPLICATE_PRICING: Record<string, ReplicatePrice> = {
  "bytedance/seedance-2.5": {
    basis: "per_second",
    unit: "second",
    usd: 0.15,
    note: "Unverified: 1080p per-second rate carried over from the Seedance Pro tier. Re-verify at https://replicate.com/bytedance/seedance-2.5.",
  },
  "bytedance/seedance-2.0": {
    basis: "per_second",
    unit: "second",
    usd: 0.15,
    note: "Unverified: 1080p per-second rate carried over from the Seedance Pro tier. Re-verify at https://replicate.com/bytedance/seedance-2.0.",
  },
  "google/nano-banana-2": {
    basis: "per_output",
    unit: "output",
    usd: 0.039,
    note: "Unverified: per-image rate. Re-verify at https://replicate.com/google/nano-banana-2.",
  },
  "google/nano-banana-pro": {
    basis: "per_output",
    unit: "output",
    usd: 0.139,
    note: "Unverified: per-image rate at 1K–2K output. Re-verify at https://replicate.com/google/nano-banana-pro.",
  },
}

const UNKNOWN_NOTE =
  "No published rate for this model, so OpenDirect cannot estimate a cost."

const OPENROUTER_TOKEN_NOTE =
  "This model is priced per token, which cannot be known before the run. OpenRouter reports the exact cost on completion."

function unknownCost(note: string, basis: PricingBasis): CostEstimateResult {
  return {
    amount: 0,
    currency: "USD",
    basis,
    confidence: "unknown",
    source: "none",
    note,
    sku: null,
  }
}

/** Parses a provider rate string; rejects anything not finite and positive. */
function parseRate(value: string | undefined): number | null {
  if (typeof value !== "string") return null
  const rate = Number.parseFloat(value)
  if (!Number.isFinite(rate) || rate < 0) return null
  return rate
}

function readNumber(
  params: GenerationParams,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const value = params[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number.parseFloat(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

/** Audio is opt-out: only an explicit `false` picks the cheaper no-audio SKU. */
function wantsAudio(params: GenerationParams): boolean {
  const value = params.generate_audio ?? params.audio
  if (value === false || value === "false") return false
  return true
}

function wants720p(params: GenerationParams): boolean {
  const value = params.resolution ?? params.size
  return typeof value === "string" && value.includes("720")
}

/**
 * OpenRouter's per-second keys vary per model
 * (`duration_seconds_with_audio`, `…_without_audio_720p`, …), so instead of
 * matching a fixed list we score every `duration_seconds*` key against what
 * the request actually asks for and take the closest fit.
 */
function pickDurationSku(
  skus: Record<string, string>,
  params: GenerationParams
): { key: string; rate: number } | null {
  const audio = wantsAudio(params)
  const hd = !wants720p(params)

  let best: { key: string; rate: number; score: number } | null = null
  for (const [key, value] of Object.entries(skus)) {
    if (!/^duration_seconds/.test(key)) continue
    const rate = parseRate(value)
    if (rate === null) continue

    const keyHasAudio = key.includes("_with_audio")
    const keyHasNoAudio = key.includes("_without_audio")
    const key720p = key.endsWith("_720p")

    let score = 0
    if (keyHasAudio || keyHasNoAudio) {
      score += keyHasNoAudio === !audio ? 2 : -2
    }
    if (key720p === !hd) score += 1
    else score -= 1

    if (!best || score > best.score) best = { key, rate, score }
  }
  return best ? { key: best.key, rate: best.rate } : null
}

function estimateOpenRouter(input: EstimateCostInput): CostEstimateResult {
  const sku = pickDurationSku(input.pricingSkus, input.params)
  if (sku) {
    const duration = readNumber(input.params, "duration", "duration_seconds")
    if (duration === null || duration <= 0) {
      return unknownCost(
        "Pick a duration to see an estimated cost for this model.",
        "per_second"
      )
    }
    return {
      amount: sku.rate * duration,
      currency: "USD",
      basis: "per_second",
      confidence: "estimated",
      source: "provider_api",
      note: "Estimated from OpenRouter's published per-second rate. The exact cost is reported when the job completes.",
      sku: sku.key,
    }
  }

  const hasTokenSku = Object.keys(input.pricingSkus).some((key) =>
    key.includes("token")
  )
  if (hasTokenSku) return unknownCost(OPENROUTER_TOKEN_NOTE, "per_token")

  return unknownCost(UNKNOWN_NOTE, "unknown")
}

function estimateReplicate(input: EstimateCostInput): CostEstimateResult {
  const price = input.slug ? REPLICATE_PRICING[input.slug] : undefined
  if (!price) return unknownCost(UNKNOWN_NOTE, "unknown")

  const quantity =
    price.basis === "per_second"
      ? readNumber(input.params, "duration", "duration_seconds", "num_frames")
      : (readNumber(input.params, "num_outputs", "n") ?? 1)

  if (quantity === null || quantity <= 0) {
    return unknownCost(
      `Pick a ${price.unit === "second" ? "duration" : "count"} to see an estimated cost for this model.`,
      price.basis
    )
  }

  return {
    amount: price.usd * quantity,
    currency: "USD",
    basis: price.basis,
    confidence: "estimated",
    source: "local_table",
    note: `${price.note} Replicate publishes no pricing API, so this is an unverified estimate.`,
    sku: null,
  }
}

/**
 * Best-effort pre-flight price for one generation. Always returns a result;
 * callers render `confidence === "unknown"` as "cost unknown", never as $0.00.
 */
export function estimateCost(input: EstimateCostInput): CostEstimateResult {
  return input.provider === "openrouter"
    ? estimateOpenRouter(input)
    : estimateReplicate(input)
}
