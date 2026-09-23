"use client"

/**
 * A container's assets, as a tab of its page: filter chips, Import, and a
 * 4-column grid.
 *
 * On a character or a scene each image can be made a reference — appended to
 * the list sent to the model — or taken out of it, and a reference wears its
 * number. That is what the old library dialog did behind a Save button; on a
 * page, a click is the save, because there is no dialog to close and lose the
 * change with. A folder has no references and shows none of that.
 */
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { PlayIcon, PlusSignIcon } from "@hugeicons/core-free-icons"
import type { ContainerNodeDto } from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import { useAssets, useChooseFiles, useImportAssets } from "@/hooks/use-assets"
import {
  ASSET_FILTERS,
  filterAssets,
  referenceNumbers,
  type AssetFilter,
} from "@/lib/workspace/container-page"
import { formatDuration } from "@/lib/workspace/home"

import { AssetTile, assetLabel } from "@/components/canvas/nodes/asset-tile"

import { EmptySection } from "./container-card"

/** How many assets the grid asks for at a time, and the most it will hold. */
const PAGE = 120
const MAX = 500

function failure(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again."
}

/**
 * Import files into a container — the native picker, then the copy — with
 * the outcome said in a toast. Shared by the grid's button and its empty
 * state.
 */
export function useImportInto(node: Pick<ContainerNodeDto, "id" | "name">) {
  const choose = useChooseFiles()
  const imports = useImportAssets()
  const run = async () => {
    try {
      const paths = await choose.mutateAsync()
      if (!paths.length) return
      const result = await imports.mutateAsync({ paths, containerId: node.id })
      if (result.failures.length)
        toast.error(`${result.failures.length} files could not be imported`, {
          description: result.failures.map((f) => f.message).join("; "),
        })
      if (result.assets.length)
        toast.success(`${result.assets.length} assets added to ${node.name}`)
    } catch (error) {
      toast.error(failure(error))
    }
  }
  return { run, busy: choose.isPending || imports.isPending }
}

export interface AssetLibraryProps {
  node: ContainerNodeDto
  /**
   * Makes an image a reference, or stops it being one. Absent on a folder,
   * which has no references.
   */
  onToggleReference?: (assetId: string) => void
  /** True while a reference change is being saved. */
  saving?: boolean
}

export function AssetLibrary({
  node,
  onToggleReference,
  saving,
}: AssetLibraryProps) {
  const [limit, setLimit] = useState(PAGE)
  const [filter, setFilter] = useState<AssetFilter>("all")
  const [preview, setPreview] = useState<string | null>(null)
  const assets = useAssets(node.id, { limit })
  const importer = useImportInto(node)
  const references = onToggleReference ? node.referenceAssetIds : null
  const numbers = useMemo(() => referenceNumbers(references), [references])

  const filters = onToggleReference
    ? ASSET_FILTERS
    : ASSET_FILTERS.filter((chip) => chip.value !== "references")
  const shown = useMemo(
    () => filterAssets(assets.data?.items ?? [], filter, references),
    [assets.data, filter, references]
  )
  const total = assets.data?.total ?? 0
  const image = assets.data?.items.find((asset) => asset.id === preview)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((chip) => (
          <Button
            key={chip.value}
            size="sm"
            variant="outline"
            aria-pressed={filter === chip.value}
            className={cn(
              "h-7 rounded-full px-3 text-xs",
              filter === chip.value
                ? "border-foreground/30 text-foreground"
                : "text-muted-foreground"
            )}
            onClick={() => setFilter(chip.value)}
          >
            {chip.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-7"
          disabled={importer.busy}
          onClick={() => void importer.run()}
        >
          <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
          {importer.busy ? "Importing…" : "Import"}
        </Button>
      </div>

      {assets.isPending ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="aspect-[4/5] rounded-lg" />
          ))}
        </div>
      ) : assets.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-sm text-destructive">{assets.error.message}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void assets.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : total === 0 ? (
        <EmptySection
          title={`Nothing in ${node.name} yet`}
          body={
            onToggleReference
              ? "Import reference images, then choose the ones sent to the model."
              : "Import files, or file generations here from the canvas."
          }
          action={
            <Button
              size="sm"
              variant="outline"
              disabled={importer.busy}
              onClick={() => void importer.run()}
            >
              Add your first images
            </Button>
          }
        />
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {filter === "references"
            ? "No references chosen — mentions use the newest images automatically."
            : "Nothing here matches this filter."}
        </p>
      ) : (
        <ul
          aria-label="Assets"
          className="grid grid-cols-2 gap-3 md:grid-cols-4"
        >
          {shown.map((asset) => {
            const number = numbers.get(asset.id)
            const label = assetLabel(asset)
            return (
              <li
                key={asset.id}
                data-asset-id={asset.id}
                className="group flex flex-col gap-2"
              >
                <button
                  type="button"
                  aria-label={`Preview ${label}`}
                  onClick={() => setPreview(asset.id)}
                  className={cn(
                    "relative aspect-[4/5] w-full overflow-hidden rounded-lg bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    number !== undefined && "ring-2 ring-primary/60"
                  )}
                >
                  <AssetTile asset={asset} className="size-full" />
                  {number !== undefined ? (
                    <span className="absolute top-2 left-2 rounded-md bg-background/80 px-1.5 py-0.5 text-[11px] font-medium backdrop-blur-sm">
                      {number === 1 && node.kind === "character"
                        ? "★ Sheet"
                        : `Ref ${number}`}
                    </span>
                  ) : null}
                  {asset.kind === "video" && asset.durationMs ? (
                    <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md bg-background/80 px-1.5 py-0.5 text-[11px] font-medium backdrop-blur-sm">
                      <HugeiconsIcon icon={PlayIcon} className="size-3" />
                      {formatDuration(asset.durationMs)}
                    </span>
                  ) : null}
                </button>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs" title={label}>
                    {label}
                  </span>
                  {onToggleReference && asset.kind === "image" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 shrink-0 px-2 text-[11px] text-muted-foreground"
                      disabled={saving}
                      aria-label={
                        number !== undefined
                          ? `Remove ${label} from references`
                          : `Use ${label} as a reference`
                      }
                      onClick={() => onToggleReference(asset.id)}
                    >
                      {number !== undefined ? "Remove ref" : "Use as ref"}
                    </Button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {assets.data && assets.data.nextOffset !== null ? (
        limit < MAX ? (
          <Button
            variant="outline"
            size="sm"
            className="self-center"
            disabled={assets.isFetching}
            onClick={() => setLimit(Math.min(MAX, limit + PAGE))}
          >
            {assets.isFetching ? "Loading…" : "Show more"}
          </Button>
        ) : (
          <p className="text-center text-xs text-muted-foreground">
            Showing the newest {MAX} of {total}.
          </p>
        )
      ) : null}

      <Dialog open={!!image} onOpenChange={() => setPreview(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{image ? assetLabel(image) : "Preview"}</DialogTitle>
            <DialogDescription>
              {image?.generationId ? "Generated" : "Imported"} into {node.name}.
            </DialogDescription>
          </DialogHeader>
          {image ? (
            <AssetTile
              asset={image}
              className="max-h-[65svh] w-full object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
