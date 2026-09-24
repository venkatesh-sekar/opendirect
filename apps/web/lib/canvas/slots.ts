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
import {
  ROLE_LABELS,
  slotAvailability,
  slotKeySchema,
  type CanvasEdgeDto,
  type CanvasNodeDto,
  type ModelDescriptor,
  type ProviderId,
  type ReferenceSlot,
  type SlotAvailability,
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

/**
 * The slot's role in words, for a line under its label: "Character", or
 * "Reference · unverified" when the role was guessed from the field name
 * rather than set by a registry mapping (design §4, degraded mode).
 */
export function slotRoleText(
  slot: Pick<ReferenceSlot, "role" | "verified">
): string {
  const role = ROLE_LABELS[slot.role]
  return slot.verified ? role : `${role} · unverified`
}

/* -------------------------------------------------------------------------- */
/* Family nodes                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The slot keys a node has filled: the distinct, sorted `slotField`s of its
 * incoming edges, plus any filled another way (the prompt's mentions).
 *
 * A text edge carries no slot, so it adds nothing. Only well-formed slot keys
 * count: an edge still holding a provider field from a concrete model the
 * node used to run (`reference_images`) is the edge label's problem — it
 * renders unresolved — not a reason to fail the family's endpoint choice.
 * For a `provider:slug` node the list is ignored.
 */
export function filledSlotKeys(
  targetNodeId: string,
  edges: readonly CanvasEdgeDto[],
  extra: readonly string[] = []
): string[] {
  const keys = new Set<string>()
  for (const edge of edges) {
    if (edge.targetNodeId !== targetNodeId || !edge.slotField) continue
    keys.add(edge.slotField)
  }
  for (const key of extra) keys.add(key)
  return [...keys].filter((key) => slotKeySchema.safeParse(key).success).sort()
}

/**
 * What `useModel` / `modelDescriptorQuery` is given for a target node: its
 * provider override and filled slot keys. Every view of one node (the prompt
 * bar, its edge labels, a new edge's slot) asks through this, so they share
 * one query and agree on the endpoint. Only a family key reads them.
 */
export function modelOptionsForNode(
  node: Pick<CanvasNodeDto, "id" | "providerOverride">,
  edges: readonly CanvasEdgeDto[],
  extra: readonly string[] = []
): { provider: ProviderId | null; filled: string[] } {
  return {
    provider: node.providerOverride ?? null,
    filled: filledSlotKeys(node.id, edges, extra),
  }
}

/**
 * Which of a family node's slots the current wiring leaves usable, and why
 * not (design §5.3). Undefined for a concrete model: its slots are all usable.
 *
 * An empty slot is judged against everything filled — can one more go there?
 * A filled slot is judged against the *other* filled slots, so a wire the
 * endpoint cannot take (after the provider override changed, say) is the one
 * reported, rather than every filled slot reading as fine because it is
 * filled. Two slots that each fit somewhere but not together both read as
 * unavailable, each naming the other.
 */
export function familyAvailability(
  descriptor: ModelDescriptor | undefined,
  filled: readonly string[]
): Record<string, SlotAvailability> | undefined {
  const info = descriptor?.family
  if (!info) return undefined
  const base = {
    providerOrder: info.providerOrder,
    configured: info.configured,
    override: info.override,
  }
  const keys = [...new Set(filled)]
  // A filled slot no candidate endpoint has at all is reported as such, and
  // is left out when judging the rest — otherwise one impossible wire would
  // dim every other slot as "not with" it.
  const alone = slotAvailability(info.family, { ...base, filled: [] })
  const impossible = new Set(
    keys.filter((key) => alone[key]?.available === false)
  )
  const possible = keys.filter((key) => !impossible.has(key))

  const result = slotAvailability(info.family, { ...base, filled: possible })
  for (const key of keys) {
    if (!Object.hasOwn(result, key)) continue
    if (impossible.has(key)) {
      result[key] = alone[key]!
      continue
    }
    const others = possible.filter((other) => other !== key)
    result[key] = slotAvailability(info.family, { ...base, filled: others })[
      key
    ]!
  }
  return result
}

/**
 * What an edge's slot menu judges availability against: the node's filled
 * slot keys as if this wire were not placed yet, so the menu answers "where
 * may this wire go?". Its own slot is left out only when it is the only wire
 * there (`slotWires === 1`); another wire still fills it otherwise, and the
 * run's check would count it.
 */
export function menuFilled(
  filled: readonly string[],
  slotField: string | null,
  slotWires: number
): string[] {
  if (slotField === null || slotWires > 1) return [...filled]
  return filled.filter((key) => key !== slotField)
}

/**
 * The slots a new edge may land in: every slot for a concrete model, else
 * the family slots the current wiring leaves available.
 */
export function availableSlots(
  descriptor: ModelDescriptor,
  filled: readonly string[]
): readonly ReferenceSlot[] {
  const availability = familyAvailability(descriptor, filled)
  if (!availability) return descriptor.referenceSlots
  return descriptor.referenceSlots.filter(
    (slot) => availability[slot.field]?.available !== false
  )
}
