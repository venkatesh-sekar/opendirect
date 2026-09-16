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
    /** queued | submitted | running | succeeded | failed | canceled */
    status: text("status").notNull(),
    error: text("error"),
    providerJobId: text("provider_job_id"),
    estimatedCostUsd: real("estimated_cost_usd"),
    actualCostUsd: real("actual_cost_usd"),
    costConfidence: text("cost_confidence"),
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
    /** pending | running | downloading | done | failed | canceled */
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
export type Job = typeof jobs.$inferSelect
export type NewJob = typeof jobs.$inferInsert
