"use client"

import { useSyncExternalStore } from "react"

import { isBridgeAvailable } from "@/lib/ipc"

/**
 * Whether the Electron preload has put the IPC bridge on `window` — `null`
 * until we are allowed to look.
 *
 * The renderer is a static export: `index.html` is prerendered in Node, where
 * no preload has run, and that one file is then opened both by the Electron
 * window, where the bridge exists, and by a plain browser tab, where it does
 * not. Reading the bridge *during* render therefore makes the first client
 * render disagree with the prerendered HTML, and React answers a mismatch by
 * throwing the server's DOM away and rebuilding the tree.
 *
 * `useSyncExternalStore` is how React is told that this is a value the server
 * cannot know: it hands back the server snapshot for the prerender *and* for
 * hydration, then re-checks once hydration is done. The bridge is injected
 * before the bundle runs and never changes afterwards, so there is nothing to
 * subscribe to.
 *
 * Both the shell and the canvas ask this, which is why it lives here rather
 * than inside either of them.
 */
const NO_BRIDGE_SUBSCRIPTION = () => () => {}
const BRIDGE_UNKNOWN = () => null

export function useBridge(): boolean | null {
  return useSyncExternalStore<boolean | null>(
    NO_BRIDGE_SUBSCRIPTION,
    isBridgeAvailable,
    BRIDGE_UNKNOWN
  )
}
