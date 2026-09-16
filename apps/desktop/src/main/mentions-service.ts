/**
 * Electron-bound wiring for `repo/mentions.ts`.
 *
 * The same split as `canvas-service.ts` / `repo/canvas.ts`: the repository is
 * pure Drizzle and testable against `:memory:`, and this is the thin sheet
 * that resolves the open project and hands its rows to the contract.
 *
 * ⛔ One read-only channel. A mention never imports, never generates and never
 * spends anything — it attaches an asset the container already holds.
 */
import type { IpcRegistrar } from "./ipc-registry"
import { getCurrentProject } from "./project-service"
import { listMentionSubjects } from "./repo/mentions"

export function registerMentionHandlers(handle: IpcRegistrar["handle"]): void {
  handle("mentions:subjects", () => {
    const current = getCurrentProject()
    // Not an error: the picker asks before a project is open, and an empty
    // list is the honest answer — there is nothing to mention yet.
    if (!current) return []
    return listMentionSubjects(current.handle.db, current.project.id)
  })
}
