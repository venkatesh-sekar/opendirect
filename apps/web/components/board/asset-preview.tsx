"use client"

import type { AssetDto } from "@opendirect/contract"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@workspace/ui/components/button"

export interface AssetPreviewProps {
  asset: AssetDto
  onClose: () => void
}

function facts(asset: AssetDto): [string, string][] {
  const rows: [string, string][] = [["Kind", asset.kind]]
  if (asset.width && asset.height) {
    rows.push(["Size", `${asset.width} × ${asset.height}`])
  }
  if (asset.durationMs) {
    rows.push(["Duration", `${(asset.durationMs / 1000).toFixed(1)}s`])
  }
  if (asset.bytes) {
    rows.push(["On disk", `${Math.round(asset.bytes / 1024)} KB`])
  }
  if (asset.generationId) rows.push(["Source", "Generated"])
  return rows
}

/**
 * The right pane: the selected tile, large. Deliberately thin — the full
 * details, lineage and "use as reference" actions arrive with the output cards.
 */
export function AssetPreview({ asset, onClose }: AssetPreviewProps) {
  const label = asset.label ?? asset.originalName ?? asset.kind

  return (
    <aside className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <h2 className="truncate text-sm font-medium">{label}</h2>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Close preview"
          className="ml-auto"
          onClick={onClose}
        >
          <HugeiconsIcon icon={Cancel01Icon} className="size-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {asset.kind === "video" && asset.url ? (
          <video
            src={asset.url}
            poster={asset.thumbnailUrl ?? undefined}
            controls
            className="w-full rounded-md bg-muted"
          />
        ) : asset.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.url}
            alt={label}
            className="w-full rounded-md bg-muted"
          />
        ) : (
          <p className="rounded-md bg-muted p-3 text-sm">
            {asset.text ?? label}
          </p>
        )}

        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
          {facts(asset).map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-muted-foreground">{term}</dt>
              <dd className="tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </aside>
  )
}
