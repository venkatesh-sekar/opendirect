/**
 * Cost estimation for a single generation.
 *
 * ⚠️ REPLICATE PRICING IS HAND-MAINTAINED. Replicate's public API exposes no
 * pricing field (verified 2026-09-16 — `GET /v1/models/{owner}/{name}` returns
 * `run_count` but no price). The rates in `REPLICATE_PRICING` were transcribed
 * on **2026-09-16** from the pricing tiers embedded in each model's public
 * page (`https://replicate.com/<slug>`), and they MUST be re-verified against
 * that page before every release — Replicate re-prices models without notice.
 * Anything not listed here shows as "cost unknown" in the UI.
 *
 * Replicate prices these models in *tiers*: a rate per target resolution, and
 * for the video models a second, dearer rate when the run has a video input
 * (Replicate calls it the `video_in` model variant). Tier keys below are
 * `"<resolution>"` or `"<resolution>:video_in"`, lower-cased, matching the
 * `resolution` enum in each model's own input schema.
 *
 * OpenRouter is different: it publishes `pricing_skus` per model and returns
 * the actual `usage.cost` when a job completes, so its pre-flight number is an
 * estimate that is later replaced by an exact figure.
 *
 * The rule this module never breaks: **never invent a price**. If a rate or
 * the quantity it multiplies is missing, the result is
 * `{ amount: 0, confidence: "unknown", source: "none" }`. Where an input that
 * only *selects* a tier is missing, the worst-case (dearest) tier is used and
 * the note says so, so the UI never under-quotes.
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
  /** The pricing key/tier the number came from, for the Details panel. */
  sku: string | null
}

export interface ReplicatePrice {
  basis: Extract<PricingBasis, "per_second" | "per_output">
  /** Human unit for the UI: `second`, `output`. */
  unit: string
  /** Input field whose value selects a tier, lower-cased before lookup. */
  tierField: string
  /** True when a video input switches the model to Replicate's dearer variant. */
  videoInputVariant: boolean
  /** USD per unit, keyed by `"<tier>"` / `"<tier>:video_in"`. */
  tiers: Record<string, number>
  note: string
}

/**
 * Transcribed 2026-09-16 from the `current_tiers` pricing block on each
 * model's public Replicate page. See the file header before touching these.
 */
export const REPLICATE_PRICING: Record<string, ReplicatePrice> = {
  "bytedance/seedance-2.5": {
    basis: "per_second",
    unit: "second",
    tierField: "resolution",
    videoInputVariant: true,
    tiers: {
      "480p": 0.1028,
      "480p:video_in": 0.4304,
      "720p": 0.2312,
      "720p:video_in": 0.9676,
    },
    note: "Per second of output video; the dearer tier applies when the run has a video input.",
  },
  "bytedance/seedance-2.0": {
    basis: "per_second",
    unit: "second",
    tierField: "resolution",
    videoInputVariant: true,
    tiers: {
      "480p": 0.08,
      "480p:video_in": 0.1,
      "720p": 0.18,
      "720p:video_in": 0.22,
      "1080p": 0.45,
      "1080p:video_in": 0.55,
      "4k": 1,
      "4k:video_in": 1.25,
    },
    note: "Per second of output video; the dearer tier applies when the run has a video input.",
  },
  "google/nano-banana-2": {
    basis: "per_output",
    unit: "output",
    tierField: "resolution",
    videoInputVariant: false,
    tiers: { "1k": 0.067, "2k": 0.101, "4k": 0.151 },
    note: "Per output image, by target resolution.",
  },
  "google/nano-banana-pro": {
    basis: "per_output",
    unit: "output",
    tierField: "resolution",
    videoInputVariant: false,
    // Replicate also publishes a `fallback` tier at $0.035/image for runs that
    // match no resolution; it is kept verbatim but never chosen by OpenDirect,
    // which deliberately quotes the dearest tier when the resolution is unset.
    tiers: { "1k": 0.15, "2k": 0.15, "4k": 0.3, fallback: 0.035 },
    note: "Per output image, by target resolution.",
  },
}

const UNKNOWN_NOTE =
  "No published rate for this model, so OpenDirect cannot estimate a cost."

const OPENROUTER_TOKEN_NOTE =
  "This model is priced per token, which cannot be known before the run. OpenRouter reports the exact cost on completion."

const REPLICATE_CAVEAT =
  "Replicate publishes no pricing API, so this rate is transcribed by hand from the model page (2026-09-16) and is an unverified estimate."

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

/**
 * Output length in seconds. `num_frames` is a frame count, never a duration —
 * it only yields seconds when the model also exposes an `fps` input.
 */
function readDurationSeconds(params: GenerationParams): number | null {
  const duration = readNumber(params, "duration", "duration_seconds")
  if (duration !== null) return duration
  const frames = readNumber(params, "num_frames", "frames")
  const fps = readNumber(params, "fps", "frames_per_second")
  if (frames !== null && fps !== null && fps > 0) return frames / fps
  return null
}

/**
 * Whether the run generates audio: true/false when the request says so, null
 * when it is silent. Null is *not* treated as "off" — callers quote the dearer
 * audio SKU and say so, rather than under-quoting on an assumption.
 */
function wantsAudio(params: GenerationParams): boolean | null {
  const value = params.generate_audio ?? params.audio
  if (value === true || value === "true") return true
  if (value === false || value === "false") return false
  return null
}

function wants720p(params: GenerationParams): boolean {
  const value = params.resolution ?? params.size
  return typeof value === "string" && value.includes("720")
}

function hasVideoInput(params: GenerationParams): boolean {
  const keys = ["reference_videos", "video", "input_video", "source_video"]
  for (const key of keys) {
    const value = params[key]
    if (Array.isArray(value) ? value.length > 0 : Boolean(value)) return true
  }
  return false
}

/**
 * OpenRouter's per-second keys vary per model
 * (`duration_seconds_with_audio`, `…_without_audio_720p`, …), so instead of
 * matching a fixed list we score every `duration_seconds*` key against what
 * the request actually asks for and take the closest fit. When audio is
 * unstated, the dearer of the audio variants wins.
 */
function pickDurationSku(
  skus: Record<string, string>,
  params: GenerationParams
): { key: string; rate: number; audioAssumed: boolean } | null {
  const audio = wantsAudio(params)
  const hd = !wants720p(params)

  let best: { key: string; rate: number; score: number } | null = null
  for (const [key, value] of Object.entries(skus)) {
    if (!/^duration_seconds/.test(key)) continue
    const rate = parseRate(value)
    if (rate === null) continue

    const keyHasNoAudio = key.includes("_without_audio")
    const keyHasAudio = !keyHasNoAudio && key.includes("_with_audio")
    const key720p = key.endsWith("_720p")

    let score = 0
    if (keyHasAudio || keyHasNoAudio) {
      // Unstated audio: prefer the audio SKU, which is never the cheaper one.
      if (audio === null) score += keyHasAudio ? 2 : -2
      else score += keyHasNoAudio === !audio ? 2 : -2
    }
    score += key720p === !hd ? 1 : -1

    if (!best || score > best.score) best = { key, rate, score }
  }
  return best
    ? { key: best.key, rate: best.rate, audioAssumed: audio === null }
    : null
}

function estimateOpenRouter(input: EstimateCostInput): CostEstimateResult {
  const sku = pickDurationSku(input.pricingSkus, input.params)
  if (sku) {
    const duration = readDurationSeconds(input.params)
    if (duration === null || duration <= 0) {
      return unknownCost(
        "Pick a duration to see an estimated cost for this model.",
        "per_second"
      )
    }
    const assumption = sku.audioAssumed
      ? " Audio is unset, so the with-audio rate is quoted."
      : ""
    return {
      amount: sku.rate * duration,
      currency: "USD",
      basis: "per_second",
      confidence: "estimated",
      source: "provider_api",
      note: `Estimated from OpenRouter's published per-second rate.${assumption} The exact cost is reported when the job completes.`,
      sku: sku.key,
    }
  }

  const hasTokenSku = Object.keys(input.pricingSkus).some((key) =>
    key.includes("token")
  )
  if (hasTokenSku) return unknownCost(OPENROUTER_TOKEN_NOTE, "per_token")

  return unknownCost(UNKNOWN_NOTE, "unknown")
}

/**
 * Resolves the tier the request selects. A stated resolution picks its tier
 * exactly; an unstated one falls back to the dearest tier for the run's video
 * variant, flagged so the note can say the quote is worst-case.
 */
function pickReplicateTier(
  price: ReplicatePrice,
  params: GenerationParams
): { key: string; usd: number; worstCase: boolean } | null {
  const suffix =
    price.videoInputVariant && hasVideoInput(params) ? ":video_in" : ""
  const raw = params[price.tierField]
  if (typeof raw === "string" && raw.trim() !== "") {
    const key = `${raw.trim().toLowerCase()}${suffix}`
    const usd = price.tiers[key]
    if (usd !== undefined) return { key, usd, worstCase: false }
  }

  let best: { key: string; usd: number } | null = null
  for (const [key, usd] of Object.entries(price.tiers)) {
    if (suffix ? !key.endsWith(suffix) : key.includes(":")) continue
    if (!best || usd > best.usd) best = { key, usd }
  }
  return best ? { ...best, worstCase: true } : null
}

function estimateReplicate(input: EstimateCostInput): CostEstimateResult {
  const price = input.slug ? REPLICATE_PRICING[input.slug] : undefined
  if (!price) return unknownCost(UNKNOWN_NOTE, "unknown")

  const tier = pickReplicateTier(price, input.params)
  if (!tier) return unknownCost(UNKNOWN_NOTE, price.basis)

  const quantity =
    price.basis === "per_second"
      ? readDurationSeconds(input.params)
      : (readNumber(input.params, "num_outputs", "n") ?? 1)

  if (quantity === null || quantity <= 0) {
    return unknownCost(
      price.basis === "per_second"
        ? "Pick a duration to see an estimated cost for this model."
        : "Pick an output count to see an estimated cost for this model.",
      price.basis
    )
  }

  const fallbackNote = tier.worstCase
    ? ` No ${price.tierField} is set, so the worst-case (dearest) tier is quoted.`
    : ""

  return {
    amount: tier.usd * quantity,
    currency: "USD",
    basis: price.basis,
    confidence: "estimated",
    source: "local_table",
    note: `${price.note}${fallbackNote} ${REPLICATE_CAVEAT}`,
    sku: tier.key,
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
