import * as React from "react"

const MOBILE_BREAKPOINT = 768

const query = (breakpoint: number) => `(max-width: ${breakpoint - 1}px)`

/**
 * True below the breakpoint — **on the first render**, not one frame later.
 *
 * The earlier version started `undefined` and flipped in an effect, so every
 * component that lays out differently when narrow painted the wide layout once
 * and then reflowed. On a surface where the layout is anchored to something
 * the user is pointing at, that one frame is a visible jolt. `useSyncExternal-
 * Store` reads the answer during render instead, and the server snapshot is
 * `false` so the markup still matches on hydration.
 *
 * `breakpoint` (px) defaults to the sidebar's. A component whose own width is
 * a function of the viewport passes the width below which it stops fitting.
 */
export function useIsMobile(breakpoint: number = MOBILE_BREAKPOINT): boolean {
  // Subscribes to the breakpoint itself rather than to every resize event.
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query(breakpoint))
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    },
    [breakpoint]
  )
  return React.useSyncExternalStore(
    subscribe,
    () => window.innerWidth < breakpoint,
    () => false
  )
}
