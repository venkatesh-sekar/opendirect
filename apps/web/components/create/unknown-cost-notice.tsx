"use client"

/**
 * The acknowledgement a run with no estimate needs before it can start.
 *
 * It says *why* there is no number — the quote's own note: no published rate
 * at all, a per-token price, or a rate that only lacks a duration — and links
 * the provider's model page, where the price is listed. A model whose rate is
 * known reads "billed at $0.20/s", never "pricing is unavailable".
 *
 * ⛔ Ticking it runs nothing; it only lets the user press Generate.
 */
import type { CostQuote, ModelDescriptor } from "@opendirect/contract"
import { cn } from "@workspace/ui/lib/utils"

import { formatRate, providerModelPage } from "@/lib/price"

export interface UnknownCostNoticeProps {
  quote: CostQuote | null | undefined
  descriptor: Pick<ModelDescriptor, "provider" | "slug">
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  className?: string
}

export function UnknownCostNotice({
  quote,
  descriptor,
  checked,
  onCheckedChange,
  className,
}: UnknownCostNoticeProps) {
  const rate = formatRate(quote?.rate)
  const page = providerModelPage(descriptor.provider, descriptor.slug)
  return (
    <div
      data-testid="unknown-cost-notice"
      className={cn("space-y-1 rounded-md border p-2 text-xs", className)}
    >
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onCheckedChange(event.target.checked)}
        />
        <span>
          {rate
            ? `I understand this run's cost can't be estimated yet (billed at ${rate}). It may incur charges; the provider determines the final cost.`
            : "I understand pricing is unavailable for this model. This run may incur charges; the provider determines the final cost."}
        </span>
      </label>
      <p className="pl-5 text-muted-foreground">
        {quote?.note ? `${quote.note} ` : null}
        <a
          href={page.url}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          See pricing on {page.name}
        </a>
      </p>
    </div>
  )
}
