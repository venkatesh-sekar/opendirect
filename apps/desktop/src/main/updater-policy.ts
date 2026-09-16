/**
 * Pure auto-update policy: when the updater runs, and how electron-updater
 * events become the payloads the renderer sees.
 *
 * Kept free of `electron` / `electron-updater` imports so it unit tests in
 * plain Node; `updater.ts` is the thin wiring around it.
 */
import type { IpcEventPayload } from "@opendirect/contract"

/** How often a running app re-checks the GitHub Releases feed. */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Derived from the IPC contract rather than redeclared, so the status this
 * module produces cannot drift from the schema that validates it on the way
 * out and on the way in.
 */
export type UpdaterStatus = IpcEventPayload<"updater:status">

export type UpdaterEvent =
  | { type: "available"; version?: string }
  | { type: "not-available" }
  | { type: "downloading"; percent?: number }
  | { type: "ready"; version?: string }
  | { type: "error"; error?: unknown }

/**
 * An unpackaged app has no `app-update.yml`, so checking would only ever log an
 * error. `OPENDIRECT_ENABLE_UPDATER` forces it on for feed testing.
 */
export function shouldEnableUpdater(options: {
  packaged: boolean
  env: Record<string, string | undefined>
}): boolean {
  if (options.packaged) return true
  const override = options.env.OPENDIRECT_ENABLE_UPDATER?.trim().toLowerCase()
  if (!override) return false
  return override !== "0" && override !== "false"
}

function clampPercent(percent: number | undefined): number {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return 0
  return Math.round(Math.min(100, Math.max(0, percent)))
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string" && error.trim()) return error
  if (error === undefined || error === null) return "Unknown updater error"
  return String(error)
}

/** The slice of `BrowserWindow` the updater needs to pick a delivery target. */
export interface StatusTarget {
  isDestroyed(): boolean
}

/**
 * Picks the window that should receive an update status.
 *
 * The updater is app-scoped, not window-scoped: on macOS the last window can be
 * closed and a new one created while the app keeps running, so statuses go to
 * whichever live window is focused, falling back to the first live one.
 */
export function pickStatusTarget<T extends StatusTarget>(
  windows: readonly T[],
  focused?: T | null
): T | undefined {
  if (focused && !focused.isDestroyed()) return focused
  return windows.find((window) => !window.isDestroyed())
}

/** Normalises an electron-updater event into the renderer-facing status. */
export function toUpdaterStatus(event: UpdaterEvent): UpdaterStatus {
  switch (event.type) {
    case "available":
      return { state: "available", version: event.version ?? "unknown" }
    case "not-available":
      return { state: "not-available" }
    case "downloading":
      return { state: "downloading", percent: clampPercent(event.percent) }
    case "ready":
      return { state: "ready", version: event.version ?? "unknown" }
    case "error":
      return { state: "error", message: messageOf(event.error) }
  }
}
