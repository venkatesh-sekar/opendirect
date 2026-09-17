/**
 * Electron-bound wiring for `repo/canvas.ts`.
 *
 * The same split as `handlers.ts` / `repo/*`: the repository is pure Drizzle
 * and testable against `:memory:`, and this is the sheet that resolves the open
 * project and hands its rows to the contract. Everything worth testing is one
 * file down.
 *
 * ⛔ Not one channel here can start a paid generation. A node is a placement
 * and an edge is a reference; the only thing that spends money is still
 * `generations:submit`, and only from a click on Generate.
 */
import { importWorkflow } from "./repo/workflows"
import type { CanvasDto } from "@opendirect/contract"

import type { ProjectDatabase } from "./db/client"
import type { IpcRegistrar } from "./ipc-registry"
import type { ProjectRef } from "./project"
import { getCurrentProject } from "./project-service"
import {
  createEdge,
  createNode,
  deleteEdges,
  deleteNodes,
  getCanvas,
  moveNodes,
  pickNode,
  updateEdge,
  updateNode,
} from "./repo/canvas"

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

/**
 * Lays an existing project's lineage out as a canvas.
 *
 * `canvas-migrate.ts` is the real implementation and installs itself through
 * `setCanvasMigrator` from `index.ts`, which is the only place that knows
 * about both. That keeps this file free of elkjs and keeps the migrator free
 * of Electron, so it can be driven against `:memory:`.
 *
 * The fallback below stays as the default because it is the honest answer for
 * a process that never wired one up (a test, a hot reload): it hands back the
 * canvas as it is and writes nothing. A migration that has not happened can
 * still happen later — the same rule the design gives a *failed* migration,
 * "a partially written layout would be worse than none".
 */
export type CanvasMigrator = (
  ctx: OpenContext
) => CanvasDto | Promise<CanvasDto>

const identityMigrator: CanvasMigrator = ({ db, project }) =>
  getCanvas(db, project.id)

let migrator: CanvasMigrator = identityMigrator

/** Installs the real migrator. Returns the previous one, for tests. */
export function setCanvasMigrator(next: CanvasMigrator): CanvasMigrator {
  const previous = migrator
  migrator = next
  return previous
}

/** Test/hot-reload seam: back to the no-op migrator. */
export function resetCanvasMigrator(): void {
  migrator = identityMigrator
}

export function registerCanvasHandlers(handle: IpcRegistrar["handle"]): void {
  /**
   * Reads the canvas. It never migrates.
   *
   * Deriving a layout is a write, and a read must not rewrite the project the
   * user just opened — so an old project comes back here with an empty canvas
   * and stays that way until someone asks. `canvas:migrate` is that asking.
   */
  handle("canvas:importWorkflow", (workflow) => {
    const { db, project } = requireProject()
    return importWorkflow(db, project.id, workflow)
  })

  handle("canvas:get", () => {
    const { db, project } = requireProject()
    return getCanvas(db, project.id)
  })

  handle("canvas:node:create", (input) => {
    const { db, project } = requireProject()
    return createNode(db, { ...input, projectId: project.id })
  })

  handle("canvas:node:update", ({ id, patch }) =>
    updateNode(requireProject().db, id, patch)
  )

  /** One debounced write per drag gesture, however many nodes it moved. */
  handle("canvas:node:move", ({ moves }) => {
    moveNodes(requireProject().db, moves)
    return { ok: true as const }
  })

  /**
   * ⛔ Removes the nodes and their edges — never the assets or the
   * generations behind them. Those stay in their sidebar container.
   */
  handle("canvas:node:delete", ({ ids }) => {
    deleteNodes(requireProject().db, ids)
    return { ok: true as const }
  })

  /** Changes which tile downstream edges use. Re-runs nothing. */
  handle("canvas:node:pick", ({ id, assetId }) =>
    pickNode(requireProject().db, id, assetId)
  )

  handle("canvas:edge:create", (input) => {
    const { db, project } = requireProject()
    return createEdge(db, { ...input, projectId: project.id })
  })

  handle("canvas:edge:update", ({ id, slotField }) =>
    updateEdge(requireProject().db, id, slotField)
  )

  handle("canvas:edge:delete", ({ ids }) => {
    deleteEdges(requireProject().db, ids)
    return { ok: true as const }
  })

  /**
   * Explicitly lays an old project's lineage out as a canvas, once.
   *
   * The renderer calls this exactly once per project: when `canvas:get` comes
   * back empty *and* the project has generations, it offers "Lay out my
   * existing work" and this is what that button invokes. A project that
   * already has canvas rows is handed straight back, so a double click, a
   * remount or a second window cannot duplicate a board.
   *
   * A failure throws, with the layout's own reason, and nothing has been
   * written — so the offer is still there and retrying is safe.
   */
  handle("canvas:migrate", () => migrator(requireProject()))
}
