/**
 * Incoming edges → the inputs of the next run.
 *
 * Step 1 of the run flow, and the whole of it that has rules worth testing.
 * A generate node's incoming edges are walked in creation order and turned
 * into two things: the `references` the request carries, and the `notes` whose
 * text the prompt's blocks place among the user's own words.
 *
 * What each source contributes:
 *
 * | Source node | Contribution                                          |
 * | ----------- | ----------------------------------------------------- |
 * | text        | its text, placed by the prompt's blocks, never a slot |
 * | media       | its `assetId`, in the edge's slot                     |
 * | generate    | its `pickAssetId`, in the edge's slot                 |
 *
 * ⛔ Nothing here submits anything, and an edge never triggers a run. This is
 * a pure function over rows the canvas already has; the only thing it can do
 * is describe the run the user has not pressed Generate on yet.
 *
 * It blocks rather than guesses. A generate node with no pick does not fall
 * back to its first output — picking is the user's decision, and a run that
 * quietly used a tile they did not choose would be a paid mistake. A slot the
 * current model no longer declares blocks too, in front of the same guard
 * `submitGeneration` already enforces in the main process — and so does a
 * family slot the node's endpoint cannot take with its other inputs.
 */
import type {
  CanvasEdgeDto,
  CanvasNodeDto,
  GenerationReference,
  ReferenceSlot,
  SlotAvailability,
} from "@opendirect/contract"

// Type-only, so the two modules never form a runtime cycle: `prompt-blocks`
// must not import from here.
import type { IncomingNote } from "./prompt-blocks"

/** Why a run cannot be built yet. The UI shows `message` verbatim. */
export type CanvasBlockCode =
  /** An upstream generate node has produced nothing the user has picked. */
  | "no-pick"
  /** A media edge carries no slot field at all. */
  | "unresolved-slot"
  /** The edge names a field this model's schema does not declare. */
  | "unknown-slot"
  /** A media node whose asset row is gone. */
  | "missing-asset"
  /**
   * A family node's slot that the endpoint the node resolves to cannot take
   * alongside its other inputs (or at all, on the overridden provider).
   */
  | "incompatible-slot"

export interface CanvasInputsBlocked {
  blocked: string
  code: CanvasBlockCode
  /** The edge that cannot be resolved, so the canvas can highlight it. */
  edgeId: string
  /** The node on the other end of it. */
  nodeId: string
}

export interface CanvasInputs {
  references: GenerationReference[]
  /** Every incoming text node, in wire order, its text untouched. */
  notes: IncomingNote[]
}

export type CanvasInputsResult = CanvasInputs | CanvasInputsBlocked

export function isBlocked(
  result: CanvasInputsResult
): result is CanvasInputsBlocked {
  return "blocked" in result
}

export interface EdgesToInputsInput {
  /** The generate node about to be run. */
  targetNodeId: string
  nodes: readonly CanvasNodeDto[]
  edges: readonly CanvasEdgeDto[]
  /** The chosen model's own slots — `descriptor.referenceSlots`. */
  slots: readonly ReferenceSlot[]
  /**
   * A family node's slot availability (`familyAvailability`), by slot key.
   * Absent for a concrete model, whose declared slots are all usable.
   */
  availability?: Readonly<Record<string, SlotAvailability>>
}

/**
 * Edge creation order, which is the order the user drew them and therefore
 * the order their contributions are sent in. `createdAt` is epoch ms and two
 * edges drawn in the same millisecond are ordered by id, so the result never
 * depends on the order the rows came back in.
 */
export function orderEdges(edges: readonly CanvasEdgeDto[]): CanvasEdgeDto[] {
  return [...edges].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  )
}

/** The edges feeding one node, in creation order. */
export function incomingEdges(
  edges: readonly CanvasEdgeDto[],
  targetNodeId: string
): CanvasEdgeDto[] {
  return orderEdges(edges.filter((edge) => edge.targetNodeId === targetNodeId))
}

function blockedBy(
  code: CanvasBlockCode,
  message: string,
  edge: CanvasEdgeDto,
  node: CanvasNodeDto
): CanvasInputsBlocked {
  return { blocked: message, code, edgeId: edge.id, nodeId: node.id }
}

/** A node's own name for an error message, without inventing a title. */
function describe(node: CanvasNodeDto): string {
  if (node.type === "media") return "A media node"
  if (node.type === "text") return "A text node"
  return "An upstream generate node"
}

/** How long a note's title may run before it is cut. */
const NOTE_TITLE_LENGTH = 32

/** First non-empty line, at most 32 characters. Notes have no title of their own. */
export function noteTitle(text: string | null): string {
  const line = (text ?? "")
    .split("\n")
    .map((one) => one.trim())
    .find((one) => one !== "")
  if (line === undefined) return "Empty note"
  return line.length > NOTE_TITLE_LENGTH
    ? `${line.slice(0, NOTE_TITLE_LENGTH)}…`
    : line
}

function toNote(node: CanvasNodeDto): IncomingNote {
  return { nodeId: node.id, title: noteTitle(node.text), text: node.text ?? "" }
}

/**
 * Every text node wired into `targetNodeId`, in wire order — blocked run or
 * not. The composer shows a node's notes while an unpicked upstream node still
 * blocks it, so they cannot come from `edgesToInputs`, which stops at a block.
 */
export function incomingNotes(
  input: Pick<EdgesToInputsInput, "targetNodeId" | "nodes" | "edges">
): IncomingNote[] {
  const byId = new Map(input.nodes.map((node) => [node.id, node]))
  return incomingEdges(input.edges, input.targetNodeId).flatMap((edge) => {
    const source = byId.get(edge.sourceNodeId)
    return source?.type === "text" ? [toNote(source)] : []
  })
}

export function edgesToInputs(input: EdgesToInputsInput): CanvasInputsResult {
  const byId = new Map(input.nodes.map((node) => [node.id, node]))
  const slotFields = new Set(input.slots.map((slot) => slot.field))

  const references: GenerationReference[] = []
  const filled = new Map<string, number>()
  const notes: IncomingNote[] = []

  for (const edge of incomingEdges(input.edges, input.targetNodeId)) {
    const source = byId.get(edge.sourceNodeId)
    // A dangling edge is a row the node it pointed at has already taken with
    // it. It describes nothing, so it contributes nothing rather than
    // blocking a run over a node that no longer exists.
    if (!source) continue

    if (source.type === "text") {
      notes.push(toNote(source))
      continue
    }

    const assetId =
      source.type === "media" ? source.assetId : source.pickAssetId
    if (!assetId) {
      if (source.type === "media") {
        return blockedBy(
          "missing-asset",
          `${describe(source)} has no asset any more. Remove the connection or replace the node.`,
          edge,
          source
        )
      }
      return blockedBy(
        "no-pick",
        `${describe(source)} has no pick selected. Choose which result to use before running this node.`,
        edge,
        source
      )
    }

    if (!edge.slotField) {
      // Only send the user to the edge label when the label has something to
      // offer. With no slots — no model chosen, or one that takes no
      // references — its menu is empty and the advice is a dead end.
      return blockedBy(
        "unresolved-slot",
        input.slots.length > 0
          ? "A connection has no input slot. Choose the slot it feeds from the edge label."
          : "A connection has no input slot, and this node's model declares none to choose from. Pick a model that takes references, or remove the connection.",
        edge,
        source
      )
    }
    if (!slotFields.has(edge.slotField)) {
      return blockedBy(
        "unknown-slot",
        `This model has no input called "${edge.slotField}". Choose a slot it does have from the edge label.`,
        edge,
        source
      )
    }
    const availability = input.availability?.[edge.slotField]
    if (availability?.available === false) {
      const label =
        input.slots.find((slot) => slot.field === edge.slotField)?.label ??
        edge.slotField
      return blockedBy(
        "incompatible-slot",
        `${label}: ${availability.reason ?? "not available here"}. Choose another slot from the edge label, or remove the connection.`,
        edge,
        source
      )
    }

    // Position is the edge's rank *within its own slot*, so two references in
    // one slot are first and second and a reference in another slot is first.
    const position = filled.get(edge.slotField) ?? 0
    filled.set(edge.slotField, position + 1)
    references.push({ slotField: edge.slotField, assetId, position })
  }

  return { references, notes }
}
