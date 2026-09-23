import { z } from "zod"
import { workflowSchema } from "./workflow"

import {
  aiProgressSchema,
  aiResultSchema,
  aiRunRequestSchema,
  aiToolIdSchema,
  aiToolsSchema,
} from "./ai"
import {
  canvasEdgeSchema,
  canvasNodeMoveSchema,
  canvasNodePatchSchema,
  canvasNodeSchema,
  canvasNodeTypeSchema,
  canvasSchema,
} from "./canvas"
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
  containerSummarySchema,
  generationPageSchema,
  generationSchema,
  importResultSchema,
  lineageSchema,
  mentionSubjectSchema,
  projectRefSchema,
  recentProjectSchema,
  relatedContainersSchema,
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
  /**
   * Which local CLI the AI helpers use when both are installed. Null means
   * "whichever is there" — it is a preference, not a requirement, and a
   * machine with neither never sees an AI menu at all.
   */
  preferredAiTool: aiToolIdSchema.nullable(),
  /**
   * Which provider runs a family model first. A configured provider missing
   * from the list is tried after the listed ones, never skipped.
   */
  providerOrder: z.array(providerIdSchema).max(8),
  /** Whether a newer registry is fetched from GitHub (a free `GET`). */
  remoteRegistry: z.boolean(),
  /** Base URL of the remote registry; null means the default. */
  registryUrl: z.string().url().nullable(),
  /** Whether the picker lists models whose inputs no mapping has verified. */
  includeUnverified: z.boolean(),
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
  preferredAiTool: null,
  providerOrder: ["replicate", "openrouter"],
  remoteRegistry: true,
  registryUrl: null,
  includeUnverified: false,
}

export const okSchema = z.object({ ok: z.literal(true) })

/**
 * Where a run is in the job runner's state machine.
 *
 * It is deliberately finer-grained than `generationStatusSchema`: a generation
 * is `running` from the moment it is submitted until its outputs are on disk,
 * while the job list wants to say *which* of those the runner is doing —
 * "submitting" and "downloading" are the two stages where a stalled run looks
 * identical otherwise.
 */
export const jobStateSchema = z.enum([
  "queued",
  "submitting",
  "running",
  "downloading",
  "succeeded",
  "failed",
  "canceled",
])
export type JobState = z.output<typeof jobStateSchema>

/** States the runner will still move out of by itself. */
export const ACTIVE_JOB_STATES: readonly JobState[] = [
  "queued",
  "submitting",
  "running",
  "downloading",
]

export const jobSchema = z.object({
  id: z.string(),
  generationId: z.string(),
  state: jobStateSchema,
  /** How many times the runner has tried this job, including the current try. */
  attempts: z.number().int(),
  error: z.string().nullable(),
  createdAt: z.number(),
  lastPolledAt: z.number().nullable(),
  nextPollAt: z.number().nullable(),
  /**
   * 0–1 when the provider reports a percentage. Neither Replicate nor
   * OpenRouter does today, so the job list shows an indeterminate bar rather
   * than an invented number — and it is not persisted, so it is null again
   * after a restart.
   */
  progress: z.number().nullable(),
  /**
   * True for a `queued` run that the app found in the database at startup and
   * deliberately did **not** start.
   *
   * ⛔ Recovery never submits. A queued row is a run the user paid nothing for
   * yet, and re-launching the app is not consent to spend money — so it is left
   * queued, flagged here, and the job list offers an explicit **Resume**. Not
   * persisted: it is re-derived by `recover()` on every start.
   */
  awaitingResume: z.boolean().default(false),
  /** The run itself: model, container, cost, error — everything the row shows. */
  generation: generationSchema,
})
export type JobDto = z.output<typeof jobSchema>

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
  /**
   * What the window needs to know about the app it is running inside: the
   * version for the status bar, the platform, and the chord the model catalog's
   * refresh should bind to.
   *
   * The accelerator comes from main because main is what gave it away or kept
   * it: Chromium's default menu owns `⌘R` for Reload in development, so catalog
   * refresh takes `⌘⇧R` there and `⌘R` in production, where the menu no longer
   * binds reload at all (`apps/desktop/src/main/menu.ts`).
   */
  "app:info": {
    input: z.void(),
    output: z.object({
      version: z.string(),
      platform: z.string(),
      dev: z.boolean(),
      /** A `react-hotkeys-hook` chord, e.g. `"mod+r"` or `"mod+shift+r"`. */
      catalogRefreshAccelerator: z.string(),
    }),
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
    input: z.object({
      provider: providerIdSchema,
      /**
       * A key the user has typed but not saved. Without it "Test" could only
       * check the *stored* key, which made the natural paste → Test → Save
       * order impossible. The draft is used for the check and nothing else —
       * it is never written to the vault by this call.
       */
      key: z.string().optional(),
    }),
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

  "containers:tree": { input: z.void(), output: z.array(containerNodeSchema) },
  /**
   * Counts, a cover image and last activity for every container, in one
   * query — what Home and the character and scene grids draw their cards from.
   */
  "containers:summaries": {
    input: z.void(),
    output: z.array(containerSummarySchema),
  },
  /**
   * A scene's cast, or the scenes a character appears in. Derived from the
   * runs filed under scenes; only a character or a scene can be asked.
   */
  "containers:related": {
    input: z.object({ id: z.string() }),
    output: relatedContainersSchema,
  },
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
  /**
   * Sets (or clears) the `@handle` a character or scene answers to.
   *
   * Main is the last word on both the shape and the uniqueness — the renderer
   * validates with the same `handle.ts` beforehand only so the error arrives
   * while the user is still typing.
   */
  "containers:setHandle": {
    input: z.object({ id: z.string(), handle: z.string().nullable() }),
    output: containerSchema,
  },
  /** The prose `@venkz` becomes on a model with no image input. */
  "containers:setReferences": {
    input: z.object({
      id: z.string(),
      assetIds: z.array(z.string()).max(100).nullable(),
    }),
    output: containerSchema,
  },
  "containers:setDescription": {
    input: z.object({ id: z.string(), description: z.string().nullable() }),
    output: containerSchema,
  },
  /**
   * "Save as character": creates the container, links the asset to it and
   * marks that asset as the reference image — one transaction in main, so a
   * failed link never leaves an empty character behind.
   *
   * ⛔ It links; it never copies, moves or generates. The asset stays on every
   * board it is already on.
   */
  "containers:createFromAsset": {
    input: z.object({
      assetId: z.string(),
      kind: z.enum(["character", "scene"]),
      name: z.string().min(1),
    }),
    output: containerSchema,
  },
  /**
   * Moves a container to `index` among its siblings (clamped to the end) and
   * renumbers them — how a scene's shots are reordered.
   */
  "containers:reorder": {
    input: z.object({ id: z.string(), index: z.number().int().min(0) }),
    output: okSchema,
  },
  /**
   * Picks a shot's version: an asset one of its runs made, or null for none.
   * ⛔ Picking chooses among what exists; it never generates.
   */
  "containers:setPick": {
    input: z.object({ id: z.string(), assetId: z.string().nullable() }),
    output: containerSchema,
  },
  /** Removes the sub-tree and its asset *links*; the assets themselves stay. */
  "containers:delete": {
    input: z.object({ id: z.string() }),
    output: okSchema,
  },

  /**
   * Every `@`-able character and scene with its ranked reference images.
   *
   * ⛔ Read-only, and it never picks: the ranking says which image is most
   * likely the canonical one, and `resolveMentions` in the renderer decides
   * how many of them a given model can actually take.
   */
  "mentions:subjects": {
    input: z.void(),
    output: z.array(mentionSubjectSchema),
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
   * Records a generation the creation bar built and hands it to the job
   * runner.
   *
   * ⛔ This is the one channel that leads to a paid call, and only ever from a
   * user-initiated Generate: it writes the `queued` row first and enqueues it,
   * so what the provider is asked for is always what SQLite already says.
   */
  "generations:submit": {
    input: generationRequestSchema,
    output: generationSchema,
  },

  /**
   * The same thing, N times — what the canvas sends when the user asks a node
   * for several results.
   *
   * The count is what the user asked for, not a job count: main reads the
   * model's own schema (`planBatch` in `canvas-batch.ts`) and decides whether
   * that is one prediction with `num_outputs: 4` or four sibling predictions.
   * The renderer would otherwise have to hold the same opinion to know what it
   * is about to spend.
   *
   * ⛔ Paid, and only ever from a click on Generate. Every sibling is written
   * to SQLite as a `queued` row before any provider is called, exactly as the
   * single-run channel does — the batch id and the ids come back so the node
   * can store what it just queued.
   */
  "generations:submitBatch": {
    input: z.object({
      request: generationRequestSchema,
      /**
       * How many results. Capped well below anything a person would click for
       * on purpose, because this is the number that multiplies the bill.
       */
      count: z.number().int().min(1).max(16),
    }),
    output: z.object({
      batchId: z.string(),
      generations: z.array(generationSchema),
    }),
  },

  /**
   * Generation *records*. Submitting one only queues a row; running it is the
   * job runner's job; `jobs:list` is where its progress shows up.
   *
   * Leave `containerId` out for every run in the open project, newest first —
   * Home's Continue strip and the generations page read it that way.
   */
  "generations:list": {
    input: z.object({
      containerId: z.string().optional(),
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

  /**
   * The whole canvas for the open project: every node with its resolved asset
   * and generation, and every edge. One fetch, because the surface is rendered
   * all at once and a per-node round trip would mean a request storm on open.
   */
  "canvas:importWorkflow": {
    input: workflowSchema,
    output: canvasSchema,
  },
  "canvas:get": { input: z.void(), output: canvasSchema },

  /**
   * Places a node. A media node names the asset it shows; a text node carries
   * its note. Nothing here runs anything — a generate node starts out empty
   * and stays that way until Generate is pressed.
   */
  "canvas:node:create": {
    input: z.object({
      type: canvasNodeTypeSchema,
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
      assetId: z.string().min(1).nullable().optional(),
      containerId: z.string().min(1).nullable().optional(),
      text: z.string().nullable().optional(),
      color: z.string().nullable().optional(),
    }),
    output: canvasNodeSchema,
  },

  /** Partial update: position, size, text, colour, pick, run. */
  "canvas:node:update": {
    input: z.object({ id: z.string().min(1), patch: canvasNodePatchSchema }),
    output: canvasNodeSchema,
  },

  /**
   * Positions, in bulk. An array because box-select then drag moves many nodes
   * at once, and one debounced write per gesture beats one per node.
   */
  "canvas:node:move": {
    input: z.object({ moves: z.array(canvasNodeMoveSchema) }),
    output: okSchema,
  },

  /**
   * Removes nodes and the edges attached to them — and nothing else. The
   * assets and the generations they point at stay in the project, reachable
   * from their sidebar container, because a node is a placement rather than
   * ownership.
   */
  "canvas:node:delete": {
    input: z.object({ ids: z.array(z.string().min(1)) }),
    output: okSchema,
  },

  /**
   * Chooses which tile of a batch downstream edges resolve to. Deletes
   * nothing, re-runs nothing: the old pick's asset is still there and no
   * downstream node is touched.
   */
  "canvas:node:pick": {
    input: z.object({ id: z.string().min(1), assetId: z.string().min(1) }),
    output: canvasNodeSchema,
  },

  /**
   * Wires one node into another's next run. ⛔ Drawing an edge submits
   * nothing and marks nothing stale.
   */
  "canvas:edge:create": {
    input: z.object({
      sourceNodeId: z.string().min(1),
      targetNodeId: z.string().min(1),
      /** Null for a text edge, which prepends rather than filling a slot. */
      slotField: z.string().min(1).nullable().optional(),
    }),
    output: canvasEdgeSchema,
  },

  /** Moves an edge to a different input slot of the same target. */
  "canvas:edge:update": {
    input: z.object({
      id: z.string().min(1),
      slotField: z.string().min(1).nullable(),
    }),
    output: canvasEdgeSchema,
  },

  "canvas:edge:delete": {
    input: z.object({ ids: z.array(z.string().min(1)) }),
    output: okSchema,
  },

  /**
   * Lays an existing project's lineage out as a canvas, for a project that
   * predates it. Idempotent by intent: a project that already has canvas rows
   * is handed back unchanged rather than laid out twice.
   */
  "canvas:migrate": { input: z.void(), output: canvasSchema },

  /**
   * Hands an asset's file to the operating system: `shell.openPath` for Open,
   * `shell.showItemInFolder` for Reveal in folder.
   *
   * The renderer names an **asset**, never a path. Main looks the row up and
   * re-checks its stored `relPath` against the project root
   * (`shell-open.ts`), so a path can neither be supplied by the renderer nor
   * escape the project folder on its way to the OS.
   */
  "shell:openAsset": {
    input: z.object({ assetId: z.string().min(1) }),
    output: okSchema,
  },
  "shell:revealAsset": {
    input: z.object({ assetId: z.string().min(1) }),
    output: okSchema,
  },

  /**
   * The job runner's queue: active runs first, then recently finished ones.
   * Every row is a `jobs` row in SQLite, so the list survives a restart.
   */
  "jobs:list": {
    input: z.object({ limit: z.number().int().min(1).max(200).optional() }),
    output: z.array(jobSchema),
  },
  /**
   * Stops a run: the provider is asked to cancel when it can, and the row is
   * marked `canceled` either way so nothing keeps polling it.
   */
  "jobs:cancel": { input: z.object({ id: z.string() }), output: jobSchema },
  /**
   * ⛔ Re-submits a failed or cancelled run — a paid call, and therefore only
   * ever from an explicit click on Retry in the job list.
   */
  "jobs:retry": { input: z.object({ id: z.string() }), output: jobSchema },
  /**
   * ⛔ Starts a run that recovery left queued — the **Resume** button. This is
   * the paid call the restart deliberately did not make, so it exists only to
   * be reached by a click.
   */
  "jobs:resume": { input: z.object({ id: z.string() }), output: jobSchema },

  /**
   * Which locally installed AI CLIs the app found. Detected once at startup
   * and cached; the renderer hides every AI entry point when `preferred` is
   * null, so a machine with neither binary never sees a greyed-out teaser.
   */
  "ai:tools": { input: z.void(), output: aiToolsSchema },
  /** Runs detection again — the "Re-detect" button in Settings. */
  "ai:detect": { input: z.void(), output: aiToolsSchema },
  /**
   * Runs one helper by spawning the user's own `claude` / `codex` binary.
   *
   * ⛔ Not a generation: no provider is called and nothing is charged beyond
   * whatever the user's own CLI subscription already covers. The result is
   * handed back for the user to accept — main never applies it anywhere.
   */
  "ai:run": { input: aiRunRequestSchema, output: aiResultSchema },
  /** Kills the child process behind a run; a no-op once it has finished. */
  "ai:cancel": {
    input: z.object({ runId: z.string().min(1) }),
    output: okSchema,
  },
  /**
   * Restarts into an update that has already been downloaded — the button the
   * status bar shows once `updater:status` reports `ready`. A downloaded
   * update installs on the next quit anyway; this only offers to bring that
   * quit forward, because a restart in the middle of a running job is the
   * user's decision, not ours.
   *
   * Returns `{ restarting: false }` when nothing is staged, so a stale button
   * click cannot be mistaken for a restart that is about to happen.
   */
  "updater:install": {
    input: z.void(),
    output: z.object({ restarting: z.boolean() }),
  },
  /**
   * The last status the updater produced, or null if it has not spoken yet
   * (an unpackaged build never does).
   *
   * `updater:status` is a push, and the updater checks once at startup and then
   * every six hours — so a window created *after* that check would otherwise
   * never learn about a downloaded update, and "Restart to update" would be
   * unreachable until the next check came round. The renderer reads this on
   * mount and subscribes for what comes later.
   */
  "updater:status:get": {
    input: z.void(),
    output: updaterStatusSchema.nullable(),
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
 * Where the application menu asks the renderer to go.
 *
 * The menu lives in the main process and the router lives in the renderer, so
 * "Settings…" can only be a push. The path is an enum rather than a string:
 * main may name a screen the app actually has, and nothing else.
 */
export const navigateRequestSchema = z.object({
  path: z.enum(["/", "/settings"]),
  /**
   * When true the renderer treats the push as a *toggle*: already on `path`
   * means go back to "/". The accelerator that fires this (`CmdOrCtrl+,`) is
   * owned by the application menu, which pre-empts the renderer's own hotkey
   * in a packaged build — so the toggle has to live on this side of the wire,
   * where the current route is actually known.
   */
  toggle: z.boolean().optional(),
})

/** Main→renderer pushes. Same rule as `ipcContract`: no channel without an entry. */
export const ipcEvents = {
  "updater:status": { payload: updaterStatusSchema },
  /**
   * One push per job state change, from the runner in main. The renderer's
   * `useJobs` patches its cache with it and invalidates the board's queries
   * when a run reaches a terminal state, so a finished generation's outputs
   * appear without polling from the renderer as well.
   */
  "jobs:update": { payload: jobSchema },
  /**
   * Live progress from a running AI helper: one `started`, any number of
   * `output` chunks as the CLI writes, and exactly one terminal event. The
   * chunks are the CLI's own stdout/stderr — never the prompt.
   */
  "ai:progress": { payload: aiProgressSchema },
  /** A menu item asking the renderer's router for a screen. */
  "shell:navigate": { payload: navigateRequestSchema },
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
