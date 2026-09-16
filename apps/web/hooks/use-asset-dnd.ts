"use client"

import { useCallback, useRef, useState } from "react"
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core"

import {
  dragStartedWithShift,
  isAssetDragData,
  resolveAssetDrop,
  type AssetDragData,
} from "@/lib/board/drop-target"

import {
  useAddAssetToContainer,
  useRemoveAssetFromContainer,
} from "./use-assets"

export interface AssetDnd {
  /** The card currently under the pointer, for the drag overlay. */
  activeDrag: AssetDragData | null
  onDragStart: (event: DragStartEvent) => void
  onDragEnd: (event: DragEndEvent) => void
  onDragCancel: () => void
}

/**
 * Turns a card-onto-container drop into asset mutations.
 *
 * A move is an add followed by an unlink, in that order and only on success:
 * unlinking first would, if the add then failed, leave the asset on no board at
 * all. `resolveAssetDrop` decides *whether* anything happens; this decides what
 * the mutations are.
 */
export function useAssetDnd(): AssetDnd {
  const addToContainer = useAddAssetToContainer()
  const removeFromContainer = useRemoveAssetFromContainer()
  const [activeDrag, setActiveDrag] = useState<AssetDragData | null>(null)
  const moveRef = useRef(false)

  const onDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current
    moveRef.current = dragStartedWithShift(event.activatorEvent)
    setActiveDrag(isAssetDragData(data) ? data : null)
  }, [])

  const onDragCancel = useCallback(() => {
    setActiveDrag(null)
    moveRef.current = false
  }, [])

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const move = moveRef.current
      setActiveDrag(null)
      moveRef.current = false

      const drop = resolveAssetDrop(
        event.active.data.current,
        event.over?.data.current,
        { move }
      )
      if (!drop) return

      addToContainer.mutate(
        { containerId: drop.toContainerId, assetId: drop.assetId },
        {
          onSuccess: () => {
            if (drop.action !== "move" || !drop.fromContainerId) return
            removeFromContainer.mutate({
              containerId: drop.fromContainerId,
              assetId: drop.assetId,
            })
          },
        }
      )
    },
    [addToContainer, removeFromContainer]
  )

  return { activeDrag, onDragStart, onDragEnd, onDragCancel }
}
