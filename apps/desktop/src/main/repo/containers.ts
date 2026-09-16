/**
 * The container tree: the boards, characters, scenes and folders an asset can
 * live in.
 *
 * Electron-free like the rest of the data layer — every function takes the
 * Drizzle database handle, so the tests drive it against `:memory:` and
 * `handlers.ts` binds it to the currently open project.
 *
 * Deleting a container removes its sub-tree and its *links* to assets, never
 * the assets themselves: media outlives the folder it happened to be filed in.
 * That is enforced by the schema (`container_assets` cascades, `assets` does
 * not), not re-implemented here.
 */
import { randomUUID } from "node:crypto"

import type {
  ContainerDto,
  ContainerKind,
  ContainerNodeDto,
} from "@opendirect/contract"
import { and, asc, eq, isNull, max } from "drizzle-orm"

import type { ProjectDatabase } from "../db/client"
import { containers, type Container } from "../db/schema"

export interface CreateContainerInput {
  projectId: string
  parentId?: string | null
  kind: ContainerKind
  name: string
  id?: string
  now?: number
}

/** `kind` is a plain text column in SQLite; the contract narrows it. */
function toDto(row: Container): ContainerDto {
  return { ...row, kind: row.kind as ContainerKind }
}

export function getContainer(
  db: ProjectDatabase,
  id: string
): ContainerDto | undefined {
  const row = db.select().from(containers).where(eq(containers.id, id)).get()
  return row ? toDto(row) : undefined
}

function requireContainer(db: ProjectDatabase, id: string): ContainerDto {
  const found = getContainer(db, id)
  if (!found) throw new Error(`Container ${id} was not found`)
  return found
}

/** A parent must exist and belong to the same project as its child. */
function requireParent(
  db: ProjectDatabase,
  parentId: string,
  projectId: string
): ContainerDto {
  const parent = getContainer(db, parentId)
  if (!parent) throw new Error(`Parent container ${parentId} was not found`)
  if (parent.projectId !== projectId) {
    throw new Error("A container's parent must be in the same project")
  }
  return parent
}

function requireName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error("A container name is required")
  return trimmed
}

/** Next free slot among a parent's children — `0` when there are none yet. */
function nextPosition(
  db: ProjectDatabase,
  projectId: string,
  parentId: string | null
): number {
  const row = db
    .select({ value: max(containers.position) })
    .from(containers)
    .where(
      and(
        eq(containers.projectId, projectId),
        // `= NULL` is never true in SQL, so a root's siblings need `IS NULL`.
        parentId === null
          ? isNull(containers.parentId)
          : eq(containers.parentId, parentId)
      )
    )
    .get()
  return row?.value === null || row?.value === undefined ? 0 : row.value + 1
}

export function createContainer(
  db: ProjectDatabase,
  input: CreateContainerInput
): ContainerDto {
  const name = requireName(input.name)
  const parentId = input.parentId ?? null

  if (parentId !== null) requireParent(db, parentId, input.projectId)

  const row = {
    id: input.id ?? randomUUID(),
    projectId: input.projectId,
    parentId,
    kind: input.kind,
    name,
    position: nextPosition(db, input.projectId, parentId),
    createdAt: input.now ?? Date.now(),
  }
  db.insert(containers).values(row).run()
  return row
}

export function renameContainer(
  db: ProjectDatabase,
  id: string,
  name: string
): ContainerDto {
  requireContainer(db, id)
  const trimmed = requireName(name)
  db.update(containers)
    .set({ name: trimmed })
    .where(eq(containers.id, id))
    .run()
  return requireContainer(db, id)
}

/** True when `candidateId` is `id` itself or sits underneath it. */
function isSelfOrDescendant(
  db: ProjectDatabase,
  id: string,
  candidateId: string
): boolean {
  let cursor: string | null = candidateId
  const seen = new Set<string>()
  while (cursor) {
    if (cursor === id) return true
    // A pre-existing cycle would otherwise hang the move.
    if (seen.has(cursor)) return false
    seen.add(cursor)
    cursor = getContainer(db, cursor)?.parentId ?? null
  }
  return false
}

/**
 * Moves a container (and therefore its whole sub-tree) under a new parent, or
 * to the root when `parentId` is null. It is appended last among its new
 * siblings; explicit ordering is a Task 14 drag-and-drop concern.
 */
export function reparentContainer(
  db: ProjectDatabase,
  id: string,
  parentId: string | null
): ContainerDto {
  const container = requireContainer(db, id)

  if (parentId !== null) {
    requireParent(db, parentId, container.projectId)
    if (isSelfOrDescendant(db, id, parentId)) {
      throw new Error("A container cannot be moved inside its own descendant")
    }
  }

  db.update(containers)
    .set({
      parentId,
      position: nextPosition(db, container.projectId, parentId),
    })
    .where(eq(containers.id, id))
    .run()
  return requireContainer(db, id)
}

/**
 * Deletes a container. Children cascade; so do the `container_assets` links,
 * but the assets they pointed at stay in the project.
 */
export function deleteContainer(db: ProjectDatabase, id: string): void {
  requireContainer(db, id)
  db.delete(containers).where(eq(containers.id, id)).run()
}

export function listContainers(
  db: ProjectDatabase,
  projectId: string
): ContainerDto[] {
  return db
    .select()
    .from(containers)
    .where(eq(containers.projectId, projectId))
    .orderBy(asc(containers.position), asc(containers.createdAt))
    .all()
    .map(toDto)
}

/**
 * The whole project's containers as a tree, each level ordered by `position`.
 *
 * Built in one query and assembled in memory: a project has tens of
 * containers, not thousands, and a recursive CTE per render buys nothing.
 * A row whose parent is missing is treated as a root so a broken link can
 * never make a container invisible.
 */
export function listTree(
  db: ProjectDatabase,
  projectId: string
): ContainerNodeDto[] {
  const rows = listContainers(db, projectId)
  const nodes = new Map<string, ContainerNodeDto>(
    rows.map((row) => [row.id, { ...row, children: [] }])
  )

  const roots: ContainerNodeDto[] = []
  for (const row of rows) {
    const node = nodes.get(row.id)!
    const parent = row.parentId ? nodes.get(row.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}
