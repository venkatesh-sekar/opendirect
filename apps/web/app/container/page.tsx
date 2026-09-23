"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"

import { ContainerScreen } from "@/components/workspace/container-screen"

/** `/container/?id=` — the static export has no `[id]` segments. */
function Screen() {
  return <ContainerScreen id={useSearchParams().get("id")} />
}

/**
 * `useSearchParams` suspends during the static export's prerender, where there
 * is no query string at all — the boundary is what lets the page be exported.
 */
export default function ContainerPage() {
  return (
    <Suspense fallback={null}>
      <Screen />
    </Suspense>
  )
}
