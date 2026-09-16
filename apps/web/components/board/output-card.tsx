"use client"

/**
 * A board tile with its run attached.
 *
 * `AssetCard` draws the media and owns the drag; this owns what you can *do*
 * with it — use it as a reference, file it somewhere else, branch from it,
 * compare it, open it in the system viewer, or read where it came from.
 *
 * The dialogs live on the card rather than on the board because each one is
 * about this asset: hoisting them would mean the board holding "which tile is
 * the details sheet open for", which is a piece of state nothing else needs.
 *
 * ⛔ Nothing on this card spends money. Branch pre-fills the creation bar and
 * stops there; the user still presses Generate.
 */
import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { MoreHorizontalIcon } from "@hugeicons/core-free-icons"
import type { AssetDto } from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"

import { useAiHelper, useAiTools } from "@/hooks/use-ai"
import { useOpenAsset, useRevealAsset } from "@/hooks/use-assets"
import { cardHelpers } from "@/components/ai/card-helpers"
import { HelperMenu } from "@/components/ai/helper-menu"
import { HelperResultDialog } from "@/components/ai/helper-result-dialog"

import { AssetCard } from "./asset-card"
import {
  AddToContainerDialog,
  OutputActionButtons,
  OutputActionMenuItems,
  outputActions,
} from "./card-actions"
import { CompareView } from "./compare-view"
import { DetailsPanel } from "./details-panel"

export interface OutputCardProps {
  asset: AssetDto
  containerId: string | null
  width: number
  selected?: boolean
  onSelect?: (asset: AssetDto) => void
  onRemove?: (asset: AssetDto) => void
  /** The rest of this board, as the other side of a comparison. */
  siblings: readonly AssetDto[]
  onUseAsReference?: (asset: AssetDto) => void
  /** ⛔ Pre-fills the creation bar from a run; never submits one. */
  onBranch?: (generationId: string) => void
  /** Adds an AI description to the prompt — from the result dialog only. */
  onUsePromptText?: (text: string) => void
}

export function OutputCard({
  asset,
  containerId,
  width,
  selected,
  onSelect,
  onRemove,
  siblings,
  onUseAsReference,
  onBranch,
  onUsePromptText,
}: OutputCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [addToOpen, setAddToOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const open = useOpenAsset()
  const reveal = useRevealAsset()
  // The AI menu is absent entirely when no local CLI was found, so this query
  // is the only thing standing between "no claude installed" and no menu.
  const aiTools = useAiTools()
  const ai = useAiHelper()
  const helpers = cardHelpers(asset)
  const failure = open.error ?? reveal.error

  const actions = outputActions({
    asset,
    onUseAsReference,
    onAddTo: () => setAddToOpen(true),
    onBranch,
    onCompare: () => setCompareOpen(true),
    onOpen: () => open.mutate(asset.id),
    onReveal: () => reveal.mutate(asset.id),
    onDetails: () => setDetailsOpen(true),
    canCompare: siblings.some((sibling) => sibling.id !== asset.id),
  })

  return (
    <div className="flex flex-col gap-1">
      <AssetCard
        asset={asset}
        containerId={containerId}
        width={width}
        selected={selected}
        onSelect={onSelect}
        onRemove={onRemove}
        menuItems={<OutputActionMenuItems actions={actions} />}
        overlay={
          <>
            <HelperMenu
              tools={aiTools.data}
              helpers={helpers}
              label={`AI helpers for ${asset.label ?? asset.originalName ?? asset.kind}`}
              className="size-7 bg-secondary text-secondary-foreground"
              onRun={(helper, tool) =>
                ai.run(
                  helper === "analyze-video"
                    ? { helper: "analyze-video", assetId: asset.id }
                    : { helper: "describe-reference", assetId: asset.id },
                  tool
                )
              }
            />
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger
                render={
                  <Button
                    size="icon"
                    variant="secondary"
                    aria-label={`Actions for ${asset.label ?? asset.originalName ?? asset.kind}`}
                    className="size-7"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  />
                }
              >
                <HugeiconsIcon icon={MoreHorizontalIcon} className="size-4" />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-1">
                <OutputActionButtons
                  actions={actions}
                  onDone={() => setMenuOpen(false)}
                />
              </PopoverContent>
            </Popover>
          </>
        }
      />

      {/* ⛔ Read-only help: the answer is text until the user inserts it. */}
      <HelperResultDialog
        controller={ai}
        onApply={onUsePromptText}
        applyLabel="Add to prompt"
        onInsertShot={onUsePromptText}
      />

      {failure ? (
        <p role="alert" className="text-xs text-destructive">
          {failure.message}
        </p>
      ) : null}

      <AddToContainerDialog
        asset={asset}
        open={addToOpen}
        onOpenChange={setAddToOpen}
      />

      {compareOpen ? (
        <CompareView
          left={asset}
          candidates={siblings}
          open={compareOpen}
          onOpenChange={setCompareOpen}
        />
      ) : null}

      {asset.generationId ? (
        <DetailsPanel
          generationId={asset.generationId}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          onBranch={onBranch}
          onSelectGeneration={(chosen) => {
            // The lineage names runs; the board shows assets. When the chosen
            // run's output is on this board, select it there too.
            const output = siblings.find(
              (sibling) => sibling.generationId === chosen
            )
            if (output) onSelect?.(output)
          }}
        />
      ) : null}
    </div>
  )
}
