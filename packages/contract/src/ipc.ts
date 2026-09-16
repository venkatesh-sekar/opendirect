import { z } from "zod"

import { costQuoteSchema, generationRequestSchema } from "./generation"
import {
  catalogListingSchema,
  modelDescriptorSchema,
  modelKindSchema,
  recommendedModelSchema,
} from "./model"
import {
  assetPageSchema,
  assetSchema,
  containerKindSchema,
  containerNodeSchema,
  containerSchema,
  generationPageSchema,
  generationSchema,
  importResultSchema,
  lineageSchema,
  projectRefSchema,
  recentProjectSchema,
} from "./project"
import { providerIdSchema } from "./provider"

/**
 * Where a resolved API key came from. `env` means a `.env.local` /
 * environment fallback used in development; it is never written to the vault.
 */
export const keySourceSchema = z.enum(["vault", "env", "none"])
export type KeySource = z.output<typeof keySourceSchema>

/**
 * All the renderer is ever told about a stored key: whether one exists, its
 * last four characters for a `•••• 1234` label, and where it came from.
 * The key itself never crosses the IPC boundary.
 */
export const keyStatusSchema = z.object({
  present: z.boolean(),
  last4: z.string().nullable(),
  source: keySourceSchema,
})
export type KeyStatus = z.output<typeof keyStatusSchema>

export const keysSummarySchema = z.object({
  /** False when the OS keychain is unavailable and keys are stored in plaintext. */
  encryptionAvailable: z.boolean(),
  replicate: keyStatusSchema,
  openrouter: keyStatusSchema,
})
export type KeysSummary = z.output<typeof keysSummarySchema>

/** Non-secret preferences. Secrets live in the key vault, never here. */
export const settingsSchema = z.object({
  projectRoot: z.string().nullable(),
  theme: z.enum(["system", "light", "dark"]),
  defaultVideoModel: z.string().nullable(),
  defaultImageModel: z.string().nullable(),
  maxConcurrentJobs: z.number().int().min(1).max(8),
  pollIntervalMs: z.number().int().min(500).max(60_000),
})
export type Settings = z.output<typeof settingsSchema>

/** Applied on top of whatever is missing from the persisted settings blob. */
export const settingsDefaults: Settings = {
  projectRoot: null,
  theme: "system",
  defaultVideoModel: null,
  defaultImageModel: null,
  maxConcurrentJobs: 2,
  pollIntervalMs: 3000,
}

export const okSchema = z.object({ ok: z.literal(true) })

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

  "settings:get": { input: z.void(), output: settingsSchema },
  "settings:set": { input: settingsSchema.partial(), output: settingsSchema },

  /** Opens a native directory picker for `projectRoot`; null when cancelled. */
  "settings:projectRoot:choose": {
    input: z.void(),
    output: z.object({ path: z.string().nullable() }),
  },

  "settings:keys:summary": { input: z.void(), output: keysSummarySchema },
  "settings:keys:set": {
    input: z.object({ provider: providerIdSchema, key: z.string().min(1) }),
    output: okSchema,
  },
  "settings:keys:clear": {
    input: z.object({ provider: providerIdSchema }),
    output: okSchema,
  },
  /**
   * Checks a key against the provider's **model-listing** endpoint only.
   * See `apps/desktop/src/main/settings.ts` — never a generation endpoint.
   */
  "settings:keys:verify": {
    input: z.object({ provider: providerIdSchema }),
    output: z.object({ valid: z.boolean(), message: z.string().optional() }),
  },

  /**
   * The model catalog. Served from the on-disk cache while it is fresh; a
   * `refresh: true` re-fetches from every configured provider first.
   *
   * ⛔ Backed by the providers' free, read-only listing endpoints only.
   */
  "models:list": {
    input: z.object({
      kinds: z.array(modelKindSchema).optional(),
      refresh: z.boolean().optional(),
    }),
    output: catalogListingSchema,
  },
  /** One full descriptor — schema included — fetched and cached on demand. */
  "models:get": {
    input: z.object({ key: z.string() }),
    output: modelDescriptorSchema,
  },
  /** The curated shortlist, annotated with whether the catalog still lists it. */
  "models:recommended": {
    input: z.void(),
    output: z.object({
      video: z.array(recommendedModelSchema),
      image: z.array(recommendedModelSchema),
    }),
  },

  /**
   * The open project and the folder it lives in. Exactly one project is open
   * at a time, so none of these take a project id — main knows which one it is.
   */
  "project:current": {
    input: z.void(),
    output: z.object({ project: projectRefSchema.nullable() }),
  },
  "project:recent": { input: z.void(), output: z.array(recentProjectSchema) },
  "project:create": {
    input: z.object({ name: z.string().min(1) }),
    output: projectRefSchema,
  },
  "project:open": {
    input: z.object({ path: z.string().min(1) }),
    output: projectRefSchema,
  },
  /** Native folder picker for "Open project…"; null when cancelled. */
  "project:choose": {
    input: z.void(),
    output: z.object({ path: z.string().nullable() }),
  },
  "project:close": { input: z.void(), output: okSchema },

  "containers:tree": { input: z.void(), output: z.array(containerNodeSchema) },
  "containers:create": {
    input: z.object({
      parentId: z.string().nullable().optional(),
      kind: containerKindSchema,
      name: z.string().min(1),
    }),
    output: containerSchema,
  },
  "containers:rename": {
    input: z.object({ id: z.string(), name: z.string().min(1) }),
    output: containerSchema,
  },
  "containers:reparent": {
    input: z.object({ id: z.string(), parentId: z.string().nullable() }),
    output: containerSchema,
  },
  /** Removes the sub-tree and its asset *links*; the assets themselves stay. */
  "containers:delete": {
    input: z.object({ id: z.string() }),
    output: okSchema,
  },

  "assets:list": {
    input: z.object({
      containerId: z.string(),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    output: assetPageSchema,
  },
  /** Native file picker for "Import…"; an empty list when cancelled. */
  "assets:choose": {
    input: z.void(),
    output: z.object({ paths: z.array(z.string()) }),
  },
  /**
   * Copies files into the project folder, deduplicating by content hash. The
   * paths come from `assets:choose` or from a renderer drop event.
   */
  "assets:import": {
    input: z.object({
      paths: z.array(z.string().min(1)).min(1),
      containerId: z.string().nullable().optional(),
      label: z.string().nullable().optional(),
    }),
    output: importResultSchema,
  },
  "assets:get": {
    input: z.object({ id: z.string() }),
    output: assetSchema,
  },
  "assets:addToContainer": {
    input: z.object({ containerId: z.string(), assetId: z.string() }),
    output: okSchema,
  },
  "assets:removeFromContainer": {
    input: z.object({ containerId: z.string(), assetId: z.string() }),
    output: okSchema,
  },

  /**
   * The pre-flight price for a set of form values, computed by
   * `providers/cost.ts` in main so the renderer never carries a pricing table.
   * Always answers — `confidence: "unknown"` is a valid, honest answer.
   */
  "cost:estimate": {
    input: z.object({
      key: z.string().min(1),
      params: z.record(z.string(), z.unknown()),
    }),
    output: costQuoteSchema,
  },

  /**
   * Records a generation the creation bar built.
   *
   * ⛔ In Task 15 this is a **stub**: it persists the request as a `queued`
   * row and returns it. No provider is called; Task 16 adds the runner that
   * picks queued rows up.
   */
  "generations:submit": {
    input: generationRequestSchema,
    output: generationSchema,
  },

  /**
   * Generation *records*. Submitting one only queues a row; running it is the
   * job runner's job (Task 16).
   */
  "generations:list": {
    input: z.object({
      containerId: z.string(),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    output: generationPageSchema,
  },
  "generations:get": {
    input: z.object({ id: z.string() }),
    output: z.object({
      generation: generationSchema,
      inputs: z.array(
        z.object({
          slotField: z.string(),
          position: z.number(),
          asset: assetSchema,
        })
      ),
    }),
  },
  /** Ancestors + descendants, for the branch view. */
  "generations:lineage": {
    input: z.object({ id: z.string() }),
    output: lineageSchema,
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
 * `updater-policy.ts` derives its `UpdaterStatus` type from this schema, so
 * there is exactly one definition of the shape.
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
