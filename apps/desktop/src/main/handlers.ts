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
import { dialog } from "electron"

import type { ModelCatalog } from "./catalog"
import { submitGeneration } from "./generations-submit"
import type { IpcRegistrar } from "./ipc-registry"
import type { ProjectDatabase } from "./db/client"
import type { ProjectRef } from "./project"
import {
  createProjectInRoot,
  getCurrentProject,
  getRecentProjects,
  closeCurrentProject,
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
  deleteContainer,
  listTree,
  renameContainer,
  reparentContainer,
} from "./repo/containers"
import { estimateCost } from "./providers/cost"
import {
  getGeneration,
  lineage,
  listByContainer as listGenerations,
  listInputs,
  toGenerationDto,
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

export function registerProjectHandlers(
  handle: IpcRegistrar["handle"],
  catalog: () => ModelCatalog
): void {
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

  handle("project:close", () => {
    closeCurrentProject()
    return { ok: true as const }
  })

  handle("containers:tree", () => {
    const { db, project } = requireProject()
    return listTree(db, project.id)
  })

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
   * The creation bar's live price. Always answers — a model with no published
   * rate comes back as `confidence: "unknown"`, which the badge renders as
   * "Cost unknown" rather than as a number nobody can stand behind.
   */
  handle("cost:estimate", async ({ key, params }) => {
    const descriptor = await catalog().getModel(key)
    return estimateCost({
      provider: descriptor.provider,
      kind: descriptor.kind,
      slug: descriptor.slug,
      pricingSkus: descriptor.pricing.skus,
      params,
      inputSchema: descriptor.inputSchema,
    })
  })

  /**
   * ⛔ Queues a run; does not start one. `generations-submit.ts` writes a
   * `queued` row and stops there — Task 16 adds the runner that calls a
   * provider.
   */
  handle("generations:submit", (request) => {
    const { db, project } = requireProject()
    return submitGeneration(
      { db, project },
      { getModel: (key) => catalog().getModel(key) },
      request
    )
  })
}
