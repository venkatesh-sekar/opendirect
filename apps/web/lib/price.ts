import type { PriceHint } from "@opendirect/contract"

/** `0.0000107` → `$0.0000107`; a small rate keeps its significant digits. */
export function formatUsd(amount: number): string {
  if (amount >= 0.01) return `$${amount.toFixed(2)}`
  if (amount >= 0.0001) return `$${amount.toFixed(4)}`
  return `$${amount.toPrecision(2)}`
}

/**
 * The model picker's per-row price.
 *
 * A missing hint reads as "price unknown" — never as `$0.00`. OpenDirect does
 * not invent a price it has not been told, and a free-looking row next to a
 * paid generation is the one mistake this string must never make.
 *
 * `est.` marks a rate transcribed by hand from a provider's public page
 * (Replicate publishes no pricing API), as opposed to one the provider's own
 * API returned.
 */
export function formatPriceHint(hint: PriceHint | null | undefined): string {
  if (!hint) return "price unknown"
  const estimate = hint.source === "local_table" ? " est." : ""
  return `from ${formatUsd(hint.amount)}/${hint.unit}${estimate}`
}
