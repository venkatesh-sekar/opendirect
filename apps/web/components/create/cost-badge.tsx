"use client"

/**
 * The live price, sitting immediately left of Generate.
 *
 * Price and commitment are read together, so the number is set in the mono
 * face — it is data, not prose — and the button is the only thing louder than
 * it. Three states, and the third is the important one: a model whose rate
 * OpenDirect cannot know says "Cost unknown" and explains why on hover, rather
 * than showing a confident `$0.00` next to a paid button.
 */
import type { CostQuote } from "@opendirect/contract"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import { formatCostQuote } from "@/lib/price"

export interface CostBadgeProps {
  quote: CostQuote | null | undefined
  /** True while a fresh quote is in flight; the last one stays on screen. */
  pending?: boolean
}

const UNKNOWN_FALLBACK =
  "OpenDirect has no usable rate for this model, so it will not guess one. The provider reports the real cost when the run completes."

export function CostBadge({ quote, pending }: CostBadgeProps) {
  const unknown = !quote || quote.confidence === "unknown"
  const label = formatCostQuote(quote)
  const note = quote?.note ?? (unknown ? UNKNOWN_FALLBACK : null)

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            data-testid="cost-badge"
            data-confidence={quote?.confidence ?? "unknown"}
            aria-live="polite"
            className={cn(
              "inline-flex h-9 shrink-0 cursor-default items-center rounded-md px-2.5 font-mono text-sm tabular-nums transition-opacity",
              unknown ? "text-muted-foreground" : "bg-muted/60 text-foreground",
              pending && "opacity-60"
            )}
          />
        }
      >
        {label}
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {note ?? `Estimated from ${quote?.source ?? "no"} pricing data.`}
      </TooltipContent>
    </Tooltip>
  )
}
