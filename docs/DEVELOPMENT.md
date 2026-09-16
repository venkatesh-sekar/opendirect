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

> **TODO (first GUI run):** no display is available in the current environment,
> so this has only been verified by reading electron-serve's source and grepping
> the built `apps/web/out/index.html`. On the first real GUI run, open DevTools
> on a production build and confirm the CSP is reported as active and that
> nothing in the app is blocked by it.

## CI

`.github/workflows/ci.yml` runs `typecheck`, `lint`, `test` and `build` on
pushes to `main` and on every pull request.
`.github/workflows/release.yml` runs on `v*` tags and publishes signed
installers plus auto-update metadata to a GitHub Release.
