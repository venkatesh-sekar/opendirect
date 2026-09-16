# Canvas UX findings — referencing, batch display, popovers, perceived speed

Investigation only. No generation was submitted and no provider API was
called; every schema claim below is read from a recorded fixture in
`test/fixtures/` or from the code itself.

---

## 1. Referencing does not work — the edge never gets a slot

### What the user saw

A media node (uploaded headshot) wired into a fresh `image_gen` node whose
prompt bar has `nano-banana-2` selected. The edge label reads **"No slot"**,
the tray thumbnail reads **"No slot"**, and the bar shows
*"A connection has no input slot. Choose the slot it feeds from the edge
label."*

### Root cause

`firstFreeSlot` is called with an empty slot list, because the canvas asks the
**node's stored generation** for the model key and a node that has never run
has no generation. The model the user picked in the prompt bar is draft state
that lives in a module map keyed by node id, and nothing on the edge path can
see it.

The chain, in order:

- `apps/web/components/canvas/canvas.tsx:124-126` —
  ```ts
  function modelKeyOfNode(node: CanvasNodeDto | undefined): string | null {
    return node?.generation ? modelKeyOf(node.generation) : null
  }
  ```
  For an unrun generate node `node.generation` is `null`, so this is `null`.
- `apps/web/components/canvas/canvas.tsx:303-322` — `slotFor()` calls
  `modelKeyOfNode(target)`, and at `:306-307` returns `null` immediately when
  the key is null. No descriptor is fetched, `firstFreeSlot` is never reached.
- `apps/web/components/canvas/canvas.tsx:335` — `connect()` therefore writes
  the edge with `slotField: null`.
- `apps/web/lib/canvas/edges-to-inputs.ts:156-163` — that null is later the
  `unresolved-slot` block, whose message is exactly the red text in the
  screenshot.
- `apps/web/components/canvas/prompt-bar.tsx:243-252` and `:664` — the model the
  user actually chose lives in `PromptDraft.modelKey`, in the module-level
  `drafts` map (`prompt-bar.tsx:143`). It is never written to the node row
  and never read by `canvas.tsx`.

### Secondary effect: the edge label cannot rescue it either

`flowEdges` passes the same `modelKeyOfNode(...)` as `data.targetModelKey`
(`canvas.tsx:193`). `ReferenceEdge` feeds that to `useModel`
(`edges/reference-edge.tsx:149`), gets `null`, and the slot menu renders
*"This node has no model yet, so it declares no input slots."*
(`reference-edge.tsx:96-101`). So the error tells the user to fix the slot
from the edge label, and the edge label offers no slots to choose. That is the
dead end the screenshot shows.

### Nothing else is at fault — ruled out with evidence

- **Slot detection works.** `test/fixtures/replicate/model-nano-banana-2.json`
  declares `image_input` as `{ type: "array", items: { format: "uri" } }`.
  `deriveReferenceSlots` (`apps/desktop/src/main/providers/reference-slots.ts:146-165`)
  classifies it as a slot via `isUriArray` (`:74-79`), `kind: "image"` via the
  `/image|photo|picture|frame|plate/i` hint (`:55-59`), and
  `role: "reference"` via the `^(image|images|input_image|input_images|
  image_input|subject_image)$` hint (`:37-40`). Given that slot,
  `firstFreeSlot` would return `"image_input"` on the first edge.
- **Capacity is not the problem.** `image_input` is `multiple: true` with no
  `maxItems` and no "up to N" in its description, so `slotCapacity` is
  `Infinity` (`apps/web/lib/canvas/slots.ts:24-27`).
- **Kind matching is not the problem.** A media node with an image asset gives
  `contributedKind === "image"` (`slots.ts:37-43`), which `accepts` matches
  against `kind: "image"` (`slots.ts:45-51`).
- **`match_input_image` does not interfere.** It is the `aspect_ratio`
  default in the fixture. It only reaches `parseAspectRatio`, which returns
  null and deliberately leaves the frame alone (`prompt-bar.tsx:473-486`). It
  touches no slot code.
- **Timing/race is not the primary cause.** `slotFor` *does* `await
  client.fetchQuery(modelDescriptorQuery(key))` (`canvas.tsx:310`), so a
  descriptor that has not loaded yet would still be awaited. The fetch is
  simply never started.
- **Nothing repairs the edge later.** `grep slotField` across
  `apps/web/hooks`, `apps/desktop/src/main/canvas-service.ts` and
  `repo/canvas.ts` finds only the explicit `canvas:edge:update` path
  (`canvas-service.ts:125`, `repo/canvas.ts:361-365`) driven by the edge
  label. Choosing a model in the bar never re-runs slot assignment.

### Recommended fix

Make the node's chosen model a property of the node, not of an in-memory
draft, and derive slots from it.

1. **Persist `modelKey` on `canvas_nodes`.** Add a nullable `modelKey` column
   (`apps/desktop/src/main/db/schema.ts`), expose it on `canvasNodeSchema`
   (`packages/contract/src/canvas.ts`) and on `canvasNodePatchSchema`, and let
   the existing `canvas:node:update` write it — no new channel. This is the
   same shape as the existing `batchId`/`pickAssetId` patch already used at
   `prompt-bar.tsx:436-448`, so it is one column plus one migration step in
   `canvas-migrate.ts`.
2. **Write it from the prompt bar** in `ModelPicker.onChange`
   (`prompt-bar.tsx:658-663`): update the draft *and* `updateNode.mutate({ id,
   patch: { modelKey } })`. Seed it the same way `defaultModelKey` is seeded
   (`prompt-bar.tsx:243-252`), and on `branch` (`canvas-context.tsx:60`).
3. **Read it in `modelKeyOfNode`** (`canvas.tsx:124`):
   `node.modelKey ?? (node.generation ? modelKeyOf(node.generation) : null)`.
   That single line fixes both the auto-assignment (`slotFor`) and the edge
   label's slot menu (`data.targetModelKey`), since both already go through
   this function.
4. **Re-resolve unresolved edges when a model is chosen.** In the bar's
   existing model-change effect (the one at `prompt-bar.tsx:314-338` that
   reseeds params), also walk `incomingEdges(canvas.edges, node.id)` and, for
   every edge whose `slotField` is `null` and whose source is not a text node,
   call `useUpdateCanvasEdge` with `firstFreeSlot({...})`. Reuses
   `lib/canvas/slots.ts` and `useUpdateCanvasEdge` unchanged — no new module.
5. **Cheap safety net (do this even if 1-4 slip):** in `slotFor`
   (`canvas.tsx:303`), when `modelKeyOfNode` is null fall back to
   `defaultModelKey` (already computed in `CanvasSurfaceInner` and passed to
   the bar at `canvas.tsx:942`). It makes the common case — default model, drag
   an edge — work immediately.

---

## 2. Batch node shows a 3x2 grid instead of a hero + filmstrip

### Current implementation

- `apps/web/lib/canvas/batch-view.ts:99-138` — `batchTiles()` produces one
  `BatchTile` per output asset, plus one tile per sibling that has no output
  yet (progress or failure). It is order-stable and already carries everything
  a hero view needs (`asset`, `state`, `progress`, `error`, `jobId`).
- `apps/web/lib/canvas/batch-view.ts:178-182` — `pickableAssets()` already
  returns exactly the succeeded tiles, i.e. the candidates for the hero.
- `apps/web/components/canvas/nodes/generate-node.tsx:441` — the grid shape:
  ```ts
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(tiles.length))))
  ```
  Five tiles → `ceil(sqrt(5)) = 3` → the 3x2 grid in the screenshot (5 tiles,
  one empty cell).
- `generate-node.tsx:443-467` — a single CSS-grid `div` with
  `gridTemplateColumns: repeat(columns, minmax(0,1fr))`, every tile rendered
  at equal size, the pick marked only by a `ring-2 ring-primary` and a tick
  badge (`generate-node.tsx:294-308`).
- The pick already exists as data: `node.pickAssetId`, defaulted to the first
  successful output at `generate-node.tsx:387-395`, changed by
  `surface.pick(...)` at `:397-403`.

So the *data* for "one big one, N options" is already correct. Only the
layout in `GenerateNodeBody` treats all tiles as equal.

### What needs to change

Replace the uniform grid at `generate-node.tsx:443-467` with a hero + strip
layout. No new library needed; the pieces exist.

- **Hero.** The tile whose `asset.id === node.pickAssetId`, falling back to the
  first succeeded tile. Render the existing `ResultTile` (unchanged — it
  already carries the context menu, compare, details, pick-on-click) in a
  `flex-1 min-h-0` box.
- **Filmstrip.** A `shrink-0 overflow-x-auto flex gap-1 p-1` row of the other
  tiles at a fixed height (~40-48px), each still a `ResultTile` so the actions
  and the pick semantics are identical. Add `nowheel` (already used on the
  grid at `:446`) so the strip scrolls without zooming the canvas.
- **Counter.** `1 of 5`, computed from the hero's index in `tiles`; put it in
  the node header via `NodeFrame`'s existing `actions`/title slot
  (`generate-node.tsx:529-544`) or as an absolutely positioned badge over the
  hero, matching the tick badge styling at `:304-308`.
- **Dots** are only worth it for small batches; the filmstrip plus `N of M`
  already answers "there are more". If dots are wanted, render them when
  `tiles.length <= 6` instead of the strip.
- **Keep failures visible.** A failed sibling must not be hidden behind the
  hero: keep `FailedTile`/`PendingTile` in the strip (they already render at
  any size) and keep the "No pick selected" status line at
  `generate-node.tsx:469-476`.
- **Small node sizes.** Below roughly 220px of node height the strip should
  collapse to the counter only — the frame is aspect-ratio sized
  (`lib/canvas/layout.ts`), so a container query or a simple height threshold
  on the node row (`node.height`) is enough.
- **Put the choice in `batch-view.ts`, not the component.** Add a pure
  `heroAndRest(tiles, pickAssetId): { hero: BatchTile | null; rest:
  BatchTile[]; index: number }` next to `pickableAssets`, so it is unit-tested
  the same way the rest of the module is (`apps/web/lib/canvas/batch-view.ts`
  has no React import and should keep it that way).

---

## 3. Popovers and the prompt bar shift when opened

There are four separate causes. The first is the big one.

### 3a. The bar is centre-anchored, so any width change moves everything

`PromptBar` is rendered inside React Flow's `NodeToolbar` with
`position={Position.Bottom}` (`canvas.tsx:932-945`). React Flow computes that
transform in `getNodeToolbarTransform`
(`@xyflow/system` `dist/esm/index.js:1547-1576`): for `Position.Bottom` with
the default `align: "center"` the shift is `translate(-50%, 0)` about the
node's horizontal centre.

The bar has **no fixed width** — `flex max-w-[52rem] flex-col`
(`prompt-bar.tsx:573`) over a `flex flex-wrap` row (`:599`) of
content-sized children. So every one of these changes its width and therefore
slides the whole bar sideways by half the delta:

- the model chip's label switching from `"Model"` to the model's name
  (`model-picker.tsx:212-214`, `truncate` but auto-width);
- the settings chip's summary text, e.g. `1K · 16:9` (`settings-popover.tsx:185`);
- the `Advanced` count badge appearing (`prompt-bar.tsx:695-699`);
- the cost badge going from pending to a figure, and the `N runs` label
  appearing/disappearing (`prompt-bar.tsx:550-559`);
- the textarea, which is `resize-y` and `flex-1 min-w-48` (`prompt-bar.tsx:617`) —
  the user can drag it and `max-h-32` lets it grow.

**Fix:** give the bar a stable width instead of letting content set it —
`w-[min(52rem,calc(100vw-4rem))]` in place of `max-w-[52rem]` at
`prompt-bar.tsx:573` — and switch the toolbar to `align="start"` so it grows
rightwards from a fixed left edge rather than about its centre. Also give the
model chip and settings chip fixed widths (`w-40` / `w-32` with the existing
`truncate`) so their labels cannot move their neighbours.

### 3b. The error pushes the row down

`prompt-bar.tsx:571-597` puts `notice`, `submission.error` and `blockedReason`
as siblings *above* the control row inside a `flex-col`. Adding one of them
grows the bar upward in content terms but, because the toolbar is anchored at
the node's bottom edge (`shift[1] = 0` in the transform above), the row is
pushed **down** — exactly the screenshot, where the red sentence sits above
the controls and the controls have moved.

**Fix:** move the messages *below* the control row so the row keeps its
position, and reserve nothing when there is no message. If the message must
stay on top, render it in an absolutely positioned block (`absolute
bottom-full mb-1 left-0`) so it does not participate in the bar's flow at all.
Both are one-line CSS changes; the `role="alert"` markup stays.

### 3c. `useIsMobile` reflows the bar one frame after mount

`prompt-bar.tsx:513` uses `useIsMobile()` (`packages/ui/src/hooks/use-mobile.ts:5-17`).
It starts `undefined` → returns `false`, then flips in an effect. When the
window is narrow, the count stepper and the cost badge jump from the row into
the settings popover's footer (`prompt-bar.tsx:706-718`) one frame after the
bar mounts — a visible jolt every time the selection moves to another node.
It also measures the **window**, not the space the bar actually has, which on
a canvas is the wrong quantity entirely.

**Fix:** either read the breakpoint synchronously with
`useSyncExternalStore(subscribe, () => window.matchMedia(q).matches, () =>
false)` in `use-mobile.ts`, or — better for this surface — drop the
window-width test and always keep the overflow in the popover, or use a CSS
container query on the bar itself so no JS state is involved.

### 3d. The popovers themselves

`packages/ui/src/components/popover.tsx` uses Base UI (`@base-ui/react`
`^1.8.0`), and it *is* portalled (`Popover.Portal` at `:28`), so inline
rendering is not the problem. But `Positioner` is passed only
`align`/`alignOffset`/`side`/`sideOffset` (`popover.tsx:29-35`): no
`collisionPadding`, no `sticky`, no `collisionAvoidance` tuning. With
`sticky` off, a popup near the viewport edge flips side rather than sliding,
which reads as a jump. And Base UI tracks the anchor by default, so every
width change from 3a re-positions any open popup in the same frame.

Compounding it, the popup widths are content-derived:
`settings-popover.tsx:189` uses `w-auto min-w-64`, and its content changes
with the model's grid rows; `reference-edge.tsx:95` uses `w-56` but its body
swaps between a paragraph and a list of buttons.

**Fix:** pass `collisionPadding={8}` and `sticky` through `PopoverContent` to
the `Positioner` in `packages/ui/src/components/popover.tsx` (both are
first-class Base UI props — no custom positioning code), and give the settings
popover a fixed `w-80` instead of `w-auto min-w-64`.

---

## 4. Everything feels slow to open

### Not the cause (checked)

- **The model list is not re-fetched on open.** `useModels` has
  `staleTime: Infinity` and is only invalidated by the explicit refresh
  mutation (`apps/web/hooks/use-models.ts:38-45, 48-59`). Same for
  `useRecommendedModels` (`:61-70`) and `modelDescriptorQuery` (`:82-88`).
- **Cost is not estimated per keystroke.** `costParams` deletes the prompt
  field before the key is built (`apps/web/lib/create/request.ts:172-174`), and
  the query key is structurally hashed (`hooks/query-keys.ts:50-51`), so typing
  does not produce IPC. Correct as written.
- **Prompt state does not live in a context.** Drafts are a module map read
  through `useSyncExternalStore` (`prompt-bar.tsx:143, 183-199`), and only
  `PromptBar` subscribes. A keystroke does not re-render the React Flow graph.

### Actual causes

**a. The picker mounts the entire catalog at once, unvirtualized.**
`model-picker.tsx:256-329` renders every model as a `CommandItem` inside
`CommandList`, across four groups, each row building a `Badge`, a
`formatPriceHint` call and (for recommended rows) a `Map` lookup. The popup is
unmounted while closed, so *opening* pays the full mount cost, and `cmdk`
(`packages/ui/src/components/command.tsx:4`, `cmdk ^1.1.1`) then scores every
item on mount and re-scores all of them on every keystroke — with
`shouldFilter` left at its default and no `limit`. The catalog is the union of
six Replicate seed collections plus OpenRouter
(`apps/desktop/src/main/providers/replicate.ts:78-85, 444-457`), i.e. low
hundreds of rows today and unbounded in principle.

*Fix:* keep `cmdk` for the keyboard/filter behaviour and virtualize the list —
`@tanstack/react-virtual` over the filtered rows (TanStack Query is already a
dependency, so the family is familiar), or cap what is rendered until the user
types (`recommended + first 50`, then filter). Also memoize `group()`,
`video`, `image` and `other` (`model-picker.tsx:182-193`) — they are plain
`.filter()` calls in the render body and re-run on every keystroke and every
parent render.

**b. Hotkeys are re-registered on every prompt-bar render.**
`prompt-bar.tsx:664` passes `kinds={kindsFor(node)}`, which allocates a new
array each render (`prompt-bar.tsx:202-204`). `ModelPicker` puts that array in
a `useHotkeys` dependency list (`model-picker.tsx:153`), so every keystroke
tears down and re-binds the ⌘R handler.
*Fix:* `useMemo` `kindsFor(node)` on `node.type` in the bar, and depend on
`kinds` by value in the picker.

**c. Every generate node recomputes its whole batch join on every render, and
every job push re-renders every node.** `GenerateNodeBody`
(`generate-node.tsx:363-374`) calls `useGenerations(containerId, {limit: 200})`,
`useAssets(containerId, {limit: 200})` and `useJobs()` — the same three
queries in every node — then runs `batchTiles(...)` **unmemoized**, which does
an `assets.filter(...)` + sort per sibling generation
(`batch-view.ts:104-108`). With 200 assets and a screenful of nodes that is a
few thousand comparisons per `jobs:update` push.
*Fix:* wrap `batchTiles`/`batchProgress` in `useMemo` keyed on the three query
`dataUpdatedAt` values plus `node`, and index assets by `generationId` once
(a `Map`) inside `batchTiles` instead of filtering per generation.

**d. Each result tile mounts three dialog subtrees.** `ResultTile`
(`generate-node.tsx:283-346`) always renders `AddToContainerDialog` and
`RunDetailsPanel`, and `RunDetailsPanel` mounts `DetailsPanel`
(`generate-node.tsx:213-221`) whether or not it is open. For a 16-tile batch
that is 32 dialog trees per node.
*Fix:* render them conditionally on `open`, exactly as `CompareView` already
is at `generate-node.tsx:328-335`.

**e. Per-keystroke request rebuilding in the bar.** `request`
(`prompt-bar.tsx:354-375`), `missing` (`:377-386`) and `plan`
(`:388-400`, which reads `descriptor.inputSchema` through `planBatch`) all
depend on `draft`, whose identity changes on every character typed. None is
expensive on its own, but they run on every keystroke together with a full
`PromptBar` re-render including `ReferenceTray` and `ModelPicker`.
*Fix:* split the textarea into its own component subscribing to just
`draft.prompt`, or debounce the `prompt` that feeds `request`/`plan` (the
prompt does not affect `plan` or `missing` beyond presence, and it is stripped
from the cost key already).

**f. Selection re-creates every flow node.** `flowNodes`
(`canvas.tsx:169-181`) depends on `selectedNodes`, so selecting one node
produces new objects for all of them and React Flow re-renders the entire
graph — each generate node then redoing (c).
*Fix:* let React Flow own selection (it already emits `select` changes) or
keep the selection set out of the memo and apply `selected` via a cheap
`nodeClassName`/store update.

---

## 5. Characters / scenarios / assets, for the @-mention follow-up

**Where they come from.** They are not three tables — they are one
`containers` tree viewed through a fixed section mapping.

- `packages/contract/src/project.ts:18-24` —
  `containerKindSchema = ["project", "character", "scene", "folder"]`.
- `packages/contract/src/project.ts:58-80` — `containerSchema`
  (`id`, `projectId`, `parentId`, `kind`, `name`, `position`, `createdAt`) and
  the recursive `containerNodeSchema` with `children`.
- `apps/web/lib/board/sidebar-tree.ts:29-79` — `buildSidebarSections` maps
  `character → Characters`, `scene → Scenes`, `folder → Assets`, hoisting the
  children of any `project` container so both project shapes render alike.
  Also exports `findContainer`, `flattenContainers`,
  `firstSelectableContainer` (`:82-113`).
- `apps/web/components/shell/sidebar.tsx:56-131` — `useContainerTree()` →
  `buildSidebarSections` → one `SidebarGroup` per section, rows rendered by
  `ContainerTree`. The "+" on a group creates a container of that section's
  kind at top level (`:104-115`).

**Media inside them.** `assetSchema` (`packages/contract/src/project.ts:82-111`):
`id`, `kind` (`image|video|audio|text|prompt`), `relPath`, `label`,
`originalName`, `thumbnailRelPath`, `url`, `thumbnailUrl`, `generationId`,
`pinned`. Fetched per container by `useAssets(containerId, { limit })`
(`apps/web/hooks/use-assets.ts`), which `ReferenceTray` already uses with a
500-row page (`reference-tray.tsx:49`).

**What this means for @-mentions.** An `@` in the prompt should resolve to
either a container (a character or a scene — a *set* of assets) or a single
asset. Both are already available in the renderer through
`useContainerTree()` and `useAssets()`, and the rendering primitive is already
in the tree: the `Command`/`CommandInput`/`CommandItem` set from
`@workspace/ui/components/command` that `ModelPicker` and `ReferencePicker`
use. The honest mapping on this canvas is that mentioning an asset should
create the media node and the edge — the same thing `ReferenceTray`'s "+"
already does (`reference-tray.tsx`, `useCreateCanvasNode` +
`useCreateCanvasEdge`) — rather than inventing a second reference channel the
graph cannot see.

---

## 6. Test, type-check and lint commands

From the repo root (`package.json` scripts, `turbo.json` tasks):

| Command | What it runs |
| --- | --- |
| `pnpm test` | `vitest run` — the whole suite, one root config |
| `pnpm test:watch` | `vitest` in watch mode |
| `pnpm typecheck` | `turbo typecheck && tsc --noEmit` (per-workspace `tsc --noEmit`, then the root project) |
| `pnpm lint` | `turbo lint` (ESLint 9 per workspace) |
| `pnpm format` | `prettier --write .` |
| `pnpm build` | `turbo build` |

`vitest.config.ts` runs a single Node-environment project over
`test/**/*.test.ts`, `apps/**/*.test.ts(x)` and `packages/**/*.test.ts`, with
`vitest.setup.ts` as the setup file and the renderer's `@/` alias pointed at
`apps/web`. Component tests use `@testing-library/react` and `msw`; msw's
`onUnhandledRequest: "error"` is what keeps a test from reaching a provider.

Narrowing to the files this document touches:

```
pnpm vitest run apps/web/lib/canvas apps/web/components/canvas
pnpm vitest run apps/desktop/src/main/providers/reference-slots.test.ts
```

⛔ No test path may submit a paid generation; the batch tests assert the shape
of the request and stop there.
