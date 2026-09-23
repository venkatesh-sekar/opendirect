/**
 * Where each connected note sits among the user's own text, and the one
 * string that order becomes. Pure — no DOM, no IPC, no state.
 *
 * Two rules hold the whole composer together:
 *
 * - **Reconcile.** The wires say *which* notes feed a node; `blocks` says
 *   *where* they go. A recipe with no `blocks` (every one saved before this)
 *   reads as its notes in wire order and then `prompt`, which renders
 *   byte-for-byte to what the old `composePrompt` sent. A newly wired note
 *   joins the leading run of notes, an unwired or repeated one is dropped,
 *   and the list always ends with a text block so there is somewhere to type.
 * - **Render.** Non-empty blocks, trimmed, in list order, joined by a blank
 *   line. The ranges let the full-prompt panel show which block wrote which
 *   part of what is sent.
 *
 * ⛔ Nothing here submits anything. The rendered prompt is what the run will
 * carry, so it is computed the same way for the preview and for Run.
 */
import type { PromptBlock } from "@opendirect/contract"

import { findMentions } from "@/lib/mentions/parse"
import type { MentionOutcome } from "@/lib/mentions/resolve"

/** What separates two blocks in the rendered prompt. */
export const BLOCK_SEPARATOR = "\n\n"

/** A block as the composer holds it: the persisted shape plus a stable UI id. */
export type DraftBlock = PromptBlock & { id: string }

/** Numbers the `t-<n>` ids of blocks made here, so none is ever reused. */
let counter = 0

export interface IncomingNote {
  nodeId: string
  title: string
  text: string
}

export interface RenderedPrompt {
  prompt: string
  ranges: { blockIndex: number; start: number; end: number }[]
}

export function renderPromptBlocks(
  blocks: readonly PromptBlock[],
  notesById: ReadonlyMap<string, Pick<IncomingNote, "text">>
): RenderedPrompt {
  const parts: string[] = []
  const ranges: RenderedPrompt["ranges"] = []
  let cursor = 0
  for (const [blockIndex, block] of blocks.entries()) {
    const text = (
      block.kind === "text"
        ? block.text
        : (notesById.get(block.nodeId)?.text ?? "")
    ).trim()
    if (text === "") continue
    if (parts.length > 0) cursor += BLOCK_SEPARATOR.length
    ranges.push({ blockIndex, start: cursor, end: cursor + text.length })
    parts.push(text)
    cursor += text.length
  }
  return { prompt: parts.join(BLOCK_SEPARATOR), ranges }
}

/** The id a block gets when it arrives without one, e.g. from a recipe. */
function defaultId(block: PromptBlock, index: number): string {
  return block.kind === "note" ? `note:${block.nodeId}` : `text:${index}`
}

export function reconcileBlocks(input: {
  blocks: readonly (PromptBlock & { id?: string })[] | undefined
  /** Only used when `blocks` is undefined (a legacy recipe). */
  prompt: string
  /** Incoming text nodes, in wire (`orderEdges`) order. */
  noteIds: readonly string[]
}): DraftBlock[] {
  if (input.blocks === undefined) {
    const legacy: DraftBlock[] = input.noteIds.map((nodeId) => ({
      id: `note:${nodeId}`,
      kind: "note",
      nodeId,
    }))
    legacy.push({
      id: `text:${legacy.length}`,
      kind: "text",
      text: input.prompt,
    })
    return legacy
  }

  const wired = new Set(input.noteIds)
  const placed = new Set<string>()
  const kept: (PromptBlock & { id?: string })[] = []
  for (const block of input.blocks) {
    if (block.kind === "note") {
      if (!wired.has(block.nodeId) || placed.has(block.nodeId)) continue
      placed.add(block.nodeId)
    }
    kept.push(block)
  }

  const missing = input.noteIds.filter((nodeId) => !placed.has(nodeId))
  if (missing.length > 0) {
    let leading = 0
    while (kept[leading]?.kind === "note") leading += 1
    kept.splice(
      leading,
      0,
      ...missing.map((nodeId): PromptBlock => ({ kind: "note", nodeId }))
    )
  }
  if (kept.at(-1)?.kind !== "text") kept.push({ kind: "text", text: "" })

  const unchanged =
    kept.length === input.blocks.length &&
    kept.every((block, index) => block === input.blocks![index]) &&
    kept.every((block) => block.id !== undefined)
  if (unchanged) return input.blocks as DraftBlock[]

  // A default id can already belong to a block that has moved since it got
  // it (`text:2` dragged to the top), and two blocks sharing an id would
  // share a React key and a dnd-kit handle. Such a block gets a fresh one.
  const taken = new Set(kept.flatMap((block) => block.id ?? []))
  return kept.map((block, index) => {
    if (block.id !== undefined) return block as DraftBlock
    let id = defaultId(block, index)
    if (taken.has(id)) id = `t-${++counter}`
    taken.add(id)
    return { ...block, id }
  })
}

/** The user's own words only — what `draft.prompt` holds and the AI helpers edit. */
export function textOfBlocks(blocks: readonly PromptBlock[]): string {
  return blocks
    .flatMap((block) => (block.kind === "text" ? [block.text.trim()] : []))
    .filter(Boolean)
    .join(BLOCK_SEPARATOR)
}

/** dnd-kit `arrayMove` semantics: `fromId` ends up at `toId`'s index. */
export function moveBlock(
  blocks: DraftBlock[],
  fromId: string,
  toId: string
): DraftBlock[] {
  const from = blocks.findIndex((block) => block.id === fromId)
  const to = blocks.findIndex((block) => block.id === toId)
  if (from === -1 || to === -1) return blocks
  const next = [...blocks]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}

/** A text block made by the UI, with an id nothing else will use. */
export function newTextBlock(text = ""): DraftBlock {
  counter += 1
  return { id: `t-${counter}`, kind: "text", text }
}

/** Every note where it was, then `text` as the one text block after them. */
export function replaceText(
  blocks: readonly DraftBlock[],
  text: string
): DraftBlock[] {
  return [
    ...blocks.filter((block) => block.kind === "note"),
    newTextBlock(text),
  ]
}

/** "Insert shot": fills an empty last text block, else adds `, text` to it. */
export function appendText(
  blocks: readonly DraftBlock[],
  text: string
): DraftBlock[] {
  let index = blocks.length - 1
  while (index >= 0 && blocks[index]!.kind !== "text") index -= 1
  if (index === -1) return [...blocks, newTextBlock(text)]
  const block = blocks[index] as Extract<DraftBlock, { kind: "text" }>
  const current = block.text.trimEnd()
  const next = [...blocks]
  next[index] = {
    ...block,
    text: current.trim() === "" ? text : `${current}, ${text}`,
  }
  return next
}

/**
 * Backspace in an empty text block: the block goes and the caret moves to the
 * previous text block. A block with text in it, or one with no text block
 * before it, stays put.
 */
export function mergeIntoPrevious(
  blocks: readonly DraftBlock[],
  id: string
): { blocks: DraftBlock[]; focus: string | null } {
  const index = blocks.findIndex((block) => block.id === id)
  const block = blocks[index]
  const unchanged = { blocks: blocks as DraftBlock[], focus: null }
  if (!block || block.kind !== "text" || block.text !== "") return unchanged
  const previous = blocks
    .slice(0, index)
    .reverse()
    .find((candidate) => candidate.kind === "text")
  if (!previous) return unchanged
  return {
    blocks: blocks.filter((candidate) => candidate.id !== id),
    focus: previous.id,
  }
}

/**
 * Ranges over the raw rendered prompt, moved to where the same text sits once
 * mentions are substituted — the replacements `resolveMentions` makes.
 *
 * A mention never straddles two blocks: the separator is not a handle
 * character, so every token lies inside one range.
 */
export function mapRangesThroughMentions(
  raw: string,
  ranges: RenderedPrompt["ranges"],
  outcomes: readonly MentionOutcome[]
): RenderedPrompt["ranges"] {
  const replacements = new Map<string, string>()
  for (const outcome of outcomes) {
    if (outcome.kind === "unresolved") continue
    replacements.set(outcome.handle, outcome.substitution)
  }

  const shifts: { end: number; delta: number }[] = []
  for (const token of findMentions(raw)) {
    const substitution = replacements.get(token.handle)
    if (substitution === undefined) continue
    shifts.push({
      end: token.end,
      delta: substitution.length - (token.end - token.start),
    })
  }
  if (shifts.length === 0) return ranges

  const map = (offset: number) =>
    shifts.reduce(
      (sum, shift) => (shift.end <= offset ? sum + shift.delta : sum),
      offset
    )
  return ranges.map((range) => ({
    ...range,
    start: map(range.start),
    end: map(range.end),
  }))
}
