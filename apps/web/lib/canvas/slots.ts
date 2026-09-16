/**
 * Which input slot a freshly drawn edge lands in.
 *
 * Drawing an edge is one gesture with no room for a dialog, so the canvas has
 * to answer "which of this model's inputs did you mean?" by itself. The rule
 * is the narrowest one that is still useful: **the first slot the model
 * declares that can take this kind of media and is not already full.** The
 * user re-labels it from the edge if the guess was wrong.
 *
 * ⛔ Nothing is invented. The slots come from `descriptor.referenceSlots`,
 * which `deriveReferenceSlots` read out of the model's own schema; a model
 * that declares no slot gets `null` and the edge is drawn unresolved rather
 * than pointed at a field that does not exist. `edges-to-inputs.ts` then
 * blocks the run until the user chooses one, in front of the same guard
 * `submitGeneration` already enforces.
 */
import type {
  CanvasEdgeDto,
  CanvasNodeDto,
  ReferenceSlot,
} from "@opendirect/contract"

/** How many references one slot accepts. `null` means the model stated none. */
export function slotCapacity(slot: ReferenceSlot): number {
  if (!slot.multiple) return 1
  return slot.max ?? Number.POSITIVE_INFINITY
}

/**
 * The kind of media a node contributes.
 *
 * The resolved asset is the honest answer where there is one — a media node's
 * file, or a generate node's pick. Before a generate node has produced
 * anything there is no asset to ask, and its own type is the only thing known
 * about what it will make.
 */
export function contributedKind(node: CanvasNodeDto): "image" | "video" | null {
  const kind = node.asset?.kind
  if (kind === "image" || kind === "video") return kind
  if (node.type === "video_gen") return "video"
  if (node.type === "image_gen") return "image"
  return null
}

function accepts(slot: ReferenceSlot, kind: "image" | "video" | null): boolean {
  if (slot.kind === "any") return true
  // An unknown contribution is not a reason to refuse: the node may not have
  // run yet, and a slot it turns out not to fit is still re-labellable.
  if (kind === null) return slot.kind === "image" || slot.kind === "video"
  return slot.kind === kind
}

export interface FirstFreeSlotInput {
  slots: readonly ReferenceSlot[]
  /** Every edge on the canvas; the ones into `targetNodeId` are counted. */
  edges: readonly CanvasEdgeDto[]
  targetNodeId: string
  /** What the new edge would feed in, for the kind check. */
  kind?: "image" | "video" | null
}

/**
 * The slot a new edge into `targetNodeId` should carry, or null when the model
 * declares none that fits and is free.
 */
export function firstFreeSlot(input: FirstFreeSlotInput): string | null {
  const used = new Map<string, number>()
  for (const edge of input.edges) {
    if (edge.targetNodeId !== input.targetNodeId) continue
    if (!edge.slotField) continue
    used.set(edge.slotField, (used.get(edge.slotField) ?? 0) + 1)
  }

  for (const slot of input.slots) {
    if (!accepts(slot, input.kind ?? null)) continue
    if ((used.get(slot.field) ?? 0) >= slotCapacity(slot)) continue
    return slot.field
  }
  return null
}

/**
 * A slot the model no longer declares. The edge keeps the field it was drawn
 * with — throwing it away would lose the user's choice on a model they may
 * switch back to — and renders as unresolved until they pick a real one.
 */
export function isUnresolvedSlot(
  slotField: string | null,
  slots: readonly ReferenceSlot[]
): boolean {
  if (slotField === null) return false
  return !slots.some((slot) => slot.field === slotField)
}

/** The label the model gave a field, falling back to the field name itself. */
export function slotLabel(
  slotField: string,
  slots: readonly ReferenceSlot[]
): string {
  return slots.find((slot) => slot.field === slotField)?.label ?? slotField
}
