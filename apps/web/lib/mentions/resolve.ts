/**
 * Intelligent substitution: what `@venkz` becomes for *this* model.
 *
 * The same mention is an attached reference image on a model that declares an
 * image input and a sentence of prose on one that does not — and because this
 * is the computation the reference tray shows, the user sees which one it will
 * be before they press Run.
 *
 * "Intelligent" means **schema-aware**, not model-assisted. This is a pure
 * function of its arguments: no IPC, no fetch, no `Date`, no randomness, no
 * LLM. ⛔ It cannot submit anything and cannot spend anything; it produces the
 * ordinary prompt and the ordinary references an ordinary `GenerationRequest`
 * carries, and main's own guards in `generations-submit.ts` are still the last
 * word on both.
 */
import type {
  GenerationReference,
  MentionSubjectDto,
  ReferenceSlot,
} from "@opendirect/contract"

import { slotCapacity } from "../canvas/slots"
import { findMentions } from "./parse"

/** One `@`-able thing, flattened for both the picker and the resolver. */
export type MentionSubject = MentionSubjectDto

export interface ResolveMentionsInput {
  /** The raw prompt, `@venkz` and all. */
  prompt: string
  subjects: readonly MentionSubject[]
  /** The chosen model's own slots — `descriptor.referenceSlots`. */
  slots: readonly ReferenceSlot[]
  /** Slots already filled by canvas edges, keyed by field. */
  occupied: Readonly<Record<string, number>>
  /** Images one mention may attach. Default 1. */
  perSubject?: number
}

export type MentionOutcome =
  | {
      kind: "image"
      handle: string
      containerId: string
      slotField: string
      assetIds: string[]
      /**
       * A preview per attached asset, in `assetIds` order, so the tray can
       * show the picture the run will send rather than only the handle. Null
       * where the asset has no preview.
       */
      thumbnailUrls: (string | null)[]
      /** What replaced `@venkz` in the prompt. */
      substitution: string
    }
  | {
      kind: "text"
      handle: string
      containerId: string
      reason: "no-image-slot" | "slots-full" | "no-images"
      substitution: string
    }
  /** A handle no container claims. Left in the prompt verbatim. */
  | { kind: "unresolved"; handle: string }

export interface ResolvedMentions {
  /** The prompt as submitted. Resolved mentions are gone from it. */
  prompt: string
  /** References to merge with the edge-derived ones. */
  references: GenerationReference[]
  /** One entry per distinct handle, in order of first appearance. */
  outcomes: MentionOutcome[]
}

/**
 * Slots a mention will never take.
 *
 * ⛔ A frame or a motion reference carries timing semantics the user wires
 * deliberately — quietly making a character sheet the first frame of a video
 * would be a paid surprise. A mask, a pose/depth map or a soundtrack is just
 * as deliberate. A mention downgrades to prose instead.
 */
const RESERVED_ROLES = new Set<ReferenceSlot["role"]>([
  "source",
  "mask",
  "first_frame",
  "last_frame",
  "structure",
  "motion",
  "soundtrack",
])

/** Slots whose contents the provider receives as images, mention or not. */
function isImageSlot(slot: ReferenceSlot): boolean {
  return slot.kind === "image" || slot.kind === "any"
}

function isMentionable(slot: ReferenceSlot): boolean {
  return isImageSlot(slot) && !RESERVED_ROLES.has(slot.role)
}

/**
 * A mapped `reference` first, then a guessed one, then whatever else takes an
 * image.
 */
function rolePreference(slot: ReferenceSlot): number {
  if (slot.role !== "reference") return 2
  return slot.verified ? 0 : 1
}

/** `[2]` → `"2"`, `[1, 2]` → `"1 and 2"`, `[1, 2, 3]` → `"1, 2 and 3"`. */
function joinNumbers(numbers: readonly number[]): string {
  if (numbers.length <= 1) return String(numbers[0] ?? 1)
  return `${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1)}`
}

/**
 * How the substitution names the picture, so the model can tie the word to it.
 *
 * A request carrying exactly one image drops the number — "the reference
 * image" is less to misread than "reference image 1" when there is only one.
 */
function imagePhrase(numbers: readonly number[], totalImages: number): string {
  if (totalImages === 1) return "the reference image"
  const plural = numbers.length > 1 ? "reference images" : "reference image"
  return `${plural} ${joinNumbers(numbers)}`
}

/**
 * The containers a resolved prompt was about, once each, in order of first
 * mention — whether the mention became a picture or prose. A handle nobody
 * claims names no one.
 *
 * Submitted with the run because the prompt that is stored is the resolved
 * one: once `@mira` is "Mira (the person in reference image 1)" nothing can
 * read the mention back out, and a scene's cast is built from this.
 */
export function mentionedContainerIds(resolved: ResolvedMentions): string[] {
  const ids: string[] = []
  for (const outcome of resolved.outcomes) {
    if (outcome.kind === "unresolved") continue
    if (!ids.includes(outcome.containerId)) ids.push(outcome.containerId)
  }
  return ids
}

/** How many references each slot already carries. */
export function countBySlot(
  references: readonly GenerationReference[]
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const reference of references) {
    counts[reference.slotField] = (counts[reference.slotField] ?? 0) + 1
  }
  return counts
}

/** An allocation decided in the first pass, numbered in the second. */
interface Allocation {
  handle: string
  containerId: string
  subject: MentionSubject
  slotField: string
  assetIds: string[]
  /** Positions within the slot, in `assetIds` order. */
  positions: number[]
}

export function resolveMentions(input: ResolveMentionsInput): ResolvedMentions {
  const tokens = findMentions(input.prompt)
  if (tokens.length === 0) {
    return { prompt: input.prompt, references: [], outcomes: [] }
  }

  const byHandle = new Map(
    input.subjects.map((subject) => [subject.handle, subject])
  )
  const perSubject = Math.max(1, Math.trunc(input.perSubject ?? 1))

  // The edges the user drew always win, so the tally starts from them.
  const tally: Record<string, number> = { ...input.occupied }
  // Stable within a preference band, so a model's own field order decides
  // between two slots that are equally suitable.
  const candidates = input.slots
    .filter(isMentionable)
    .sort((a, b) => rolePreference(a) - rolePreference(b))

  const allocations: Allocation[] = []
  const outcomes: MentionOutcome[] = []
  const seen = new Set<string>()

  for (const token of tokens) {
    // A handle mentioned twice attaches once and substitutes both times.
    if (seen.has(token.handle)) continue
    seen.add(token.handle)

    const subject = byHandle.get(token.handle)
    if (!subject) {
      outcomes.push({ kind: "unresolved", handle: token.handle })
      continue
    }

    const asText = (
      reason: "no-image-slot" | "slots-full" | "no-images"
    ): MentionOutcome => ({
      kind: "text",
      handle: subject.handle,
      containerId: subject.containerId,
      reason,
      substitution: subject.description ?? subject.name,
    })

    if (candidates.length === 0) {
      outcomes.push(asText("no-image-slot"))
      continue
    }
    if (subject.images.length === 0) {
      outcomes.push(asText("no-images"))
      continue
    }

    const slot = candidates.find(
      (candidate) => slotCapacity(candidate) - (tally[candidate.field] ?? 0) > 0
    )
    if (!slot) {
      outcomes.push(asText("slots-full"))
      continue
    }

    const filled = tally[slot.field] ?? 0
    const remaining = slotCapacity(slot) - filled
    // A scene is one place; a character can be worth several views of itself,
    // but never more than the model said it accepts.
    const wanted = subject.explicitReferences
      ? subject.images.length
      : subject.kind === "scene"
        ? 1
        : perSubject
    const take = Math.min(wanted, remaining, subject.images.length)

    const taken = subject.images.slice(0, take)
    const assetIds = taken.map((image) => image.assetId)
    const positions = assetIds.map((_id, index) => filled + index)
    tally[slot.field] = filled + take

    allocations.push({
      handle: subject.handle,
      containerId: subject.containerId,
      subject,
      slotField: slot.field,
      assetIds,
      positions,
    })
    // Placed now so the outcomes keep first-appearance order; the substitution
    // needs the final tally and is filled in below.
    outcomes.push({
      kind: "image",
      handle: subject.handle,
      containerId: subject.containerId,
      slotField: slot.field,
      assetIds,
      thumbnailUrls: taken.map((image) => image.thumbnailUrl),
      substitution: "",
    })
  }

  // Second pass: the 1-based position of each image *across the whole
  // request*, in the order the provider receives them — slot order first,
  // position within the slot second — so the sentence matches the payload.
  const slotOffset = new Map<string, number>()
  let totalImages = 0
  for (const slot of input.slots) {
    if (!isImageSlot(slot)) continue
    slotOffset.set(slot.field, totalImages)
    totalImages += tally[slot.field] ?? 0
  }

  const references: GenerationReference[] = []
  const substitutions = new Map<string, string>()
  for (const allocation of allocations) {
    const offset = slotOffset.get(allocation.slotField) ?? 0
    const numbers = allocation.positions.map(
      (position) => offset + position + 1
    )
    const noun = allocation.subject.kind === "scene" ? "location" : "person"
    const substitution = `${allocation.subject.name} (the ${noun} in ${imagePhrase(numbers, totalImages)})`
    substitutions.set(allocation.handle, substitution)

    for (const [index, assetId] of allocation.assetIds.entries()) {
      references.push({
        slotField: allocation.slotField,
        assetId,
        position: allocation.positions[index]!,
      })
    }
  }

  for (const outcome of outcomes) {
    if (outcome.kind !== "image") continue
    outcome.substitution = substitutions.get(outcome.handle) ?? ""
  }

  const replacements = new Map<string, string>()
  for (const outcome of outcomes) {
    if (outcome.kind === "unresolved") continue
    replacements.set(outcome.handle, outcome.substitution)
  }

  // Back to front, so an earlier token's indexes are still valid. Only the
  // `@handle` itself is replaced — the text around it is the user's.
  let prompt = input.prompt
  for (const token of [...tokens].reverse()) {
    const substitution = replacements.get(token.handle)
    if (substitution === undefined) continue
    prompt =
      prompt.slice(0, token.start) + substitution + prompt.slice(token.end)
  }

  return { prompt, references, outcomes }
}
