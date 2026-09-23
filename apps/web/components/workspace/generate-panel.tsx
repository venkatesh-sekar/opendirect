"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import type { AssetDto, ContainerNodeDto } from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"

import { AssetTile } from "@/components/canvas/nodes/asset-tile"
import type { GenerateTarget } from "@/lib/workspace/container-page"

import { GenerateForm } from "@/components/create/generate-form"

export type { GenerateTarget }

/** "sheet + 3 refs", "sheet only", or "no references yet". */
export function referenceSummary(count: number): string {
  if (count === 0) return "no references yet"
  if (count === 1) return "sheet only"
  const rest = count - 1
  return `sheet + ${rest} ref${rest === 1 ? "" : "s"}`
}

export interface GeneratePanelProps {
  node: ContainerNodeDto
  /** The character's face for the identity row. */
  cover: AssetDto | null
  /** Somewhere other than `node` to file the run; `node` itself by default. */
  target?: GenerateTarget | null
  onClose: () => void
  /** A run was queued — the page shows it on the Generations tab. */
  onSubmitted?: () => void
}

/** The panel for the page's own container: `@mira ` in the prompt. */
export function ownTarget(node: ContainerNodeDto): GenerateTarget {
  return {
    containerId: node.id,
    label: node.handle ? `Generate with @${node.handle}` : "Generate",
    destination: node.name,
    initialPrompt: node.handle ? `@${node.handle} ` : (node.description ?? ""),
  }
}

/**
 * "Generate with @mira": a 400px panel at the right of the character's page
 * (C2), so the page it was opened from stays in view and the new run can be
 * watched arriving on it.
 *
 * The form starts from the character — `@mira ` in the prompt, and so its
 * references attached — and files the run under it. A scene's page can aim it
 * at one of its shots instead (`target`): the identity row is still the scene,
 * but the run is filed under the shot and becomes its newest version. Opening
 * the panel spends nothing; its Generate button is the only thing that does.
 */
export function GeneratePanel({
  node,
  cover,
  target,
  onClose,
  onSubmitted,
}: GeneratePanelProps) {
  const aim = target ?? ownTarget(node)
  const label = aim.label
  const refs = node.referenceAssetIds?.length ?? 0

  return (
    <aside
      aria-label={label}
      className="flex w-100 shrink-0 flex-col gap-5 overflow-y-auto border-l bg-card px-5 py-5"
    >
      <div className="flex items-center gap-3">
        <div
          aria-hidden
          className="size-10 shrink-0 overflow-hidden rounded-full bg-muted"
        >
          {cover ? <AssetTile asset={cover} className="size-full" /> : null}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold">{node.name}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {node.handle ? `@${node.handle} · ` : ""}
            {referenceSummary(refs)}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Close the generate panel"
          onClick={onClose}
        >
          <HugeiconsIcon icon={Cancel01Icon} className="size-4" />
        </Button>
      </div>

      <GenerateForm
        // A different character, or shot, is a different composition.
        key={aim.containerId}
        containerId={aim.containerId}
        destination={aim.destination}
        initialPrompt={aim.initialPrompt}
        onSubmitted={onSubmitted}
      />
    </aside>
  )
}
