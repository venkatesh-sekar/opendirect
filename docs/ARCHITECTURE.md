# Architecture

How OpenDirect is put together, and why each piece is the shape it is. This is
the map; [`DEVELOPMENT.md`](DEVELOPMENT.md) is the terrain — it documents each
subsystem in the detail you need to change it.

## The shape of the thing

```
┌──────────────────────────────── Electron ─────────────────────────────────┐
│                                                                           │
│  renderer (apps/web)                    main (apps/desktop)               │
│  ────────────────────                   ────────────────────              │
│  Next.js 16 static export               SQLite (better-sqlite3 + Drizzle)  │
│  React 19 + shadcn/ui                   the project folder on disk        │
│  TanStack Query                         provider HTTP (Replicate, OR)     │
│  @rjsf/shadcn schema forms              the job runner (p-queue)          │
│                                         safeStorage key vault             │
│  contextIsolation: true                 child_process.spawn(claude|codex) │
│  nodeIntegration: false                 electron-updater                  │
│                                                                           │
│         └──── window.opendirect.invoke ──── zod contract ────┘            │
│         └──── asset:// protocol (read-only, contained) ──────┘            │
└───────────────────────────────────────────────────────────────────────────┘
```

Four workspaces:

| Workspace                | What it is                                                |
| ------------------------ | --------------------------------------------------------- |
| `apps/web`               | The renderer. A plain SPA once exported; no Node at runtime |
| `apps/desktop`           | The Electron main process. Everything privileged           |
| `packages/contract`      | The zod IPC contract, imported by both processes            |
| `packages/ui`            | shadcn/ui components shared by the renderer                 |
| `packages/{eslint,typescript}-config` | Shared lint and tsconfig bases                |

## The load-bearing decisions

**Electron, not Tauri 2.** The whole stack stays TypeScript — no Rust toolchain
— `better-sqlite3` and `child_process.spawn('claude')` work natively, and
electron-builder + electron-updater + GitHub Releases is the most battle-tested
desktop auto-update path there is.

**A static-exported Next.js renderer.** `output: 'export'` produces a plain SPA
bundle. In development it is the dev server on `localhost:3000`; in production
`electron-serve` serves it over `app://`. No Node server ever ships to a user.

**All privilege in main.** The renderer gets `contextIsolation: true`,
`nodeIntegration: false` and one typed `invoke` bridge. There is no path from a
React component to the filesystem, the database, a provider key or a child
process — only to a named channel that main decides how to answer.

**The IPC contract is data, not convention.** `packages/contract` declares every
channel's input and output as a zod schema. The renderer parses the input before
it leaves, main parses it again on arrival, and the response is parsed back on
the way home. A schema change cannot silently desync the two processes, and
`createIpcRegistrar` refuses to register a channel the contract does not
declare. Main→renderer pushes (`jobs:update`, `updater:status`, `ai:progress`)
go through the same validation in both directions.

**Drizzle + better-sqlite3.** Synchronous, embedded, zero-daemon, with typed
queries and real generated migration files (`drizzle-kit generate`) instead of
hand-rolled SQL. The database lives *inside the project folder*, not in
`userData`, which is why the migration runner runs on project open rather than
at startup.

**`@rjsf/shadcn` for model schemas.** Replicate hands us literal JSON Schema, so
rendering it is a library's problem, not ours. `split-schema.ts` partitions a
descriptor into promoted common controls, reference slots, and everything else;
the partition is *total*, asserted property by property in tests, so a
parameter we have never heard of still reaches the user under **Advanced**.

**`@xyflow/react` for the canvas.** The project workspace is a node graph, and
pan, zoom, edge rendering, handles, selection and the minimap are all things a
mature library already does well. Custom node types are plain React components
registered in a `nodeTypes` map, so every node is still our own shadcn and
Hugeicons markup. React Flow's stylesheet is imported once and re-themed by
overriding its CSS custom properties with our Tailwind v4 tokens, so the canvas
follows light and dark mode and `default-src 'self'` stands unchanged. It
replaced `masonic`, which laid out the old masonry board.

**`elkjs` for the migration layout.** A project that predates the canvas is
turned into nodes and edges once, from its own lineage, by a layered ELK layout
in the main process. It is dual licensed EPL-2.0 or GPL-3.0-or-later; we take it
under EPL-2.0 and list it in the installers' third-party notices. If a layout
throws, **nothing is written** — the project opens on an empty canvas with a
"Lay out my existing work" button, because a half-written layout would be worse
than none.

**`p-queue` over durable SQLite rows.** Concurrency limiting from a library,
durability from the database, so jobs survive a restart. No external broker for
a single-user desktop app.

**`electron-store` + `safeStorage`.** Settings in JSON, API keys encrypted at
rest by the OS keychain. `.env.local` is developer convenience only and never
reaches a packaged build.

**Changesets over release-please.** Monorepo-native, matches the Turborepo
scaffold, and produces both the changelog and the version bump that
electron-builder publishes against.

**Video thumbnails are renderer-side `<video>` posters, not `ffmpeg-static`.**
*(Open question 4 from the plan, now decided.)* A first-frame grab would have
cost a ~70 MB per-platform binary and its own licensing story in every
installer, to reproduce something Chromium already does for free: a
`<video preload="metadata">` paints its own first frame. Video assets therefore
record `thumbnailRelPath: null`. Images do get a real derived preview — `sharp`
writes a 512px WebP and fills `width`/`height` in the same pass. Revisit this
only if a scrubbable filmstrip is wanted, because that does need real decoding.

## Data model

`Container → Asset → Generation`, and nothing else is special.

```
projects · containers · assets · container_assets · generations ·
generation_inputs · jobs
```

A container is a container whether it is a project, a character or a scene —
`kind` is a label the sidebar groups by, not a different type. An asset belongs
to *many* containers through `container_assets`, which is why dropping a card on
a container **adds** rather than moves by default: an asset legitimately lives
in several places and a copy is the non-destructive choice.

A project is a folder the user owns:

```
Infinite Hotel/
  project.json        identity — the source of truth
  opendirect.db       SQLite (WAL), migrated on every open
  assets/<yyyy>/<mm>/ imported media, deduplicated by sha256 within the project
  generations/<id>/   model outputs, one folder per run
  thumbnails/         derived previews, safe to delete
  tmp/                in-flight downloads, cleared on open
```

Foreign keys are ON (off by default in SQLite — without it the cascades are
decoration). Deleting a project cascades; deleting a *generation* only detaches
its output assets and its branch children, so pruning a run never destroys media
or lineage.

## Providers

A provider adapter answers two questions — what models exist, and what does this
one's input look like — and then submits and polls. Both adapters normalise into
one `ModelDescriptor`, so nothing above them knows which provider it is talking
to.

The two are genuinely different underneath:

- **Replicate** publishes the input JSON Schema at
  `latest_version.openapi_schema.components.schemas.Input`, and **no pricing at
  all**. Cost therefore comes from a curated `REPLICATE_PRICING` table, is
  labelled an estimate (`~$0.64`), and falls back to **Cost unknown** with the
  reason on hover rather than to a confident `$0.00`.
- **OpenRouter** publishes `pricing_skus` whose *keys differ per model*
  (`video_tokens` for one, `duration_seconds_with_audio` for another), so the
  cost code handles them generically, and reports `usage.cost` — the real
  figure — when a job completes.

Model capability data is cached at `<userData>/model-catalog.json` with
per-modality freshness, written atomically, and re-fetched after 24 hours or on
an explicit "Refresh catalog" (`⌘R`). A provider that fails a refresh is
reported in the listing's `failures` and named in the picker; if *every*
provider fails, the previous cache is kept rather than replaced with nothing.

> ⛔ The catalog only ever calls free listing endpoints. So does key
> verification.

## The generation path

This is the only part of the app that spends money, so it is the part with the
most rules.

```
prompt bar → generations:submit → queued row in SQLite → p-queue
   → submitting → running (poll) → downloading → succeeded | failed | canceled
```

The canvas changed where a request is composed, and nothing else on this path.
The prompt bar under the selected generate node builds the same
`GenerationRequest` the old creation bar built — the node's incoming edges
become its `references`, each carrying the `slotField` the edge is labelled
with, and any text node feeding it is prepended to the prompt. There is no
workflow engine, no execution order and no auto-run: pressing Generate on one
node runs one node.

A batch is the one addition. `canvas-batch.ts` reads the model's own input
schema for a field that reads as an output count; when there is one, N goes in
that field and one job is submitted, and when there is not, N identical requests
are submitted sharing a `batch_id` (a new nullable, indexed column on
`generations`). Either way the node ends up with N results and exactly one
**pick**, which is the asset its outgoing edges resolve to. Picking re-runs
nothing.

- The **row is written before the request**, so a crash in between leaves a free
  `queued` row rather than a paid provider job nothing knows about.
- Once `generations.provider_job_id` is set, every later attempt — a retry after
  a flaky poll, a restart, the Retry button — **polls** it. Nothing resubmits.
- A submit that fails with *no HTTP status at all* is terminal, because the
  provider may have accepted it; the error tells the user to check their
  dashboard rather than quietly trying again.
- Retries are for 5xx and 429 only, with jittered exponential backoff, three
  attempts. A 4xx, a provider-reported failure and a failed download are all
  terminal — by then the request has already been paid for.
- Outputs stream into `tmp/` and are renamed into `generations/<id>/` only once
  the length checks out, so the project never holds a half-written file. The
  provider response and cost are recorded **before** the download, so a failed
  download can be retried for free.
- Every transition is written to SQLite before it is pushed as `jobs:update`.
- **A restart never submits.** `recover()` re-attaches to provider jobs (polling
  is free) and fails the ones interrupted mid-submit, but a run still sitting in
  `queued` is left queued and flagged `awaitingResume` — the job list shows it
  with a **Resume** button. Launching the app is not consent to spend money.
- **One instance.** `app.requestSingleInstanceLock()`; a second launch focuses
  the existing window and quits. Two copies would run two job runners over one
  `jobs` table, which is another way to pay twice.

## Security boundaries

| Boundary                | How it is held                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Renderer → OS           | `contextIsolation`, `sandbox: true`, no `nodeIntegration`, one preload bridge, every channel in the contract. The preload requires nothing but `electron` — `zod` is bundled into it, because a sandboxed preload cannot `require` a package |
| Renderer → local files  | `asset://` only: the path must name `assets/`/`generations/`/`thumbnails/`, survive `resolveAssetPath()`, and still be inside the project after `realpath` — which is what stops a planted symlink |
| Renderer → network      | A CSP with `default-src 'self'` in **both** builds — production's, and a development one that differs only by `'unsafe-eval'` and the HMR socket; `asset:` appears only in `img-src`/`media-src`, so it can never become a script or connect source |
| API keys                | `safeStorage` (OS keychain) in main; `settings:keys:summary` returns `{ present, last4 }` and the key itself never crosses IPC |
| Child processes         | `shell: false`, argv of flags only, prompt on stdin, a deadline and an abort signal, and an **allowlisted environment**: a variable has to be named in `ENV_ALLOWLIST` (PATH, HOME, locale, XDG, the Windows equivalents) to survive, plus each CLI's own login and never the other's. A denylist of credential-shaped names was the earlier design and was wrong — it has to anticipate every spelling, and `GH_PAT` is not one of them. `claude` also runs with an explicit deny list covering Bash/Edit/Write and the search and indirection tools |
| Opening a file          | "Open" hands a file to the OS's handler, so it is limited to the media extensions the app recognises (and never `.svg`) — a project folder is filled by imports and provider downloads, not by us. "Reveal in folder" executes nothing and is unrestricted |
| Committed secrets       | CI greps every tracked file for Replicate (`r8_…`) and OpenRouter (`sk-or-v1-…`) key shapes and fails the build on a hit |

## The AI helpers

Improve prompt · Describe reference · Analyze video · Suggest shots. All four
are the user's own locally installed `claude` or `codex`, spawned by main. If
neither binary is on `PATH`, every entry point is hidden rather than greyed out
— OpenDirect ships no assistant and calls no AI provider for them.

A helper returns **text**. Putting that text anywhere is a button the user
presses; nothing is ever applied automatically. A reference helper is given an
*asset id*, never a path — main resolves it through the same containment check
`asset://` uses before a path reaches a child process.

⛔ Not a generation: these spend the user's own CLI subscription, never a
provider credit.

## Packaging and updates

The Next.js export is **not** inside `app.asar` — electron-builder copies it
beside the archive as an `extraResource`, and `resolveRendererDirectory()` picks
the layout from `app.isPackaged`. Native modules (`better-sqlite3`, `sharp`) are
`external` to tsup and `asarUnpack`ed, because both resolve binaries by path at
runtime.

electron-updater polls the GitHub Releases feed baked into `app-update.yml`,
downloads in the background, and installs on quit. The status bar surfaces
progress from `updater:status`, and offers **Restart to update**
(`updater:install`) once one is actually staged — bringing the quit forward is
the user's decision, never ours, because a restart mid-run is not free.

See [`RELEASING.md`](RELEASING.md) and
[`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md).

## Testing

686-plus tests, all offline. `vitest.setup.ts` starts `msw` with
`onUnhandledRequest: "error"`, so a request no test mocked is a **failing test**
rather than a live call. Provider code is tested against recorded fixtures; the
AI spawn path is tested against `test/fixtures/ai/fake-cli.mjs`, never the real
binaries; the database layer runs against `:memory:` or a temp project folder.

Pure logic is deliberately separated from Electron so most of it tests in plain
Node: `project.ts`, `media.ts`, `updater-policy.ts`, `run-cli.ts`, `cost.ts`,
the repositories and the schema splitters all import nothing from `electron`.

> ⛔ Do not weaken `onUnhandledRequest: "error"`. CI asserts it is still there.
