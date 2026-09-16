"use client"

/**
 * The auto-updater, from the renderer's side.
 *
 * Push-only: main emits `updater:status` when electron-updater has something
 * to say, and there is nothing to ask for in between — an unpackaged dev build
 * never emits at all, which is why the status starts as `null` and the status
 * bar simply shows nothing until it hears otherwise.
 */
import { useCallback, useEffect, useState } from "react"
import type { IpcEventPayload } from "@opendirect/contract"

import { invoke, isBridgeAvailable, subscribe } from "@/lib/ipc"

export type UpdaterStatus = IpcEventPayload<"updater:status">

export interface UpdaterController {
  status: UpdaterStatus | null
  /** Restarts into a staged update. Resolves false when there was none. */
  install: () => Promise<boolean>
}

export function useUpdater(): UpdaterController {
  const [status, setStatus] = useState<UpdaterStatus | null>(null)

  useEffect(() => {
    if (!isBridgeAvailable()) return
    return subscribe("updater:status", setStatus)
  }, [])

  const install = useCallback(async () => {
    const result = await invoke("updater:install")
    // A false answer means nothing was staged after all; drop the prompt
    // rather than leaving a button that does nothing.
    if (!result.restarting) setStatus({ state: "not-available" })
    return result.restarting
  }, [])

  return { status, install }
}
