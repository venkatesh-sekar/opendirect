/**
 * What the creation bar sends, and what a cost quote looks like coming back.
 *
 * A `GenerationRequest` is deliberately *not* a provider payload: it names a
 * catalog model, carries the schema-driven params verbatim, and refers to
 * references by asset id. Turning asset ids into provider URLs is the job
 * runner's job and happens entirely in the main process, so the
 * renderer never has to know how a provider wants its files.
 *
 * ⛔ Submitting a request records a `queued` row and hands it to the runner.
 * Nothing in this file calls a provider.
 */
import { z } from "zod"

import {
  costConfidenceSchema,
  pricingBasisSchema,
  pricingSourceSchema,
} from "./model"

/**
 * One asset in one reference slot. `position` is explicit because order is
 * meaningful to a model (`first_frame` before `last_frame`, a reference list
 * the user ranked) and must survive the round-trip unchanged.
 */
export const generationReferenceSchema = z.object({
  /** The model's own field name, e.g. `reference_images`. */
  slotField: z.string().min(1),
  assetId: z.string().min(1),
  position: z.number().int().min(0),
})
export type GenerationReference = z.output<typeof generationReferenceSchema>

export const generationRequestSchema = z.object({
  /** Catalog key: `"replicate:bytedance/seedance-2.5"`. */
  modelKey: z.string().min(1),
  /** The board the outputs land on; null when no container is selected. */
  containerId: z.string().nullable(),
  prompt: z.string().nullable(),
  /**
   * Every non-reference input the form produced, under the model's own field
   * names. Reference slots are carried in `references` instead, because their
   * values are asset ids the main process still has to resolve.
   */
  params: z.record(z.string(), z.unknown()),
  references: z.array(generationReferenceSchema),
  /** The pre-flight quote shown on the button, recorded with the run. */
  estimatedCostUsd: z.number().nullable(),
  costConfidence: costConfidenceSchema.nullable(),
  /** Set when the run is a variant of an earlier one. */
  parentGenerationId: z.string().nullable(),
  /**
   * Groups the sibling runs the canvas submits when the user asks for N
   * results and the model has no native output-count field. Defaulted rather
   * than required so every existing caller — the creation bar, a branch, a
   * retry — keeps building a valid request without knowing the canvas exists.
   */
  batchId: z.string().nullable().default(null),
})
export type GenerationRequest = z.output<typeof generationRequestSchema>

/**
 * A pre-flight price. Mirrors `estimateCost`'s result in the main process;
 * `confidence: "unknown"` is rendered as "Cost unknown", never as `$0.00`.
 */
export const costQuoteSchema = z.object({
  amount: z.number(),
  currency: z.literal("USD"),
  basis: pricingBasisSchema,
  confidence: costConfidenceSchema,
  source: pricingSourceSchema,
  /** Why it is an estimate, or why there is no number at all. */
  note: z.string().nullable(),
  sku: z.string().nullable(),
})
export type CostQuote = z.output<typeof costQuoteSchema>
