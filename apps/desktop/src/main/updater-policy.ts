/**
 * Pure auto-update policy: when the updater runs, and how electron-updater
 * events become the payloads the renderer sees.
 *
 * Kept free of `electron` / `electron-updater` imports so it unit tests in
 * plain Node; `updater.ts` is the thin wiring around it.
 */

/** IPC channel the main process pushes update status over. */
export const UPDATER_STATUS_CHANNEL = "updater:status"

/** How often a running app re-checks the GitHub Releases feed. */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export type UpdaterStatus =
  | { state: "available"; version: string }
  | { state: "not-available" }
  | { state: "downloading"; percent: number }
  | { state: "ready"; version: string }
  | { state: "error"; message: string }

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
