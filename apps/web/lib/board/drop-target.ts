/**
 * Resolving a `@dnd-kit` drag into an asset mutation.
 *
 * dnd-kit hands the drop handler two opaque `data.current` blobs. Narrowing
 * them, and deciding whether the drop is meaningful at all, is pure logic —
 * so it lives here and the `DndContext` handler stays three lines long.
 *
 * Dropping an asset on a container **adds** it: an asset legitimately lives in
 * many containers, and a copy is the non-destructive default. Starting the drag
 * with Shift held **moves** it instead, which is the same add plus an unlink
 * from the board the drag started on.
 */
export interface AssetDragData {
  type: "asset"
  assetId: string
  /** The board the drag started on; null when it was not a container board. */
  containerId: string | null
}

export interface ContainerDropData {
  type: "container"
  containerId: string
}

/**
 * A container being *dragged* — onto the creation bar's reference tray, which
 * is the one place a whole container means something. It carries the name so
 * the reference dialog can say which container the assets came from without a
 * second lookup.
 */
export interface ContainerDragData {
  type: "container"
  containerId: string
  name: string
}

export function isContainerDragData(
  value: unknown
): value is ContainerDragData {
  if (!isContainerDropData(value)) return false
  return typeof (value as Partial<ContainerDragData>).name === "string"
}

export interface AssetDrop {
  action: "add" | "move"
  assetId: string
  /** Only set for a move — the link to remove once the add succeeds. */
  fromContainerId: string | null
  toContainerId: string
}

export function isAssetDragData(value: unknown): value is AssetDragData {
  if (typeof value !== "object" || value === null) return false
  const data = value as Partial<AssetDragData>
  return (
    data.type === "asset" &&
    typeof data.assetId === "string" &&
    data.assetId.length > 0 &&
    (data.containerId === null || typeof data.containerId === "string")
  )
}

export function isContainerDropData(
  value: unknown
): value is ContainerDropData {
  if (typeof value !== "object" || value === null) return false
  const data = value as Partial<ContainerDropData>
  return (
    data.type === "container" &&
    typeof data.containerId === "string" &&
    data.containerId.length > 0
  )
}

export interface ResolveDropOptions {
  /** Shift was held when the drag began. */
  move?: boolean
}

/**
 * Null means "do nothing": the drop missed, landed on something that is not a
 * container, or landed back on the board the asset already belongs to.
 */
export function resolveAssetDrop(
  active: unknown,
  over: unknown,
  options: ResolveDropOptions = {}
): AssetDrop | null {
  if (!isAssetDragData(active)) return null
  if (!isContainerDropData(over)) return null
  if (active.containerId === over.containerId) return null

  const canMove = options.move === true && active.containerId !== null
  return {
    action: canMove ? "move" : "add",
    assetId: active.assetId,
    fromContainerId: canMove ? active.containerId : null,
    toContainerId: over.containerId,
  }
}

/** Reads the modifier off whatever event dnd-kit says started the drag. */
export function dragStartedWithShift(activatorEvent: unknown): boolean {
  if (typeof activatorEvent !== "object" || activatorEvent === null)
    return false
  return (activatorEvent as { shiftKey?: unknown }).shiftKey === true
}
