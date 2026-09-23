# Prompt Composer: notes as blocks, the full prompt on show

A validated design. The user asked:

> "The way prompting works and the reference characters, the place where we
> type the prompt, everything looks bad… we should also convey how reference
> text works… think of it as already inserted, like Notion, but greyed out…
> you can still move it around."

The canvas prompt bar becomes a **block composer**. Connected notes show up
inside the prompt as dimmed, read-only blocks. The user's own text sits in
editable blocks around them, and every block can be dragged anywhere. A **Full
prompt** panel shows the exact string that will be sent. References show the
first few thumbnails per model input, then a `+97` button that opens all of them.

**Mockup** (the source of truth for layout; open it in a browser):

| What | File |
|---|---|
| Combined composer: drag, type, full prompt, `+97`, image vs video model | [`composer.html`](mockups/2026-09-23-prompt-composer/composer.html) |

Every round explored, including the rejected ones (Round 1: numbered blocks,
inline ghost text, compact rows, side rail; Round 2: locked blocks, hover
cards, stress test), is on the design canvas:
https://claude.ai/artifact/3bJpNCAAcwkcgbkQatP9Za

The mockup uses hardcoded hex colours and the Geist font. **Build with the
app's own shadcn tokens and `@workspace/ui` components.** Take layout,
hierarchy and behaviour from the mockup, not its colours.

---

## 1. What is wrong today

Screenshot from the user: a Note wired into an Image node, with the bar open.

- **The row wraps.** `prompt-bar.tsx` lays everything out in one
  `flex flex-wrap items-end` row. The textarea gets about 300px and **Run**
  drops onto a line of its own.
- **The note is unreadable.** `ReferenceTray` draws a text edge as a tiny
  truncated chip ("Characte brief: appe…") labelled "Prompt". Nothing says
  the note's whole text is *prepended* to the prompt.
- **The order is invisible.** `edgesToInputs` joins every connected note in
  **wire creation order** (`orderEdges` sorts by `createdAt`), with a blank line
  between notes and the typed prompt last (`composePrompt`). The only way to
  reorder is to delete and redraw wires.
- **The header is filler.** "Compose · select references · review cost · run".

## 2. The design

### 2.1 Layout

One card, top to bottom:

1. **References strip.** One group per model input (see 2.4). Each group shows
   up to 4 thumbnails. Past 4 it shows **3 and a `+N` button**. `+` adds a
   reference, and on the right is a quiet "`N images`" total.
2. **Gallery** (only when opened). Clicking `+N` or a thumbnail opens a
   scrollable grid of every image in that input, headed "Reference images ·
   100 · sent as `input_images`", with a Done button. It is inline under the
   strip, not a modal: the bar is anchored to a node and must not jump.
3. **Blocks.** The prompt itself, as an ordered list of blocks (2.2).
4. **Toolbar, one row, never wraps.** Model · aspect/settings · Advanced ·
   **Full prompt** · cost · Save (icon) · **Run**, far right. The count stepper
   stays here. At narrow widths count and cost move into the settings popover,
   as they do today.
5. **Full prompt panel** (toggle, 2.3).

The header line goes. Messages (`MentionNotes`, notices, errors, blocked
reason) stay *below* everything, for the reason the current file gives: the
bar is anchored by its top edge.

### 2.2 Blocks

A block is one of:

- **Note block.** One connected text node. It is read-only and dimmed
  (`text-muted-foreground` at reduced strength), shown on one line: order
  number, link icon + note title, the text ellipsised, and a word count.
  - Click to expand the full text in place, and click again to collapse.
  - Hover shows the **⋮⋮** handle (left, outside the text), **+** (insert a
    text block below), and **✕**, which disconnects the wire. The note node
    stays on the canvas.
  - Hover also highlights the source note and its wire on the canvas.
    Double-click selects the note on the canvas for editing.
- **Text block.** The user's own words. It is a `MentionTextarea`, so
  `@mentions` keep working in every text block. It auto-grows.

Every block has the ⋮⋮ handle and can be dragged anywhere in the list. A blue
line shows the drop position. There is always an empty text block at the end
("Type here, or drag a note in…"), so there is always somewhere to type.

Empty text blocks are dropped when the prompt is rendered. An empty note
still shows (so the user can see why it adds nothing) but contributes nothing.

### 2.3 Full prompt panel

Toggled by **Full prompt** in the toolbar. Open by default the first time a
node has notes; after that the choice is remembered per window.

- **Header.** "Exactly what gets sent", then `chars · words · notes · images`,
  a **Highlight notes** checkbox (tints note-sourced text), and **Copy**.
- **Prompt.** A monospace, `pre-wrap` box showing the **resolved** prompt:
  `useGeneratePlan().mentions.prompt`, i.e. after blocks are joined *and*
  `@mentions` are substituted. This is the string the provider receives and
  the string `generations.prompt` records. Highlighting maps rendered ranges
  back to their block. Mention substitution can change lengths, so compute
  ranges from the block boundaries before resolution and carry them through
  (or highlight by block when a range cannot be mapped).
- **Images.** One chip per input: `input_images × 100`. Clicking a chip opens
  that input's gallery.

### 2.4 How images are grouped

Groups come from the **model's own inputs**, never from labels we invent.
`ModelDescriptor.referenceSlots` (`packages/contract/src/model.ts`) is read from
each model's input schema. Every slot has `field`, `label`, `multiple`, `max`
and a `role` (`reference | first_frame | last_frame | motion | source |
unknown`). Every incoming media/generate edge already carries its `slotField`.

- **One slot** (most image models: one "reference images" field): no group
  heading. Just thumbnails, `+N`, and the total.
- **Several slots** (video models with first/last frame, edit models with
  source + reference): a small uppercase heading per slot with its count.
- A slot at capacity (`max`) shows `12 / 12`, and the `+` for that slot is
  disabled with the reason in its tooltip. `remainingCapacity` already
  computes this.

## 3. Data

### 3.1 The recipe gains `blocks`

Today the recipe (`promptRecipeSchema`, `packages/contract/src/workflow.ts`)
holds one `prompt: string`, and notes are prepended at run time. With free
placement the **order belongs to the prompt, not to the wires**. That makes a
`position` column on `canvas_edges` unnecessary.

```ts
export const promptBlockSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().max(100_000) }),
  z.object({ kind: z.literal("note"), nodeId: z.string() }),
])

export const promptRecipeSchema = z.object({
  prompt: z.string().max(100_000),          // kept: see below
  blocks: z.array(promptBlockSchema).max(500).optional(),
  modelKey: …, common: …, advanced: …, count: …,
})
```

- `blocks` is **optional**, so every saved node and exported workflow still
  parses.
- `prompt` is kept and **written as the join of the text blocks only**. Older
  readers (and the container page's generate panel, which has no notes) keep
  working. It is not what gets sent on the canvas: `blocks` is.
- A note block stores the **source node id**, not the edge id. The wire is
  "note → this node"; the node id survives the user redrawing the wire.

`PromptDraft` in `prompt-bar.tsx` gains the same `blocks` field. The module
store and `useSyncExternalStore` are unchanged.

### 3.2 Reconciling blocks with the wires

The wires are still the truth about *which* notes feed a node, and blocks are
the truth about *where* they go. On every render, a pure function
`reconcileBlocks(blocks, noteIds)` settles the two:

| Situation | Result |
|---|---|
| Recipe has no `blocks` (legacy) | Note blocks for every incoming text edge in `orderEdges` order, then one text block holding `prompt`. **Sends byte-for-byte what it sends today.** |
| Note wired in, no block for it | Note block inserted **at the top**, after any existing leading note blocks. That matches today's "notes first" and is where a user looks. |
| Block for a note no longer wired in | Block dropped. |
| Same note twice | Second occurrence dropped. |
| No trailing empty text block | One appended. |

**✕** on a note block deletes the edge (as the tray's ✕ does today), and
reconciliation removes the block.

### 3.3 Rendering the prompt

`edgesToInputs` stops producing `promptPrefix`. Instead it returns the
incoming notes by id: `notes: { nodeId, title, text }[]`. References, slots
and every block reason are unchanged. A new pure function:

```ts
/** Non-empty blocks, in order, joined by PROMPT_PREFIX_SEPARATOR ("\n\n"). */
export function renderPromptBlocks(blocks, notesById): {
  prompt: string
  ranges: { blockIndex: number; start: number; end: number }[]
}
```

`useGeneratePlan` takes the rendered string where it now calls
`composePrompt(inputs.promptPrefix, draft.prompt)`. Everything after that
(mention resolution, request, quote, batch plan, `run`) is untouched.
`composePrompt` is deleted once nothing calls it. The container page's panel
passes `draft.prompt` as today.

### 3.4 Workflows

`importWorkflow` (`apps/desktop/src/main/repo/workflows.ts`) remaps node ids.
It must also **rewrite `nodeId` in every note block** through the same map, or
imported blocks point at nothing and reconciliation silently drops them. On
export, blocks travel inside `recipe` with no extra work. Starter workflows
(`lib/canvas/starter-workflows.ts`) need no change: no `blocks` means legacy
order.

## 4. Components

| Piece | Where | Change |
|---|---|---|
| `PromptBar` | `components/canvas/prompt-bar.tsx` | New layout (2.1). Owns `blocks` in the draft; calls `reconcileBlocks`; toolbar row; Full prompt toggle. |
| `ReferenceStrip` | replaces the thumbnail part of `reference-tray.tsx` | Per-slot groups, first 3 + `+N`, inline gallery, capacity. Text edges are no longer drawn here. |
| `PromptBlocks` | new, `components/canvas/prompt-blocks.tsx` | Renders blocks; drag and drop; note expand, insert-below, disconnect; hover → canvas highlight. |
| `MentionTextarea` | unchanged | One per text block. |
| `FullPromptPanel` | new | Resolved prompt, highlight ranges, stats, per-input chips, Copy. |
| `edgesToInputs` | `lib/canvas/edges-to-inputs.ts` | `notes` instead of `promptPrefix`. |
| `renderPromptBlocks`, `reconcileBlocks` | new, `lib/canvas/prompt-blocks.ts` | Pure; the whole of the rules above. |

**Drag and drop.** Use dnd-kit, which is already a dependency
(`@dnd-kit/sortable`, and the shell's sidebar uses it), with a sortable list in
the bar's own nested `DndContext`, so it cannot collide with the shell's
sidebar drags. Do not use native HTML5 drag. It handles keyboard reordering
(space to lift, arrows to move) and does not fight the textareas. Screen
readers hear "Note 2, Lighting, moved to position 4 of 6".

**Focus.** Enter at the end of a text block does *not* split it: prompts are
prose, and a newline belongs in the text. Backspace in an empty text block
merges into the previous text block. A note block is never deleted from the
keyboard by accident: it takes an explicit ✕ or Delete on a focused note.

## 5. What does not change

- ⛔ **Run spends once.** `useGeneratePlan().run` is still called exactly once
  per click, and the button is disabled in flight.
- Mentions resolve against the *whole* rendered prompt, notes included, as
  they do today.
- `generations.prompt` records the resolved string, so a run replays exactly.
- Edges drawn before a model was chosen still get their slot assigned (the
  existing `firstFreeSlot` effect).

## 6. Testing

- `prompt-blocks.test.ts`: `renderPromptBlocks` joins and drops empties and
  returns correct ranges; `reconcileBlocks` covers every row of the 3.2 table.
  **Legacy parity:** for any recipe without `blocks`, the rendered prompt
  equals today's `composePrompt(promptPrefix, prompt)`.
- `edges-to-inputs.test.ts`: `notes` replaces `promptPrefix`; block reasons
  unchanged.
- `prompt-bar.test.tsx`: typing in a middle text block; dragging a note below
  a text block changes the submitted prompt; ✕ deletes the edge; the Full
  prompt panel shows the resolved (mention-substituted) text; `+97` opens the
  gallery; toolbar never wraps at the bar's minimum width.
- `workflows.test.ts`: import remaps `blocks[].nodeId`.
- Contract: a recipe without `blocks` still parses; one with blocks
  round-trips through export → import.

## 7. Out of scope

- Referring to a specific image by number inside the prompt ("the person in
  image 2"). The per-slot order the strip shows is the order sent, so this can
  come later.
- Editing a note's text from inside the composer. Double-click takes you to
  the note.
- Reordering images by drag. Order within a slot stays wire order.
