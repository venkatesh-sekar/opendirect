/**
 * The pieces of a composition that do not care where it is being composed —
 * the canvas's prompt bar and a container page's generate panel both use them.
 *
 * Pure: nothing here submits, fetches or spends.
 */
import type {
  CostQuote,
  GenerationReference,
  ModelDescriptor,
} from "@opendirect/contract"

import { buildIconGrid } from "../canvas/icon-grid"
import { schemaDefaults, splitSchema } from "../schema-form/split-schema"

/**
 * A model's own defaults, split the way a draft holds them: the promoted
 * controls and the icon grid's fields in `common`, everything else in
 * `advanced`.
 *
 * Reference slots are never seeded — a slot holds the user's pictures, and a
 * schema default there would be a picture nobody chose.
 */
export function modelDefaults(descriptor: ModelDescriptor): {
  common: Record<string, unknown>
  advanced: Record<string, unknown>
} {
  const split = splitSchema(descriptor)
  const defaults = schemaDefaults(descriptor)
  const commonFields = new Set(split.common.map((field) => field.field))
  for (const field of buildIconGrid(descriptor).fields) commonFields.add(field)
  const slotFields = new Set(split.slots.map((slot) => slot.field))

  const common: Record<string, unknown> = {}
  const advanced: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(defaults)) {
    if (slotFields.has(field)) continue
    if (commonFields.has(field)) common[field] = value
    else advanced[field] = value
  }
  return { common, advanced }
}

/** References grouped the way `buildGenerationRequest` takes them. */
export function groupReferences(
  references: readonly GenerationReference[]
): Record<string, string[]> {
  const grouped: Record<string, string[]> = {}
  for (const reference of [...references].sort(
    (a, b) => a.position - b.position
  )) {
    ;(grouped[reference.slotField] ??= []).push(reference.assetId)
  }
  return grouped
}

/** The quote, as the submitted row records it: no amount when it is unknown. */
export function quoteOf(quote: CostQuote | undefined) {
  return {
    estimatedCostUsd:
      quote && quote.confidence !== "unknown" ? quote.amount : null,
    costConfidence: quote ? quote.confidence : null,
  }
}
