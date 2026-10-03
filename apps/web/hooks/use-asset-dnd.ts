"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core"

import {
  dragStartedWithShift,
  isAssetDragData,
  resolveAssetDrop,
  type AssetDragData,
} from "@/lib/board/drop-target"

import { useAddAssetToContainer, useMoveAsset } from "./use-assets"

export interface AssetDnd {
  /** The card currently under the pointer, for the drag overlay. */
  activeDrag: AssetDragData | null
  /** True while Shift is held, i.e. while the drop would move rather than add. */
  moveIntent: boolean
  onDragStart: (event: DragStartEvent) => void
  onDragEnd: (event: DragEndEvent) => void
  onDragCancel: () => void
}

/**
 * Turns a card-onto-container drop into asset mutations.
 *
 * A move is one `assets:move`, which links and unlinks in a single transaction
 * in main — never an add and an unlink from here, where a failure between the
 * two could leave the asset on no board at all. `resolveAssetDrop` decides
 * *whether* anything happens; this decides what the mutation is.
 *
 * Shift is tracked for the whole drag rather than only sampled at its start, so
 * the overlay can say what the drop will actually do and the user can change
 * their mind mid-flight.
 */
export function useAssetDnd(): AssetDnd {
  const addToContainer = useAddAssetToContainer()
  const moveAsset = useMoveAsset()
  const [activeDrag, setActiveDrag] = useState<AssetDragData | null>(null)
  const [moveIntent, setMoveIntent] = useState(false)
  const moveRef = useRef(false)

  const setMove = useCallback((value: boolean) => {
    moveRef.current = value
    setMoveIntent(value)
  }, [])

  useEffect(() => {
    if (!activeDrag) return
    const sync = (event: KeyboardEvent) => {
      if (event.key === "Shift") setMove(event.type === "keydown")
    }
    window.addEventListener("keydown", sync)
    window.addEventListener("keyup", sync)
    return () => {
      window.removeEventListener("keydown", sync)
      window.removeEventListener("keyup", sync)
    }
  }, [activeDrag, setMove])

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      const data = event.active.data.current
      setMove(dragStartedWithShift(event.activatorEvent))
      setActiveDrag(isAssetDragData(data) ? data : null)
    },
    [setMove]
  )

  const onDragCancel = useCallback(() => {
    setActiveDrag(null)
    setMove(false)
  }, [setMove])

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const move = moveRef.current
      setActiveDrag(null)
      setMove(false)

      const drop = resolveAssetDrop(
        event.active.data.current,
        event.over?.data.current,
        { move }
      )
      if (!drop) return

      if (drop.action === "move" && drop.fromContainerId) {
        moveAsset.mutate({
          assetId: drop.assetId,
          fromContainerId: drop.fromContainerId,
          toContainerId: drop.toContainerId,
        })
        return
      }
      addToContainer.mutate({
        containerId: drop.toContainerId,
        assetId: drop.assetId,
      })
    },
    [addToContainer, moveAsset, setMove]
  )

  return { activeDrag, moveIntent, onDragStart, onDragEnd, onDragCancel }
}
