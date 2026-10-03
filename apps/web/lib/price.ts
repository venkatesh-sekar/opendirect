import type { CostQuote, PriceHint, ProviderId } from "@opendirect/contract"

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

/**
 * The creation bar's cost badge.
 *
 * `~$0.64` for an estimate, `$0.64` for a provider-reported figure, and
 * `Cost unknown` when there is no usable rate — never `$0.00`. A model whose
 * price we cannot know must say so; a zero would read as "free", which is the
 * one thing it is not.
 */
export function formatCostQuote(quote: CostQuote | null | undefined): string {
  if (!quote || quote.confidence === "unknown") {
    // A known rate still missing its quantity (no duration yet) shows the
    // rate, `$0.20/s` — what the model is billed at — never a total.
    return formatRate(quote?.rate) ?? "Cost unknown"
  }
  const prefix = quote.confidence === "estimated" ? "~" : ""
  return `${prefix}${formatUsd(quote.amount)}`
}

const RATE_UNITS: Record<string, string> = { second: "s", output: "output" }

/** `{ amount: 0.2, unit: "second" }` → `$0.20/s`; null when there is no rate. */
export function formatRate(rate: CostQuote["rate"]): string | null {
  if (!rate) return null
  return `${formatUsd(rate.amount)}/${RATE_UNITS[rate.unit] ?? rate.unit}`
}

const PROVIDER_PAGES: Record<ProviderId, { name: string; base: string }> = {
  replicate: { name: "Replicate", base: "https://replicate.com/" },
  openrouter: { name: "OpenRouter", base: "https://openrouter.ai/" },
}

/**
 * The provider's own public page for a model, where its price is listed —
 * the place to check when OpenDirect cannot quote one.
 */
export function providerModelPage(
  provider: ProviderId,
  slug: string
): { name: string; url: string } {
  const page = PROVIDER_PAGES[provider]
  const path = slug.split("/").map(encodeURIComponent).join("/")
  return { name: page.name, url: `${page.base}${path}` }
}
