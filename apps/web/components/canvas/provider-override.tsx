"use client"

/**
 * A family node's provider override (design §5.1; planning decision 11).
 *
 * A family runs wherever the settings' provider order and the node's wiring
 * send it — "Auto". This lets one node insist on one provider instead: the
 * endpoint is then chosen among that provider's alone, and a wire it cannot
 * take blocks the run with its reason rather than quietly moving elsewhere.
 *
 * It sits beside the model chip in the prompt bar's one toolbar row, so it
 * states its width and, below the bar's narrow breakpoint, collapses to an
 * icon whose name and title carry the choice.
 *
 * Only the providers the family has an endpoint on are offered. One with no
 * key is shown but refused, with the fix. ⛔ Choosing one writes the node's
 * `providerOverride`, through `onChange`; it runs nothing.
 */
import { useId, useMemo } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { CloudServerIcon } from "@hugeicons/core-free-icons"
import {
  chooseEndpoint,
  PROVIDER_NAMES,
  providerIdSchema,
  type FamilyInfo,
  type ProviderId,
} from "@opendirect/contract"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { cn } from "@workspace/ui/lib/utils"

/** Base UI's select wants a string for every item, "Auto" included. */
const AUTO = "auto"

export interface ProviderOverrideProps {
  /** `descriptor.family` — fetched with this node's override and wiring. */
  family: FamilyInfo
  /** The node's `providerOverride`; null is Auto. */
  value: ProviderId | null
  /** The node's filled slot keys, which decide where Auto goes. */
  filled: readonly string[]
  onChange: (value: ProviderId | null) => void
  /** Icon-only, for the bar's narrow width. */
  compact?: boolean
  className?: string
}

export function ProviderOverride({
  family,
  value,
  filled,
  onChange,
  compact = false,
  className,
}: ProviderOverrideProps) {
  const reasonId = useId()

  /** Where Auto would run this wiring: the settings order's choice. */
  const autoProvider = useMemo(() => {
    const choice = chooseEndpoint(family.family, {
      filled,
      providerOrder: family.providerOrder,
      configured: family.configured,
      override: null,
    })
    return choice.index === null
      ? null
      : family.family.endpoints[choice.index]!.provider
  }, [family, filled])

  const providers = providerIdSchema.options.filter((provider) =>
    family.family.endpoints.some((endpoint) => endpoint.provider === provider)
  )

  const autoLabel = autoProvider
    ? `Auto · ${PROVIDER_NAMES[autoProvider]}`
    : "Auto"
  const current = value ? PROVIDER_NAMES[value] : autoLabel
  const name = `Provider: ${current}`
  /** The chosen endpoint's own sentence when it cannot run. */
  const blocked = family.choice.message

  return (
    <span className={cn("nokey inline-flex shrink-0", className)}>
      <Select
        value={value ?? AUTO}
        onValueChange={(next: string | null) => {
          if (next === null) return
          onChange(next === AUTO ? null : (next as ProviderId))
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label={name}
          title={blocked ? `${name}. ${blocked}` : name}
          aria-invalid={blocked ? true : undefined}
          aria-describedby={blocked ? reasonId : undefined}
          data-testid="provider-override"
          className={cn(
            "h-8 text-xs text-muted-foreground",
            // Stated widths: a provider name arriving must not move Run.
            compact
              ? "w-8 justify-center px-0 [&>svg:last-child]:hidden"
              : "w-32"
          )}
        >
          {compact ? (
            <HugeiconsIcon icon={CloudServerIcon} className="size-3.5" />
          ) : (
            <SelectValue className="min-w-0 truncate">
              {() => current}
            </SelectValue>
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO}>{autoLabel}</SelectItem>
          {providers.map((provider) => {
            const configured = family.configured.includes(provider)
            return (
              <SelectItem
                key={provider}
                value={provider}
                disabled={!configured}
                title={
                  configured
                    ? undefined
                    : `No ${PROVIDER_NAMES[provider]} key. Add one in Settings.`
                }
              >
                {PROVIDER_NAMES[provider]}
                {configured ? null : (
                  <span className="ml-auto text-muted-foreground">Add key</span>
                )}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
      {blocked ? (
        <span id={reasonId} className="sr-only">
          {blocked}
        </span>
      ) : null}
    </span>
  )
}
