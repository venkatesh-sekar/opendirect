"use client"

/**
 * A role as a badge: its icon and name (design §2).
 *
 * A role a registry mapping set is plain. A role guessed from the field name
 * (`verified === false`, degraded mode in design §4) is drawn with a dashed
 * outline and the word "unverified", and says — on hover or keyboard focus —
 * how to make it real. The Models settings tab, the mapping editor, the model
 * picker and the canvas slots all use this, so a role looks the same
 * everywhere.
 */
import { useId } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Badge } from "@workspace/ui/components/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import { roleMeta } from "@/lib/registry/role-meta"

export const UNVERIFIED_HINT =
  "Guessed from the field name. Add a mapping in Settings → Models to verify it."

export interface RoleBadgeProps {
  /** A role, or a slot key such as `reference:2`. */
  role: string
  /** False when a name guess, not a mapping, set the role. Default true. */
  verified?: boolean
  className?: string
}

export function RoleBadge({
  role,
  verified = true,
  className,
}: RoleBadgeProps) {
  const meta = roleMeta(role)
  const hintId = useId()

  const content = (
    <>
      <HugeiconsIcon icon={meta.icon} data-icon="inline-start" aria-hidden />
      {meta.label}
      {verified ? null : (
        <span className="text-muted-foreground">· unverified</span>
      )}
    </>
  )

  if (verified) {
    return (
      <Badge
        variant="outline"
        data-role={meta.role}
        data-verified="true"
        title={meta.description}
        className={cn("font-normal", className)}
      >
        {content}
      </Badge>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant="outline"
            tabIndex={0}
            data-role={meta.role}
            data-verified="false"
            aria-describedby={hintId}
            className={cn(
              "border-dashed font-normal text-muted-foreground",
              className
            )}
          />
        }
      >
        {content}
        <span id={hintId} className="sr-only">
          {UNVERIFIED_HINT}
        </span>
      </TooltipTrigger>
      <TooltipContent>{UNVERIFIED_HINT}</TooltipContent>
    </Tooltip>
  )
}
