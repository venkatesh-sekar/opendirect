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

import {
  isValidHandle,
  slugifyHandle,
  uniqueHandle,
  type ContainerDto,
  type ContainerKind,
  type ContainerNodeDto,
  type ContainerSummaryDto,
  type RelatedContainersDto,
} from "@opendirect/contract"
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  max,
  ne,
} from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"

import type { ProjectDatabase } from "../db/client"
import {
  assets,
  containerAssets,
  containers,
  generationInputs,
  generations,
  type Container,
} from "../db/schema"
import { addToContainer, toAssetDto } from "./assets"

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

/**
 * The two kinds a prompt can mention. A folder is an organising device and the
 * project board is the project, so neither is a subject anyone would `@`.
 */
const MENTIONABLE_KINDS: readonly ContainerKind[] = ["character", "scene"]

export function isMentionableKind(kind: ContainerKind): boolean {
  return MENTIONABLE_KINDS.includes(kind)
}

/**
 * Every handle a project has already taken, optionally ignoring one container
 * — so a rename can re-derive without colliding with the row it is renaming.
 */
export function existingHandles(
  db: ProjectDatabase,
  projectId: string,
  exceptId?: string
): Set<string> {
  const rows = db
    .select({ handle: containers.handle })
    .from(containers)
    .where(
      and(
        eq(containers.projectId, projectId),
        isNotNull(containers.handle),
        exceptId === undefined ? undefined : ne(containers.id, exceptId)
      )
    )
    .all()
  return new Set(rows.map((row) => row.handle!).filter(Boolean))
}

/** `"  venkz  "` → `"venkz"`; blank and null alike mean "no handle". */
function normalizeHandle(handle: string | null): string | null {
  const trimmed = handle?.trim() ?? ""
  return trimmed === "" ? null : trimmed
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

/**
 * Where a kind may live. A shot is a beat of one scene, so it lives directly
 * under a scene and nowhere else; and nothing lives under a shot — its
 * versions are runs, not children.
 */
function requirePlacement(
  kind: ContainerKind,
  parent: ContainerDto | null
): void {
  if (parent?.kind === "shot")
    throw new Error("A shot cannot hold other containers")
  if (kind === "shot" && parent?.kind !== "scene")
    throw new Error("A shot must belong to a scene")
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

  const parent =
    parentId === null ? null : requireParent(db, parentId, input.projectId)
  requirePlacement(input.kind, parent)

  const row = {
    id: input.id ?? randomUUID(),
    projectId: input.projectId,
    parentId,
    kind: input.kind,
    name,
    position: nextPosition(db, input.projectId, parentId),
    // A character and a scene are `@`-able, so they get a handle derived from
    // the name they were created with. A name with no ASCII left in it yields
    // null and the container is simply not mentionable until it is renamed.
    handle: isMentionableKind(input.kind)
      ? uniqueHandle(slugifyHandle(name), existingHandles(db, input.projectId))
      : null,
    description: null,
    referenceAssetIds: null,
    pickedAssetId: null,
    createdAt: input.now ?? Date.now(),
  }
  db.insert(containers).values(row).run()
  return row
}

/**
 * The handle a rename should leave behind.
 *
 * It re-derives **only** when the stored handle is still the one the old name
 * would produce: a hand-edited `venkz` on "Venkatesh Sekar" is a decision the
 * user made and a rename must not quietly undo it. No extra column records
 * "was this edited" — the old name answers that question already.
 *
 * A new name that slugifies to nothing leaves the handle alone rather than
 * clearing it, because losing `@venkz` would silently break every prompt that
 * already says it.
 */
function handleAfterRename(
  db: ProjectDatabase,
  row: ContainerDto,
  nextName: string
): string | null {
  if (!isMentionableKind(row.kind)) return row.handle
  const derived = slugifyHandle(row.name)
  if (row.handle !== null && row.handle !== derived) return row.handle

  const next = uniqueHandle(
    slugifyHandle(nextName),
    existingHandles(db, row.projectId, row.id)
  )
  return next ?? row.handle
}

export function renameContainer(
  db: ProjectDatabase,
  id: string,
  name: string
): ContainerDto {
  const row = requireContainer(db, id)
  const trimmed = requireName(name)
  db.update(containers)
    .set({ name: trimmed, handle: handleAfterRename(db, row, trimmed) })
    .where(eq(containers.id, id))
    .run()
  return requireContainer(db, id)
}

/**
 * Sets (or clears) the handle a container answers to.
 *
 * Both failures throw a sentence the renderer shows as-is: the renderer
 * validates with the same `handle.ts` while the user types, but main is the
 * last word because only main can see the rest of the project.
 */
export function setContainerHandle(
  db: ProjectDatabase,
  id: string,
  handle: string | null
): ContainerDto {
  const row = requireContainer(db, id)
  if (!isMentionableKind(row.kind)) {
    throw new Error("Only characters and scenes can have a handle")
  }

  const next = normalizeHandle(handle)
  if (next !== null) {
    if (!isValidHandle(next)) {
      throw new Error(
        `"${next}" is not a usable handle. Use lowercase letters, digits and single hyphens, up to 32 characters.`
      )
    }
    if (existingHandles(db, row.projectId, row.id).has(next)) {
      throw new Error(`Another character or scene already answers to @${next}`)
    }
  }

  db.update(containers).set({ handle: next }).where(eq(containers.id, id)).run()
  return requireContainer(db, id)
}

/** The prose `@venkz` becomes on a model with no image input. */
export function setContainerDescription(
  db: ProjectDatabase,
  id: string,
  description: string | null
): ContainerDto {
  requireContainer(db, id)
  const trimmed = description?.trim() ?? ""
  db.update(containers)
    .set({ description: trimmed === "" ? null : trimmed })
    .where(eq(containers.id, id))
    .run()
  return requireContainer(db, id)
}

export interface CreateContainerFromAssetInput {
  projectId: string
  assetId: string
  kind: "character" | "scene"
  name: string
  id?: string
  now?: number
}

/**
 * "Save as character": one asset becomes a new character or scene.
 *
 * Three steps in one transaction — create the container, link the asset, mark
 * the asset as the reference image — because a failed link would otherwise
 * leave an empty character behind for the user to find and delete.
 *
 * ⛔ It copies nothing and moves nothing: `container_assets` is many-to-many,
 * so the asset stays on every board it is already on. Pinning is how
 * `rankReferenceImages` learns which image `@venkz` should send, and it is the
 * only thing here that touches the asset row.
 */
export function createContainerFromAsset(
  db: ProjectDatabase,
  input: CreateContainerFromAssetInput
): ContainerDto {
  if (!isMentionableKind(input.kind)) {
    throw new Error("Only characters and scenes can be made from an asset")
  }

  return db.transaction((tx) => {
    const container = createContainer(tx, {
      projectId: input.projectId,
      parentId: null,
      kind: input.kind,
      name: input.name,
      id: input.id,
      now: input.now,
    })
    addToContainer(tx, { containerId: container.id, assetId: input.assetId })
    tx.update(assets)
      .set({ pinned: true })
      .where(eq(assets.id, input.assetId))
      .run()
    return container
  })
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

  const parent =
    parentId === null ? null : requireParent(db, parentId, container.projectId)
  requirePlacement(container.kind, parent)
  if (parentId !== null && isSelfOrDescendant(db, id, parentId)) {
    throw new Error("A container cannot be moved inside its own descendant")
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
 * Puts a container at `index` among its siblings — past the end is the end —
 * and renumbers them all from 0, so positions stay a dense order however
 * they started.
 */
export function moveContainer(
  db: ProjectDatabase,
  id: string,
  index: number
): void {
  if (!Number.isInteger(index) || index < 0)
    throw new Error("A position is a whole number from 0")
  const container = requireContainer(db, id)
  db.transaction((tx) => {
    const siblings = tx
      .select({ id: containers.id })
      .from(containers)
      .where(
        and(
          eq(containers.projectId, container.projectId),
          container.parentId === null
            ? isNull(containers.parentId)
            : eq(containers.parentId, container.parentId)
        )
      )
      .orderBy(asc(containers.position), asc(containers.createdAt))
      .all()
      .map((row) => row.id)
      .filter((sibling) => sibling !== id)
    siblings.splice(Math.min(index, siblings.length), 0, id)
    siblings.forEach((sibling, position) =>
      tx
        .update(containers)
        .set({ position })
        .where(eq(containers.id, sibling))
        .run()
    )
  })
}

/**
 * Picks a shot's version, or clears the pick. The asset must be linked to the
 * shot — which is where a run filed under it puts what it made — so a shot can
 * only ever wear one of its own versions.
 */
export function setContainerPick(
  db: ProjectDatabase,
  id: string,
  assetId: string | null
): ContainerDto {
  const container = requireContainer(db, id)
  if (container.kind !== "shot")
    throw new Error("Only a shot has a picked version")
  if (assetId !== null) {
    const linked = db
      .select({ assetId: containerAssets.assetId })
      .from(containerAssets)
      .where(
        and(
          eq(containerAssets.containerId, id),
          eq(containerAssets.assetId, assetId)
        )
      )
      .get()
    if (!linked) throw new Error("Pick one of this shot's own versions")
  }
  db.update(containers)
    .set({ pickedAssetId: assetId })
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

/**
 * Every scene's cast, as character ids in `rows` order (tree order).
 *
 * A character is in a scene when a run filed under the scene — or under one
 * of its shots, whose versions are that scene's runs too — mentioned it. The
 * stored prompt cannot say so — its `@mira` is already prose — which is why
 * submission records `mentionedContainerIds`. A run from before that column
 * (null) falls back to its inputs: a character is in the scene when one of
 * the character's assets was sent to the model. A recorded list, even an
 * empty one, is trusted over the inputs.
 *
 * Two queries for the whole project, for the same reason as `listTree`. The
 * kinds are filtered in SQL: runs are joined to the scene or shot they were
 * filed under, and legacy inputs to the character that holds the asset, so an
 * input also filed under a scene or a folder never reaches the cast.
 * Scenes with nobody in them are absent from the map.
 */
function castByScene(
  db: ProjectDatabase,
  projectId: string,
  rows: readonly ContainerDto[]
): Map<string, string[]> {
  const kindOf = new Map(rows.map((row) => [row.id, row.kind]))
  const found = new Map<string, Set<string>>()
  const sceneOf = (filed: {
    id: string
    kind: string
    parentId: string | null
  }) => (filed.kind === "scene" ? filed.id : filed.parentId)
  const add = (sceneId: string | null, characterId: string) => {
    if (sceneId === null || kindOf.get(sceneId) !== "scene") return
    const cast = found.get(sceneId) ?? new Set<string>()
    cast.add(characterId)
    found.set(sceneId, cast)
  }
  const filedInScene = and(
    eq(generations.projectId, projectId),
    inArray(containers.kind, ["scene", "shot"])
  )

  for (const run of db
    .select({
      id: containers.id,
      kind: containers.kind,
      parentId: containers.parentId,
      mentioned: generations.mentionedContainerIds,
    })
    .from(generations)
    .innerJoin(containers, eq(containers.id, generations.containerId))
    .where(and(filedInScene, isNotNull(generations.mentionedContainerIds)))
    .all()) {
    for (const id of run.mentioned ?? []) {
      // A deleted container, a scene or a folder is nobody's cast.
      if (kindOf.get(id) === "character") add(sceneOf(run), id)
    }
  }

  const character = alias(containers, "character")
  for (const input of db
    .selectDistinct({
      id: containers.id,
      kind: containers.kind,
      parentId: containers.parentId,
      characterId: character.id,
    })
    .from(generationInputs)
    .innerJoin(generations, eq(generations.id, generationInputs.generationId))
    .innerJoin(containers, eq(containers.id, generations.containerId))
    .innerJoin(
      containerAssets,
      eq(containerAssets.assetId, generationInputs.assetId)
    )
    .innerJoin(
      character,
      and(
        eq(character.id, containerAssets.containerId),
        eq(character.kind, "character")
      )
    )
    .where(and(filedInScene, isNull(generations.mentionedContainerIds)))
    .all()) {
    add(sceneOf(input), input.characterId)
  }

  const ordered = new Map<string, string[]>()
  for (const [sceneId, cast] of found) {
    ordered.set(
      sceneId,
      rows.filter((row) => cast.has(row.id)).map((row) => row.id)
    )
  }
  return ordered
}

/**
 * A scene's cast, or the scenes a character appears in (`castByScene`), as
 * containers in tree order.
 */
export function listRelated(
  db: ProjectDatabase,
  id: string
): RelatedContainersDto {
  const container = requireContainer(db, id)
  if (!isMentionableKind(container.kind))
    throw new Error("Only characters and scenes have a cast or scenes")
  const rows = listContainers(db, container.projectId)
  const casts = castByScene(db, container.projectId, rows)

  if (container.kind === "scene") {
    const cast = new Set(casts.get(id) ?? [])
    return {
      kind: "scene",
      characters: rows.filter((row) => cast.has(row.id)),
    }
  }
  return {
    kind: "character",
    scenes: rows.filter((row) => casts.get(row.id)?.includes(id)),
  }
}

/**
 * Counts, cover and last activity for every container in the project, in
 * `listContainers` order. A scene's runs, activity and (failing its own)
 * cover include its shots'.
 *
 * A handful of grouped queries assembled in memory, for the same reason as
 * `listTree`: a project has tens of containers, and a card grid wants them
 * all at once rather than one round trip per card.
 */
export function listContainerSummaries(
  db: ProjectDatabase,
  projectId: string
): ContainerSummaryDto[] {
  const rows = listContainers(db, projectId)
  const inProject = eq(containers.projectId, projectId)

  const assetStats = new Map(
    db
      .select({
        containerId: containerAssets.containerId,
        total: count(),
        latest: max(assets.createdAt),
      })
      .from(containerAssets)
      .innerJoin(containers, eq(containers.id, containerAssets.containerId))
      .innerJoin(assets, eq(assets.id, containerAssets.assetId))
      .where(inProject)
      .groupBy(containerAssets.containerId)
      .all()
      .map((row) => [row.containerId, row])
  )

  const runStats = new Map(
    db
      .select({
        containerId: generations.containerId,
        total: count(),
        latestCreated: max(generations.createdAt),
        latestCompleted: max(generations.completedAt),
      })
      .from(generations)
      .where(
        and(
          eq(generations.projectId, projectId),
          isNotNull(generations.containerId)
        )
      )
      .groupBy(generations.containerId)
      .all()
      .map((row) => [row.containerId!, row])
  )

  // Every linked image per container, newest first. Only ids here — the full
  // rows are fetched once, below, for the one per card that becomes its cover.
  const linkedImages = new Map<string, string[]>()
  const imageCreatedAt = new Map<string, number>()
  for (const row of db
    .select({
      containerId: containerAssets.containerId,
      assetId: assets.id,
      createdAt: assets.createdAt,
    })
    .from(containerAssets)
    .innerJoin(containers, eq(containers.id, containerAssets.containerId))
    .innerJoin(assets, eq(assets.id, containerAssets.assetId))
    .where(and(inProject, eq(assets.kind, "image")))
    .orderBy(desc(assets.createdAt), desc(assets.id))
    .all()) {
    const list = linkedImages.get(row.containerId) ?? []
    list.push(row.assetId)
    linkedImages.set(row.containerId, list)
    imageCreatedAt.set(row.assetId, row.createdAt)
  }

  // A scene's shots, in order. Their runs are the scene's work too, so the
  // scene's card counts them and dates itself by them, and wears one of their
  // pictures when it has none of its own. Assets are not rolled up: a
  // scene's asset count is its own library, the one its Assets tab lists.
  const kindOf = new Map(rows.map((row) => [row.id, row.kind]))
  const shotsOf = new Map<string, ContainerDto[]>()
  for (const row of rows) {
    if (row.kind !== "shot" || row.parentId === null) continue
    if (kindOf.get(row.parentId) !== "scene") continue
    const list = shotsOf.get(row.parentId) ?? []
    list.push(row)
    shotsOf.set(row.parentId, list)
  }

  // The first reference still linked here, else the newest image. Unlinking an
  // asset leaves `referenceAssetIds` alone, so a stale or deleted reference is
  // skipped the same way `listMentionSubjects` skips it.
  const coverIds = new Map<string, string>()
  for (const row of rows) {
    const linked = linkedImages.get(row.id) ?? []
    // A shot wears its pick. The link is checked like a reference's, though
    // unlinking already clears the pick.
    const picked =
      row.pickedAssetId && linked.includes(row.pickedAssetId)
        ? row.pickedAssetId
        : undefined
    const id =
      picked ??
      row.referenceAssetIds?.find((ref) => linked.includes(ref)) ??
      linked[0]
    if (id !== undefined) coverIds.set(row.id, id)
  }
  // A scene with no picture of its own: its first picked shot image, else
  // the newest image any of its shots has.
  for (const [sceneId, shots] of shotsOf) {
    if (coverIds.has(sceneId)) continue
    const picked = shots.find(
      (shot) =>
        shot.pickedAssetId &&
        linkedImages.get(shot.id)?.includes(shot.pickedAssetId)
    )?.pickedAssetId
    const newest = shots
      .map((shot) => linkedImages.get(shot.id)?.[0])
      .filter((id): id is string => id !== undefined)
      .sort(
        (a, b) => (imageCreatedAt.get(b) ?? 0) - (imageCreatedAt.get(a) ?? 0)
      )[0]
    const id = picked ?? newest
    if (id) coverIds.set(sceneId, id)
  }
  const casts = castByScene(db, projectId, rows)
  const candidates = [...new Set(coverIds.values())]
  const coverRows = new Map(
    (candidates.length === 0
      ? []
      : db.select().from(assets).where(inArray(assets.id, candidates)).all()
    ).map((asset) => [asset.id, asset])
  )

  return rows.map((row) => {
    const own = assetStats.get(row.id)
    const cover = coverRows.get(coverIds.get(row.id) ?? "")
    const work = [row, ...(shotsOf.get(row.id) ?? [])]
    const runs = work.map((one) => runStats.get(one.id))
    return {
      id: row.id,
      assetCount: own?.total ?? 0,
      generationCount: runs.reduce((sum, one) => sum + (one?.total ?? 0), 0),
      coverAsset: cover ? toAssetDto(cover) : null,
      lastActivityAt: Math.max(
        row.createdAt,
        ...work.map((one) => assetStats.get(one.id)?.latest ?? 0),
        ...runs.map((one) => one?.latestCreated ?? 0),
        ...runs.map((one) => one?.latestCompleted ?? 0)
      ),
      castIds: casts.get(row.id) ?? [],
    }
  })
}

/** An explicit selection is scoped to this subject, never a global asset pin. */
export function setContainerReferences(
  db: ProjectDatabase,
  id: string,
  assetIds: string[] | null
): ContainerDto {
  return db.transaction(() => {
    const container = requireContainer(db, id)
    if (!isMentionableKind(container.kind))
      throw new Error("Only characters and scenes have references")
    const ids = assetIds === null ? null : [...new Set(assetIds)]
    for (const assetId of ids ?? []) {
      const linked = db
        .select()
        .from(containerAssets)
        .innerJoin(assets, eq(assets.id, containerAssets.assetId))
        .where(
          and(
            eq(containerAssets.containerId, id),
            eq(containerAssets.assetId, assetId)
          )
        )
        .get()
      if (!linked || linked.assets.kind !== "image")
        throw new Error("Select images from this character or scene's library")
    }
    db.update(containers)
      .set({ referenceAssetIds: ids })
      .where(eq(containers.id, id))
      .run()
    return requireContainer(db, id)
  })
}
