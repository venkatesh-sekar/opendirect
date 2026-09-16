import { contextBridge, ipcRenderer } from "electron"
import { isIpcChannel, isIpcEventChannel } from "@opendirect/contract"

/**
 * The entire renderer-facing surface: one `invoke` and one event subscription.
 *
 * The renderer never gets Node (`contextIsolation` on, `nodeIntegration` off)
 * and never gets a raw `ipcRenderer`, so it cannot reach an arbitrary channel.
 * Channels are checked against the contract here as well as in the main process
 * and in the renderer client — the bridge is the boundary, so it does not trust
 * the code calling it.
 */
const bridge = {
  invoke(channel: string, payload?: unknown): Promise<unknown> {
    if (!isIpcChannel(channel)) {
      return Promise.reject(
        new Error(`Channel "${String(channel)}" is not in the IPC contract`)
      )
    }
    return ipcRenderer.invoke(channel, payload)
  },

  on(channel: string, callback: (payload: unknown) => void): () => void {
    if (!isIpcEventChannel(channel)) {
      throw new Error(
        `Channel "${String(channel)}" is not a declared IPC event`
      )
    }
    // The Electron `event` argument is deliberately dropped: handing it to the
    // renderer would leak `sender` and with it a path back to the main process.
    const listener = (_event: unknown, payload: unknown): void =>
      callback(payload)
    ipcRenderer.on(channel, listener as never)
    return () => {
      ipcRenderer.removeListener(channel, listener as never)
    }
  },
}

contextBridge.exposeInMainWorld("opendirect", bridge)

export type OpenDirectBridge = typeof bridge
