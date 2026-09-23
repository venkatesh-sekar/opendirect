"use client"

import { Suspense, useEffect, useMemo } from "react"
import { useSearchParams } from "next/navigation"

import { useContainerTree } from "@/hooks/use-containers"
import { requestCanvasFocus } from "@/lib/canvas/focus-request"
import {
  findContainer,
  firstSelectableContainer,
} from "@/lib/board/sidebar-tree"

import { Canvas } from "@/components/canvas/canvas"

/**
 * The canvas, one place among the project's others rather than its front
 * door.
 *
 * `?focus=<containerId>` frames that container's nodes, and new nodes are
 * filed under it. Without one they are filed where they always were when
 * nothing was chosen: the project's first character, scene or folder. A
 * generate node reads its batch back from the container it was filed under,
 * so "no container at all" would submit a run and then show an empty node.
 */
function CanvasScreen() {
  const focus = useSearchParams().get("focus")
  const tree = useContainerTree()

  const containerId = useMemo(() => {
    const nodes = tree.data ?? []
    if (focus && findContainer(nodes, focus)) return focus
    return firstSelectableContainer(nodes)?.id ?? null
  }, [focus, tree.data])

  // Held by the canvas until its nodes have loaded, then answered once.
  useEffect(() => {
    if (focus) requestCanvasFocus(focus)
  }, [focus])

  return <Canvas containerId={containerId} />
}

/**
 * `useSearchParams` suspends during the static export's prerender, where there
 * is no query string at all — the boundary is what lets the page be exported.
 */
export default function CanvasPage() {
  return (
    <Suspense fallback={null}>
      <CanvasScreen />
    </Suspense>
  )
}
