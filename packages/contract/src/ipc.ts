import { z } from "zod"

/**
 * The single source of truth for every main↔renderer message.
 *
 * Each entry pairs a request schema with a response schema. Both sides import
 * this object, so a channel cannot exist on one side only, and no payload
 * crosses the process boundary unvalidated.
 *
 * Later tasks extend this object; **never** add an `ipcMain.handle` without a
 * contract entry.
 */
export const ipcContract = {
  "app:info": {
    input: z.void(),
    output: z.object({ version: z.string(), platform: z.string() }),
  },
} as const

export type IpcContract = typeof ipcContract
export type IpcChannel = keyof IpcContract

/** What the renderer passes to `invoke`. */
export type IpcInput<K extends IpcChannel> = z.input<IpcContract[K]["input"]>
/** What a main-process handler receives, after parsing. */
export type IpcParsedInput<K extends IpcChannel> = z.output<
  IpcContract[K]["input"]
>
/** What a main-process handler may return, before parsing. */
export type IpcHandlerOutput<K extends IpcChannel> = z.input<
  IpcContract[K]["output"]
>
/** What the renderer receives back from `invoke`. */
export type IpcOutput<K extends IpcChannel> = z.output<IpcContract[K]["output"]>

export const ipcChannels = Object.keys(ipcContract) as readonly IpcChannel[]

/** Channel allowlist guard — used by the preload bridge and the registrar. */
export function isIpcChannel(value: unknown): value is IpcChannel {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ipcContract, value)
  )
}

/**
 * Status pushed by the auto-updater (`apps/desktop/src/main/updater.ts`).
 * Mirrors `UpdaterStatus` in `updater-policy.ts`; `ipc.test.ts` on the desktop
 * side asserts the two stay compatible.
 */
export const updaterStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("available"), version: z.string() }),
  z.object({ state: z.literal("not-available") }),
  z.object({ state: z.literal("downloading"), percent: z.number() }),
  z.object({ state: z.literal("ready"), version: z.string() }),
  z.object({ state: z.literal("error"), message: z.string() }),
])

/** Main→renderer pushes. Same rule as `ipcContract`: no channel without an entry. */
export const ipcEvents = {
  "updater:status": { payload: updaterStatusSchema },
} as const

export type IpcEvents = typeof ipcEvents
export type IpcEventChannel = keyof IpcEvents
export type IpcEventPayload<K extends IpcEventChannel> = z.output<
  IpcEvents[K]["payload"]
>
export type IpcEventInput<K extends IpcEventChannel> = z.input<
  IpcEvents[K]["payload"]
>

export const ipcEventChannels = Object.keys(
  ipcEvents
) as readonly IpcEventChannel[]

export function isIpcEventChannel(value: unknown): value is IpcEventChannel {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ipcEvents, value)
  )
}

/**
 * Every handler resolves with this envelope instead of rejecting, so the
 * renderer always sees a discriminated result rather than an opaque Electron
 * rejection whose message is mangled with a stack prefix.
 */
export const ipcResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
])

export type IpcResult<T = unknown> =
  { ok: true; data: T } | { ok: false; error: { message: string } }
