import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

/**
 * Subscribes to the breakpoint itself rather than to every resize event.
 */
function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

/**
 * True below the breakpoint — **on the first render**, not one frame later.
 *
 * The earlier version started `undefined` and flipped in an effect, so every
 * component that lays out differently when narrow painted the wide layout once
 * and then reflowed. On a surface where the layout is anchored to something
 * the user is pointing at, that one frame is a visible jolt. `useSyncExternal-
 * Store` reads the answer during render instead, and the server snapshot is
 * `false` so the markup still matches on hydration.
 */
export function useIsMobile(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false
  )
}
