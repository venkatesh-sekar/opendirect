/**
 * Cost estimation for a single generation — a pure function of the model's
 * published rates and the run's params.
 *
 * Where rates come from:
 * - **OpenRouter** publishes `pricing_skus` per model, e.g. Wan 3.0's
 *   `{ duration_seconds_480p, duration_seconds_720p, duration_seconds_1080p }`,
 *   Veo's `duration_seconds_with_audio_720p` or Grok's
 *   `cents_per_video_output_second_720p` (cents, not dollars), plus the odd
 *   `minimum_cents_per_generation` / `cents_per_image_input`. It reports the
 *   actual `usage.cost` when a job completes; the pre-flight is an estimate.
 *   Token and megapixel-second SKUs cannot be known before a run and stay
 *   unknown.
 * - **Replicate** exposes no pricing field at all, so its rates live in the
 *   hand-curated `registry/pricing.json` (see `curated-pricing.ts`). That
 *   table also fills an OpenRouter model that publishes no SKUs.
 *
 * Both kinds of rate are read into the same shape: a USD rate per second of
 * output (or per output) for one combination of *dimensions* — target
 * resolution, audio on/off, and input mode (text, image, or Replicate's dearer
 * `video_in` variant). The run's params select among them, so the estimate is
 * `rate(resolution, audio, input) × duration` (or `× outputs`); the batch
 * count multiplies that again in the renderer.
 *
 * The rule this module never breaks: **never invent a price**. If no rate or
 * the quantity it multiplies is missing, the result is
 * `confidence: "unknown"`. Where a dimension is unstated, the model's own
 * schema default is used when it states one — that is what the provider would
 * run — and otherwise the worst-case (dearest) rate, with the note saying so,
 * so the UI never under-quotes.
 */
import {
  DURATION_FPS_FIELDS,
  DURATION_FRAME_FIELDS,
  DURATION_SECONDS_FIELDS,
  detectOutputCountField,
  parseSeconds,
  type CommonControls,
  type CostConfidence,
  type CostQuote,
  type ModelDescriptor,
  type ModelKind,
  type PricingBasis,
  type PricingSource,
  type ProviderId,
} from "@opendirect/contract"

import { curatedPrice } from "./curated-pricing"

/** Free-form generation parameters, straight off the schema-driven form. */
export type GenerationParams = Record<string, unknown>

export interface EstimateCostInput {
  provider: ProviderId
  kind: ModelKind
  /** Provider-local slug; looks the model up in the curated table. */
  slug?: string
  /** OpenRouter's `pricing_skus`, verbatim. Ignored for Replicate. */
  pricingSkus: Record<string, string>
  params: GenerationParams
  /**
   * The model's own input JSON Schema, when the caller has it. Used only to
   * read the default of a field (resolution, duration) the request leaves
   * unset — the provider would run with that default.
   */
  inputSchema?: Record<string, unknown>
  /**
   * Which input fields carry duration, resolution and audio, when they are not
   * named `duration` / `resolution` / `generate_audio`.
   */
  controls?: Partial<Pick<CommonControls, "duration" | "resolution" | "audio">>
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
  /**
   * The per-unit rate the amount multiplies, when one applies — present even
   * when the amount is unknown for want of a duration, so the UI can say what
   * the model is billed at instead of "no pricing".
   */
  rate: { amount: number; unit: string } | null
}

/** What a run is generated from; `reference` = reference images/clips. */
const INPUT_MODES = ["text", "image", "video", "reference"] as const
type InputMode = (typeof INPUT_MODES)[number]

/** One published rate, with the dimensions its key names. Null = any. */
export interface ParsedRate {
  key: string
  usd: number
  basis: "per_second" | "per_output"
  resolution: string | null
  audio: boolean | null
  input: InputMode | null
}

const UNITS = { per_second: "second", per_output: "output" } as const

const UNKNOWN_NOTE =
  "No published rate for this model, so OpenDirect cannot estimate a cost."

const OPENROUTER_TOKEN_NOTE =
  "This model is priced per token, which cannot be known before the run. OpenRouter reports the exact cost on completion."

/** Parses a provider rate string; rejects anything not finite and positive. */
function parseRate(value: unknown): number | null {
  const rate =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN
  if (!Number.isFinite(rate) || rate < 0) return null
  return rate
}

const RESOLUTION_TOKEN = /(?:^|_)(\d{3,4}p|\d+k)(?=_|$)/i

/**
 * How many units of a per-second SKU make a dollar: `duration_seconds…`
 * keys are USD, `cents_per_second_output…` / `cents_per_video_output_second…`
 * keys are US cents. Null for anything that is not a per-second-of-output
 * rate (tokens, megapixel-seconds, per-input surcharges).
 */
function perSecondDivisor(key: string): number | null {
  if (key.includes("duration_seconds")) return 1
  if (/^cents_per_(second_output|video_output_second|second_video_)/.test(key))
    return 100
  return null
}

/**
 * Reads one OpenRouter SKU key as a per-second rate. The rest of the key
 * names the dimensions it applies to, in whatever order the model lists
 * them: `text_to_video_` / `image_to_video_` / `reference_` prefixes, a
 * `video_continuation` (video-input) variant, `_with_audio` /
 * `_without_audio`, and a resolution
 * token (`_720p`, `_1080p`, `_4k`). Exported for its tests.
 */
export function parseOpenRouterSku(
  key: string,
  value: unknown
): ParsedRate | null {
  const divisor = perSecondDivisor(key)
  if (divisor === null) return null
  const raw = parseRate(value)
  if (raw === null) return null
  const mode = key.includes("video_continuation")
    ? "video"
    : key.startsWith("reference_")
      ? "reference"
      : /^([a-z]+)_to_video_/.exec(key)?.[1]
  return {
    key,
    usd: raw / divisor,
    basis: "per_second",
    resolution: RESOLUTION_TOKEN.exec(key)?.[1]?.toLowerCase() ?? null,
    audio: key.includes("_without_audio")
      ? false
      : key.includes("_with_audio")
        ? true
        : null,
    input: INPUT_MODES.includes(mode as InputMode) ? (mode as InputMode) : null,
  }
}

/**
 * Reads one curated tier key: `<resolution>` or `*`, optionally followed by
 * `:video_in` (Replicate's dearer video-input variant), `:audio` or `:silent`
 * (a with- or without-audio rate, as Veo publishes).
 */
function parseCuratedTier(
  key: string,
  usd: number,
  basis: ParsedRate["basis"]
): ParsedRate {
  const [resolution = "*", variant] = key.toLowerCase().split(":")
  return {
    key,
    usd,
    basis,
    resolution: resolution === "*" ? null : resolution,
    audio: variant === "audio" ? true : variant === "silent" ? false : null,
    input: variant === "video_in" ? "video" : null,
  }
}

function readNumber(
  params: GenerationParams,
  keys: ReadonlyArray<string | null | undefined>
): number | null {
  for (const key of keys) {
    if (!key) continue
    const value = params[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number.parseFloat(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

/** The `default` a model's own input schema states for one property. */
function schemaDefault(
  inputSchema: Record<string, unknown> | undefined,
  field: string
): unknown {
  const properties = inputSchema?.properties
  if (typeof properties !== "object" || properties === null) return undefined
  const property = (properties as Record<string, unknown>)[field]
  if (typeof property !== "object" || property === null) return undefined
  return (property as Record<string, unknown>).default
}

/** Whether a field counts frames rather than seconds, by its name. */
function isFrameField(field: string): boolean {
  return (
    (DURATION_FRAME_FIELDS as readonly string[]).includes(field) ||
    /frame/i.test(field)
  )
}

/** The first of `fields` the params state as a length (`5`, `"5"`, `"5s"`). */
function readLength(
  params: GenerationParams,
  fields: ReadonlyArray<string>
): number | null {
  for (const field of fields) {
    const value = parseSeconds(params[field])
    if (value !== null) return value
  }
  return null
}

/**
 * Output length in seconds, and whether it is the schema's default rather than
 * a value the run states.
 *
 * Reads the same field names the renderer's duration control writes
 * (`DURATION_*_FIELDS` in the contract): a length in seconds under the mapped
 * control or any seconds name (`duration`, Sora's `seconds`, `"10s"`
 * strings), else a frame count (`num_frames`, Hunyuan's `video_length`, …)
 * divided by a frame rate the run or the schema states. A frame count is never
 * a duration on its own — with no frame rate it yields nothing.
 */
function readDuration(
  input: EstimateCostInput
): { seconds: number; fromDefault: boolean } | null {
  const mapped = input.controls?.duration ?? null
  const mappedFrames = mapped !== null && isFrameField(mapped)
  const secondsFields = [
    ...(mapped !== null && !mappedFrames ? [mapped] : []),
    ...DURATION_SECONDS_FIELDS,
  ]
  const frameFields = [
    ...(mappedFrames ? [mapped] : []),
    ...DURATION_FRAME_FIELDS,
  ]
  const fpsOf = (params: GenerationParams): number | null => {
    const stated = readLength(params, DURATION_FPS_FIELDS)
    if (stated !== null) return stated
    for (const field of DURATION_FPS_FIELDS) {
      const fallback = parseSeconds(schemaDefault(input.inputSchema, field))
      if (fallback !== null) return fallback
    }
    return null
  }
  const fromFrames = (frames: number | null): number | null => {
    const fps = fpsOf(input.params)
    return frames !== null && fps !== null && fps > 0 ? frames / fps : null
  }

  const stated = readLength(input.params, secondsFields)
  if (stated !== null) return { seconds: stated, fromDefault: false }
  const framed = fromFrames(readLength(input.params, frameFields))
  if (framed !== null) return { seconds: framed, fromDefault: false }

  for (const field of secondsFields) {
    const fallback = parseSeconds(schemaDefault(input.inputSchema, field))
    if (fallback !== null) return { seconds: fallback, fromDefault: true }
  }
  for (const field of frameFields) {
    const fallback = fromFrames(
      parseSeconds(schemaDefault(input.inputSchema, field))
    )
    if (fallback !== null) return { seconds: fallback, fromDefault: true }
  }
  return null
}

/** `1280x720` → `720p`; a size is a resolution by its shorter side. */
function resolutionOfSize(value: unknown): string | null {
  if (typeof value !== "string") return null
  const match = /^(\d+)\s*[x*×]\s*(\d+)$/i.exec(value.trim())
  if (!match) return null
  return `${Math.min(Number(match[1]), Number(match[2]))}p`
}

function asResolution(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim().toLowerCase()
    : null
}

/**
 * The resolution the run asks for: stated, else from a `size`, else the
 * schema default. Null when none of them says.
 */
function readResolution(input: EstimateCostInput): string | null {
  const field = input.controls?.resolution ?? "resolution"
  return (
    asResolution(input.params[field]) ??
    resolutionOfSize(input.params.size) ??
    asResolution(schemaDefault(input.inputSchema, field))
  )
}

/**
 * Whether the run generates audio: true/false when the request says so, null
 * when it is silent. Null is *not* treated as "off" — the dearer audio rate is
 * quoted and the note says so, rather than under-quoting on an assumption.
 */
function readAudio(input: EstimateCostInput): boolean | null {
  const field = input.controls?.audio ?? "generate_audio"
  const value =
    input.params[field] ?? input.params.generate_audio ?? input.params.audio
  if (value === true || value === "true") return true
  if (value === false || value === "false") return false
  return null
}

function populated(params: GenerationParams, keys: string[]): boolean {
  return keys.some((key) => {
    const value = params[key]
    return Array.isArray(value) ? value.length > 0 : Boolean(value)
  })
}

const VIDEO_INPUTS = [
  "reference_videos",
  "video",
  "input_video",
  "source_video",
]
const IMAGE_INPUTS = [
  "image",
  "first_frame",
  "first_frame_image",
  "start_image",
  "input_image",
  "frame_images",
]

const REFERENCE_INPUTS = ["reference_images", "input_references"]

function readInputMode(params: GenerationParams): InputMode {
  if (populated(params, VIDEO_INPUTS)) return "video"
  if (populated(params, REFERENCE_INPUTS)) return "reference"
  if (populated(params, IMAGE_INPUTS)) return "image"
  return "text"
}

/** How many images the run sends, for a per-input-image surcharge. */
function countImageInputs(params: GenerationParams): number {
  let count = 0
  for (const key of [...IMAGE_INPUTS, "last_frame", "reference_images"]) {
    const value = params[key]
    if (Array.isArray(value)) count += value.length
    else if (value) count += 1
  }
  return count
}

interface RunFacts {
  resolution: string | null
  audio: boolean | null
  input: InputMode | null
}

/**
 * Picks the rate for the run. A rate naming a different value for a stated
 * dimension is out. Among the rest, one naming the stated resolution beats one
 * that applies to any resolution, then likewise for audio; the input mode only
 * ever rules rates out. Among equally good fits the dearest wins, so an
 * unstated dimension is quoted at its worst case. Returns the dimensions the
 * pick had to assume, for the note.
 */
function pickRate(
  rates: ParsedRate[],
  facts: RunFacts
): { rate: ParsedRate; assumed: Array<"resolution" | "audio"> } | null {
  const fit = (has: unknown, wants: unknown): number | null => {
    if (wants === null || has === null) return 0
    return has === wants ? 1 : null
  }
  const score = (rate: ParsedRate): number | null => {
    const resolution = fit(rate.resolution, facts.resolution)
    const audio = fit(rate.audio, facts.audio)
    const input = fit(rate.input, facts.input)
    if (resolution === null || audio === null || input === null) return null
    return resolution * 2 + audio
  }

  let best: { rate: ParsedRate; score: number }[] = []
  for (const rate of rates) {
    const value = score(rate)
    if (value === null) continue
    if (best.length === 0 || value > best[0]!.score)
      best = [{ rate, score: value }]
    else if (value === best[0]!.score) best.push({ rate, score: value })
  }
  if (best.length === 0) return null

  const ties = best.map((entry) => entry.rate)
  const rate = ties.reduce((a, b) => (b.usd > a.usd ? b : a))
  const varies = (dim: "resolution" | "audio") =>
    facts[dim] === null &&
    ties.some((other) => other[dim] !== rate[dim] && other.usd !== rate.usd)
  const assumed = (["resolution", "audio"] as const).filter(varies)
  return { rate, assumed }
}

function unknownCost(
  note: string,
  basis: PricingBasis,
  rate: ParsedRate | null = null
): CostEstimateResult {
  return {
    amount: 0,
    currency: "USD",
    basis,
    confidence: "unknown",
    source: "none",
    note,
    sku: rate?.key ?? null,
    rate: rate ? { amount: rate.usd, unit: UNITS[rate.basis] } : null,
  }
}

interface FoundRates {
  rates: ParsedRate[]
  source: Exclude<PricingSource, "none">
  note: string
  /** A floor on one generation's price (`minimum_cents_per_generation`). */
  minimumUsd: number
  /** Added per image the run sends (`cents_per_image_input`). */
  perImageInputUsd: number
}

function centsSku(skus: Record<string, string>, key: string): number {
  return (parseRate(skus[key]) ?? 0) / 100
}

/**
 * The rates that apply to this model, and where they came from: the
 * provider's own published SKUs first, the curated table for a gap. A string
 * instead is the reason there is no usable rate.
 */
function ratesFor(input: EstimateCostInput): FoundRates | string {
  const skus = input.provider === "openrouter" ? input.pricingSkus : {}
  const rates = Object.entries(skus)
    .map(([key, value]) => parseOpenRouterSku(key, value))
    .filter((rate) => rate !== null)
  if (rates.length > 0)
    return {
      rates,
      source: "provider_api",
      note: "Estimated from OpenRouter's published rate.",
      minimumUsd: centsSku(skus, "minimum_cents_per_generation"),
      perImageInputUsd: centsSku(skus, "cents_per_image_input"),
    }

  const curated = curatedPrice(input.provider, input.slug)
  if (curated)
    return {
      rates: Object.entries(curated.tiers).map(([key, usd]) =>
        parseCuratedTier(key, usd, curated.basis)
      ),
      source: "local_table",
      note: `${curated.note} No pricing API publishes this rate, so it was copied by hand from ${curated.source} (checked ${curated.checked}) and is an unverified estimate.`,
      minimumUsd: 0,
      perImageInputUsd: 0,
    }

  const keys = Object.keys(skus)
  if (keys.some((key) => key.includes("token"))) return OPENROUTER_TOKEN_NOTE
  if (keys.length > 0)
    return `OpenRouter prices this model by ${keys.join(", ")}, which OpenDirect cannot estimate before the run. It reports the exact cost when the job completes.`
  return UNKNOWN_NOTE
}

/**
 * Best-effort pre-flight price for one generation. Always returns a result;
 * callers render `confidence === "unknown"` as "cost unknown", never as $0.00.
 */
export function estimateCost(input: EstimateCostInput): CostEstimateResult {
  const found = ratesFor(input)
  if (typeof found === "string")
    return unknownCost(
      found,
      found === OPENROUTER_TOKEN_NOTE ? "per_token" : "unknown"
    )

  const facts: RunFacts = {
    resolution: readResolution(input),
    audio: readAudio(input),
    input: readInputMode(input.params),
  }

  // A run no published rate fits exactly (a new resolution tier, an input
  // mode the SKUs do not name) is quoted at the worst case of what is
  // published rather than dropped to "unknown": over-quoting is recoverable,
  // under-quoting is not.
  let mismatch = ""
  let picked = pickRate(found.rates, facts)
  if (!picked && facts.resolution !== null) {
    picked = pickRate(found.rates, { ...facts, resolution: null })
    if (picked)
      mismatch = ` No rate is published for ${facts.resolution}, so the worst-case (dearest) tier is quoted.`
  }
  if (!picked) {
    picked = pickRate(found.rates, {
      resolution: null,
      audio: null,
      input: null,
    })
    mismatch =
      " No published rate matches this run exactly, so the dearest published rate is quoted."
  }
  if (!picked) return unknownCost(UNKNOWN_NOTE, "unknown")
  const { rate, assumed } = picked

  let quantity: number | null
  let durationNote = ""
  if (rate.basis === "per_second") {
    const duration = readDuration(input)
    quantity = duration?.seconds ?? null
    if (duration?.fromDefault)
      durationNote = ` No duration is set, so the model's default of ${duration.seconds} s is used.`
  } else {
    quantity =
      readNumber(input.params, [
        detectOutputCountField(input.inputSchema)?.field,
        "num_outputs",
        "n",
      ]) ?? 1
  }

  if (quantity === null || quantity <= 0) {
    return unknownCost(
      rate.basis === "per_second"
        ? "Pick a duration to see an estimated cost for this model."
        : "Pick an output count to see an estimated cost for this model.",
      rate.basis,
      rate
    )
  }

  const images = found.perImageInputUsd > 0 ? countImageInputs(input.params) : 0
  const surcharge = images * found.perImageInputUsd
  const amount = Math.max(rate.usd * quantity + surcharge, found.minimumUsd)

  const assumptions = [
    mismatch ||
      (assumed.includes("resolution")
        ? " No resolution is set, so the worst-case (dearest) tier is quoted."
        : ""),
    assumed.includes("audio")
      ? " Audio is unset, so the with-audio rate is quoted."
      : "",
    durationNote,
    surcharge > 0 ? ` Includes a charge for ${images} input image(s).` : "",
    amount === found.minimumUsd && amount > rate.usd * quantity + surcharge
      ? " The provider's minimum charge per generation applies."
      : "",
    found.source === "provider_api"
      ? " The exact cost is reported when the job completes."
      : "",
  ].join("")

  return {
    amount,
    currency: "USD",
    basis: rate.basis,
    confidence: "estimated",
    source: found.source,
    note: `${found.note}${assumptions}`,
    sku: rate.key,
    rate: { amount: rate.usd, unit: UNITS[rate.basis] },
  }
}

/**
 * The quote for one descriptor and one set of form values — the single place
 * a descriptor's rates, schema and control names are handed to
 * `estimateCost`, so a duration or resolution control feeds every caller.
 */
export function estimateForDescriptor(
  descriptor: ModelDescriptor,
  params: GenerationParams
): CostQuote {
  return estimateCost({
    provider: descriptor.provider,
    kind: descriptor.kind,
    slug: descriptor.slug,
    pricingSkus: descriptor.pricing.skus,
    params,
    inputSchema: descriptor.inputSchema,
    controls: descriptor.commonControls,
  })
}
