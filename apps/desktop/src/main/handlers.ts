/**
 * Project, container, asset and generation IPC handlers.
 *
 * The thinnest possible layer: resolve the open project, call a repository,
 * hand back a contract shape. Everything with logic worth testing lives in
 * `repo/*` (electron-free, driven against a temp project folder), so this file
 * stays a wiring sheet — the same split as `catalog.ts` / `catalog-service.ts`.
 *
 * Two invariants it does enforce:
 *
 * - **A project must be open.** Every channel here would otherwise have to
 *   invent a database, so they fail with one clear message instead.
 * - **No filesystem path leaves main.** Assets go out as `asset://` URLs built
 *   by `media.ts`; the only exception is `project.path`, which the title bar
 *   shows and which the user typed in the first place.
 */
import { dialog, shell } from "electron"

import { registerCanvasHandlers } from "./canvas-service"
import { submitBatch, submitGeneration } from "./generations-submit"
import { getJobRunner } from "./jobs-service"
import { estimateFor } from "./model-registry/family-descriptor"
import { annotatedModel, modelSource } from "./model-registry/registry-service"
import type { IpcRegistrar } from "./ipc-registry"
import type { ProjectDatabase } from "./db/client"
import type { ProjectRef } from "./project"
import {
  createProjectInRoot,
  getCurrentProject,
  getRecentProjects,
  openProjectAt,
} from "./project-service"
import {
  addToContainer,
  getAsset,
  importFiles,
  listByContainer as listAssets,
  removeFromContainer,
  toAssetDto,
} from "./repo/assets"
import {
  createContainer,
  createContainerFromAsset,
  deleteContainer,
  listContainerSummaries,
  listRelated,
  listTree,
  moveContainer,
  renameContainer,
  reparentContainer,
  setContainerDescription,
  setContainerReferences,
  setContainerHandle,
  setContainerPick,
} from "./repo/containers"
import { preflightGeneration } from "./generation-preflight"
import { resolveOpenPath } from "./shell-open"
import {
  getGeneration,
  lineage,
  listByContainer as listGenerations,
  listInputs,
  toGenerationDto,
  updateStatus,
} from "./repo/generations"

interface OpenContext {
  db: ProjectDatabase
  project: ProjectRef
}

/** The open project, or a message the renderer can show as-is. */
function requireProject(): OpenContext {
  const current = getCurrentProject()
  if (!current) throw new Error("No project is open")
  return { db: current.handle.db, project: current.project }
}

/** File types the import dialog offers. Dropping a file is not filtered. */
const IMPORT_FILTERS = [
  {
    name: "Media",
    extensions: [
      "png",
      "jpg",
      "jpeg",
      "webp",
      "gif",
      "avif",
      "heic",
      "mp4",
      "mov",
      "webm",
      "m4v",
      "mp3",
      "wav",
      "m4a",
      "flac",
    ],
  },
  { name: "All files", extensions: ["*"] },
]

export function registerProjectHandlers(handle: IpcRegistrar["handle"]): void {
  handle("project:current", () => ({
    project: getCurrentProject()?.project ?? null,
  }))

  handle("project:recent", () => getRecentProjects().list())

  handle("project:create", async ({ name }) => {
    const project = await createProjectInRoot(name)
    // Creating implies opening: the renderer expects a board afterwards.
    await openProjectAt(project.path)
    return project
  })

  handle(
    "project:open",
    async ({ path }) => (await openProjectAt(path)).project
  )

  handle("project:choose", async () => {
    const result = await dialog.showOpenDialog({
      title: "Open an OpenDirect project folder",
      properties: ["openDirectory"],
    })
    if (result.canceled || result.filePaths.length === 0) return { path: null }
    return { path: result.filePaths[0] ?? null }
  })

  handle("containers:tree", () => {
    const { db, project } = requireProject()
    return listTree(db, project.id)
  })

  handle("containers:summaries", () => {
    const { db, project } = requireProject()
    return listContainerSummaries(db, project.id)
  })

  handle("containers:related", ({ id }) => listRelated(requireProject().db, id))

  handle("containers:create", ({ parentId, kind, name }) => {
    const { db, project } = requireProject()
    return createContainer(db, {
      projectId: project.id,
      parentId: parentId ?? null,
      kind,
      name,
    })
  })

  handle("containers:rename", ({ id, name }) =>
    renameContainer(requireProject().db, id, name)
  )

  handle("containers:reparent", ({ id, parentId }) =>
    reparentContainer(requireProject().db, id, parentId)
  )

  /**
   * ⛔ Main is the last word on a handle: the renderer checks the same
   * pattern while the user types, but only main can see whether another
   * container in this project already answers to it.
   */
  handle("containers:setHandle", ({ id, handle: value }) =>
    setContainerHandle(requireProject().db, id, value)
  )

  handle("containers:setReferences", ({ id, assetIds }) =>
    setContainerReferences(requireProject().db, id, assetIds)
  )

  handle("containers:setDescription", ({ id, description }) =>
    setContainerDescription(requireProject().db, id, description)
  )

  /**
   * ⛔ One transaction: the container, the link and the pin. It creates
   * nothing else and spends nothing.
   */
  handle("containers:createFromAsset", ({ assetId, kind, name }) => {
    const { db, project } = requireProject()
    return createContainerFromAsset(db, {
      projectId: project.id,
      assetId,
      kind,
      name,
    })
  })

  handle("containers:reorder", ({ id, index }) => {
    moveContainer(requireProject().db, id, index)
    return { ok: true as const }
  })

  /** ⛔ Chooses among a shot's existing versions; it never generates. */
  handle("containers:setPick", ({ id, assetId }) =>
    setContainerPick(requireProject().db, id, assetId)
  )

  handle("containers:delete", ({ id }) => {
    deleteContainer(requireProject().db, id)
    return { ok: true as const }
  })

  handle("assets:list", ({ containerId, limit, offset }) =>
    listAssets(requireProject().db, { containerId, limit, offset })
  )

  handle("assets:choose", async () => {
    const result = await dialog.showOpenDialog({
      title: "Import media into this project",
      properties: ["openFile", "multiSelections"],
      filters: IMPORT_FILTERS,
    })
    if (result.canceled) return { paths: [] }
    return { paths: result.filePaths }
  })

  handle("assets:import", ({ paths, containerId, label }) => {
    const { db, project } = requireProject()
    return importFiles({ db, project }, { paths, containerId, label })
  })

  handle("assets:get", ({ id }) => {
    const asset = getAsset(requireProject().db, id)
    if (!asset) throw new Error(`Asset ${id} was not found`)
    return toAssetDto(asset)
  })

  handle("assets:addToContainer", ({ containerId, assetId }) => {
    addToContainer(requireProject().db, { containerId, assetId })
    return { ok: true as const }
  })

  handle("assets:removeFromContainer", ({ containerId, assetId }) => {
    removeFromContainer(requireProject().db, { containerId, assetId })
    return { ok: true as const }
  })

  handle("generations:list", ({ containerId, limit, offset }) =>
    listGenerations(requireProject().db, { containerId, limit, offset })
  )

  handle("generations:get", ({ id }) => {
    const { db } = requireProject()
    const generation = getGeneration(db, id)
    if (!generation) throw new Error(`Generation ${id} was not found`)
    return {
      generation: toGenerationDto(generation),
      inputs: listInputs(db, id),
    }
  })

  handle("generations:lineage", ({ id }) => lineage(requireProject().db, id))

  /**
   * The two places a path leaves main. `resolveOpenPath` re-checks the row's
   * stored path against the project root first, so the OS is only ever handed
   * a file that is genuinely inside the open project.
   */
  handle("shell:openAsset", async ({ assetId }) => {
    const { db, project } = requireProject()
    const failure = await shell.openPath(
      // `forOpening`: this hands the file to the OS's handler, so it is limited
      // to the media types the app recognises. Reveal, below, is not.
      await resolveOpenPath({ db, project }, assetId, { forOpening: true })
    )
    // `openPath` reports "no application could open this" as a string rather
    // than by rejecting, and silence would look like success.
    if (failure) throw new Error(failure)
    return { ok: true as const }
  })

  handle("shell:revealAsset", async ({ assetId }) => {
    const { db, project } = requireProject()
    shell.showItemInFolder(await resolveOpenPath({ db, project }, assetId))
    return { ok: true as const }
  })

  /**
   * The creation bar's live price. Always answers — a model with no published
   * rate comes back as `confidence: "unknown"`, which the badge renders as
   * "Cost unknown" rather than as a number nobody can stand behind.
   */
  handle("cost:estimate", ({ key, params, provider, filled }) =>
    // A family key is priced on the endpoint it would run on, in that
    // endpoint's own field names.
    estimateFor(modelSource, key, params, { provider, filled })
  )

  /**
   * ⛔ The one channel that leads to a paid call — and only ever because the
   * user pressed Generate.
   *
   * The row is written first (`generations-submit.ts` still calls no provider),
   * then handed to the runner. Order matters: if the process dies between the
   * two, SQLite holds a `queued` row that costs nothing and that startup
   * recovery will pick up, rather than a provider job nothing knows about.
   */
  handle("generations:submit", async (request) => {
    const { db, project } = requireProject()
    const generation = await submitGeneration(
      { db, project },
      {
        getModel: (key) => annotatedModel(key, { refresh: true }),
        preflight: preflightGeneration,
      },
      request
    )

    try {
      getJobRunner().enqueue(generation.id)
    } catch (error) {
      // The run is on the board either way, so it must not be left claiming to
      // be queued when nothing is going to pick it up.
      const message =
        error instanceof Error ? error.message : "The job runner is unavailable"
      return updateStatus(db, generation.id, {
        status: "failed",
        error: message,
      })
    }

    return generation
  })

  /**
   * ⛔ The same channel, N times — the canvas node's count stepper.
   *
   * Main decides what N costs in jobs, because only main has the model's
   * schema: `submitBatch` may write one row with `num_outputs: 4` or four
   * sibling rows sharing a batch id. Either way every row is `queued` in
   * SQLite before a single one is handed to the runner, so a crash midway
   * through leaves runs that cost nothing rather than provider jobs nobody
   * recorded.
   */
  handle("generations:submitBatch", async ({ request, count }) => {
    const { db, project } = requireProject()
    const batch = await submitBatch(
      { db, project },
      {
        getModel: (key) => annotatedModel(key, { refresh: true }),
        preflight: preflightGeneration,
      },
      request,
      count
    )

    const runner = getJobRunner()
    return {
      batchId: batch.batchId,
      generations: batch.generations.map((generation) => {
        try {
          runner.enqueue(generation.id)
        } catch (error) {
          // One sibling failing to enqueue must not hide the others, and none
          // of them may be left claiming to be queued with nothing to pick it
          // up. Each row answers for itself.
          const message =
            error instanceof Error
              ? error.message
              : "The job runner is unavailable"
          return updateStatus(db, generation.id, {
            status: "failed",
            error: message,
          })
        }
        return generation
      }),
    }
  })

  /**
   * The canvas: nodes, edges, picks and the layout the user arranged.
   *
   * ⛔ None of them submits anything — an edge is a statement about the next
   * run, never a trigger. See `canvas-service.ts`.
   */
  registerCanvasHandlers(handle)

  /** The job list sheet. Reads the `jobs` table, so it survives a restart. */
  handle("jobs:list", ({ limit }) => {
    requireProject()
    return getJobRunner().list(limit)
  })

  handle("jobs:cancel", ({ id }) => {
    requireProject()
    return getJobRunner().cancel(id)
  })

  /** ⛔ Paid: re-submits the run. Only ever from an explicit Retry click. */
  handle("jobs:retry", ({ id }) => {
    requireProject()
    return getJobRunner().retry(id)
  })

  /**
   * ⛔ Paid: submits a run that the restart deliberately left queued. Only ever
   * from an explicit Resume click — see `recover()` in `jobs/runner.ts`.
   */
  handle("jobs:resume", ({ id }) => {
    requireProject()
    return getJobRunner().resume(id)
  })
}
