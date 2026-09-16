# Visual Canvas Builder

A validated design. The decisions below are settled; this document records
them and works out what they cost in code.

The canvas replaces the masonry board as the project workspace. A project is
no longer a grid of finished tiles. It is a graph of nodes you wire together,
where an edge means "use this as a reference" and a generate node is a run you
have not paid for yet.

---

## 1. Goal and non-goals

### Goal

Give a project one spatial workspace where the user can:

- See every asset and every run as a node, laid out where they put it.
- Wire an asset into a run by dragging an edge, not by opening a picker.
- Compose and submit a run from a prompt bar anchored under the node it
  belongs to.
- Ask for several results at once and keep all of them, while one is the pick
  that downstream nodes use.
- Keep the existing guarantees: every control comes from the model's own
  schema, nothing is dropped, and nothing spends money without a click.

### Non-goals

- **No workflow engine.** There is no run graph, no execution order, no
  scheduler. Pressing run on one node runs one node.
- **No auto-run.** An edge never triggers anything. Changing an upstream pick
  does not re-run downstream nodes.
- **No new generation path.** The canvas produces the same
  `GenerationRequest` the creation bar produces today and hands it to the same
  `generations:submit` handler and the same job runner.
- **No server, no sync, no telemetry.** Canvas rows live in the project's own
  SQLite file next to everything else.
- **No masonry board kept in parallel.** The board is replaced, not
  duplicated. Sidebar containers stay exactly as they are.

---

## 2. User model

### A node

A node is one thing on the canvas. Four types in v1.

| Type       | What it holds                        | Handles         |
| ---------- | ------------------------------------ | --------------- |
| Text       | A coloured note. Free text.          | Output only     |
| Media      | One imported asset. Image or video.  | Output only     |
| Image gen  | One image run, or one batch of them. | Input and output |
| Video gen  | One video run, or one batch of them. | Input and output |

A Media node is created by dropping a file on the canvas or dragging an asset
in from the sidebar. A Text node is a coloured sticky whose text is prepended
to the prompt of anything it feeds.

A generate node is a frame sized to its chosen aspect ratio. Before it has
run, it is empty. While it runs, it shows a progress ring and a percentage.
After it succeeds, it shows a grid of its results. Its input handle is on the
left, its output handle on the right, and each side carries a small "+" that
adds a new connected node in that direction.

### An edge

An edge is a reference input, and nothing else.

Drawing an edge from A into B says "when B runs, feed it A". It does not run
B. It does not mark B stale. It is a statement about the next run, not about
the current one.

Each edge carries a `slotField`, which is the model's own input field name.
The role of that field (`reference`, `first_frame`, `last_frame`, `motion`,
`source`) comes from `deriveReferenceSlots` in
`apps/desktop/src/main/providers/reference-slots.ts`, which already reads it
out of the model's schema. When an edge is drawn, the canvas picks the first
compatible free slot and labels the edge with it. The user can change the slot
from the edge label.

Text nodes are the exception. A text edge has no slot field. Its text is
prepended to the target's prompt at run time.

### Batch and pick

Asking for four images gives one node with four tiles, not four nodes.

One tile is the **pick**. It is stored on the node as `pickAssetId`. Outgoing
edges use the pick. Any other tile can be made the pick later with one click,
and every downstream edge follows from then on. Nothing is deleted when the
pick changes, and nothing re-runs.

How the batch is submitted depends on the model:

- If the model's input schema has a native output-count field (`num_outputs`,
  `num_images`, `n`, and anything else that reads as a count of outputs), one
  job is submitted with that field set to N.
- Otherwise N sibling jobs are submitted, sharing one batch id.

Either way the node ends up with N result assets and one pick. Video batching
works the same way.

Deleting a node removes the node. It never removes the asset or the
generation. Those stay in the project, reachable from the sidebar container
they belong to.

---

## 3. Architecture

### Packages touched

| Workspace           | What changes                                                      |
| ------------------- | ----------------------------------------------------------------- |
| `packages/contract` | New `canvas.ts` module, new IPC channels, `batchId` on a request   |
| `apps/desktop`      | Two new tables, a repository, a service, handlers, a migrator      |
| `apps/web`          | The canvas itself, node components, prompt bar, settings popover   |
| `packages/ui`       | Nothing new expected. shadcn primitives already cover the popovers |

### React Flow integration

`@xyflow/react` owns pan, zoom, edge rendering, selection, the minimap and
the handles. We do not hand-roll any of it. Custom node types are plain React
components registered in a `nodeTypes` map, so every node is still our own
markup with Hugeicons, shadcn and Tailwind v4 tokens inside it.

React Flow ships a stylesheet. It is imported once and then re-themed by
overriding its CSS custom properties with our shadcn tokens, so the canvas
follows light and dark mode with everything else. No hardcoded colours.

The canvas must not break the CSP. React Flow injects no remote assets and
needs no `unsafe-inline` style beyond what Tailwind already produces, so
`default-src 'self'` stands unchanged. That is asserted by the existing CSP
test.

### State ownership

Two stores, with a clear line between them.

**React Flow's own store holds the transient state.** Viewport, selection,
the in-flight drag, the connection line being drawn, hover. None of it is
persisted and none of it goes through IPC. Reading it during a drag must stay
cheap, which is exactly what React Flow's store is for.

**TanStack Query plus IPC holds the persisted state.** Node rows, edge rows,
positions, picks. The query cache is the source of truth for what the canvas
renders. React Flow is handed nodes derived from that cache.

The two meet in two places:

- On drag end, the new position is written through a debounced mutation
  (roughly 400ms of quiet). Positions are the only high-frequency write and
  they are the only thing debounced. Node adds, deletes, edge changes and pick
  changes are written immediately.
- On a `jobs:update` push, the query cache for generations updates, and the
  generate node re-renders with new progress or new results. The canvas
  subscribes to nothing new. It reuses `useJobs` and `useGenerations`.

---

## 4. Data model

### Tables

Two new Drizzle tables in `apps/desktop/src/main/db/schema.ts`, following the
existing conventions: text UUID ids, epoch-millisecond timestamps, foreign
keys declared and enforced.

```ts
canvas_nodes
  id            text primary key
  projectId     text not null   → projects.id     on delete cascade
  type          text not null   // "text" | "media" | "image_gen" | "video_gen"
  x, y          real not null
  width, height real not null
  assetId       text            → assets.id       on delete cascade
  generationId  text            → generations.id  on delete set null
  batchId       text
  pickAssetId   text            → assets.id       on delete set null
  text          text
  color         text
  createdAt     integer not null
  updatedAt     integer not null
  index on (projectId), (generationId), (batchId)

canvas_edges
  id            text primary key
  projectId     text not null   → projects.id      on delete cascade
  sourceNodeId  text not null   → canvas_nodes.id  on delete cascade
  targetNodeId  text not null   → canvas_nodes.id  on delete cascade
  slotField     text            // null for a text edge
  createdAt     integer not null
  index on (projectId), (sourceNodeId), (targetNodeId)
```

The delete rules matter and are deliberate.

- Deleting a **node** cascades to its edges only. The asset and the generation
  are untouched.
- Deleting an **asset** cascades to a media node, because a media node with no
  asset is nothing. It only nulls `pickAssetId` on a generate node, because a
  generate node without a pick is still a run that happened.
- Deleting a **generation** nulls `generationId`. The node stays, empty,
  ready to run again. This matches the existing rule that pruning a run never
  destroys media or lineage.

One column is added to an existing table: `generations.batch_id`, nullable and
indexed. Sibling jobs need a queryable grouping key, and `canvas_nodes.batchId`
alone cannot find them without scanning `request_json`. It is nullable, so
every existing row and every non-canvas run is unaffected.

### Contract schemas

New file `packages/contract/src/canvas.ts`:

- `canvasNodeTypeSchema` = `z.enum(["text", "media", "image_gen", "video_gen"])`
- `canvasNodeSchema` mirroring the table, plus a resolved `asset` and
  `generation` where they exist, so one fetch renders the whole canvas.
- `canvasEdgeSchema` with `slotField: z.string().nullable()`.
- `canvasSchema` = `{ nodes, edges }`.
- `canvasNodePatchSchema` for partial updates (position, size, text, colour,
  pick).

One field is added to `generationRequestSchema` in
`packages/contract/src/generation.ts`: `batchId: z.string().nullable()`. It is
carried into `requestJson` verbatim like everything else, and written to the
new column.

### IPC methods

| Channel                | Input                                    | Output              |
| ---------------------- | ---------------------------------------- | ------------------- |
| `canvas:get`           | `void`                                   | `canvasSchema`      |
| `canvas:node:create`   | type, position, size, optional asset/text | `canvasNodeSchema` |
| `canvas:node:update`   | `{ id, patch }`                          | `canvasNodeSchema`  |
| `canvas:node:move`     | `{ moves: [{ id, x, y, width, height }] }` | `okSchema`        |
| `canvas:node:delete`   | `{ ids: string[] }`                      | `okSchema`          |
| `canvas:node:pick`     | `{ id, assetId }`                        | `canvasNodeSchema`  |
| `canvas:edge:create`   | source, target, slotField                | `canvasEdgeSchema`  |
| `canvas:edge:update`   | `{ id, slotField }`                      | `canvasEdgeSchema`  |
| `canvas:edge:delete`   | `{ ids: string[] }`                      | `okSchema`          |
| `canvas:migrate`       | `void`                                   | `canvasSchema`      |

`canvas:node:move` takes an array because box-select then drag moves many
nodes at once, and one debounced write per gesture beats one per node.

Every channel goes in `ipcContract`, which is what `createIpcRegistrar`
enforces. `ipc-coverage.test.ts` already fails on a channel that is declared
and not handled, so no extra guard is needed.

---

## 5. Components

### New files

| Path                                                       | What it is                                            |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| `packages/contract/src/canvas.ts`                           | The schemas above                                     |
| `apps/desktop/src/main/repo/canvas.ts`                      | Row reads and writes, pure Drizzle, no Electron        |
| `apps/desktop/src/main/canvas-service.ts`                   | Handler wiring, matching `project-service.ts`          |
| `apps/desktop/src/main/canvas-migrate.ts`                   | Lineage to layout, using elkjs                         |
| `apps/desktop/src/main/canvas-batch.ts`                     | Count-field detection and batch strategy               |
| `apps/web/components/canvas/canvas.tsx`                     | The React Flow surface, node types, handlers           |
| `apps/web/components/canvas/nodes/text-node.tsx`            | Coloured note                                          |
| `apps/web/components/canvas/nodes/media-node.tsx`           | Imported asset, reusing `AssetPreview`                 |
| `apps/web/components/canvas/nodes/generate-node.tsx`        | Frame, progress ring, result grid, pick control        |
| `apps/web/components/canvas/nodes/node-frame.tsx`           | Shared chrome: handles, "+" affordances, selection ring |
| `apps/web/components/canvas/edges/reference-edge.tsx`       | Edge with its slot label and a slot menu               |
| `apps/web/components/canvas/prompt-bar.tsx`                 | The floating bar under the selected generate node      |
| `apps/web/components/canvas/settings-popover.tsx`           | Icon grids for quality, resolution, aspect ratio       |
| `apps/web/components/canvas/reference-tray.tsx`             | Connected-reference thumbnails plus "+"                |
| `apps/web/components/canvas/canvas-rail.tsx`                | Left rail: add, select, folder, undo, redo             |
| `apps/web/hooks/use-canvas.ts`                              | Queries and mutations for the tables                   |
| `apps/web/hooks/use-canvas-history.ts`                      | Undo and redo stack for canvas operations              |
| `apps/web/lib/canvas/edges-to-inputs.ts`                    | Edges plus picks to `references` and prompt prefix     |
| `apps/web/lib/canvas/icon-grid.ts`                          | Schema enum values to icon grid rows                   |
| `apps/web/lib/canvas/layout.ts`                             | Sizes, aspect-ratio frames, spawn positions            |

### Modified files

| Path                                          | Change                                                       |
| --------------------------------------------- | ------------------------------------------------------------ |
| `apps/web/components/shell/app-shell.tsx`      | Renders `<Canvas/>` where `<Board/>` was; drops the creation bar from the main panel |
| `apps/desktop/src/main/db/schema.ts`           | Two tables, one column, their relations                       |
| `apps/desktop/src/main/handlers.ts`            | Registers the canvas handlers                                 |
| `apps/desktop/src/main/generations-submit.ts`  | Accepts and stores `batchId`; submits N siblings when asked   |
| `packages/contract/src/ipc.ts`                 | The channels above                                            |
| `packages/contract/src/generation.ts`          | `batchId` on the request                                      |
| `apps/web/hooks/query-keys.ts`                 | A `canvas` key                                                |

### Removed

`apps/web/components/board/board.tsx` and its masonry helpers go, along with
the `masonic` dependency, once nothing imports them. `asset-card.tsx`,
`output-card.tsx`, `asset-preview.tsx`, `details-panel.tsx`, `compare-view.tsx`
and `lineage-view.tsx` all stay. They are still used by the details panel and
by the node bodies.

### The prompt bar

The bar floats, anchored under the selected generate node, and moves with it.
It holds, left to right:

1. The reference tray. One thumbnail per incoming edge, each labelled with its
   slot, plus a "+" that opens the existing reference picker.
2. The prompt textarea.
3. A model chip, which opens the existing `ModelPicker`.
4. A settings chip, reading like `High · 1080p · 16:9`, which opens the icon
   grid popover.
5. A count stepper.
6. The cost estimate, from the existing `cost:estimate` channel.
7. The run button.

### The settings popover

Three rows at most: quality, resolution, aspect ratio. Each row is an icon
grid built from that model's own JSON schema.

The rule is strict. A row appears only if the model's schema declares that
field, and its cells are exactly the enum values the schema lists. A model
with no resolution field gets no resolution row. A model that offers only
`480p` and `720p` gets two cells. Nothing is faked and nothing is padded to
make the grid look even.

Everything the popover does not promote stays in the existing
`AdvancedParams` RJSF form, reachable from a chip on the bar. The partition
stays total, exactly as `split-schema.ts` asserts today.

### Canvas chrome

- Left rail: add, select, folder, undo, redo.
- Minimap bottom right, from React Flow.
- Space and drag pans. The wheel zooms. Shift and drag box-selects.
- Delete removes the selected nodes and edges, and nothing else.
- Undo and redo cover canvas operations only: node add, move and delete, edge
  add and delete, and pick change. They never undo a generation, because a
  generation has already been paid for.

---

## 6. Run flow

Pressing run on a generate node, step by step.

1. **Collect the inputs.** Walk the node's incoming edges.
   - A text node contributes its text. Texts are joined in edge creation
     order and prepended to the prompt.
   - A media node contributes its asset id.
   - A generate node contributes its `pickAssetId`. If it has no pick, the run
     is blocked with a reason.
   Each media contribution becomes one `GenerationReference` with the edge's
   `slotField` and a `position` taken from edge order within that slot. This is
   `edges-to-inputs.ts`, and it is a pure function, so it is unit tested
   without a canvas.

2. **Build the request.** The same `GenerationRequest` the creation bar
   builds: `modelKey`, `containerId`, `prompt`, `params`, `references`,
   `estimatedCostUsd`, `costConfidence`, `parentGenerationId`, and now
   `batchId`.

3. **Choose the batch strategy.** `canvas-batch.ts` reads the model's input
   schema for an integer property that reads as an output count
   (`num_outputs`, `num_images`, `n`, and anything matching the same shape
   within its own declared bounds).
   - **Native count.** Set that field to N in `params`. One request. `batchId`
     is still set, so the node and the run agree.
   - **No count field.** Build N identical requests sharing one `batchId`, each
     submitted separately.
   If N exceeds the schema's stated maximum for the count field, the request is
   split: as many native-count jobs as needed, all sharing the batch id.

4. **Quote it.** `cost:estimate` runs against the request before anything is
   submitted, and the total shown on the button is the per-run quote times N.
   A model with no usable rate still says "Cost unknown", never `$0.00`.

5. **Submit.** `generations:submit`, unchanged in shape. It writes the queued
   row or rows to SQLite before any provider is called, exactly as today. The
   node stores the returned `batchId` and, for a single run, `generationId`.

6. **Watch.** The job runner picks the rows up. `jobs:update` pushes arrive,
   the query cache updates, and the node paints a progress ring with the
   percentage. Nothing about the runner changes. Restart behaviour, Resume,
   the no-resubmit rule and the retry policy are all inherited untouched.

7. **Land the results.** On success, output assets are attached to the
   generation as they are today. The node reads them and renders the grid.
   When a node has no pick yet, the first successful output becomes the pick.
   That is a default, not a lock: any tile can be made the pick, at any time,
   with one click, and no downstream node re-runs because of it.

8. **Downstream.** Nothing happens. The edges out of the node now resolve to
   the new pick the next time a downstream node is run, and only then.

---

## 7. Error handling

**A failed job.** The node shows the failure in place, with the provider's own
message and a Retry that goes through the existing `jobs:retry`. A generation
that already has a `providerJobId` polls rather than resubmits, which is the
existing rule and the reason Retry is safe to offer here.

**Partial batch failure.** Three of four succeed. The node shows three result
tiles and one failed tile. The node is usable: the pick is one of the three
that worked. The failed tile keeps its own Retry, and retrying it adds a
fourth tile without touching the other three. A batch is never all-or-nothing,
because each sibling is a separately paid job.

**Missing asset.** A media node whose asset row is gone is cascaded away with
it. A generate node whose `pickAssetId` was nulled renders as "no pick
selected" and blocks any downstream run with that sentence. It does not
silently fall back to another tile, because picking is the user's decision.

**Model without a count field.** Handled by design, not as an error: N sibling
jobs. The count stepper stays enabled and the cost line reads as N runs.

**Model whose schema changed.** A stored slot field that the current model no
longer declares is shown on the edge as unresolved, and the run is blocked
until the user picks a slot the model actually has. `submitGeneration` already
rejects an unknown slot field, so this is a guard in front of an existing
guard, not a new trust boundary.

**Migration failure.** If the lineage layout throws, or elkjs cannot lay out a
graph, the project opens with an empty canvas and a dismissible notice
offering "Lay out my existing work". Nothing is written on a failed migration,
so it can be retried. A partially written layout would be worse than none.

**Bridge missing.** The canvas renders a placeholder outside Electron, the
same way the shell already handles a missing IPC bridge.

---

## 8. Testing

Everything offline, and `onUnhandledRequest: "error"` stays exactly as it is.

**Unit, plain Node, no Electron and no React:**

- `edges-to-inputs.test.ts`. Edge plus pick to `references`. Slot fields come
  from the edge. Positions follow edge order. Text nodes prepend and do not
  become references. An unresolved pick blocks. An unknown slot blocks.
- `canvas-batch.test.ts`. Count-field detection across real recorded schemas:
  one with `num_outputs`, one with `n`, one with `num_images`, one with none.
  N within bounds gives one request. N over bounds splits. All requests in a
  batch share one id.
- `canvas-migrate.test.ts`. A lineage with `parentGenerationId` and
  `generation_inputs` becomes nodes and edges. Every generation appears once.
  An orphan is still placed. A project with existing canvas rows is left
  alone.
- `repo/canvas.test.ts`. Against `:memory:`. Deleting a node leaves the asset
  and the generation. Deleting a generation nulls `generationId` and keeps the
  node. Deleting an asset nulls a pick.
- `use-canvas-history.test.ts`. Undo and redo over add, move, delete and pick.
  A generation is never on the stack.

**Component tests, with msw:**

- The prompt bar builds the right request from a selected node, and the run
  button calls the submit mutation exactly once.
- The settings popover renders a row only when the schema has the field, and
  renders exactly the enum values the schema lists. A model without a
  resolution field renders no resolution row.
- A generate node renders progress from a `jobs:update` payload, then a grid
  from attached outputs, then a changed pick.
- A failed sibling renders its own error and its own Retry.

**The rule that outranks all of them:** no test path may ever submit a paid
generation. Every provider call in these tests is an msw handler over a
recorded fixture. The batch tests assert the *shape* of what would be sent and
stop there.

---

## 9. Open questions and later

- **Auto-run.** An opt-in toggle, per node, that re-runs when an upstream pick
  changes. It is deliberately out of v1 because it makes an edge spend money,
  which is the one thing this app never does by itself. If it ever ships it
  needs a confirmation and a visible cost before the first automatic run.
- **Multiple canvases per project.** The tables already carry `projectId` and
  would take a `canvasId` cleanly. The question is whether a second canvas is
  better than a second project, and it probably is not until someone asks.
- **Crop and mask tools** on a media node, so a reference can be framed
  without leaving the app.
- **Grouping and frames**, for shot sequences. React Flow supports parent
  nodes, so this is layout work rather than data work.
- **Comparing two tiles** inside a node. `compare-view.tsx` already exists and
  would slot in.
- **Migration for very large projects.** elkjs on a few thousand generations
  has not been measured. If it is slow, the layout runs in a worker and the
  canvas fills in when it lands.

---

## 10. Libraries adopted

| Library           | Version   | Licence                       | Why                                                        |
| ----------------- | --------- | ----------------------------- | ---------------------------------------------------------- |
| `@xyflow/react`   | 12.11.6   | MIT                           | Pan, zoom, edges, handles, selection, minimap. React 19 ready |
| `elkjs`           | 0.12.0    | EPL-2.0 OR GPL-3.0-or-later   | Layered auto layout for migrated projects, in the main process |

Versions verified against the npm registry on 2026-09-16.

Two notes on licensing.

`@xyflow/react` is MIT. The Pro features we are not using are a separate
commercial package; nothing here depends on one.

`elkjs` is dual licensed EPL-2.0 or GPL-3.0-or-later. EPL-2.0 is file-level
copyleft and is the licence we take it under. We consume it unmodified as a
dependency, so the obligation is attribution and source availability for
elkjs itself, not for OpenDirect. It must be listed in the third-party notices
that ship with the installers. If that ever becomes awkward, the alternatives
are `dagre` (MIT, simpler layered layout) or a hand-written column layout by
lineage depth, which is all the migration really needs.

Everything else is already in the tree: Hugeicons, shadcn, Tailwind v4 tokens,
TanStack Query, zod, Drizzle, `@rjsf/shadcn`. `masonic` leaves when the board
does.
