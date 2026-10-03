/**
 * The hand-curated price table, `registry/pricing.json`.
 *
 * Replicate's API exposes no price for a model (verified 2026-10-03:
 * `GET /v1/models/{owner}/{name}` carries `run_count` and the schemas, no
 * rate), so its rates are copied by hand from the `current_tiers` block each
 * model's public page embeds. OpenRouter publishes `pricing_skus` per model
 * and those always win; an `openrouter:` entry here only fills a model that
 * publishes none.
 *
 * Like the model families, the file is JSON compiled into the main bundle (see
 * `model-registry/bundled.ts`), so updating a rate is a data edit, not a code
 * change. It is validated here, at load: a malformed table fails loudly in
 * tests rather than silently quoting nothing.
 */
import { z } from "zod"

import {
  modelKey,
  type PriceHint,
  type Pricing,
  type ProviderId,
} from "@opendirect/contract"

import table from "../../../../../registry/pricing.json"

const curatedPriceSchema = z.object({
  basis: z.enum(["per_second", "per_output"]),
  /** The day the rates were last compared with `source` (YYYY-MM-DD). */
  checked: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** The provider page the rates were copied from. */
  source: z.url(),
  note: z.string(),
  /**
   * USD per unit, keyed `<resolution>` or `*`, optionally with a `:video_in`,
   * `:audio` or `:silent` variant.
   */
  tiers: z
    .record(z.string(), z.number().nonnegative())
    .refine((tiers) => Object.keys(tiers).length > 0, "no tiers"),
})
export type CuratedPrice = z.output<typeof curatedPriceSchema>

const curatedTableSchema = z.object({
  format: z.literal(1),
  models: z.record(z.string(), curatedPriceSchema),
})

/** Every curated rate, keyed by model key (`replicate:owner/name`). */
export const CURATED_PRICING: Readonly<Record<string, CuratedPrice>> =
  curatedTableSchema.parse(table).models

/** The curated rate for one model, or null when the table has none. */
export function curatedPrice(
  provider: ProviderId,
  slug: string | null | undefined
): CuratedPrice | null {
  if (!slug) return null
  return CURATED_PRICING[modelKey(provider, slug)] ?? null
}

/** A descriptor's pricing block from a curated entry: its tiers, verbatim. */
export function curatedPricing(price: CuratedPrice, caveat: string): Pricing {
  const skus: Record<string, string> = {}
  for (const [tier, usd] of Object.entries(price.tiers))
    skus[tier] = String(usd)
  return {
    basis: price.basis,
    currency: "USD",
    skus,
    // A pre-flight number needs the form values; the creation bar calls
    // `estimateCost` with them. The descriptor only carries the rates.
    estimate: null,
    source: "local_table",
    note: `${price.note} ${caveat} Last checked ${price.checked}.`,
  }
}

/**
 * The cheapest curated rate, for the picker's one-line hint.
 *
 * The `:video_in` variants are left out, being dearer by construction, and so
 * is `nano-banana-pro`'s `fallback` tier: a rate Replicate publishes but
 * OpenDirect never quotes, so advertising it as the "from" price would
 * understate every real run. A `:silent` rate is a run anyone can choose, so
 * it counts.
 */
export function curatedPriceHint(price: CuratedPrice): PriceHint | null {
  let lowest: number | null = null
  for (const [tier, usd] of Object.entries(price.tiers)) {
    if (tier.endsWith(":video_in") || tier === "fallback") continue
    if (lowest === null || usd < lowest) lowest = usd
  }
  if (lowest === null) return null
  return {
    amount: lowest,
    unit: price.basis === "per_second" ? "second" : "output",
    basis: price.basis,
    source: "local_table",
  }
}
