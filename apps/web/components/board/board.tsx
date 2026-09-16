"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { DragEvent } from "react"
import type { AssetDto } from "@opendirect/contract"
import { HugeiconsIcon } from "@hugeicons/react"
import { Upload04Icon } from "@hugeicons/core-free-icons"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import {
  useMasonry,
  usePositioner,
  useResizeObserver,
  type RenderComponentProps,
} from "masonic"

import {
  useAssets,
  useChooseFiles,
  useImportAssets,
  useRemoveAssetFromContainer,
} from "@/hooks/use-assets"
import { useGenerations } from "@/hooks/use-generations"
import {
  BOARD_COLUMN_GUTTER,
  BOARD_COLUMN_WIDTH,
  boardMetrics,
  buildBoardItems,
  type BoardItem,
} from "@/lib/board/items"
import { pathsForFiles } from "@/lib/ipc"

import { AssetCard, GenerationCard } from "./asset-card"
import { BoardEmptyState } from "./empty-state"

/** How many assets one board page holds; the contract caps it at 500. */
const PAGE_SIZE = 200

export interface BoardProps {
  containerId: string | null
  title: string
  /** `generations` hides imported media and shows only the runs. */
  view?: "all" | "generations"
  selectedAssetId?: string | null
  onSelectAsset?: (asset: AssetDto) => void
}

/**
 * Tracks the scroll box the masonry lives in.
 *
 * `useMasonry` is given a viewport rather than reading the browser `window`,
 * because the board scrolls inside a panel — the window never moves. An
 * unmeasured box reports 0, which `boardMetrics` turns into a desktop-sized
 * guess so the first paint is a grid rather than nothing.
 */
function useScrollViewport(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [scrollTop, setScrollTop] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () =>
      setSize({ width: element.clientWidth, height: element.clientHeight })
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop)
  }, [])

  return { ...boardMetrics(size), scrollTop, onScroll }
}

export function Board({
  containerId,
  title,
  view = "all",
  selectedAssetId,
  onSelectAsset,
}: BoardProps) {
  const assets = useAssets(containerId, { limit: PAGE_SIZE })
  const generations = useGenerations(containerId, { limit: PAGE_SIZE })
  const importAssets = useImportAssets()
  const chooseFiles = useChooseFiles()
  const removeAsset = useRemoveAssetFromContainer()

  const scrollRef = useRef<HTMLDivElement>(null)
  const { width, height, scrollTop, onScroll } = useScrollViewport(scrollRef)
  const [dropActive, setDropActive] = useState(false)

  const items = useMemo(
    () =>
      buildBoardItems(
        view === "generations" ? [] : (assets.data?.items ?? []),
        generations.data?.items ?? []
      ),
    [assets.data, generations.data, view]
  )

  const positioner = usePositioner(
    {
      width,
      columnWidth: BOARD_COLUMN_WIDTH,
      columnGutter: BOARD_COLUMN_GUTTER,
    },
    [items.length, view, containerId]
  )
  const resizeObserver = useResizeObserver(positioner)

  const importPaths = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return
      importAssets.mutate({ paths, containerId })
    },
    [importAssets, containerId]
  )

  const onImportClick = useCallback(() => {
    chooseFiles.mutate(undefined, { onSuccess: importPaths })
  }, [chooseFiles, importPaths])

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setDropActive(false)
      importPaths(pathsForFiles(Array.from(event.dataTransfer.files)))
    },
    [importPaths]
  )

  const renderItem = useCallback(
    ({ data, width: cellWidth }: RenderComponentProps<BoardItem>) =>
      data.type === "asset" ? (
        <AssetCard
          asset={data.asset}
          containerId={containerId}
          width={cellWidth}
          selected={selectedAssetId === data.asset.id}
          onSelect={onSelectAsset}
          onRemove={(asset) =>
            containerId &&
            removeAsset.mutate({ containerId, assetId: asset.id })
          }
        />
      ) : (
        <GenerationCard generation={data.generation} width={cellWidth} />
      ),
    [containerId, selectedAssetId, onSelectAsset, removeAsset]
  )

  const grid = useMasonry<BoardItem>({
    positioner,
    resizeObserver,
    items,
    height,
    scrollTop,
    overscanBy: 2,
    itemKey: (item) => item.id,
    role: "list",
    className: "mx-auto",
    render: renderItem,
  })

  const loading = assets.isPending && containerId !== null
  const error = assets.error ?? generations.error

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      onDragOver={(event: DragEvent<HTMLDivElement>) => {
        // Only a file drag; an in-app card drag is dnd-kit's business.
        if (!event.dataTransfer.types.includes("Files")) return
        event.preventDefault()
        setDropActive(true)
      }}
      onDragLeave={(event: DragEvent<HTMLDivElement>) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return
        setDropActive(false)
      }}
      onDrop={onDrop}
    >
      <header className="flex h-11 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="truncate text-sm font-medium">{title}</h1>
        <span className="text-xs text-muted-foreground tabular-nums">
          {items.length}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={onImportClick}
          disabled={!containerId || importAssets.isPending}
        >
          <HugeiconsIcon icon={Upload04Icon} className="size-4" />
          {importAssets.isPending ? "Importing…" : "Import"}
        </Button>
      </header>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        data-testid="board-scroll"
        className={cn(
          "relative flex min-h-0 flex-1 flex-col overflow-y-auto p-4",
          dropActive && "bg-accent/40 ring-2 ring-primary ring-inset"
        )}
      >
        {error ? (
          <p className="p-4 text-sm text-destructive">{error.message}</p>
        ) : loading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {[180, 260, 200, 240, 300, 220].map((h, index) => (
              <Skeleton
                key={index}
                style={{ height: h }}
                className="rounded-md"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <BoardEmptyState
            onImport={onImportClick}
            importing={importAssets.isPending}
          />
        ) : (
          grid
        )}
      </div>
    </section>
  )
}
