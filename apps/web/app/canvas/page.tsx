"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"

import { CanvasScreen } from "@/components/workspace/canvas-screen"

/**
 * The canvas, one place among the project's others rather than its front
 * door. `?focus=<containerId>` frames that container's nodes and files new
 * ones under it.
 */
function Screen() {
  return <CanvasScreen focus={useSearchParams().get("focus")} />
}

/**
 * `useSearchParams` suspends during the static export's prerender, where there
 * is no query string at all — the boundary is what lets the page be exported.
 */
export default function CanvasPage() {
  return (
    <Suspense fallback={null}>
      <Screen />
    </Suspense>
  )
}
