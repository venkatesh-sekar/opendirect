/**
 * Pure IPC registrar: contract lookup, validation and the result envelope.
 *
 * Kept free of `electron` imports so it unit tests against a fake `ipcMain` in
 * plain Node; `ipc.ts` is the thin wiring that binds it to the real one.
 */
import {
  ipcContract,
  ipcEvents,
  isIpcChannel,
  isIpcEventChannel,
  type IpcChannel,
  type IpcEventChannel,
  type IpcEventInput,
  type IpcHandlerOutput,
  type IpcParsedInput,
  type IpcResult,
} from "@opendirect/contract"

/** The slice of Electron's `ipcMain` the registrar needs. */
export interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: unknown, payload: unknown) => Promise<unknown>
  ): void
  removeHandler(channel: string): void
}

/** The slice of `WebContents` used to push a main→renderer event. */
export interface IpcEventSender {
  send(channel: string, payload: unknown): void
}

export type IpcHandler<K extends IpcChannel> = (
  input: IpcParsedInput<K>
) => Promise<IpcHandlerOutput<K>> | IpcHandlerOutput<K>

export interface IpcRegistrar {
  handle<K extends IpcChannel>(channel: K, handler: IpcHandler<K>): void
  dispose(): void
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string" && error.trim()) return error
  return "Unknown IPC error"
}

function failure(message: string): IpcResult<never> {
  return { ok: false, error: { message } }
}

/**
 * Binds contract-declared channels to an `ipcMain`-shaped object.
 *
 * Every handler resolves with an `IpcResult` envelope rather than rejecting, so
 * the renderer gets a clean discriminated result instead of an Electron
 * rejection whose message is wrapped in a stack prefix. Input and output are
 * both parsed against the contract, so a handler can neither be reached with an
 * unexpected payload nor return an undeclared field.
 */
export function createIpcRegistrar(ipc: IpcMainLike): IpcRegistrar {
  const registered = new Set<IpcChannel>()

  return {
    handle(channel, handler) {
      if (!isIpcChannel(channel)) {
        throw new Error(
          `Channel "${String(channel)}" is not in the IPC contract`
        )
      }
      if (registered.has(channel)) {
        throw new Error(`IPC channel "${channel}" is already registered`)
      }
      registered.add(channel)

      ipc.handle(channel, async (_event, raw) => {
        const spec = ipcContract[channel]
        const input = spec.input.safeParse(raw)
        if (!input.success) {
          return failure(
            `Invalid input for "${channel}": ${input.error.message}`
          )
        }
        try {
          const result = await handler(input.data as never)
          const output = spec.output.safeParse(result)
          if (!output.success) {
            return failure(
              `Invalid output for "${channel}": ${output.error.message}`
            )
          }
          return { ok: true as const, data: output.data }
        } catch (error) {
          return failure(messageOf(error))
        }
      })
    },

    dispose() {
      for (const channel of registered) ipc.removeHandler(channel)
      registered.clear()
    },
  }
}

/**
 * Pushes a contract-declared event to a renderer, validating the payload first
 * so a malformed status is caught here rather than silently dropped by the
 * renderer's own parse.
 */
export function emitIpcEvent<K extends IpcEventChannel>(
  target: IpcEventSender,
  channel: K,
  payload: IpcEventInput<K>
): void {
  if (!isIpcEventChannel(channel)) {
    throw new Error(`Channel "${String(channel)}" is not a declared IPC event`)
  }
  const parsed = ipcEvents[channel].payload.safeParse(payload)
  if (!parsed.success) {
    throw new Error(`Invalid payload for "${channel}": ${parsed.error.message}`)
  }
  target.send(channel, parsed.data)
}
