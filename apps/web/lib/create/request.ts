/**
 * Turning the creation bar's state into a `GenerationRequest`.
 *
 * Two shapes meet here. The form holds values per *widget* — a prompt box,
 * the promoted common controls, the rjsf Advanced object, and a per-slot list
 * of asset ids. The request holds values per *model field*, with references
 * split out because their values are asset ids that only the main process can
 * resolve to files.
 *
 * Rules:
 *
 * - **A slot field never appears in `params`.** Whatever an Advanced form put
 *   there is discarded; references travel in `references`.
 * - **An unset value is omitted, not nulled.** Sending `null` for a field the
 *   user never touched is a different instruction from leaving it out, and
 *   several models reject it.
 * - **The quote is recorded as it was shown.** An unknown cost stores no
 *   amount at all rather than `0`.
 *
 * ⛔ Building a request does not submit it, and submitting it only queues a
 * row — no provider is called anywhere in this task.
 */
import {
  modelKey,
  type CostQuote,
  type GenerationReference,
  type GenerationRequest,
  type ModelDescriptor,
  type ProviderId,
} from "@opendirect/contract"

import {
  labelFor,
  propertiesOf,
  type JsonSchema,
} from "../schema-form/split-schema"

export interface CreationValues {
  /** The prompt box, verbatim. Trimmed here, never before. */
  prompt: string
  /** Promoted controls, keyed by the model's own field names. */
  common: Record<string, unknown>
  /** The Advanced form's object, keyed the same way. */
  advanced: Record<string, unknown>
  /** Chosen assets per reference slot field, in the order they will be sent. */
  references: Record<string, string[]>
}

export interface BuildRequestInput {
  descriptor: ModelDescriptor
  containerId: string | null
  values: CreationValues
  /** The quote the cost badge was showing when Generate was pressed. */
  quote?: CostQuote | null
  parentGenerationId?: string | null
  /**
   * Groups the sibling runs of one canvas batch. The creation bar never sets
   * one — a single Generate is a single run — so it defaults to null.
   */
  batchId?: string | null
  /**
   * The characters and scenes the prompt mentioned, by container id. Left
   * out, it is null — "not recorded" — rather than "mentioned nobody".
   */
  mentionedContainerIds?: string[] | null
  /**
   * A family node's provider override; null (the default) runs it on the
   * settings order. Main ignores it for a `provider:slug` key.
   */
  providerOverride?: ProviderId | null
}

/** True for a value the user has actually supplied. */
function isSet(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === "string" && value.trim() === "") return false
  if (Array.isArray(value) && value.length === 0) return false
  return true
}

export function buildGenerationRequest(
  input: BuildRequestInput
): GenerationRequest {
  const { descriptor, values } = input
  const slotFields = new Set(descriptor.referenceSlots.map((s) => s.field))

  const params: Record<string, unknown> = {}
  for (const source of [values.advanced, values.common]) {
    for (const [field, value] of Object.entries(source)) {
      if (slotFields.has(field)) continue
      if (!isSet(value) && typeof value !== "boolean" && value !== 0) continue
      params[field] = value
    }
  }

  const prompt = values.prompt.trim()
  const promptField = descriptor.commonControls.prompt
  if (prompt === "") {
    if (promptField) delete params[promptField]
  } else if (promptField) {
    params[promptField] = prompt
  }

  // Slot order is the model's own, so a provider that cares about the order of
  // its inputs gets them the way its schema lists them.
  const references: GenerationReference[] = []
  for (const slot of descriptor.referenceSlots) {
    const chosen = values.references[slot.field] ?? []
    chosen.forEach((assetId, position) => {
      references.push({ slotField: slot.field, assetId, position })
    })
  }

  const quote = input.quote ?? null
  return {
    modelKey: descriptor.key,
    containerId: input.containerId,
    prompt: prompt === "" ? null : prompt,
    params,
    references,
    estimatedCostUsd:
      quote && quote.confidence !== "unknown" ? quote.amount : null,
    costConfidence: quote ? quote.confidence : null,
    parentGenerationId: input.parentGenerationId ?? null,
    batchId: input.batchId ?? null,
    mentionedContainerIds: input.mentionedContainerIds ?? null,
    providerOverride: input.providerOverride ?? null,
    // A family descriptor stands on the endpoint it was chosen (and quoted)
    // on. Main chooses again at submit and refuses a different answer, so a
    // run never costs a price that was not shown.
    quotedEndpoint:
      descriptor.family && descriptor.family.choice.index !== null
        ? modelKey(descriptor.provider, descriptor.slug)
        : null,
    // Main's to set, on the request it translates from a family key.
    familyId: null,
    shapes: null,
  }
}

/**
 * The required fields the request does not answer, by their human label — what
 * the Generate button's tooltip names.
 *
 * A field the model itself defaults counts as answered: that default is what
 * the provider would use, so demanding the user retype it would be theatre.
 */
export function missingRequirements(
  descriptor: ModelDescriptor,
  request: GenerationRequest
): string[] {
  const properties = propertiesOf(descriptor.inputSchema as JsonSchema)
  const schemaRequired = (descriptor.inputSchema as JsonSchema).required
  const required = Array.isArray(schemaRequired) ? schemaRequired : []

  const slots = new Map(descriptor.referenceSlots.map((s) => [s.field, s]))
  const filledSlots = new Set(request.references.map((r) => r.slotField))

  const missing: string[] = []
  // A family descriptor's schema has lost its mapped inputs, so the chosen
  // endpoint's required inputs are on the slots.
  for (const slot of descriptor.referenceSlots) {
    if (slot.required && !filledSlots.has(slot.field)) missing.push(slot.label)
  }
  for (const field of required) {
    if (typeof field !== "string") continue
    const slot = slots.get(field)
    if (slot) {
      if (!filledSlots.has(field) && !slot.required) missing.push(slot.label)
      continue
    }
    if (isSet(request.params[field])) continue
    const schema = properties[field]
    if (schema && "default" in schema && schema.default !== null) continue
    // `false` and `0` are answers, not absences.
    if (field in request.params) continue
    missing.push(schema ? labelFor(field, schema) : field)
  }
  return missing
}

/**
 * Params as the cost estimator should see them.
 *
 * `estimateCost` reads the request to decide which tier applies, and one of
 * Replicate's tiers is "this run has a video input" — which it detects by
 * looking for a populated `reference_videos` / `video` field. Those fields are
 * exactly the ones `buildGenerationRequest` moves out into `references`, so
 * without this the estimator would quote the cheap tier for a video-to-video
 * run. The placeholder values are asset ids, never URLs: the estimator only
 * ever checks whether a field is populated.
 *
 * The prompt is **removed**. No provider prices a media generation by prompt
 * length, and the params are part of the `cost:estimate` query key — leaving it
 * in would re-quote the same price on every keystroke.
 */
export function costParams(
  descriptor: ModelDescriptor,
  request: GenerationRequest
): Record<string, unknown> {
  const params: Record<string, unknown> = { ...request.params }
  const promptField = descriptor.commonControls.prompt
  if (promptField) delete params[promptField]
  // A family's slots are slot keys, which no endpoint has as a field: the
  // quote translates params into the endpoint's, and a slot key there would
  // make every wired family run's price "unknown".
  if (descriptor.family) return params
  for (const slot of descriptor.referenceSlots) {
    const chosen = request.references
      .filter((reference) => reference.slotField === slot.field)
      .map((reference) => reference.assetId)
    if (chosen.length === 0) continue
    params[slot.field] = slot.multiple ? chosen : chosen[0]
  }
  return params
}
