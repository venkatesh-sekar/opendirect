/**
 * The normalized model descriptor.
 *
 * Replicate and OpenRouter describe their models in completely different
 * shapes; every provider adapter (Tasks 9 and 10) flattens its payload into
 * the schemas below so the renderer only ever knows one model shape. The
 * provider payload is kept verbatim in `raw` for the Details panel — we
 * normalize for the UI, we never discard the source of truth.
 */
import { z } from "zod"

import { providerIdSchema } from "./provider"

/** Coarse output modality, used for filtering and for picking a cost basis. */
export const modelKindSchema = z.enum([
  "video",
  "image",
  "text",
  "audio",
  "other",
])
export type ModelKind = z.output<typeof modelKindSchema>

/** What an asset dropped into a slot is used for by the model. */
export const referenceRoleSchema = z.enum([
  "reference",
  "first_frame",
  "last_frame",
  "motion",
  "source",
  "unknown",
])
export type ReferenceRole = z.output<typeof referenceRoleSchema>

/**
 * An input field that accepts an Asset rather than a scalar — the drop targets
 * the board drags assets onto. Derived from the model's own input schema, so a
 * model we have never seen still gets working slots.
 */
export const referenceSlotSchema = z.object({
  /** Input field name, e.g. `reference_images`. */
  field: z.string(),
  /** Human label, e.g. `Reference Images`. */
  label: z.string(),
  kind: z.enum(["image", "video", "audio", "any"]),
  multiple: z.boolean(),
  /** Upper bound on items when `multiple`; null when the model states none. */
  max: z.number().nullable(),
  role: referenceRoleSchema,
})
export type ReferenceSlot = z.output<typeof referenceSlotSchema>

/**
 * The handful of controls worth promoting out of the generated form into the
 * creation bar. Each value is the model's own field name, or null when the
 * model has no such control — never a guess at a default.
 */
export const commonControlsSchema = z.object({
  prompt: z.string().nullable(),
  aspectRatio: z.string().nullable(),
  duration: z.string().nullable(),
  resolution: z.string().nullable(),
  seed: z.string().nullable(),
  audio: z.string().nullable(),
})
export type CommonControls = z.output<typeof commonControlsSchema>

/** How a price is charged. `unknown` means we have no usable rate at all. */
export const pricingBasisSchema = z.enum([
  "per_second",
  "per_output",
  "per_token",
  "unknown",
])
export type PricingBasis = z.output<typeof pricingBasisSchema>

/** How much to trust an estimate. `exact` is only ever a provider-reported cost. */
export const costConfidenceSchema = z.enum(["exact", "estimated", "unknown"])
export type CostConfidence = z.output<typeof costConfidenceSchema>

/**
 * Where a price came from. Replicate exposes no pricing endpoint, so its
 * numbers are `local_table` and always shown as unverified estimates.
 */
export const pricingSourceSchema = z.enum([
  "provider_api",
  "local_table",
  "none",
])
export type PricingSource = z.output<typeof pricingSourceSchema>

export const costEstimateSchema = z.object({
  amount: z.number(),
  confidence: costConfidenceSchema,
})
export type CostEstimate = z.output<typeof costEstimateSchema>

export const pricingSchema = z.object({
  basis: pricingBasisSchema,
  currency: z.literal("USD"),
  /**
   * The provider's pricing keys, verbatim. OpenRouter's `pricing_skus` keys
   * differ per model (`video_tokens`, `duration_seconds_with_audio_720p`, …),
   * so they are carried untouched and interpreted generically.
   */
  skus: z.record(z.string(), z.string()),
  estimate: costEstimateSchema.nullable(),
  source: pricingSourceSchema,
  note: z.string().nullable(),
})
export type Pricing = z.output<typeof pricingSchema>

/**
 * The cheapest published rate for a model, for the one-line hint in the model
 * picker. It is deliberately *not* a quote: a real number needs the form
 * values, which the picker does not have. `null` on a summary means the price
 * is unknown, and the picker must say exactly that rather than show "$0.00".
 */
export const priceHintSchema = z.object({
  /** Lowest published rate across the model's tiers/SKUs, in USD. */
  amount: z.number(),
  /** What the rate is charged per: `second`, `output`, `token`. */
  unit: z.string(),
  basis: pricingBasisSchema,
  source: pricingSourceSchema,
})
export type PriceHint = z.output<typeof priceHintSchema>

/** Everything the model picker needs, without the full JSON Schema payload. */
export const modelSummarySchema = z.object({
  key: z.string(),
  provider: providerIdSchema,
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  kind: modelKindSchema,
  coverImageUrl: z.string().nullable(),
  /** Null when no rate is published — rendered as "price unknown". */
  priceHint: priceHintSchema.nullable(),
})
export type ModelSummary = z.output<typeof modelSummarySchema>

/**
 * A curated model the picker offers first. `available` is false when the
 * refreshed catalog does not list the key — a recommendation is a hint, never
 * a promise, so the row is shown greyed out rather than silently dropped.
 */
export const recommendedModelSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: modelKindSchema,
  available: z.boolean(),
})
export type RecommendedModel = z.output<typeof recommendedModelSchema>

export const modelDescriptorSchema = z.object({
  /** Globally unique: `"replicate:bytedance/seedance-2.5"`. */
  key: z.string(),
  provider: providerIdSchema,
  /** Provider-local id: `"bytedance/seedance-2.5"`. */
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  kind: modelKindSchema,
  /** Replicate version id pinned at fetch time; null for OpenRouter. */
  versionId: z.string().nullable(),
  coverImageUrl: z.string().nullable(),
  /** JSON Schema (draft-07 compatible) fed straight to `@rjsf/shadcn`. */
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()).nullable(),
  referenceSlots: z.array(referenceSlotSchema),
  commonControls: commonControlsSchema,
  pricing: pricingSchema,
  /** The provider payload, verbatim, for the Details panel. */
  raw: z.unknown(),
  /** Epoch ms the descriptor was fetched, for cache staleness. */
  fetchedAt: z.number(),
})
export type ModelDescriptor = z.output<typeof modelDescriptorSchema>

/** The one place `provider` and `slug` are joined into a catalog key. */
export function modelKey(provider: ProviderIdInput, slug: string): string {
  return `${provider}:${slug}`
}

type ProviderIdInput = z.output<typeof providerIdSchema>

/** Inverse of `modelKey`; returns null for anything not in `provider:slug` form. */
export function parseModelKey(
  key: string
): { provider: ProviderIdInput; slug: string } | null {
  const separator = key.indexOf(":")
  if (separator <= 0) return null
  const provider = providerIdSchema.safeParse(key.slice(0, separator))
  const slug = key.slice(separator + 1)
  if (!provider.success || slug.length === 0) return null
  return { provider: provider.data, slug }
}

/** A descriptor with no usable price — the honest default. */
export const unknownPricing: Pricing = {
  basis: "unknown",
  currency: "USD",
  skus: {},
  estimate: null,
  source: "none",
  note: null,
}
