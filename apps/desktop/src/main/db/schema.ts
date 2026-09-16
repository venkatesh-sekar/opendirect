/**
 * The OpenDirect project database.
 *
 * One SQLite file lives inside each project folder (`opendirect.db`), so the
 * whole workspace — rows *and* media — is a single directory the user can move,
 * back up or sync. `projects` still carries a row so the file is
 * self-describing: opening a folder never needs an external index.
 *
 * Conventions:
 * - Ids are application-generated text (UUIDs), not autoincrement integers, so
 *   rows can be created before they are written and stay stable across exports.
 * - Timestamps are epoch milliseconds in plain `integer` columns.
 * - Anything provider-shaped (`params`, `request`, `response`) is stored as raw
 *   JSON text, verbatim, because every model has a different schema and we must
 *   be able to replay exactly what was sent.
 * - Foreign keys are declared *and* enforced (`PRAGMA foreign_keys = ON`, see
 *   `client.ts`). Deleting a project removes everything under it; deleting a
 *   generation detaches its outputs and branches rather than destroying them.
 */
import { relations } from "drizzle-orm"
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core"

/** The project this database belongs to. Exactly one row in practice. */
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Absolute path of the project folder, refreshed every time it is opened. */
  path: text("path").notNull(),
  createdAt: integer("created_at").notNull(),
})

/** Containers nest: a project board holds characters, scenes and folders. */
export const containers = sqliteTable(
  "containers",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references(
      (): AnySQLiteColumn => containers.id,
      {
        onDelete: "cascade",
      }
    ),
    /** "project" | "character" | "scene" | "folder" */
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("containers_project_id_idx").on(t.projectId),
    index("containers_parent_id_idx").on(t.parentId),
  ]
)

/**
 * Every piece of media in the project. An asset is just an asset — what makes
 * one a "reference" is being wired into a generation's input slot, not a flag
 * here.
 */
export const assets = sqliteTable(
  "assets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** "image" | "video" | "audio" | "text" | "prompt" */
    kind: text("kind").notNull(),
    /** Relative to the project root; null for text-only assets. */
    relPath: text("rel_path"),
    text: text("text"),
    mimeType: text("mime_type"),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    bytes: integer("bytes"),
    sha256: text("sha256"),
    thumbnailRelPath: text("thumbnail_rel_path"),
    /** Free-form, e.g. "Character Sheet". */
    label: text("label"),
    /**
     * The file name the user imported, kept for display and for "reveal in
     * finder" — the stored copy is named after the asset id, so without this
     * the original name is lost the moment the import finishes.
     */
    originalName: text("original_name"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    /**
     * Set when this asset came out of a generation. Deleting the generation
     * only clears the provenance — the file on disk outlives its job record.
     */
    generationId: text("generation_id").references(
      (): AnySQLiteColumn => generations.id,
      { onDelete: "set null" }
    ),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("assets_project_id_idx").on(t.projectId),
    index("assets_generation_id_idx").on(t.generationId),
  ]
)

/** Many-to-many: one asset can sit in several containers at once. */
export const containerAssets = sqliteTable(
  "container_assets",
  {
    containerId: text("container_id")
      .notNull()
      .references(() => containers.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.containerId, t.assetId] }),
    index("container_assets_container_id_idx").on(t.containerId),
    index("container_assets_asset_id_idx").on(t.assetId),
  ]
)

/** One submitted (or about to be submitted) model run. */
export const generations = sqliteTable(
  "generations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    containerId: text("container_id").references(() => containers.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull(),
    modelSlug: text("model_slug").notNull(),
    modelVersion: text("model_version"),
    /** "video" | "image" | … */
    kind: text("kind").notNull(),
    prompt: text("prompt"),
    /** The exact params the user chose. */
    paramsJson: text("params_json").notNull(),
    /** The exact payload sent to the provider. */
    requestJson: text("request_json"),
    /** The raw provider response. */
    responseJson: text("response_json"),
    /**
     * `queued | submitted | running | succeeded | failed | canceled` —
     * `generationStatusSchema` in `@opendirect/contract` is the definition.
     * Deliberately coarser than a job's `state`: a generation does not have a
     * "downloading" phase, its job does.
     */
    status: text("status").notNull(),
    error: text("error"),
    providerJobId: text("provider_job_id"),
    estimatedCostUsd: real("estimated_cost_usd"),
    actualCostUsd: real("actual_cost_usd"),
    /**
     * Seconds of compute the provider says the run took (Replicate's
     * `metrics.predict_time`). Recorded because it is the only thing Replicate
     * publishes that a hardware-seconds bill can be checked against.
     */
    predictTimeSeconds: real("predict_time_seconds"),
    costConfidence: text("cost_confidence"),
    /**
     * Groups the sibling runs of one canvas batch. Nullable and indexed:
     * every existing row and every non-canvas run has none, and the canvas
     * needs a queryable grouping key rather than a scan of `request_json`.
     */
    batchId: text("batch_id"),
    /**
     * Branching. `set null` rather than `cascade`: pruning one run must not
     * silently wipe every variant descended from it.
     */
    parentGenerationId: text("parent_generation_id").references(
      (): AnySQLiteColumn => generations.id,
      { onDelete: "set null" }
    ),
    branchNote: text("branch_note"),
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
  },
  (t) => [
    index("generations_project_id_idx").on(t.projectId),
    index("generations_container_id_idx").on(t.containerId),
    index("generations_parent_generation_id_idx").on(t.parentGenerationId),
    index("generations_batch_id_idx").on(t.batchId),
  ]
)

/** Which asset was fed into which input slot of a generation. */
export const generationInputs = sqliteTable(
  "generation_inputs",
  {
    id: text("id").primaryKey(),
    generationId: text("generation_id")
      .notNull()
      .references(() => generations.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    /** "reference_images", "first_frame", … — the provider's own field name. */
    slotField: text("slot_field").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    index("generation_inputs_generation_id_idx").on(t.generationId),
    index("generation_inputs_asset_id_idx").on(t.assetId),
  ]
)

/**
 * The visual canvas: where the user put things.
 *
 * A node is a *placement*, not ownership. That is what the delete rules say:
 *
 * - deleting a **node** cascades to its edges only — the asset and the
 *   generation it pointed at stay in the project;
 * - deleting an **asset** cascades a media node away (a media node with no
 *   asset is nothing) but only nulls `pick_asset_id` on a generate node,
 *   because a run that happened is still a run that happened;
 * - deleting a **generation** nulls `generation_id` and leaves the node in
 *   place, empty and ready to run again — the same rule as `assets`, where
 *   pruning a run never destroys media or lineage.
 */
export const canvasNodes = sqliteTable(
  "canvas_nodes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** "text" | "media" | "image_gen" | "video_gen" — `canvasNodeTypeSchema`. */
    type: text("type").notNull(),
    x: real("x").notNull(),
    y: real("y").notNull(),
    width: real("width").notNull(),
    height: real("height").notNull(),
    /** The asset a media node shows. Gone with the asset. */
    assetId: text("asset_id").references(() => assets.id, {
      onDelete: "cascade",
    }),
    generationId: text("generation_id").references(
      (): AnySQLiteColumn => generations.id,
      { onDelete: "set null" }
    ),
    /** Groups the sibling runs of one batch; matches `generations.batch_id`. */
    batchId: text("batch_id"),
    /** Which tile downstream edges resolve to. The user's decision. */
    pickAssetId: text("pick_asset_id").references(
      (): AnySQLiteColumn => assets.id,
      { onDelete: "set null" }
    ),
    text: text("text"),
    color: text("color"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("canvas_nodes_project_id_idx").on(t.projectId),
    index("canvas_nodes_generation_id_idx").on(t.generationId),
    index("canvas_nodes_batch_id_idx").on(t.batchId),
  ]
)

/**
 * An edge is a reference input and nothing else: "when the target runs, feed
 * it the source". It never triggers anything, which is why there is no state
 * on it beyond which slot it fills.
 */
export const canvasEdges = sqliteTable(
  "canvas_edges",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceNodeId: text("source_node_id")
      .notNull()
      .references((): AnySQLiteColumn => canvasNodes.id, {
        onDelete: "cascade",
      }),
    targetNodeId: text("target_node_id")
      .notNull()
      .references((): AnySQLiteColumn => canvasNodes.id, {
        onDelete: "cascade",
      }),
    /** The model's own field name; null for a text edge, which prepends. */
    slotField: text("slot_field"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("canvas_edges_project_id_idx").on(t.projectId),
    index("canvas_edges_source_node_id_idx").on(t.sourceNodeId),
    index("canvas_edges_target_node_id_idx").on(t.targetNodeId),
  ]
)

/**
 * The durable half of the job runner: `p-queue` gives concurrency, this table
 * gives survival across a restart.
 */
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    generationId: text("generation_id")
      .notNull()
      .references(() => generations.id, { onDelete: "cascade" }),
    /**
     * `queued | submitting | running | downloading | succeeded | failed |
     * canceled` — the enum is `jobStateSchema` in `@opendirect/contract`, and
     * that is the one that counts. Kept as plain text so a new state does not
     * need a migration; `toJobDto` is what narrows it.
     */
    state: text("state").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastPolledAt: integer("last_polled_at"),
    nextPollAt: integer("next_poll_at"),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("jobs_state_idx").on(t.state),
    index("jobs_generation_id_idx").on(t.generationId),
  ]
)

export const projectRelations = relations(projects, ({ many }) => ({
  containers: many(containers),
  assets: many(assets),
  generations: many(generations),
  canvasNodes: many(canvasNodes),
  canvasEdges: many(canvasEdges),
}))

export const containerRelations = relations(containers, ({ one, many }) => ({
  project: one(projects, {
    fields: [containers.projectId],
    references: [projects.id],
  }),
  parent: one(containers, {
    fields: [containers.parentId],
    references: [containers.id],
    relationName: "containerParent",
  }),
  children: many(containers, { relationName: "containerParent" }),
  containerAssets: many(containerAssets),
}))

export const assetRelations = relations(assets, ({ one, many }) => ({
  project: one(projects, {
    fields: [assets.projectId],
    references: [projects.id],
  }),
  containerAssets: many(containerAssets),
  generationInputs: many(generationInputs),
  canvasNodes: many(canvasNodes, { relationName: "canvasNodeAsset" }),
  canvasPicks: many(canvasNodes, { relationName: "canvasNodePick" }),
}))

export const containerAssetRelations = relations(
  containerAssets,
  ({ one }) => ({
    container: one(containers, {
      fields: [containerAssets.containerId],
      references: [containers.id],
    }),
    asset: one(assets, {
      fields: [containerAssets.assetId],
      references: [assets.id],
    }),
  })
)

export const generationRelations = relations(generations, ({ one, many }) => ({
  project: one(projects, {
    fields: [generations.projectId],
    references: [projects.id],
  }),
  container: one(containers, {
    fields: [generations.containerId],
    references: [containers.id],
  }),
  inputs: many(generationInputs),
  jobs: many(jobs),
  canvasNodes: many(canvasNodes),
}))

export const generationInputRelations = relations(
  generationInputs,
  ({ one }) => ({
    generation: one(generations, {
      fields: [generationInputs.generationId],
      references: [generations.id],
    }),
    asset: one(assets, {
      fields: [generationInputs.assetId],
      references: [assets.id],
    }),
  })
)

export const canvasNodeRelations = relations(canvasNodes, ({ one, many }) => ({
  project: one(projects, {
    fields: [canvasNodes.projectId],
    references: [projects.id],
  }),
  asset: one(assets, {
    fields: [canvasNodes.assetId],
    references: [assets.id],
    relationName: "canvasNodeAsset",
  }),
  pick: one(assets, {
    fields: [canvasNodes.pickAssetId],
    references: [assets.id],
    relationName: "canvasNodePick",
  }),
  generation: one(generations, {
    fields: [canvasNodes.generationId],
    references: [generations.id],
  }),
  outgoing: many(canvasEdges, { relationName: "canvasEdgeSource" }),
  incoming: many(canvasEdges, { relationName: "canvasEdgeTarget" }),
}))

export const canvasEdgeRelations = relations(canvasEdges, ({ one }) => ({
  project: one(projects, {
    fields: [canvasEdges.projectId],
    references: [projects.id],
  }),
  source: one(canvasNodes, {
    fields: [canvasEdges.sourceNodeId],
    references: [canvasNodes.id],
    relationName: "canvasEdgeSource",
  }),
  target: one(canvasNodes, {
    fields: [canvasEdges.targetNodeId],
    references: [canvasNodes.id],
    relationName: "canvasEdgeTarget",
  }),
}))

export const jobRelations = relations(jobs, ({ one }) => ({
  generation: one(generations, {
    fields: [jobs.generationId],
    references: [generations.id],
  }),
}))

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Container = typeof containers.$inferSelect
export type NewContainer = typeof containers.$inferInsert
export type Asset = typeof assets.$inferSelect
export type NewAsset = typeof assets.$inferInsert
export type ContainerAsset = typeof containerAssets.$inferSelect
export type Generation = typeof generations.$inferSelect
export type NewGeneration = typeof generations.$inferInsert
export type GenerationInput = typeof generationInputs.$inferSelect
export type NewGenerationInput = typeof generationInputs.$inferInsert
export type CanvasNode = typeof canvasNodes.$inferSelect
export type NewCanvasNode = typeof canvasNodes.$inferInsert
export type CanvasEdge = typeof canvasEdges.$inferSelect
export type NewCanvasEdge = typeof canvasEdges.$inferInsert
export type Job = typeof jobs.$inferSelect
export type NewJob = typeof jobs.$inferInsert
