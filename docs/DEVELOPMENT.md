# Development

## Prerequisites

- Node.js >= 20 (CI uses 22)
- pnpm 10 (`corepack enable`)

## Setup

```bash
pnpm install
```

## Scripts (run from the repo root)

| Script            | What it does                                            |
| ----------------- | ------------------------------------------------------- |
| `pnpm dev`        | Runs every workspace `dev` task via Turborepo            |
| `pnpm dev:desktop` | Next.js dev server + the Electron shell pointed at it   |
| `pnpm build`      | Builds every workspace                                   |
| `pnpm lint`       | ESLint (flat config) in each workspace                   |
| `pnpm typecheck`  | `tsc --noEmit` per workspace, plus the root test harness |
| `pnpm test`       | Vitest (single run)                                      |
| `pnpm test:watch` | Vitest in watch mode                                     |
| `pnpm format`     | Prettier over the repo (`*.md` is left alone)            |
| `pnpm changeset`  | Record a user-facing change for the next release         |
| `pnpm release`    | Build everything, then package installers locally        |

Standard verification before every commit:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Test harness

Vitest is configured at the repo root (`vitest.config.ts`) and picks up
`test/**/*.test.ts` plus `*.test.ts(x)` inside `apps/` and `packages/`.

`vitest.setup.ts` starts an `msw` server (`test/msw/server.ts`) with
`onUnhandledRequest: "error"`. Any HTTP request a test does not explicitly mock
fails the test, which is what keeps an accidental live provider call from ever
happening in CI.

> **Never trigger a paid generation.** Provider submission and polling code is
> tested exclusively against `msw` handlers backed by recorded fixture JSON.
> Read-only provider endpoints (`GET /v1/models`, etc.) are free but still
> belong behind a mock in tests.

## Data layer

Each project is a folder the user owns, with its own SQLite file inside it:

```
Infinite Hotel/
  project.json        id, name, createdAt — the source of truth for identity
  opendirect.db       SQLite (WAL), migrated every time the project is opened
  assets/<yyyy>/<mm>/ imported media, bucketed by month
  generations/<id>/   model outputs, one folder per generation
  thumbnails/         derived previews, safe to delete
  tmp/                in-flight downloads, cleared on open
```

`apps/desktop/src/main/project.ts` owns that layout (`createProject`,
`openProject`, `assetRelPath`, `resolveAssetPath`, `createRecentProjects`) and
is Electron-free, so it is tested in plain Node against temp directories.
`project-service.ts` is the wiring: the `projectRoot` setting, the recent-projects
list in `electron-store`, and `restoreLastProject()`, which the main process
calls on `whenReady` — **that is the startup migration runner**, because the
database lives in the project, not in `userData`.

The schema is Drizzle (`src/main/db/schema.ts`): `projects`, `containers`,
`assets`, `container_assets`, `generations`, `generation_inputs`, `jobs`.
`client.ts` opens the file with `journal_mode = WAL`, `synchronous = NORMAL` and
`foreign_keys = ON` (off by default in SQLite — without it the cascades are
decoration). Deleting a project cascades through every table; deleting a
generation only *detaches* its output assets and its branch children
(`on delete set null`), so pruning a run never destroys media or lineage.

Migrations are generated, never hand-written:

```bash
pnpm --filter @opendirect/desktop db:generate     # after editing schema.ts
```

That writes `apps/desktop/drizzle/NNNN_*.sql` plus `drizzle/meta/*`, all of
which are committed. `tsup` copies `drizzle/` to `dist/drizzle` so it ships
inside `app.asar`, and `resolveMigrationsFolder(__dirname)` finds it from either
the bundle or the source tree. `migrate()` runs on every project open and is a
no-op once the migrations are recorded in `__drizzle_migrations`.

### Native modules

`better-sqlite3` is a native module. It is built with **Node-API**
(`node-addon-api`) and ships ABI-stable prebuilds, so the same binary loads in
Node (tests) and in Electron — no rebuild step is needed today. The safety net
is still wired up, because that stops being true the moment a non-Node-API
native dependency is added:

- `npmRebuild: true` in `electron-builder.yml` rebuilds native dependencies
  against the target Electron ABI while packaging.
- `pnpm --filter @opendirect/desktop rebuild:native` (electron-builder's
  `install-app-deps`, which drives `@electron/rebuild`) does the same for the
  local dev run after `pnpm install` or an Electron version bump.
- `asarUnpack: "**/*.node"` keeps the compiled binary outside the asar, where
  `dlopen` can reach it.

Tests never use the Electron build: they open `:memory:` or a temp file with
Node's copy of better-sqlite3.

### Repositories

`apps/desktop/src/main/repo/{containers,assets,generations}.ts` are the only
code that writes those tables. They take the Drizzle handle (and, where files
are involved, the project's path) as arguments and import nothing from
`electron`, so they are tested against a real temp project folder and an
in-memory or on-disk database.

- **containers** — create / rename / reparent / delete plus `listTree()`. A
  reparent refuses to move a container inside its own descendant; a delete
  takes the sub-tree and the `container_assets` links but never an asset.
- **assets** — `importFiles()` copies the user's files into
  `assets/<yyyy>/<mm>/`, hashes them with sha256 and **deduplicates by hash
  within the project**, so re-importing the same picture into a second
  container links the existing asset instead of storing the bytes twice. A
  per-file failure is reported in `failures`, never thrown. Files are hashed by
  streaming (never `readFile`, which would pin a whole clip in memory), copied
  into `tmp/` and renamed into place so `assets/` never holds a half-written
  file, and the row plus its container link are written in one transaction. The
  user's own file name is kept in `assets.original_name`.
  `addToContainer` / `removeFromContainer` are link operations only.
- **generations** — `createGeneration`, `updateStatus` (write-once `startedAt`
  and `completedAt`), `attachOutputs` (records a finished run's files as assets
  and files them on the board) and `lineage()`, which walks ancestors and
  descendants in JavaScript with a cycle guard rather than a recursive CTE.
  ⛔ Nothing in this module can submit anything to a provider.

`apps/desktop/src/main/handlers.ts` is the IPC wiring for all three, plus the
`project:*` channels; it resolves the open project from `project-service.ts` and
fails with "No project is open" when there is none.

### Thumbnails

**Images** get a real preview: `sharp` writes `thumbnails/<assetId>.webp` at
512px on the longest edge, and the same pass fills `assets.width` / `height`.

**Video does not.** The alternative was `ffmpeg-static` + `fluent-ffmpeg` for a
first-frame grab, which adds a ~70 MB per-platform binary and its own licensing
story to every installer in order to reproduce something Chromium already does:
a `<video preload="metadata">` paints its own first frame. Video assets
therefore record `thumbnailRelPath: null` and the renderer uses the element's
poster (the plan's documented fallback). Revisit this if a scrubbable filmstrip
is ever wanted, because that does need real decoding.

`sharp` is a native module like `better-sqlite3`: it is `external` in
`tsup.config.ts` and its package plus the sibling `@img/*` libvips packages are
in `asarUnpack`, because it resolves those binaries by path at runtime.

### Displaying local media in the renderer

The renderer cannot read the disk and the CSP allows only `'self'`, so local
files are served over a custom `asset://` protocol instead of `file://`:

```
asset://media/assets/2026/09/<id>.png
```

`media.ts` (pure) builds and parses those URLs, and a request must clear three
checks before a byte is read: it names one of `assets/`, `generations/` or
`thumbnails/` (so `opendirect.db`, `project.json` and the in-flight `tmp/`
downloads are not addressable), it survives `resolveAssetPath()`, and its
`realpath` is still inside the project — which is what stops a symlink planted
under `assets/` from serving a file outside it.
`media-service.ts` registers the scheme (before `app.whenReady()`, privileged,
`standard` + `secure` + `stream`, and **not** `bypassCSP`) and streams the bytes
with `net.fetch` over a `file://` URL, forwarding the request's `Range` header. `img-src` and `media-src` name `asset:`
in both copies of the policy — and nothing else does, so the scheme can never
become a script or connect source. An unknown, escaping or missing path is a
plain 404.

Assets therefore reach the renderer as `url` / `thumbnailUrl`; an absolute
filesystem path never crosses the IPC boundary (only `project.path`, which the
user chose and the title bar shows).

## Model catalog cache

`apps/desktop/src/main/catalog.ts` merges every **configured** provider's model
list into one catalog and caches it at
`<userData>/model-catalog.json` as `{ version, models, descriptors, fetchedAt }`.
A `list()` serves that file for 24 hours and re-fetches once it is older; the
picker's "Refresh catalog" item forces a re-fetch. Freshness is tracked *per
modality* (`kindFetchedAt`), so a kind-scoped refresh neither blanks nor
re-stamps the other modality, and the file is written atomically
(`.tmp` + rename). Full `ModelDescriptor`s
(which carry the whole input JSON Schema) are fetched one key at a time and
cached under `descriptors`, never eagerly.

Both adapters are registered at startup (`providers/bootstrap.ts`) and are
handed a *getter* for their key, so a key added in Settings takes effect on the
next refresh without re-registering anything. A provider that fails a refresh
is logged, skipped, and reported back in the listing's `failures` so the picker
can name it ("Replicate: …"); if every provider fails, the previous cache is
kept rather than replaced with an empty catalog. Setting or clearing an API key
invalidates the catalog in main and the `["models"]` queries in the renderer.

> ⛔ The catalog only ever calls the providers' free listing endpoints.

## Packaging and releases

`apps/desktop/electron-builder.yml` packages the app. The Next.js static export
(`apps/web/out`) is **not** inside `app.asar`: electron-builder copies it beside
the archive as an `extraResource`, and `resolveRendererDirectory()` picks the
layout from `app.isPackaged` (`<resources>/web` when packaged, `../../../web/out`
when running `dist/main/index.js` straight out of the workspace).

Smoke-test packaging without producing installers:

```bash
pnpm build
pnpm --filter @opendirect/desktop exec electron-builder --dir --linux
```

See `docs/RELEASING.md` for changesets, tagging, the GitHub Actions release
workflow, auto-update and the code-signing / notarization secrets.

## Renderer data hooks

`apps/web/hooks/{use-containers,use-assets,use-generations}.ts` wrap `invoke`
in TanStack Query. Every key comes from `apps/web/hooks/query-keys.ts`, and the
keys are hierarchical so a mutation can invalidate the narrowest thing that
changed: an import invalidates `["assets", containerId]`, deleting a container
invalidates `["containers"]`, `["assets"]` and `["generations"]`, and opening a
different project `resetQueries()` — everything cached belonged to the project
that was open when it was fetched.

## Renderer Content-Security-Policy

The production renderer is served by `electron-serve` v3 over `app://`.
electron-serve answers those requests from `session.protocol.handle`, which
**bypasses Electron's `webRequest` module**, so `onHeadersReceived` cannot set
the renderer's CSP. The policy therefore ships as a
`<meta http-equiv="Content-Security-Policy">` tag emitted by the Next.js root
layout in production builds (`apps/web/lib/csp.ts`). The main process still sets
the same policy as a response header for anything that does go through the
network stack, and `test/csp.test.ts` keeps the two strings identical.

A meta policy only governs what the parser sees after it, and React hoists
`<meta>` to the *end* of `<head>`, behind Next's async script tags. The
`node scripts/hoist-csp.ts` step in `web`'s build therefore moves the tag to the
front of `<head>` in every exported page. Note that `frame-ancestors` is ignored
in the meta form — framing is prevented by the shell never loading the renderer
in a frame, and `frame-src 'none'` stops the renderer framing anything else.

> **TODO (first GUI run):** no display is available in the current environment,
> so this has only been verified by reading electron-serve's source and checking
> the tag order in the built `apps/web/out/*.html`. On the first real GUI run, open DevTools
> on a production build and confirm the CSP is reported as active and that
> nothing in the app is blocked by it.

## App shell

`apps/web/app/page.tsx` renders `components/shell/app-shell.tsx`, which is the
whole window. With no project open it shows `project-launcher.tsx` (create,
open a folder, or pick a recent one); everything else needs a database, and the
database lives inside the project.

The four sidebar headings — Characters, Scenes, Assets, Generations — are a
*view* over `containers:tree`, not rows of their own. `lib/board/sidebar-tree.ts`
maps a container's `kind` to its heading and treats a `project`-kind container
as transparent, hoisting its children, so a project that wraps everything in one
root and a project that files characters at the top level render identically.

The board is `masonic`'s `useMasonry` (not `<Masonry>`), because the grid
scrolls inside a panel rather than the browser window: the scroll box is
measured with a `ResizeObserver` and its `scrollTop` is fed to the hook
directly. An unmeasured box reports `0`, which `boardMetrics` turns into a
desktop-sized guess so the first paint is a grid instead of nothing.

Board tiles mix assets and generations. A finished run is already on the board
as its output assets, so its own record is dropped; a queued, running or failed
run has no asset yet and gets a placeholder tile (`buildBoardItems`).

**Drag and drop.** A card is a `role="button"` tile: Enter selects it, Space
picks it up for the `KeyboardSensor` and the arrow keys walk it to a container.
Dropping a card on a container **adds** it — an asset
legitimately lives in many containers and a copy is the non-destructive
default. Starting the drag with Shift held **moves** it: the same add, then an
unlink from the source board, in that order and only on success. The decision
is `lib/board/drop-target.ts`; the mutations are `hooks/use-asset-dnd.ts`,
which tracks Shift for the whole drag so the overlay says what the drop will
actually do.

**File import.** `File.path` was removed in Electron 32, so a dropped file is
resolved through `webUtils.getPathForFile` in the preload, exposed as
`window.opendirect.pathForFile` and wrapped by `pathsForFiles` in
`apps/web/lib/ipc.ts`. Outside Electron it returns an empty list rather than
throwing, and the board says "Nothing to import" instead of firing a no-op
mutation. The Import button uses the `assets:choose` dialog channel instead.
Either way the board reports the counts the main process returns — imported,
already here, failed — and lists the files it could not read.

Component tests run under jsdom via a `// @vitest-environment jsdom` pragma.
`vitest.config.ts` sets the automatic JSX runtime (the renderer's tsconfig says
`jsx: "preserve"`, which the transformer cannot emit) and the `@/…` alias;
`vitest.setup.ts` stubs `ResizeObserver`, `matchMedia` and
`Element.prototype.getAnimations`, which jsdom lacks and which `masonic`, the
shadcn sidebar and Base UI's ScrollArea require; it also registers the
`@testing-library/jest-dom` matchers.

## Creation bar

The bar (`apps/web/components/create/*`) is a `sticky bottom-0` sibling of the
board's panel group, so it stays put while the board scrolls under it.

**The schema split.** `lib/schema-form/split-schema.ts` partitions a
`ModelDescriptor`'s input schema into three: the promoted **common** controls
(whatever `commonControls` named — prompt, aspect ratio, duration, resolution,
seed, audio), the **reference slots**, and **advanced**, which is everything
else. The partition is total and `split-schema.test.ts` asserts it property by
property: a field OpenDirect has never heard of still reaches the user, under
Advanced. Common controls get hand-built shadcn widgets picked from the
schema's own shape (`lib/schema-form/widgets.tsx`); Advanced is rendered by
`@rjsf/shadcn` with the `@rjsf/validator-ajv8` validator, alongside a read-only
preview of the request.

**Reference limits.** Dropping an asset or a whole container on the tray goes
through `lib/create/references.ts`. When the drop exceeds the slot's capacity
(`maxItems`, or 1 for a single-value slot) OpenDirect **does not pick**: the
plan comes back as `choose` and `reference-picker.tsx` opens with nothing
selected and the model's limit stated. The `✨ Suggest N` button is present but
disabled until the local `claude`/`codex` helper exists (Task 18). A container
is dragged by its sidebar label, which is a `useDraggable` handle on the row's
button only — the chevron and the rename field keep working as themselves.

**Cost.** `cost:estimate` runs `providers/cost.ts` in main, so the pricing
table lives in exactly one place. `costParams` re-attaches the filled reference
slots before quoting, because Replicate's dearer tier is selected by the
presence of a video input. `~$0.64` is an estimate, `$0.64` a provider-reported
figure, and a model with no usable rate reads **Cost unknown** with the reason
on hover — never `$0.00`.

**Submitting.** Generate builds a `GenerationRequest`
(`lib/create/request.ts`) and calls `generations:submit`, which in the main
process writes one `queued` row with its reference links
(`apps/desktop/src/main/generations-submit.ts`) and then hands it to the job
runner. The row is always written first, so a crash between the two leaves a
free `queued` row rather than a provider job nothing knows about.

The prompt is stripped from the params sent to `cost:estimate` (`costParams`):
no provider prices a media generation by prompt length, and the params are part
of the query key, so leaving it in would re-quote the same price on every
keystroke.

## Job runner

`apps/desktop/src/main/jobs/` owns every paid call in the app.

- **`runner.ts`** — one `p-queue` whose concurrency is the `maxConcurrentJobs`
  setting, over durable `jobs` rows. A run walks
  `queued → submitting → running → downloading → succeeded | failed | canceled`,
  and every transition is written to SQLite *before* it is pushed to the
  renderer as a `jobs:update` event.
- **`poll.ts`** — the timing and retry arithmetic: the poll interval comes from
  settings and is jittered; a 5xx, a 429 or a transport failure is retried with
  exponential backoff up to three attempts; a 4xx, a provider-reported failure
  and a failed download are all terminal, because by then the request has
  already been paid for.
- **`download.ts`** — streams each output into `tmp/` and renames it into
  `generations/<id>/<index>.<ext>` only once the length checks out, so the
  project never holds a half-written file. `attachOutputs` then creates the
  asset rows and files them on the run's board.
- **Crash recovery** (`recoverJobs()` in `jobs-service.ts`, called once at
  startup) re-attaches to any run that still has a `provider_job_id` and keeps
  polling it; a run interrupted mid-submit with no provider job id is marked
  failed with a message telling the user to check the provider's dashboard
  before retrying, because re-submitting could pay for the same run twice.

The job list is a Sheet on the status strip (`components/jobs/`): model, state,
elapsed time, progress, estimated-vs-actual cost, the provider's error inline,
and Cancel / Retry.

⛔ Every test of this path runs against `msw` handlers; the harness's
`onUnhandledRequest: "error"` is what guarantees no test can reach a live
provider. Do not weaken it.

## First real generation — a manual check, for a human

⛔ **This checklist is for the user to run, never for an agent.** It is the only
step in the project that spends money, and nothing automated may perform it.

1. `pnpm dev:desktop`, and open or create a project.
2. Settings → paste a Replicate or OpenRouter key and verify it.
3. Pick a **cheap image model** (not a video model) in the creation bar.
4. Type a short prompt and read the cost badge. If it says "Cost unknown",
   stop and find out why before pressing anything.
5. Press **Generate once**. Do not press it again while the job list shows the
   run as active.
6. Watch the job list: `Queued → Submitting → Running → Downloading → Done`.
7. Confirm the output appears on the board and that the file is on disk under
   `<project>/generations/<generation-id>/0.<ext>`.
8. Confirm the recorded cost: OpenRouter reports the exact figure, Replicate
   leaves the estimate in place (it publishes no per-run cost).
9. Quit the app mid-run once, restart, and confirm the run re-attaches and
   finishes rather than being submitted a second time.

## CI

`.github/workflows/ci.yml` runs `typecheck`, `lint`, `test` and `build` on
pushes to `main` and on every pull request.
`.github/workflows/release.yml` runs on `v*` tags and publishes signed
installers plus auto-update metadata to a GitHub Release.
