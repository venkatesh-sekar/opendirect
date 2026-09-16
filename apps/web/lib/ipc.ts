import {
  ipcContract,
  ipcEvents,
  ipcResultSchema,
  isIpcChannel,
  isIpcEventChannel,
  type IpcChannel,
  type IpcEventChannel,
  type IpcEventPayload,
  type IpcInput,
  type IpcOutput,
} from "@opendirect/contract"

/** The bridge the preload script exposes on `window.opendirect`. */
export interface OpenDirectBridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>
  on(channel: string, callback: (payload: unknown) => void): () => void
  /** Optional so the renderer still runs in a plain browser tab. */
  pathForFile?(file: File): string
}

function findBridge(): OpenDirectBridge | undefined {
  return (globalThis as { opendirect?: OpenDirectBridge }).opendirect
}

/** True inside Electron, false when the renderer is opened in a plain browser. */
export function isBridgeAvailable(): boolean {
  return findBridge() !== undefined
}

function bridge(): OpenDirectBridge {
  const found = findBridge()
  if (!found) {
    throw new Error(
      "OpenDirect IPC bridge unavailable — are you running outside Electron?"
    )
  }
  return found
}

/**
 * Calls a contract channel in the main process.
 *
 * Both ends validate: the input is parsed here before it leaves the renderer,
 * the main process parses it again on arrival, and the response is parsed back
 * against the same contract entry — so a schema change can never silently
 * desync the two processes.
 */
export async function invoke<K extends IpcChannel>(
  channel: K,
  input?: IpcInput<K>
): Promise<IpcOutput<K>> {
  if (!isIpcChannel(channel)) {
    throw new Error(`Channel "${String(channel)}" is not in the IPC contract`)
  }
  const spec = ipcContract[channel]

  const parsedInput = spec.input.safeParse(input)
  if (!parsedInput.success) {
    throw new Error(
      `Invalid input for "${channel}": ${parsedInput.error.message}`
    )
  }

  const raw = await bridge().invoke(channel, parsedInput.data)

  const envelope = ipcResultSchema.safeParse(raw)
  if (!envelope.success) {
    throw new Error(`Malformed IPC response for "${channel}"`)
  }
  if (!envelope.data.ok) throw new Error(envelope.data.error.message)

  const output = spec.output.safeParse(envelope.data.data)
  if (!output.success) {
    throw new Error(`Invalid output for "${channel}": ${output.error.message}`)
  }
  return output.data as IpcOutput<K>
}

/**
 * Subscribes to a main→renderer event. Payloads that fail the contract are
 * dropped rather than delivered, so a UI subscriber only ever sees valid data.
 * Returns the unsubscribe function.
 */
export function subscribe<K extends IpcEventChannel>(
  channel: K,
  callback: (payload: IpcEventPayload<K>) => void
): () => void {
  if (!isIpcEventChannel(channel)) {
    throw new Error(`Channel "${String(channel)}" is not a declared IPC event`)
  }
  const schema = ipcEvents[channel].payload
  return bridge().on(channel, (raw) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      console.warn(
        `Dropped an invalid "${channel}" event payload: ${parsed.error.message}`
      )
      return
    }
    callback(parsed.data as IpcEventPayload<K>)
  })
}

/**
 * Absolute paths for files dropped onto the window.
 *
 * `File.path` was removed in Electron 32, so the only way back to a path is
 * `webUtils.getPathForFile` in the preload. Outside Electron — a browser tab, a
 * test — there is no path to give, so the list comes back empty and the caller
 * shows "drag files from Finder" rather than throwing.
 */
export function pathsForFiles(files: readonly File[]): string[] {
  const found = findBridge()
  if (!found?.pathForFile) return []
  const paths: string[] = []
  for (const file of files) {
    const path = found.pathForFile(file)
    if (path) paths.push(path)
  }
  return paths
}
