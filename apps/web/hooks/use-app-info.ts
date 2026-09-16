"use client"

/**
 * What the renderer knows about the app around it: version, platform, and the
 * chord the catalog refresh should bind to.
 *
 * The accelerator is asked for rather than assumed because main is what decides
 * it — the application menu either hands ⌘R to Chromium's Reload (development)
 * or does not (production), and the renderer must take whichever is left. See
 * `apps/desktop/src/main/menu.ts`.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query"
import type { IpcOutput } from "@opendirect/contract"

import { invoke, isBridgeAvailable } from "@/lib/ipc"

export type AppInfo = IpcOutput<"app:info">

export const appInfoQueryKey = ["app", "info"] as const

/**
 * The chord assumed until main answers. `⌘⇧R` is the safe default: it is never
 * the one Chromium has taken, so the worst case is a shortcut that is briefly
 * unusual rather than one that reloads the window mid-session.
 */
export const FALLBACK_REFRESH_ACCELERATOR = "mod+shift+r"

export function useAppInfo(): UseQueryResult<AppInfo> {
  return useQuery({
    queryKey: appInfoQueryKey,
    queryFn: () => invoke("app:info"),
    enabled: isBridgeAvailable(),
    // None of it changes while the app is open.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}

export function useCatalogRefreshAccelerator(): string {
  const info = useAppInfo()
  return info.data?.catalogRefreshAccelerator ?? FALLBACK_REFRESH_ACCELERATOR
}
