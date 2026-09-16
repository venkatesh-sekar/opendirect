import { contextBridge, ipcRenderer, webUtils } from "electron"
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

  /**
   * The absolute path of a `File` the user dropped onto the window.
   *
   * `File.path` was removed in Electron 32, so a drop can only be turned into
   * an import through `webUtils.getPathForFile`, which lives in the preload.
   * This is deliberately not an IPC channel: it is a synchronous lookup on an
   * object the renderer already holds, and it reveals nothing the user did not
   * just hand the app by dropping the file.
   */
  pathForFile(file: File): string {
    return webUtils.getPathForFile(file)
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
