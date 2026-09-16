"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { AiMagicIcon, Upload04Icon } from "@hugeicons/core-free-icons"
import { Button } from "@workspace/ui/components/button"

export interface BoardEmptyStateProps {
  onImport: () => void
  importing?: boolean
}

/**
 * An empty board is an invitation, not an apology: it names the two ways
 * something gets onto it and puts the cheaper one under the cursor.
 */
export function BoardEmptyState({ onImport, importing }: BoardEmptyStateProps) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-lg border border-dashed px-8 py-12 text-center">
        <HugeiconsIcon
          icon={Upload04Icon}
          className="size-6 text-muted-foreground"
          strokeWidth={1.5}
        />
        <p className="text-sm text-muted-foreground">
          Drop files or generate something.
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onImport} disabled={importing}>
            {importing ? "Importing…" : "Import files"}
          </Button>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <HugeiconsIcon icon={AiMagicIcon} className="size-3.5" />
            or describe a shot below
          </span>
        </div>
      </div>
    </div>
  )
}
