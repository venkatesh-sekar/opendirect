# Project Workspace — from canvas-first to project-first

A validated design. The user asked:

> "Right now it's mainly canvas focused… I'm thinking we can make it project
> focused, where we see recently generated content and all the characters and
> scenes… like a workspace, instead of just directly opening it in a canvas."

Opening a project lands on a **Home** page. Characters and scenes each get a
**page of their own**. The canvas stays, but it becomes one place you go to, not
the front door. This follows `product.md`'s model, **Container → Asset →
Generation**: every container is a place.

**Mockups** (the source of truth for layout; open the files in a browser):

| Screen | File | Status |
|---|---|---|
| Home | [`home-a1-sections.html`](mockups/2026-09-23-workspace/home-a1-sections.html) | **Chosen** |
| Home in-progress rail | [`home-a2-cast-activity.html`](mockups/2026-09-23-workspace/home-a2-cast-activity.html) | Take only the "Generating now" block (right rail) |
| Character page | [`character-c1-profile.html`](mockups/2026-09-23-workspace/character-c1-profile.html) | **Chosen** |
| Character generate panel | [`character-c2-generate-panel.html`](mockups/2026-09-23-workspace/character-c2-generate-panel.html) | **Chosen**, as a panel that opens from C1 |
| Scene page | [`scene-c3-shots.html`](mockups/2026-09-23-workspace/scene-c3-shots.html) | **Chosen** (shots are Phase 3) |

All seven explored options, including the rejected Bento (A3) and Library (A4)
homes, are on the design canvas: https://claude.ai/artifact/MXHAJPkv4dLrq8QHoNtnKG

The mockups are dark, use hardcoded hex colours, the Geist font and colour
blocks where images go. **Build with the app's own shadcn tokens and Inter
font** (`bg-background`, `bg-card`, `border`, `text-muted-foreground`,
`@workspace/ui` components). Take layout, hierarchy and content from the
mockups, not their colours. Amber marks "running / starred"; add one token for
it, say `--status-running`.

---

## 1. Where the code is today

- **One real route.** `apps/web/app/page.tsx` renders `<Canvas containerId>`.
  `app/settings/page.tsx` is the only other page.
- **The shell sits above the router.** `components/shell/app-shell.tsx` owns
  the sidebar, `DndContext`, `StatusBar`, ⌘, and `shell:navigate`. It
  publishes the selected container through `WorkspaceContainerContext` /
  `useWorkspaceContainerId()`, and the canvas reads it.
- **Sidebar.** `components/shell/sidebar.tsx` and `container-tree.tsx` show
  sections Characters / Scenes / Assets (`lib/board/sidebar-tree.ts →
  buildSidebarSections`). Clicking a character or scene opens the
  **`SubjectLibrary` dialog** (`components/shell/subject-library.tsx`). That
  dialog picks references (`useSetContainerReferences`), imports assets, and
  offers "generate with this", which seeds a canvas node through
  `seedPromptDraft` + `requestCanvasFocus`.
- **The canvas is per project, not per container.** `canvas:get` takes no
  input. `canvas_nodes.container_id` only tags where a new node's outputs are
  filed.
- **Data** (`apps/desktop/src/main/db/schema.ts`):
  - `containers` has `kind` project|character|scene|folder, `parentId`,
    `handle`, `description`, `referenceAssetIds` and `position`.
  - Assets join containers through `container_assets`.
  - `generations.container_id` exists.
  - `jobs` feed `useJobs` and the `jobs:update` push.
- **Channels we lean on** (`packages/contract/src/ipc.ts`):
  - containers: `containers:tree`, `containers:create/rename/setHandle/setDescription/setReferences/delete`
  - assets: `assets:list {containerId}`, `assets:import`
  - generations: `generations:list {containerId}` (container-scoped only), `generations:lineage`, `generations:submit`
  - jobs, mentions and cost: `jobs:list`, `mentions:subjects`, `cost:estimate`
- **Prompt bar is tied to a canvas node.** `components/canvas/prompt-bar.tsx`
  is `PromptBar({ node, canvas, defaultModelKey })`, and its drafts live in a
  module map keyed by node id. The standalone generate panel is the riskiest
  piece of this work (§4.3).
- **Routing constraint.** The app is a static export
  (`next.config.ts: output: "export"`, `trailingSlash: true`), so it has **no
  dynamic `[id]` segments**. Pass IDs in query params with `useSearchParams`
  inside `<Suspense>`, the way `app/settings/page.tsx` does. Per `AGENTS.md`,
  read `node_modules/next/dist/docs/` before writing routes. Run `pnpm install`
  first if the docs are missing.

## 2. Information architecture

| Route | Page | Replaces |
|---|---|---|
| `/` | **Home** (§3) | the canvas |
| `/canvas/` (optional `?focus=<containerId>`) | the existing `<Canvas>` | `/` |
| `/characters/` | Grid of all characters (the Characters section of Home, full page) | – |
| `/scenes/` | Grid of all scenes | – |
| `/generations/` | Project-wide generations, newest first, grouped by day | – |
| `/container/?id=<id>` | Dispatches on `kind`: character → §4, scene → §5, folder → plain asset grid | `SubjectLibrary` dialog |
| `/settings/` | unchanged | – |

**Sidebar** (see any mockup's left column):

1. Project switcher.
2. Search / `@mention` field. It can be a stub in v1.
3. Nav: **Home, Characters (n), Scenes (n), Generations (n), Canvas**.
4. The **Folders** tree.
5. A small "N generating" card with a progress bar, above Settings. It can be
   the existing `StatusBar` moved or duplicated here.

Character and scene rows in the tree now **navigate** to
`/container/?id=`; they no longer open a dialog. Keep the drag-and-drop onto
rows as it is.

**Canvas and the selected container.** Today the sidebar selection chooses
which container new canvas nodes are filed under. On `/canvas/`:

- `?focus=<id>` frames that container's nodes, using the existing
  `requestCanvasFocus`.
- New nodes are filed under the focus id when one is given. Otherwise they go
  under the container the user last visited (a `/container/?id=` page or a
  `?focus`), remembered across reloads in `localStorage`, and only when there
  is none, or it was deleted, under the first container in the tree. Not the
  project root: a generate node reads its batch back from the container it was
  filed under, so a run filed nowhere would show as an empty node.
- A chip over the canvas says "File new nodes under ‹name›" and is a picker
  for changing it; a change is remembered the same way.

`WorkspaceContainerContext` can then go, or it can shrink to "last focused
container".

## 3. Home (A1, plus in-progress from A2)

Top bar: "Home", with **Open canvas** (ghost button) and **New ▾** (character /
scene / folder / import). Then three sections:

1. **Continue.** A horizontal strip.
   - Running jobs come first as tiles with a dashed amber outline and a
     progress bar (from `useJobs`).
   - After them, the latest generations project-wide. Each tile has the
     thumbnail, the prompt on one line (truncated), `model · 2m ago`, and a
     duration badge on videos.
   - "All generations →" goes to `/generations/`.
   - Clicking a tile opens the existing details / lineage view
     (`components/board/details-panel.tsx`, `lineage-view.tsx`).
2. **Characters (n).** A 7-column grid of 3:4 cards: cover image, name,
   `@handle · N assets`. The character-sheet cover gets a ★ Sheet badge. The
   last card is a dashed "New character".
3. **Scenes (n).** A 4-column grid of 16:9 cards: cover, "N assets" badge,
   name, and a stack of cast avatars.

When the project is empty, each section shows its own "create the first one"
prompt; a blank page is not OK.

## 4. Character page (C1, with the C2 panel)

`/container/?id=` for a `character`.

### 4.1 Header

- **Left:** the character sheet at 400×250. This is `referenceAssetIds[0]`, or
  a placeholder that says "pick a character sheet".
- **Right:**
  - the name (H1) and an `@handle` chip, editable in place (`containers:rename`, `containers:setHandle`)
  - the description, editable (`containers:setDescription`)
  - a stats line: "12 assets · 38 generations · in Hotel hallway, Rooftop…"
  - **"References sent to the model, in order"**: numbered thumbnails and a
    "+" tile. These edit `referenceAssetIds` (reuse `SubjectLibrary`'s
    selection logic), and dragging reorders them.
- Top bar: breadcrumb *Characters / Mira*, then **Edit** and the primary
  button **Generate with @mira**.

### 4.2 Tabs

Put the active tab in the query string, e.g. `&tab=generations`.

- **Assets.** Filter chips All / References / Generated / Uploaded, an
  **Import** button, and a 4-column grid (`assets:list`). Reference assets show
  their order badge.
- **Generations.** `generations:list {containerId}`, grouped by day, with
  running jobs first.
- **Canvas.** Links to `/canvas/?focus=<id>`. It does not embed the canvas.
- **Appears in.** The scenes this character appears in (§6.3).

### 4.3 Generate panel (C2)

**Generate with @mira** opens a right-hand panel, 400px wide, on this page:

- identity row: avatar, name, `@handle · sheet + N refs`
- reference slots, prefilled from `referenceAssetIds`
- a prompt box prefilled with `@mira `, using `mention-textarea.tsx`
- model select
- a row of model parameters: duration, aspect ratio, resolution
- "Save to: Mira", and "+ scene" when you arrive from a scene
- the **Generate · ≈ $cost** button

It submits with `generations:submit` using `containerId = character`. New
results appear at the top of the Generations tab as running tiles.

**Build approach:** pull the model picker, schema settings, mention textarea,
reference tray and cost estimate out of `prompt-bar.tsx` into a
`GenerateForm` that is not tied to a canvas node. Both `PromptBar` (the canvas
node adapter) and this panel then use it. Keep `seedPromptDraft` working for
the canvas.

**Fallback** if the extraction balloons: the button creates and focuses a
generate node on `/canvas/?focus=<id>`, seeded with `@mira`, which is what
`SubjectLibrary` does today. Ship the fallback first if needed and replace it
later.

**As built (Phase 2).** The panel shipped, not the fallback. What is shared
is `useGeneratePlan` (mentions → request → quote → batch plan → submit),
which `PromptBar` and `GenerateForm` both call; `PromptBar` does not render
`GenerateForm`. The panel submits through `generations:submitBatch` with a
count of 1, the canvas's path, so its runs carry a batch id. Known gaps:

- "Save to" names only the container; there is no "+ scene" yet, because
  there is no way to arrive from a scene until the scene page's cast lands.
- Duration, aspect ratio and resolution sit in the settings popover the
  canvas uses (plus Advanced), not in an inline row of chips.
- References in the panel are what the prompt's mentions resolve to for the
  chosen model. They are edited on the page, not in the panel.

**"Appears in" is not built, and §6.3's derivation does not work as
written.** `generations.prompt` stores the *resolved* prompt — `@mira` is
already replaced by "Mira (the person in reference image 1)" or by the
description — so no stored prompt contains `@handle`. Phase 3 will record the
container ids a run mentioned when it is submitted and derive Cast and
"Appears in" from those. Until then the character page has no "Appears in"
tab and its stats line has no "in Hotel hallway, …" clause.

## 5. Scene page (C3)

`/container/?id=` for a `scene`. The layout mirrors the character page:

- **Header:**
  - a 16:9 cover (440×248)
  - the name, the `@handle` chip and the description
  - **Cast**: chips of the characters in this scene, each an avatar and a name,
    plus "+ Add"
  - **Location references**: `referenceAssetIds`
- Top bar: **Open canvas**, then the primary button **Generate in scene**,
  which opens the same `GenerateForm` panel with `containerId = scene`.
- **Tabs:** **Shots** (Phase 3), **Assets**, **Canvas** (link) and **Notes**.
  Until shots ship, the first tab is **Generations**.

**Shots (Phase 3):**

- A 6-column storyboard of numbered cards. Each card has a thumbnail (the
  picked version), a short description, the model and a version badge (`v4`).
  The last card is a dashed "New shot".
- Selecting a shot shows a **versions strip** below. The picked version has an
  amber ring, and clicking a version picks it.

## 6. Data and IPC changes

Every channel below is declared in `packages/contract/src/ipc.ts`, with zod on
both sides, and registered in main.

1. **Project-wide generations.** Make `containerId` optional on
   `generations:list`; leaving it out means "whole project, newest first".
   Home's Continue strip and `/generations/` use this.
2. **Container summaries.** Add `containers:summaries` with input `void` and
   output `{ id, assetCount, generationCount, coverAsset: AssetDto | null,
   lastActivityAt }[]`.
   - Cover rule: `referenceAssetIds[0]` if set, else the newest image asset in
     the container.
   - Home, `/characters/` and `/scenes/` use it. Invalidate it in the same
     places `containers:tree` is invalidated, plus on `jobs:update` terminal
     states.
3. **Cast / Appears in.** Add `containers:related {id}` with output
   `{ characters: ContainerDto[] }` for a scene and `{ scenes: ContainerDto[] }`
   for a character.
   - It is derived; there is no new table. A character is "in" a scene when a
     generation filed under that scene mentions `@handle` in its prompt. Use the
     handle parser in `packages/contract/src/handle.ts`.
   - "+ Add" on Cast needs to be explicit, so an explicit
     `cast_ids` JSON column on scene containers will be needed when that
     button is built. Leave it out of v1 and hide "+ Add".
4. **Shots (Phase 3).**
   - Add `"shot"` to `containerKindSchema`. A shot is a child container of a
     scene (`parentId`), ordered by `position`, and its description is its
     label.
   - Versions are generations with `containerId = shot`.
   - Add a nullable `picked_asset_id` column to `containers` through a Drizzle
     migration in `apps/desktop/drizzle`, and a `containers:setPick` channel.
   - Shots are not `@`-mentionable (null handle), and `buildSidebarSections`
     must skip them.

No other schema changes are needed.

## 7. Phases

Each phase ships on its own, green: `pnpm test`, lint and typecheck.

1. **Shell and Home.**
   - Move the canvas to `/canvas/` and add `?focus`.
   - Build the new sidebar nav.
   - Build Home (§3) with channels 6.1 and 6.2, and the `/characters/`,
     `/scenes/` and `/generations/` grids.
   - Update `app-shell.test.tsx` and `sidebar.test.tsx`: they assert `"/"` is
     the canvas and that a row click opens the library.
   - Make ⌘, and `shell:navigate` still toggle Settings ↔ the previous route.
2. **Character and folder pages.**
   - Build `/container/` dispatch, C1 (header plus tabs) and the folder grid.
   - Build the generate panel (§4.3), or its fallback.
   - Delete `SubjectLibrary`, moving its logic into the page.
3. **Scene page and shots.** C3 with Cast (channel 6.3), then shots (6.4).

## 8. Non-goals and notes

- No embedded canvas inside container pages. The Canvas tab is a link.
- The sidebar search box can be visual only in v1. Wiring it up to ⌘K is a
  later piece of work.
- The rejected options, A3 Bento and A4 Library, are on the design canvas only.
  A4's filter chips (model, `@mention`) are a good later addition to
  `/generations/`.
- Nothing spends money without an explicit Generate click. This invariant is
  already in `app-shell.tsx`, and the new panel must keep it.
