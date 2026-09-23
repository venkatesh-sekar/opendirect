"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"

import { ContainerScreen } from "@/components/workspace/container-screen"

/**
 * `/container/?id=&tab=&shot=` — the static export has no `[id]` segments, so
 * the container, its open tab and a scene's selected shot all travel in the
 * query string.
 */
function Screen() {
  const params = useSearchParams()
  return (
    <ContainerScreen
      id={params.get("id")}
      tab={params.get("tab")}
      shot={params.get("shot")}
    />
  )
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
