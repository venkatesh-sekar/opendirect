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
| `pnpm build`      | Builds every workspace                                   |
| `pnpm lint`       | ESLint (flat config) in each workspace                   |
| `pnpm typecheck`  | `tsc --noEmit` per workspace, plus the root test harness |
| `pnpm test`       | Vitest (single run)                                      |
| `pnpm test:watch` | Vitest in watch mode                                     |
| `pnpm format`     | Prettier over the repo (`*.md` is left alone)            |

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

## CI

`.github/workflows/ci.yml` runs `typecheck`, `lint`, `test` and `build` on
pushes to `main` and on every pull request.
