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

## CI

`.github/workflows/ci.yml` runs `typecheck`, `lint`, `test` and `build` on
pushes to `main` and on every pull request.
`.github/workflows/release.yml` runs on `v*` tags and publishes signed
installers plus auto-update metadata to a GitHub Release.
