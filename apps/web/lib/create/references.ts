/**
 * Filling reference slots, and the rule that guards them.
 *
 * **A limit is a question, never an auto-pick.** Dropping a 100-asset
 * container on a slot that takes 12 does not silently take the first twelve:
 * `planReferenceDrop` answers `"choose"`, and the creation bar opens the
 * picker so the user says which twelve. Nothing in this module ever selects an
 * asset on the user's behalf — the one exception is replacing the single value
 * of a single-asset slot, which is what dropping onto an occupied slot
 * unambiguously means.
 *
 * Pure logic, so the dialog above it stays a rendering concern.
 */
import type { AssetKind, ReferenceSlot } from "@opendirect/contract"

export interface IncomingReference {
  assetId: string
  kind: AssetKind
}

/** The plan a drop resolves to. */
export type ReferenceDropPlan =
  /** It fits: this is the slot's new contents, in order. */
  | { outcome: "accept"; slotField: string; assetIds: string[] }
  /** Over the limit: ask, with everything in play offered for selection. */
  | {
      outcome: "choose"
      slotField: string
      capacity: number
      /** Everything the user may pick from — what is held plus what arrived. */
      candidateIds: string[]
      /**
       * What the user had already chosen for this slot, carried into the
       * dialog. Never anything that arrived in the drop — those start
       * unselected, because only the user may pick them.
       */
      preselectedIds: string[]
      /** The container the assets came from, for the dialog's first line. */
      sourceLabel: string | null
    }
  /** No slot on this model takes these assets. */
  | { outcome: "unsupported" }

export interface PlanReferenceDropInput {
  slots: readonly ReferenceSlot[]
  /** Current selection, keyed by slot field. */
  current: Readonly<Record<string, string[]>>
  incoming: readonly IncomingReference[]
  /** Forces a slot, e.g. when the user dropped onto one chip group. */
  slotField?: string
  sourceLabel?: string | null
}

/**
 * How many assets a slot holds. A single-value slot holds one regardless of
 * what `max` says; `null` means the model published no bound, which is a
 * statement rather than a silence and is honoured as "no limit".
 */
export function slotCapacity(slot: ReferenceSlot): number | null {
  if (!slot.multiple) return 1
  return slot.max
}

export function remainingCapacity(
  slot: ReferenceSlot,
  selected: readonly string[]
): number | null {
  const capacity = slotCapacity(slot)
  if (capacity === null) return null
  return Math.max(0, capacity - selected.length)
}

/** Media a reference slot can hold at all. Text is never a media reference. */
export function acceptsKind(slot: ReferenceSlot, kind: AssetKind): boolean {
  if (kind === "text" || kind === "prompt") return false
  return slot.kind === "any" || slot.kind === kind
}

/** The slots that accept *every* incoming asset, in the model's own order. */
export function candidateSlots(
  slots: readonly ReferenceSlot[],
  incoming: readonly IncomingReference[]
): ReferenceSlot[] {
  if (incoming.length === 0) return []
  return slots.filter((slot) =>
    incoming.every((asset) => acceptsKind(slot, asset.kind))
  )
}

/**
 * Prefers a slot that names the media exactly (`reference_videos` for a video)
 * over a catch-all, so a video dropped on a model with both lands where the
 * model expects it.
 */
function chooseSlot(
  slots: readonly ReferenceSlot[],
  incoming: readonly IncomingReference[]
): ReferenceSlot | null {
  const candidates = candidateSlots(slots, incoming)
  if (candidates.length === 0) return null
  return candidates.find((slot) => slot.kind !== "any") ?? candidates[0]!
}

export function planReferenceDrop(
  input: PlanReferenceDropInput
): ReferenceDropPlan {
  if (input.incoming.length === 0) return { outcome: "unsupported" }

  const slot = input.slotField
    ? input.slots.find((candidate) => candidate.field === input.slotField)
    : chooseSlot(input.slots, input.incoming)
  if (!slot) return { outcome: "unsupported" }
  if (!input.incoming.every((asset) => acceptsKind(slot, asset.kind))) {
    return { outcome: "unsupported" }
  }

  const held = input.current[slot.field] ?? []
  const arriving = input.incoming
    .map((asset) => asset.assetId)
    .filter((id, index, list) => list.indexOf(id) === index)
  const fresh = arriving.filter((id) => !held.includes(id))

  // Nothing new arrived, so the slot keeps exactly what it had.
  if (fresh.length === 0) {
    return { outcome: "accept", slotField: slot.field, assetIds: held }
  }

  const capacity = slotCapacity(slot)
  if (capacity === null) {
    return {
      outcome: "accept",
      slotField: slot.field,
      assetIds: [...held, ...fresh],
    }
  }

  // A single-asset slot with a single asset dropped on it: the drop *is* the
  // instruction, so it replaces rather than asking about a one-item list.
  if (capacity === 1 && fresh.length === 1) {
    return { outcome: "accept", slotField: slot.field, assetIds: [fresh[0]!] }
  }

  if (held.length + fresh.length <= capacity) {
    return {
      outcome: "accept",
      slotField: slot.field,
      assetIds: [...held, ...fresh],
    }
  }

  return {
    outcome: "choose",
    slotField: slot.field,
    capacity,
    candidateIds: [...held, ...fresh],
    // Only what the user had already chosen survives into the dialog. The
    // assets that just arrived start unselected: picking for the user is the
    // mistake this whole module exists to prevent.
    preselectedIds: capacity === 1 ? [] : held.slice(0, capacity),
    sourceLabel: input.sourceLabel ?? null,
  }
}

/** The dialog's first line: what was dropped, and what the model can take. */
export function referenceLimitMessage(input: {
  sourceLabel: string | null
  total: number
  capacity: number
}): string {
  const noun = input.capacity === 1 ? "reference" : "references"
  const limit = `This model supports ${input.capacity} ${noun}.`
  const dropped = `${input.total} asset${input.total === 1 ? "" : "s"}.`
  return input.sourceLabel
    ? `${input.sourceLabel} — ${dropped} ${limit}`
    : `${dropped} ${limit}`
}
