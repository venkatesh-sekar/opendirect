/**
 * Asking for N results, and working out how few jobs that costs.
 *
 * A model that can produce several outputs in one prediction says so in its
 * own input schema — `num_outputs`, `num_images`, `n`. Setting that field is
 * one job instead of N, which is both cheaper to queue and what the provider
 * expects. A model that says nothing of the kind gets N identical sibling
 * jobs, and the two are held together by one `batchId`.
 *
 * This lives in the contract rather than in main because both sides need the
 * same answer: main submits the plan, and the renderer's cost line has to say
 * "4 runs" or "1 run" *before* anything is submitted. One implementation, one
 * verdict — the same reason `splitSchema` is the only thing allowed to decide
 * which control a field is.
 *
 * ⛔ Nothing here submits anything or contacts a provider. It produces
 * `GenerationRequest` values and stops; `generations:submitBatch` is what
 * writes the queued rows, and only from a click.
 */
import type { GenerationRequest } from "./generation"

/**
 * A model's own JSON input schema, as the catalog recorded it. Unknown shape
 * on purpose: a model we have never seen can put anything in here.
 */
export type JsonInputSchema = Record<string, unknown>

/** The count field a model declares, with the bounds it declares for it. */
export interface OutputCountField {
  /** The model's own field name — what goes in `params`. */
  field: string
  /** The schema's `minimum`, or 1 when it states none. */
  min: number
  /** The schema's `maximum`, or null when it states none. */
  max: number | null
}

/**
 * The nouns a count field counts. A field only reads as an output count when
 * it names one of these, which is what keeps `num_inference_steps` (steps),
 * `num_frames` (frames) and `seed` out.
 */
const OUTPUT_NOUNS = new Set([
  "output",
  "outputs",
  "image",
  "images",
  "video",
  "videos",
  "sample",
  "samples",
  "generation",
  "generations",
  "result",
  "results",
  "variation",
  "variations",
])

/** The quantifiers that may lead a count field: `num_images`, `number_of_images`. */
const QUANTIFIERS = new Set(["num", "nums", "number", "n", "count"])

/**
 * A count larger than this is not an output count — it is a seed range, a
 * pixel dimension or a step budget that happens to be spelled like one. No
 * provider offers a hundred outputs from a single prediction, so a schema
 * claiming it has been misread.
 */
const MAX_PLAUSIBLE_OUTPUTS = 100

function tokensOf(field: string): string[] {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== "" && token !== "of")
}

/**
 * Does this field name read as "how many results do you want"?
 *
 * Deliberately narrow. The cost of a false positive is a parameter silently
 * overwritten on a paid run — `num_inference_steps` set to 4 is a ruined
 * image the user paid for — while the cost of a false negative is only N
 * sibling jobs instead of one, which still produces exactly what was asked
 * for.
 */
function namesAnOutputCount(field: string): boolean {
  const tokens = tokensOf(field)
  if (tokens.length === 0) return false

  // `n`, the OpenAI spelling, is a count on its own and nothing else.
  if (tokens.length === 1) return tokens[0] === "n"

  // `num_outputs`, `number_of_images`, `n_samples`.
  const [head, ...rest] = tokens
  if (head !== undefined && QUANTIFIERS.has(head) && rest.length === 1) {
    return OUTPUT_NOUNS.has(rest[0]!)
  }

  // `output_count`, `image_count`.
  if (tokens.length === 2 && tokens[1] === "count") {
    return OUTPUT_NOUNS.has(tokens[0]!)
  }

  return false
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isIntegerSchema(schema: Record<string, unknown>): boolean {
  const type = schema.type
  if (type === "integer") return true
  return Array.isArray(type) && type.includes("integer")
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/**
 * The model's output-count field, or null when it has none.
 *
 * Three conditions, all required: the schema declares the property as an
 * integer, its name reads as a count of outputs, and whatever bound it states
 * is a plausible one. A model with two such fields — none is known to exist —
 * yields the first in schema order, which is the order the provider listed
 * them in.
 */
export function detectOutputCountField(
  inputSchema: unknown
): OutputCountField | null {
  if (!isObject(inputSchema)) return null
  const properties = inputSchema.properties
  if (!isObject(properties)) return null

  for (const [field, raw] of Object.entries(properties)) {
    if (!isObject(raw)) continue
    if (!isIntegerSchema(raw)) continue
    if (!namesAnOutputCount(field)) continue

    const max = numberOf(raw.maximum)
    // A stated maximum below 1 cannot be an output count, and an implausibly
    // large one means the name matched something that is not one.
    if (max !== null && (max < 1 || max > MAX_PLAUSIBLE_OUTPUTS)) continue

    const min = numberOf(raw.minimum)
    if (min !== null && max !== null && min > max) continue

    return { field, min: min !== null && min >= 1 ? min : 1, max }
  }

  return null
}

export interface BatchPlanInput {
  /** The request the prompt bar built, minus the batch decision. */
  request: GenerationRequest
  /** How many results the user asked for. */
  count: number
  /** The model's own input schema, from its catalog descriptor. */
  inputSchema?: unknown
  /** Supplied when the caller already has an id — otherwise one is minted. */
  batchId?: string
}

export interface BatchPlan {
  /** Shared by every request in the plan, and written to `generations.batch_id`. */
  batchId: string
  /** The model's count field, or null when N siblings is the only way. */
  countField: string | null
  /** One entry per job that will be submitted, in order. */
  requests: GenerationRequest[]
  /** How many jobs — what the cost line multiplies the per-run quote by. */
  runs: number
  /** How many results the plan produces in total. Equals the requested count. */
  outputs: number
}

/**
 * Turns "give me N of these" into the jobs that produce them.
 *
 * Three outcomes, in the order they are tried:
 *
 * - The model has a count field and N fits inside its declared maximum: one
 *   request, with that field set to N.
 * - The model has a count field and N is over its maximum: as many
 *   native-count jobs as it takes, filled to the maximum and with the
 *   remainder in the last one. Four jobs of 4 rather than fifteen of 1.
 * - The model has no count field: N identical siblings.
 *
 * Every request carries the same `batchId`, so the node can find its siblings
 * without scanning `request_json`, and so a native-count run and a sibling run
 * look the same to everything downstream.
 */
export function planBatch(input: BatchPlanInput): BatchPlan {
  const count = Math.max(1, Math.trunc(input.count))
  const batchId = input.batchId ?? webCrypto().randomUUID()
  const countField = detectOutputCountField(input.inputSchema)

  const requests: GenerationRequest[] = countField
    ? splitAcross(count, countField.max).map((size) => ({
        ...input.request,
        params: { ...input.request.params, [countField.field]: size },
        batchId,
      }))
    : Array.from({ length: count }, () => ({
        ...input.request,
        params: { ...input.request.params },
        batchId,
      }))

  return {
    batchId,
    countField: countField ? countField.field : null,
    requests,
    runs: requests.length,
    outputs: count,
  }
}

/**
 * The Web Crypto API, which Node 22 and the Electron renderer both expose as
 * a global. Reached for through `globalThis` because this package deliberately
 * compiles with neither DOM nor Node types — it is the contract, and it must
 * stay true on both sides of the bridge.
 */
function webCrypto(): { randomUUID(): string } {
  return (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto
}

/** `[4, 4, 2]` for ten outputs on a model that caps a prediction at four. */
function splitAcross(count: number, max: number | null): number[] {
  if (max === null || count <= max) return [count]
  const sizes: number[] = []
  let left = count
  while (left > 0) {
    const take = Math.min(max, left)
    sizes.push(take)
    left -= take
  }
  return sizes
}
