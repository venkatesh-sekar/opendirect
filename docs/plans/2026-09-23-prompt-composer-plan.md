# Prompt Composer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or
> superpowers:subagent-driven-development) to implement this plan task-by-task.
> Each task is self-contained: read **only** your task's section, the
> "Shared context" section below, and the design doc
> `docs/plans/2026-09-23-prompt-composer-design.md`. Open the mockup
> `docs/plans/mockups/2026-09-23-prompt-composer/composer.html` in a browser for
> layout. Use superpowers:test-driven-development inside each task.

**Goal:** Replace the canvas prompt bar's single textarea and chip tray with a
block composer (dimmed, draggable note blocks mixed with editable text blocks),
a per-slot reference strip with an inline gallery, and a "Full prompt" panel
that shows exactly what is sent.

**Architecture:** The recipe gains optional `blocks` (order of notes and text).
Two pure functions in `apps/web/lib/canvas/prompt-blocks.ts` —
`reconcileBlocks` (wires × blocks → blocks) and `renderPromptBlocks`
(blocks → prompt string + ranges) — hold every rule. `edgesToInputs` stops
producing `promptPrefix` and reports `notes` instead; `useGeneratePlan` takes
the rendered prompt as an explicit input. The UI is three new/rewritten
components (`PromptBlocks`, `CanvasReferenceStrip`, `FullPromptPanel`) that
`PromptBar` lays out.

**Tech Stack:** Next.js 16 (static export, client components only here), React
19, TypeScript, zod 4, `@dnd-kit/core` + `@dnd-kit/sortable`, shadcn
components from `@workspace/ui`, Hugeicons, Vitest 5 + Testing Library
(jsdom), Electron main process with better-sqlite3/drizzle for the desktop repo.

---

## Shared context (read this for every task)

### Commands

Run from the repo root `/Users/venkatesh/git/opendirect`.

| What | Command |
|---|---|
| One test file | `pnpm vitest run <path>` |
| All tests | `pnpm test` |
| Typecheck (every package + root) | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Build (Next static export + Electron bundles) | `pnpm build` |

CI (`.github/workflows/ci.yml`) runs exactly: `pnpm install --frozen-lockfile`,
`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, then asserts no
provider keys are committed and that `vitest.setup.ts` still contains
`onUnhandledRequest: "error"`. The release workflow only builds on tags; nothing
in this plan touches it. **No new dependencies are needed** (dnd-kit is already
in `apps/web/package.json`), so the lockfile must not change.

Every task ends with: its own test file(s) green, then `pnpm typecheck` and
`pnpm lint` green. The last task also runs `pnpm test` and `pnpm build`.

### Next.js

`AGENTS.md` warns this Next.js version has breaking changes. Everything here is
a `"use client"` component or a pure module, so no Next API is touched. If you
find yourself importing from `next/*`, stop and read the relevant guide in
`node_modules/next/dist/docs/` first.

### Conventions seen in the codebase

- Component tests start with `// @vitest-environment jsdom` and
  `import "@testing-library/jest-dom/vitest"`, mock `@/lib/ipc` with
  `vi.hoisted` (see `apps/web/components/canvas/prompt-bar.test.tsx` lines
  1–40), and wrap in `QueryClientProvider` + `TooltipProvider`.
- Files open with a doc comment explaining *why*; keep that style, and keep the
  `⛔` notes about spending money intact.
- Colours: shadcn tokens only (`text-muted-foreground`, `bg-muted`,
  `border`, `ring-primary`, …). Never the mockup's hex values.
- dnd-kit sortable with its own nested `DndContext`, keyboard sensor and
  `sortableKeyboardCoordinates` — copy the pattern in
  `apps/web/components/workspace/reference-strip.tsx` (lines 160–215). The
  keyboard-drag test pattern (mock `getBoundingClientRect`, focus handle,
  `" "`, arrow, `" "`) is in
  `apps/web/components/workspace/container-screen.test.tsx` lines 421–475.

### Decisions made while planning (defaults, not in the design doc)

1. **Trailing block rule.** The design says "always an empty text block at the
   end". Taken literally, typing into that block would spawn another empty one
   under the caret on every keystroke. The mockup does not do that. Rule used:
   **the list always ends with a text block** (if the last block is a note, an
   empty text block is appended). A new, fully empty prompt is therefore one
   empty text block.
2. **Block ids.** dnd-kit and React keys need stable ids; the persisted schema
   has none. The draft holds `DraftBlock = PromptBlock & { id: string }`.
   `reconcileBlocks` assigns deterministic ids to blocks that lack one:
   `note:<nodeId>` for notes, `text:<index>` for text. Blocks created by the UI
   use `t-<counter>` from a module counter. `promptRecipeSchema.parse` strips
   `id` (zod objects strip unknown keys), so ids are never persisted.
3. **Note title.** Text nodes have no title field. `noteTitle(text)` = first
   non-empty line, trimmed, cut to 32 chars with `…`; `"Empty note"` when blank.
4. **Text block labels.** The *last* text block is `aria-label="Prompt"`
   (keeps every existing `findByLabelText("Prompt")` test meaningful); any
   other text block is `Prompt, part N` (N = 1-based among text blocks).
5. **AI helpers with blocks.** "Improve prompt" reads/writes the *text* blocks
   only (`draft.prompt`, the join of text blocks). Apply keeps every note
   block in its order and replaces all text with one text block holding the
   answer, placed after the notes. "Insert shot" appends `, <text>` to the last
   text block (or sets it when empty).
6. **Branch from this run** (`seedPromptDraft`) sets `blocks: undefined`, so
   the new node uses legacy order. Unchanged behaviour.
7. **Edges with no/unknown slot and mention images in the strip.** Edges whose
   `slotField` is null or not a declared slot go in a trailing group headed
   "Unassigned" (shown only when non-empty, always headed). Mention images go
   into the slot they resolved to, drawn with the existing dashed ring and
   `@handle` badge, and count toward that slot's number.
8. **Full prompt remembered "per window".** A module-level
   `let fullPromptPreference: boolean | null = null`. `null` → open iff the node
   has at least one note; toggling sets it for every node until reload.
   `clearPromptDrafts()` (the test seam) also resets it.
9. **Canvas highlight** is done by attribute, not by re-rendering React Flow:
   the canvas sets `data-prompt-highlight` on `.react-flow__node[data-id=…]`
   and `.react-flow__edge[data-id=…]` and styles it in
   `apps/web/app/react-flow.css`. This avoids breaking the flow-node caches in
   `canvas.tsx` (`toFlowNodes` / flow edge cache).
10. **Name clash.** `apps/web/components/workspace/reference-strip.tsx` already
    exports `ReferenceStrip`. The canvas one is exported as
    `CanvasReferenceStrip` from the existing `reference-tray.tsx` (file kept to
    limit churn).

---

### Task 1: Contract `blocks` + pure block functions

Pure, no UI. Everything later depends on this.

**Files:**
- Modify: `packages/contract/src/workflow.ts` (add `promptBlockSchema`, `blocks` on `promptRecipeSchema`)
- Modify: `packages/contract/src/workflow.test.ts`
- Create: `apps/web/lib/canvas/prompt-blocks.ts`
- Create: `apps/web/lib/canvas/prompt-blocks.test.ts`

**Step 1: Contract test (failing).** In `workflow.test.ts` add:

```ts
it("parses a recipe without blocks and round trips one with blocks", () => {
  expect(workflowSchema.safeParse(workflow).success).toBe(true)
  const withBlocks = {
    ...workflow,
    nodes: [
      {
        ...workflow.nodes[0],
        recipe: {
          prompt: "A forest",
          modelKey: "openrouter:test/image",
          blocks: [
            { kind: "note", nodeId: "n1" },
            { kind: "text", text: "A forest" },
          ],
        },
      },
    ],
  }
  const parsed = workflowSchema.parse(withBlocks)
  expect(parsed.nodes[0]!.recipe!.blocks).toEqual(withBlocks.nodes[0].recipe.blocks)
  expect(workflowSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
})
it("strips UI ids from blocks and rejects unknown block kinds", () => {
  const recipe = promptRecipeSchema.parse({
    prompt: "",
    modelKey: null,
    blocks: [{ id: "t-1", kind: "text", text: "x" }],
  })
  expect(recipe.blocks).toEqual([{ kind: "text", text: "x" }])
  expect(
    promptRecipeSchema.safeParse({ prompt: "", modelKey: null, blocks: [{ kind: "image" }] }).success
  ).toBe(false)
})
```

Run `pnpm vitest run packages/contract/src/workflow.test.ts` → FAIL.

**Step 2: Implement the schema** in `workflow.ts`, above `promptRecipeSchema`:

```ts
export const promptBlockSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().max(100_000) }),
  z.object({ kind: z.literal("note"), nodeId: z.string().min(1).max(100) }),
])
export type PromptBlock = z.output<typeof promptBlockSchema>
```

and add to `promptRecipeSchema`, right after `prompt`:

```ts
  /**
   * Where each connected note sits among the user's own text. Optional so
   * every recipe saved before it still parses; absent means legacy order
   * (notes in wire order, then `prompt`). `prompt` is kept, written as the
   * join of the text blocks only, for readers that have no notes.
   */
  blocks: z.array(promptBlockSchema).max(500).optional(),
```

Re-run → PASS.

**Step 3: Pure-function tests (failing).** Create
`apps/web/lib/canvas/prompt-blocks.test.ts` covering, one `it` each:

- `renderPromptBlocks`:
  - joins non-empty blocks with `"\n\n"`, trimming each; text and note blocks
    interleave in list order.
  - drops empty/whitespace text blocks and empty notes, and a note whose id is
    missing from `notesById`.
  - `ranges` has one entry per *contributing* block with `blockIndex` = index in
    the input list and `prompt.slice(start, end) === trimmed block text`.
  - empty list → `{ prompt: "", ranges: [] }`.
- `reconcileBlocks` — one test per row of design §3.2:
  - legacy (`blocks: undefined`) → note blocks for `noteIds` in given order,
    then one text block holding `prompt` (untrimmed); ids `note:<id>` and
    `text:<index>`.
  - legacy with `prompt: ""` and no notes → `[text ""]`.
  - wired note with no block → inserted after the existing *leading* run of note
    blocks (e.g. `[note a, text x, note b]` + new `c` → `[note a, note c, text x, note b]`;
    `[text x]` + `c` → `[note c, text x]`).
  - block for a note not in `noteIds` → dropped.
  - duplicate note → second dropped.
  - last block is a note → empty text block appended; last block is non-empty
    text → nothing appended.
  - ids already present are kept; returns the *same array reference* when
    nothing changed (so React state does not churn).
- **Legacy parity** (the key test): for several fixtures (no notes; notes only;
  notes with padding whitespace and a blank note; notes + prompt with
  surrounding spaces), `renderPromptBlocks(reconcileBlocks({ blocks: undefined, prompt, noteIds }), notesById).prompt`
  equals the old `composePrompt(prefix, prompt)` where
  `prefix = notes.map(t=>t.trim()).filter(Boolean).join("\n\n")`. Inline a
  local copy of the old `composePrompt` in the test (it is deleted in Task 3):

  ```ts
  function legacyCompose(prefix: string, prompt: string) {
    const p = prefix.trim(), b = prompt.trim()
    return p === "" ? b : b === "" ? p : `${p}\n\n${b}`
  }
  ```
- `textOfBlocks` joins trimmed non-empty *text* blocks with `"\n\n"`.
- `moveBlock(blocks, fromId, toId)` returns a new array with the block moved to
  `toId`'s index (dnd-kit `arrayMove` semantics); unknown ids → same array.
- `replaceText(blocks, text)` → note blocks in order then `text`;
  `appendText(blocks, text)` → last text block becomes `text` if empty, else
  `${trimEnd}, ${text}`.
- `mergeIntoPrevious(blocks, id)` removes empty text block `id` and returns the
  id of the previous **text** block to focus (or null; nothing removed when the
  block is not empty or has no previous text block).
- `mapRangesThroughMentions(raw, ranges, outcomes)`:
  - no mentions → ranges unchanged.
  - `"note\n\n@venkz here"` with outcome substitution `"Venkz (the person in the reference image)"`
    → the second range's end grows by `substitution.length - "@venkz".length`,
    the first is unchanged; slicing the resolved prompt with each mapped range
    gives the block's resolved text.
  - an `unresolved` handle leaves offsets unchanged.

Run `pnpm vitest run apps/web/lib/canvas/prompt-blocks.test.ts` → FAIL (module missing).

**Step 4: Implement `apps/web/lib/canvas/prompt-blocks.ts`.** Header comment
summarising design §3.2/§3.3. Exports:

```ts
import type { PromptBlock } from "@opendirect/contract"
import { findMentions } from "@/lib/mentions/parse"
import type { MentionOutcome } from "@/lib/mentions/resolve"

/** What separates two blocks in the rendered prompt. */
export const BLOCK_SEPARATOR = "\n\n"

/** A block as the composer holds it: the persisted shape plus a stable UI id. */
export type DraftBlock = PromptBlock & { id: string }

export interface IncomingNote { nodeId: string; title: string; text: string }

export interface RenderedPrompt {
  prompt: string
  ranges: { blockIndex: number; start: number; end: number }[]
}

export function renderPromptBlocks(
  blocks: readonly PromptBlock[],
  notesById: ReadonlyMap<string, Pick<IncomingNote, "text">>
): RenderedPrompt

export function reconcileBlocks(input: {
  blocks: readonly (PromptBlock & { id?: string })[] | undefined
  /** Only used when `blocks` is undefined (a legacy recipe). */
  prompt: string
  /** Incoming text nodes, in wire (`orderEdges`) order. */
  noteIds: readonly string[]
}): DraftBlock[]

export function textOfBlocks(blocks: readonly PromptBlock[]): string
export function moveBlock(blocks: DraftBlock[], fromId: string, toId: string): DraftBlock[]
export function replaceText(blocks: readonly DraftBlock[], text: string): DraftBlock[]
export function appendText(blocks: readonly DraftBlock[], text: string): DraftBlock[]
export function mergeIntoPrevious(blocks: readonly DraftBlock[], id: string): { blocks: DraftBlock[]; focus: string | null }
export function newTextBlock(text?: string): DraftBlock   // id `t-${++counter}`
export function mapRangesThroughMentions(
  raw: string,
  ranges: RenderedPrompt["ranges"],
  outcomes: readonly MentionOutcome[]
): RenderedPrompt["ranges"]
```

Implementation notes:
- `renderPromptBlocks`: iterate; text = `block.kind === "text" ? block.text : notesById.get(block.nodeId)?.text ?? ""`, `.trim()`; skip empty; track `cursor` so each range is `[cursor, cursor + text.length)` and add `BLOCK_SEPARATOR.length` between parts.
- `reconcileBlocks`: when `blocks` undefined, build legacy list. Otherwise:
  filter out notes not in `noteIds` and duplicates; find notes in `noteIds`
  with no block; insert them (in `noteIds` order) at index = length of the
  leading run of note blocks; ensure last block is text; assign missing ids.
  If the result is element-wise identical (same objects, same length) to the
  input and every input already had an id, return the input array itself.
- `mapRangesThroughMentions`: build `replacements` from outcomes exactly as
  `resolveMentions` does (every outcome except `unresolved`, handle →
  substitution); walk `findMentions(raw)`; for each token with a replacement,
  `delta = substitution.length - (end - start)`; a raw offset `x` maps to
  `x + sum(delta of tokens with token.end <= x)`. Tokens never straddle a
  block boundary (the separator is not a handle character).

Run the test file → PASS. Then `pnpm typecheck && pnpm lint`.

**Step 5: Commit**
`git add packages/contract/src/workflow.ts packages/contract/src/workflow.test.ts apps/web/lib/canvas/prompt-blocks.ts apps/web/lib/canvas/prompt-blocks.test.ts`
`git commit -m "feat(canvas): prompt blocks in the recipe, with pure render and reconcile"`

---

### Task 2: Workflow import remaps note blocks

**Files:**
- Modify: `apps/desktop/src/main/repo/workflows.ts`
- Modify: `apps/desktop/src/main/repo/workflows.test.ts`

Context: `importWorkflow` creates each node with a fresh id and stores
`JSON.stringify(node.recipe)` in `text`. A note block's `nodeId` must be
rewritten through the same id map, or reconciliation silently drops it. A
recipe may reference a note that appears *later* in `workflow.nodes`, so ids
must be known before any node is written. `createNode` in
`apps/desktop/src/main/repo/canvas.ts` already accepts an optional `id`.

**Step 1: Failing test** in `workflows.test.ts`:

```ts
it("rewrites note block node ids through the import's id map", () => {
  const source = workflowSchema.parse({
    format: "opendirect-workflow",
    version: 1,
    name: "Notes",
    nodes: [
      { id: "gen", type: "image_gen", x: 0, y: 0, width: 400, height: 400, text: null,
        recipe: { prompt: "after", modelKey: null,
          blocks: [
            { kind: "text", text: "before" },
            { kind: "note", nodeId: "note" },
            { kind: "note", nodeId: "gone" },
            { kind: "text", text: "after" },
          ] } },
      { id: "note", type: "text", x: -500, y: 0, width: 200, height: 200, text: "Lighting", recipe: null },
    ],
    edges: [{ sourceNodeId: "note", targetNodeId: "gen", slotField: null }],
  })
  const canvas = importWorkflow(handle.db, "p", source)
  const note = canvas.nodes.find((n) => n.type === "text")!
  const gen = canvas.nodes.find((n) => n.type === "image_gen")!
  expect(JSON.parse(gen.text!).blocks).toEqual([
    { kind: "text", text: "before" },
    { kind: "note", nodeId: note.id },
    // A block for a node that is not in the workflow is dropped, not kept dangling.
    { kind: "text", text: "after" },
  ])
})
```

Run `pnpm vitest run apps/desktop/src/main/repo/workflows.test.ts` → FAIL.

**Step 2: Implement.** In `importWorkflow`: first build
`ids = new Map(workflow.nodes.map((n) => [n.id, randomUUID()]))`
(`import { randomUUID } from "node:crypto"`), then create each node with
`id: ids.get(node.id)` and `text: node.recipe ? JSON.stringify(remapRecipe(node.recipe, ids)) : node.text`,
where

```ts
/** Note blocks name nodes; imported nodes get new ids, so the blocks must too. */
function remapRecipe(recipe: PromptRecipe, ids: ReadonlyMap<string, string>): PromptRecipe {
  if (!recipe.blocks) return recipe
  return {
    ...recipe,
    blocks: recipe.blocks.flatMap((block) => {
      if (block.kind === "text") return [block]
      const nodeId = ids.get(block.nodeId)
      return nodeId ? [{ ...block, nodeId }] : []
    }),
  }
}
```

Edges keep using `ids`. Update the doc comment. Run the file → PASS (all three
tests, including the existing rollback test). `pnpm typecheck && pnpm lint`.

**Step 3: Commit** — `feat(workflows): remap note blocks on import`.

---

### Task 3: `edgesToInputs` reports notes; `useGeneratePlan` takes the rendered prompt

Swap the data path under the existing UI without changing what is sent. After
this task the bar still shows one textarea and the old tray, but the prompt it
submits comes from `renderPromptBlocks(reconcileBlocks(...))`.

**Files:**
- Modify: `apps/web/lib/canvas/edges-to-inputs.ts`
- Modify: `apps/web/lib/canvas/edges-to-inputs.test.ts`
- Modify: `apps/web/hooks/use-generate-plan.ts`
- Modify: `apps/web/lib/mentions/canvas-integration.test.ts`
- Modify: `apps/web/components/canvas/prompt-bar.tsx` (draft type + wiring only)
- Test: `apps/web/components/canvas/prompt-bar.test.tsx` (must stay green)

**Step 1: Update tests first.**
- `edges-to-inputs.test.ts`: replace `promptPrefix` assertions. The test at
  ~line 195 now expects
  `result.notes` toEqual `[{nodeId:"t2",title:"shot on 35mm",text:"shot on 35mm"},{nodeId:"t1",title:"golden hour",text:"  golden hour  "},{nodeId:"t3",title:"Empty note",text:"   "}]`
  (wire order, text untouched, blank notes included). Line ~306: `{ references: [], notes: [] }`.
  Delete the `describe("composePrompt")` block. Add: `incomingNotes` returns the
  same list even when a media edge blocks the run; add `noteTitle` cases
  (multi-line → first line; 40-char line → 32 chars + `…`; blank → `"Empty note"`).
  Existing block-reason tests stay as they are.
- `canvas-integration.test.ts`: replace `composePrompt(inputs.promptPrefix, X)`
  with `renderPromptBlocks(reconcileBlocks({ blocks: undefined, prompt: X, noteIds: inputs.notes.map(n => n.nodeId) }), new Map(inputs.notes.map(n => [n.nodeId, n]))).prompt`.
  Expected strings do not change.

Run both files → FAIL.

**Step 2: `edges-to-inputs.ts`.**
- `IncomingNote` stays defined in `prompt-blocks.ts`; import it here with
  `import type` (cycle-safe). `prompt-blocks.ts` must never import from
  `edges-to-inputs.ts`.
- `CanvasInputs` becomes `{ references: GenerationReference[]; notes: IncomingNote[] }`.
- Add and export:

```ts
/** First non-empty line, at most 32 characters. Notes have no title of their own. */
export function noteTitle(text: string | null): string
/** Every text node wired into `targetNodeId`, in wire order — blocked run or not. */
export function incomingNotes(input: Pick<EdgesToInputsInput, "targetNodeId" | "nodes" | "edges">): IncomingNote[]
```

- In `edgesToInputs`, a text source pushes `{ nodeId, title: noteTitle(text), text: source.text ?? "" }`
  (untrimmed, empty included) instead of into `texts`. Return `{ references, notes }`.
- Delete `PROMPT_PREFIX_SEPARATOR` and `composePrompt`; update the header table
  ("its text, placed by the prompt's blocks, never a slot").
- `grep -rn "PROMPT_PREFIX_SEPARATOR\|composePrompt\|promptPrefix" apps packages --include='*.ts' --include='*.tsx'`
  must return nothing when done.

**Step 3: `use-generate-plan.ts`.**
- Add to `GeneratePlanInput`:
  ```ts
  /**
   * The prompt to resolve and send. The canvas passes its rendered blocks;
   * a container page passes nothing and `draft.prompt` is used.
   */
  prompt?: string
  ```
- `NO_INPUTS = { references: [], notes: [] }`.
- `resolveMentions({ prompt: prompt ?? draft.prompt, ... })`; update the
  memo deps. Remove the `composePrompt` import. Nothing else changes (⛔ `run`
  still called once per click).
- `apps/web/components/create/generate-form.tsx` passes no `inputs`/`prompt` —
  confirm it still typechecks unchanged.

**Step 4: `prompt-bar.tsx` wiring (behaviour-preserving).**
- `PromptDraft` gains `blocks?: DraftBlock[]`; `EMPTY_DRAFT.blocks = undefined`;
  `seedPromptDraft` sets `blocks: undefined`.
- `readPromptRecipe`: unchanged logic; `promptRecipeSchema.parse(current)`
  already strips ids.
- In `PromptBar`:
  ```ts
  const notes = useMemo(() => incomingNotes({ targetNodeId: node.id, nodes: canvas.nodes, edges: canvas.edges }), [canvas.edges, canvas.nodes, node.id])
  const notesById = useMemo(() => new Map(notes.map((n) => [n.nodeId, n])), [notes])
  const blocks = useMemo(() => reconcileBlocks({ blocks: draft.blocks, prompt: draft.prompt, noteIds: notes.map((n) => n.nodeId) }), [draft.blocks, draft.prompt, notes])
  const rendered = useMemo(() => renderPromptBlocks(blocks, notesById), [blocks, notesById])
  ```
  and pass `prompt: rendered.prompt` to `useGeneratePlan`.
- Add a helper used by every block edit (Task 4 uses it):
  ```ts
  const editBlocks = useCallback((edit: (current: DraftBlock[]) => DraftBlock[]) => {
    updateDraft((current) => {
      const base = reconcileBlocks({ blocks: current.blocks, prompt: current.prompt, noteIds })
      const next = edit(base)
      return { ...current, blocks: next, prompt: textOfBlocks(next) }
    })
  }, [noteIds, updateDraft])
  ```
  (`noteIds` memoised from `notes`.) For now the single textarea's `onChange`
  still writes `prompt` only while `draft.blocks` is undefined — i.e. leave it
  as is; Task 4 replaces it.
- Save prompt: persist `{ ...draft, blocks: draft.blocks ? blocks : undefined }`
  (a legacy draft stays legacy until the user rearranges something).

**Step 5:** Run
`pnpm vitest run apps/web/lib/canvas apps/web/lib/mentions apps/web/components/canvas apps/web/hooks`
→ all PASS (the prompt-bar tests prove nothing sent changed). Then
`pnpm typecheck && pnpm lint`.

**Step 6: Commit** — `refactor(canvas): notes by id instead of a prompt prefix`.

---

### Task 4: `PromptBlocks` — the block list, drag and drop, canvas hover

**Files:**
- Create: `apps/web/components/canvas/prompt-blocks.tsx`
- Create: `apps/web/components/canvas/prompt-blocks.test.tsx`
- Modify: `apps/web/components/canvas/mention-textarea.tsx` (two optional props)
- Modify: `apps/web/components/canvas/canvas-context.tsx` (two optional surface actions)
- Modify: `apps/web/components/canvas/canvas.tsx` (implement them)
- Modify: `apps/web/app/react-flow.css` (highlight style)
- Modify: `apps/web/components/canvas/prompt-bar.tsx` (replace the textarea; AI helper edits)
- Modify: `apps/web/components/canvas/prompt-bar.test.tsx`

**Component contract:**

```ts
export interface PromptBlocksProps {
  blocks: readonly DraftBlock[]
  notesById: ReadonlyMap<string, IncomingNote>
  subjects: readonly MentionSubject[]
  /** Every edit goes through here; PromptBar's `editBlocks`. */
  onEdit: (edit: (current: DraftBlock[]) => DraftBlock[]) => void
  /** ✕ on a note: delete the wire note → this node. Reconcile drops the block. */
  onDisconnect: (noteNodeId: string) => void
}
```

**Behaviour (design §2.2, §4):**
- `<ol aria-label="Prompt blocks">` inside its own `DndContext`
  (`PointerSensor` with `activationConstraint: { distance: 4 }`,
  `KeyboardSensor` with `sortableKeyboardCoordinates`, `closestCenter`,
  `verticalListSortingStrategy`). `onDragEnd` → `onEdit(b => moveBlock(b, active.id, over.id))`.
  Drop indicator: a 2px `bg-primary` line on the `over` item (use `isOver`/
  `index` from `useSortable`), not the default transform-only feedback.
  `accessibility.announcements` produce e.g. "Note 2, Lighting, moved to
  position 4 of 6" / "Text block moved to position 2 of 6".
- Each `<li data-block-id data-kind>` has a **⋮⋮ handle button** (Hugeicons
  `DragDropVerticalIcon` or similar; `aria-label="Move note 2"` / `"Move text block"`),
  absolutely positioned left, `opacity-0 group-hover:opacity-100 focus-visible:opacity-100`;
  dnd-kit `listeners`/`attributes` go on the handle only, so textareas keep
  their own mouse and keyboard.
- **Note block**: `button`-like row (`role="button"`, `tabIndex=0`,
  `aria-expanded`), classes `text-muted-foreground/70`, number badge
  (1-based among notes), link icon + `title` (font-medium), body (`truncate`
  collapsed, `whitespace-pre-wrap` expanded), word count `Nw` (mono). Click or
  Enter toggles expand. Empty note shows "Empty — adds nothing" in italics.
  Hover actions: **+** (`aria-label="Insert text below"`; inserts
  `newTextBlock()` after it and focuses its textarea) and **✕**
  (`aria-label="Disconnect <title>"`; calls `onDisconnect(nodeId)`).
  `Delete`/`Backspace` on the *focused note row itself* also disconnects.
  `onMouseEnter/Leave` → `surface?.highlightNote?.(nodeId | null)`;
  `onDoubleClick` → `surface?.selectNode?.(nodeId)`. Clear the highlight on
  unmount.
- **Text block**: `MentionTextarea` with the block's text; label per Decision 4;
  placeholder `"Type here, or drag a note in…"` for the last block, `"Type…"`
  otherwise; auto-grows (`field-sizing-content` class, `min-h-8`, no max so the
  bar grows downward; cap at `max-h-64` with scroll). Enter inserts a newline
  (default textarea behaviour — do not intercept). Backspace at caret 0 in an
  empty block → `onEdit(b => mergeIntoPrevious(b, id).blocks)` then focus the
  returned id's textarea at its end. Text blocks also get the hover **+**.
- Focus management: keep a `Map<id, HTMLTextAreaElement>` of refs; a
  `pendingFocus` ref applied in `useLayoutEffect` after blocks change.

**`MentionTextarea` change (minimal, backwards compatible):** add optional
`onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void` (called only
when the mention picker did not handle the key) and
`textareaRef?: Ref<HTMLTextAreaElement>` (merged with its internal `ref`).
Existing `mention-textarea.test.tsx` must stay green.

**Canvas surface:** in `canvas-context.tsx` add to `CanvasSurface`:

```ts
  /** The composer is pointing at this note: light it and its wire up. Null clears. */
  highlightNote?: (nodeId: string | null) => void
  /** Select one node, e.g. a note double-clicked in the composer. */
  selectNode?: (nodeId: string) => void
```

In `canvas.tsx`: `selectNode` = `setSelectedNodes([id]); setSelectedEdges([])`
(like `selectGeneration`). `highlightNote` sets `highlightedNote` state; an
effect finds the edge(s) from that note to the selected generate node, and
toggles `data-prompt-highlight` on
`wrapper.current?.querySelector(\`.react-flow__node[data-id="${CSS.escape(id)}"]\`)`
and each `.react-flow__edge[data-id="…"]`, removing it in cleanup. (Verify in
the browser devtools / a test that xyflow 12 renders `data-id` on edge `<g>`s;
if it does not, fall back to `[data-testid="rf__edge-<id>"]`.) Add both to the
`actions` ref and the `surface` memo. CSS in `react-flow.css`:

```css
.react-flow__node[data-prompt-highlight] { outline: 2px solid var(--ring); outline-offset: 2px; border-radius: var(--radius); }
.react-flow__edge[data-prompt-highlight] path { stroke: var(--primary); stroke-width: 2.5; }
```

**PromptBar changes:** replace the `<MentionTextarea aria-label="Prompt" …>`
with `<PromptBlocks blocks={blocks} notesById={notesById} subjects={subjects} onEdit={editBlocks} onDisconnect={…} />`.
`onDisconnect` = `deleteEdges.mutate(incomingEdges(canvas.edges, node.id).filter(e => e.sourceNodeId === id).map(e => e.id))`
(`useDeleteCanvasEdges` from `@/hooks/use-canvas`). AI helper per Decision 5:
Apply → `editBlocks(b => replaceText(b, text))`; `appendToPrompt` →
`editBlocks(b => appendText(b, text))`. "Improve prompt" still reads
`draft.prompt`. (The old tray still draws note chips until Task 5; that is fine.)

**Tests — `prompt-blocks.test.tsx`** (render `PromptBlocks` directly with a
`CanvasSurfaceProvider` whose actions are `vi.fn()`s, and a tiny harness that
holds `blocks` in `useState` and applies `onEdit`):
1. Renders notes dimmed with number, title, word count; clicking a note
   toggles `aria-expanded`.
2. Typing in a middle text block edits only that block.
3. **+** on a note inserts an empty text block after it and focuses it.
4. ✕ calls `onDisconnect` with the note's node id; Delete on a focused note row
   does too; Backspace inside a text block never does.
5. Backspace in an empty middle text block removes it and focuses the previous
   text block.
6. Keyboard reorder (pattern from `container-screen.test.tsx`: mock
   `getBoundingClientRect` by `li[data-block-id]` index with vertical offsets,
   focus the note's handle, `" "`, `{ArrowDown}`, `" "`) moves the note below
   the next block.
7. Hovering a note calls `highlightNote(nodeId)`, leaving calls
   `highlightNote(null)`; double-click calls `selectNode(nodeId)`.

**Tests — `prompt-bar.test.tsx`** (existing fixture already has a text edge and a
media edge): add
- "sends notes and text in block order": drag (keyboard) the note below the
  typed text, Run, and assert the submitted `request.prompt` is
  `"<typed>\n\n<note text>"` (was note first).
- "✕ on a note deletes its edge": expect an `invoke` call to the canvas edge
  delete channel with the text edge's id (look up the channel name used by
  `useDeleteCanvasEdges` in `apps/web/hooks/use-canvas.ts`).
- Update the AI-helper test if Apply's expectations change (Apply now keeps
  notes; with the fixture's note the textarea labelled "Prompt" holds the
  answer).

Run `pnpm vitest run apps/web/components/canvas` → PASS;
`pnpm typecheck && pnpm lint`.

**Commit** — `feat(canvas): prompt as draggable note and text blocks`.

---

### Task 5: `CanvasReferenceStrip` — per-slot groups, `+N`, inline gallery

**Files:**
- Modify (rewrite the tray part): `apps/web/components/canvas/reference-tray.tsx`
- Modify: `apps/web/components/canvas/reference-tray.test.tsx`
- Modify: `apps/web/components/canvas/prompt-bar.tsx` (use the strip)
- Modify: `apps/web/components/canvas/prompt-bar.test.tsx`

Keep `mentionNote` and `MentionNotes` exactly as they are (and their tests).
Keep `browse`/`confirm`/`ReferencePicker` logic (the `+` still creates media
nodes and edges). Rename `ReferenceTray` → `CanvasReferenceStrip`,
`data-testid="canvas-reference-strip"`.

**Pure helper (export it and unit-test it in the same test file):**

```ts
export interface StripGroup {
  /** The slot, or null for the "Unassigned" group. */
  slot: ReferenceSlot | null
  items: StripItem[]          // edge thumbs (wire order) then mention images
  capacity: number | null      // slotCapacity(slot); null = unlimited/unknown
  full: boolean                // remainingCapacity(...) === 0
}
export function groupStrip(node, canvas, slots, mentions): StripGroup[]
```

Text edges are **not** included (they are blocks now). Edges with null or
undeclared `slotField` → the "Unassigned" group (Decision 7). Mention images go
in their `slotField` group.

**Rendering (design §2.1, §2.4):**
- One row: groups left, a quiet `"<N> images"` total (`text-xs text-muted-foreground ml-auto`) right.
- `slots.length > 1` or an Unassigned group present → each group gets an
  uppercase `text-[10px] font-semibold tracking-wide text-muted-foreground`
  heading `"<label> <count>"`, plus `"<count> / <max>"` when the slot has a
  finite `max` (e.g. `12 / 12`). One slot → no heading.
- Per group: if `items.length <= 4` show all; else show 3 then a
  `+<items.length-3>` button (`aria-label="Show all <N> <label>"`, mono,
  `h-10 min-w-12`). Thumbnails keep the existing look (problem ring, ✕
  disconnect on hover for edge thumbs, dashed ring + `@handle` for mentions).
  Clicking a thumbnail or `+N` opens the gallery for that group.
- Per slot a `+` add button; when full it is `disabled` and wrapped in a
  `Tooltip` saying `"<label> is full (<max> / <max>)"` (wrap the disabled button
  in a `span` so the tooltip still fires, like `run-wrapper` in prompt-bar).
- **Gallery** (inline, below the strip, not a modal; `role="region"`,
  `aria-label="<label> gallery"`): header `"<label> · <count> · sent as <field>"`
  (field in mono) and a **Done** button; body is a `grid
  grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1 max-h-52 overflow-auto`
  of every item, numbered in send order. Only one gallery open at a time.
  Expose `openGallery(slotField)` via a prop so the Full prompt panel's chips
  can open it: make the strip controlled — props `galleryFor: string | null`
  and `onGalleryChange(field | null)`; `PromptBar` owns the state. Use the
  string `"__unassigned"` for the Unassigned group.

**PromptBar:** swap `ReferenceTray` for `CanvasReferenceStrip`, add
`const [galleryFor, setGalleryFor] = useState<string | null>(null)`. Leave
placement inside the current controls row for now; Task 7 moves it.

**Tests (`reference-tray.test.tsx`):**
- `groupStrip`: one slot; two slots with headings; unassigned edges; mention
  image counted in its slot; text edges excluded.
- 100 edges into one slot → exactly 3 `reference-thumb`s plus a `+97` button;
  clicking it shows a gallery region with 100 items and "sent as
  reference_images"; Done closes it.
- 4 edges → 4 thumbs, no `+N`.
- A slot with `max: 2` and 2 edges shows `2 / 2` and a disabled add button.
- Existing mention tests keep passing (update `render(<ReferenceTray …>)` →
  `CanvasReferenceStrip` with `galleryFor={null} onGalleryChange={vi.fn()}`).

`prompt-bar.test.tsx`: the old "shows one thumbnail per incoming edge, labelled
with its slot" test changes to: the media edge shows one thumbnail; the text
edge shows **no** thumbnail (it is a note block instead). Run
`pnpm vitest run apps/web/components/canvas` → PASS; typecheck; lint.

**Commit** — `feat(canvas): per-input reference strip with an inline gallery`.

---

### Task 6: `FullPromptPanel` — exactly what gets sent

**Files:**
- Create: `apps/web/components/canvas/full-prompt-panel.tsx`
- Create: `apps/web/components/canvas/full-prompt-panel.test.tsx`
- Modify: `apps/web/components/canvas/prompt-bar.tsx` (render it + toggle state)
- Modify: `apps/web/components/canvas/prompt-bar.test.tsx`

**Contract:**

```ts
export interface FullPromptPanelProps {
  /** `useGeneratePlan().mentions.prompt` — resolved, the string the provider receives. */
  prompt: string
  /** Ranges into `prompt`, already mapped through mentions, tagged with block kind. */
  segments: { start: number; end: number; kind: "note" | "text" }[]
  noteCount: number
  /** One chip per slot that will carry images: field + count. */
  inputs: { field: string; label: string; count: number }[]
  onOpenInput: (field: string) => void
}
```

**Behaviour (design §2.3):**
- Header row: `EXACTLY WHAT GETS SENT` (uppercase xs muted), stats
  `"<chars> chars · <words> words · <notes> notes · <images> images"` (mono xs),
  a native checkbox **Highlight notes** (default on; local state), and a
  **Copy** ghost button (`navigator.clipboard.writeText(prompt)`, label flips to
  "Copied" for 1.4s; swallow errors).
- Prompt box: `font-mono text-xs whitespace-pre-wrap rounded-md border bg-muted/40 p-2 max-h-60 overflow-auto`,
  `data-testid="full-prompt"`. Render `prompt` as spans cut at segment
  boundaries; note segments get `data-from-note` and, when highlighting,
  `bg-primary/10 text-foreground` (text segments plain). Separators between
  segments are plain text. Empty prompt → muted "Nothing yet — type or connect a note."
- Images: a chip per `inputs` entry, `"<field> × <count>"` (field mono),
  clicking calls `onOpenInput(field)`. No chips → hide the row.

**PromptBar wiring:**
- `segments` = `mapRangesThroughMentions(rendered.prompt, rendered.ranges, mentions.outcomes)`
  zipped with `blocks[range.blockIndex].kind`.
- `inputs` from the strip's groups (reuse `groupStrip`, excluding Unassigned
  and empty groups): field, label, count (edges + mentions).
- Module-level preference (Decision 8) in `prompt-bar.tsx`:
  ```ts
  let fullPromptPreference: boolean | null = null
  ```
  `const [open, setOpen] = useState(() => fullPromptPreference ?? notes.length > 0)`;
  the toggle sets both. Reset it in `clearPromptDrafts()`.
- The **Full prompt** toggle is a ghost `Button` with an eye icon,
  `aria-pressed={open}`, `aria-controls` the panel id. Put it next to Advanced
  in the current row for now; Task 7 finalises placement.
- `onOpenInput` → `setGalleryFor(field)`.

**Tests (`full-prompt-panel.test.tsx`):** stats count correctly
(e.g. `"ab cd\n\nef"` → `9 chars · 3 words`); note segments carry
`data-from-note` and lose the highlight class when the checkbox is unchecked;
Copy writes the exact prompt (stub `navigator.clipboard`); a chip click calls
`onOpenInput("reference_images")`.

**Tests (`prompt-bar.test.tsx`):**
- With the fixture's note connected, the panel is open on first render and
  `getByTestId("full-prompt")` has text content equal to the submitted
  `request.prompt` after Run.
- Typing `a shot of @venkz` (reuse the existing mention fixture) shows the
  **substituted** text in the panel, not `@venkz`, and the note segment is
  still marked `data-from-note`.
- After toggling it closed, unmounting and mounting the bar for another node
  that also has a note keeps it closed (the preference is per window). The
  `beforeEach` that calls `clearPromptDrafts()` resets it between tests.

Run canvas tests; typecheck; lint. **Commit** — `feat(canvas): full prompt panel`.

---

### Task 7: PromptBar layout — one card, one toolbar row that never wraps

Final assembly to match the mockup and design §2.1.

**Files:**
- Modify: `apps/web/components/canvas/prompt-bar.tsx`
- Modify: `apps/web/components/canvas/prompt-bar.test.tsx`
- Modify: `apps/web/components/canvas/settings-popover.tsx` only if the overflow footer needs the Full prompt/cost items (probably not)

**Layout, top to bottom, inside the existing stated-width card
(`w-[min(52rem,calc(100vw-4rem))]`, keep it):**
1. `CanvasReferenceStrip` (hide the strip entirely when there are no slots, no
   edges and no mentions), separated by a bottom border.
2. The gallery (rendered by the strip, directly under it).
3. `PromptBlocks`.
4. Unknown-cost acceptance label (existing), just above the toolbar.
5. **Toolbar** `data-testid="prompt-bar-controls"`:
   `flex flex-nowrap items-center gap-1.5 border-t pt-2 min-w-0`. Order:
   `ModelPicker` (w-44 shrink-0) · `SettingsPopover` · Advanced · HelperMenu ·
   **Full prompt** toggle · (not narrow) count stepper, runs label, cost ·
   `ml-auto` · **Save** icon button (`aria-label="Save prompt"`, bookmark icon,
   tooltip "Save prompt and settings to this node") · **Run**. Every child
   `shrink-0`; Run is last. Narrow (`useIsMobile`) keeps moving count + cost
   into the settings popover footer, as today.
6. `FullPromptPanel` when open.
7. Messages exactly as today, below everything: `MentionNotes`, notice, error,
   blocked reason (bar is anchored by its top edge).
- Delete the header line ("Compose · select references · review cost · run")
  and its row; the Save button moves into the toolbar.
- Update the file header comment (drafts now hold blocks; the tray is a strip;
  the full prompt panel exists). Keep every `⛔` note.

**Tests (`prompt-bar.test.tsx`):**
- "toolbar never wraps": `getByTestId("prompt-bar-controls")` has class
  `flex-nowrap`, not `flex-wrap`, and contains the model picker, the Full
  prompt toggle and Run, with Run as its last element child (jsdom cannot
  measure; the class and DOM order are the contract). Run it with
  `useIsMobile` true and false (the existing narrow test shows how).
- "no header line": `queryByText(/Compose · select references/)` is null.
- Save is an icon button labelled "Save prompt" and the existing
  "persists the complete recipe" test still passes; extend it: after dragging a
  note below the text (or with `seedPromptDraft`-free draft edits), the saved
  JSON contains `blocks` with `{ kind: "note", nodeId: <note id> }` and no `id`
  keys.
- "puts a blocked-run message below the controls" and "keeps one stated
  width" still pass unchanged.
- "⛔ submits nothing a second time while the first is in flight" unchanged.

**Final verification (whole repo, same as CI):**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
git status --short   # pnpm-lock.yaml must not appear
```

All must pass. Then run the app (`pnpm dev:desktop`) and check against the
mockup: note wired in shows as a dimmed block; drag it below text; Full prompt
shows the resolved prompt; 100 references collapse to 3 + `+97`; the toolbar
stays one row at the bar's minimum width.

**Commit** — `feat(canvas): prompt composer layout`.
