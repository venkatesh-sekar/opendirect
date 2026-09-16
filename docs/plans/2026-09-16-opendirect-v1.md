# OpenDirect v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build OpenDirect — a local-first desktop workspace for generative media where Containers hold Assets, any Asset can be a Reference, and the generation UI is driven entirely by each model's own schema.

**Architecture:** A Turborepo monorepo scaffolded by the shadcn CLI (`apps/web` = Next.js renderer, `packages/ui` = shadcn components). We add `apps/desktop`, an Electron main process that owns everything privileged: SQLite (better-sqlite3 + Drizzle), the project folder on disk, provider HTTP calls (Replicate, OpenRouter), the background job runner, and child-process spawning of locally installed `claude` / `codex` CLIs. The renderer is a static-exported Next.js app talking to main over a typed, zod-validated IPC contract, consumed through TanStack Query. Model capability schemas are fetched live from the providers and rendered into forms with `@rjsf/shadcn`, so the app never hardcodes a model's parameters.

**Tech Stack:** pnpm + Turborepo · Next.js 16 (static export) · React 19 · shadcn/ui (preset `bIkfFpI`, style `vega`, hugeicons) · Electron 44 · electron-builder 26 · electron-updater 6 · electron-serve 3 · tsup · better-sqlite3 13 + drizzle-orm 0.45 · zod 4 · @tanstack/react-query 5 · @rjsf/core + @rjsf/shadcn 6 + @rjsf/validator-ajv8 · masonic 4 · @dnd-kit/core 6 · p-queue 9 · electron-store 11 + Electron `safeStorage` · replicate 1.4 · @openrouter/sdk 1.2 · vitest 5 + msw 2 · @changesets/cli 3

---

## ⛔ ABSOLUTE RULE — READ BEFORE EVERY TASK

**NEVER trigger a paid generation during development, testing, or verification.**

- ❌ Do NOT call `replicate.run()`, `replicate.predictions.create()`, `POST /v1/predictions`, `POST /api/v1/videos`, `POST /api/v1/images/generations`, `POST /api/v1/chat/completions`, or `client.callModel()` against the live APIs. Not once. Not with a "cheap" model. Not to "just check the shape".
- ✅ ALLOWED against live APIs (read-only, free): `GET /v1/models`, `GET /v1/models/{owner}/{name}`, `GET /v1/collections`, `GET /v1/collections/{slug}`, `GET /v1/hardware`, `GET /v1/search`, `GET /api/v1/models`, `GET /api/v1/videos/models`, `GET /api/v1/images/models`.
- ✅ All generation/submission/polling code is tested **exclusively** with `msw` request handlers backed by recorded fixture JSON.
- ✅ Local `claude` / `codex` CLI helpers may be invoked in dev (they use the user's own subscription) but must be mocked in tests by stubbing `spawn`.
- If a task's verification seems to require a real generation, **stop and report** instead of running it.

---

## Decisions

- **Electron over Tauri 2** — the whole stack stays TypeScript (no Rust toolchain), `better-sqlite3` and `child_process.spawn('claude')` work natively, and electron-builder + electron-updater + GitHub Releases is the most battle-tested desktop auto-update path.
- **Next.js renderer via static export + `electron-serve`** — `output: 'export'` gives a plain SPA bundle Electron can serve over a custom protocol in production and a dev server on `localhost:3000` in development; no Node server ships to users.
- **All privilege lives in the Electron main process** — renderer gets `contextIsolation: true`, `nodeIntegration: false`, and a single typed `invoke` bridge; DB, fs, provider keys and child processes never touch the renderer.
- **Drizzle + better-sqlite3** — synchronous, embedded, zero-daemon, and Drizzle gives typed queries plus real migration files (`drizzle-kit generate`) rather than hand-rolled SQL.
- **`@rjsf/shadcn` for model-schema→form** — Replicate hands us literal JSON Schema, and rjsf v6 ships an official shadcn theme, so schema rendering is a library concern, not ours.
- **`masonic` for the board** — virtualized masonry; a container with 500 assets must stay at 60fps, which CSS-column masonry cannot guarantee.
- **`@dnd-kit/core` for drag & drop** — accessible, pointer+keyboard, no HTML5 DnD quirks, actively maintained.
- **`p-queue` + a SQLite `jobs` table** — concurrency limiting from a library, durability from the DB, so jobs survive an app restart; no external broker for a single-user desktop app.
- **`electron-store` + Electron `safeStorage`** — settings in JSON, API keys encrypted at rest by the OS keychain; `.env.local` (gitignored) only for developer convenience.
- **Changesets over release-please** — it is monorepo-native, matches the Turborepo scaffold, and produces both the CHANGELOG and the version bump that electron-builder publishes against.
- **Replicate exposes no pricing via API** (verified: `GET /v1/models/bytedance/seedance-2.5` returns `run_count` but no price field) — so Replicate cost is a curated local pricing table plus an explicit "estimate, unverified" badge; OpenRouter *does* expose `pricing_skus` and returns actual `usage.cost` on job completion.
- **Verified model slugs** (via live Replicate search + OpenRouter model endpoints, 2026-09-16): Replicate `bytedance/seedance-2.5`, `bytedance/seedance-2.0`, `google/nano-banana-2`, `google/nano-banana-pro`; OpenRouter `bytedance/seedance-2.5`, `bytedance/seedance-2.0-mini`, `google/gemini-3-pro-image`.

---

## Verified research notes (do not re-derive)

**shadcn preset `bIkfFpI`** decodes to: `version b · style vega · baseColor neutral · theme neutral · chartColor neutral · iconLibrary hugeicons · font inter · fontHeading inherit · radius default · menuAccent subtle · menuColor default`. `--monorepo` produces `apps/web` + `packages/ui` + root `turbo.json`, with `@workspace/ui/components/*` and `@workspace/ui/lib/utils` import aliases and a `components.json` in each workspace. `--pointer` sets `cursor: pointer` on buttons.

**Replicate model object** (`GET /v1/models/{owner}/{name}`) top-level keys: `cover_image_url, created_at, default_example, description, github_url, is_official, latest_version, license_url, name, owner, paper_url, run_count, url, visibility, weights_url`. `latest_version` = `{cog_version, created_at, id, openapi_schema}`. The input JSON Schema is at `latest_version.openapi_schema.components.schemas.Input`, output at `...schemas.Output`. **There is no pricing/hardware field.** `bytedance/seedance-2.5` Input properties: `aspect_ratio, duration, generate_audio, image, last_frame_image, output_format, prompt, reference_audios, reference_images, reference_videos, resolution, seed, watermark`.

**Replicate collections** relevant to us: `text-to-video`, `image-to-video`, `video-editing`, `text-to-image`, `image-editing`, `official`.

**OpenRouter `GET /api/v1/videos/models`** returns 29 models shaped like:
```json
{"id":"bytedance/seedance-2.5","canonical_slug":"bytedance/seedance-2.5-20260807","name":"ByteDance: Seedance 2.5",
 "supported_resolutions":["480p","720p"],"supported_aspect_ratios":["16:9","4:3","1:1","3:4","9:16","21:9"],
 "supported_sizes":["854x480","1280x720","..."],"supported_durations":[4,5,6,"...",30],
 "supported_frame_images":["first_frame","last_frame"],"generate_audio":true,"seed":true,
 "pricing_skus":{"video_tokens":"0.0000107","video_tokens_without_audio":"0.0000107","video_tokens_with_video_input":"0.0000064"},
 "allowed_passthrough_parameters":["watermark","req_key","output_format"]}
```
`google/veo-3.1-lite` instead prices as `{"duration_seconds_with_audio":"0.08","duration_seconds_without_audio":"0.05","duration_seconds_with_audio_720p":"0.05","duration_seconds_without_audio_720p":"0.03"}` — i.e. **pricing_skus keys vary per model and must be handled generically.**

**OpenRouter `GET /api/v1/images/models`** returns 52 models with `architecture.{input_modalities,output_modalities}` and a typed `supported_parameters` map, e.g. `{"aspect_ratio":{"type":"enum","values":[...]},"n":{"type":"range","min":1,"max":10},"input_references":{"type":"range","min":0,"max":16}}`.

**OpenRouter `GET /api/v1/models?output_modalities=video|image`** also works and returns the generic model objects with `pricing`.

**OpenRouter video job flow:** `POST /api/v1/videos` with `{model, prompt, duration, resolution, aspect_ratio, size, frame_images:[{frame_type:"first_frame"|"last_frame", ...}], input_references:[...], generate_audio, seed, provider}` → poll `GET /api/v1/videos/{jobId}` → `{status: "pending"|"in_progress"|"completed"|"failed", unsigned_urls: [...], usage: {cost, is_byok}, generation_id, error}`. `frame_images` takes precedence over `input_references` when both are given.

---

## Conventions for every task

- Package manager is **pnpm**. Run commands from the repo root unless a task says otherwise.
- Repo root is `/primary01/git/video-production/opendirect`. All paths below are relative to it.
- Standard verification (run before every commit): `pnpm typecheck && pnpm lint && pnpm test`.
- Commit messages use Conventional Commits. Commit at the end of every task.
- Every new user-facing behaviour gets a test first (TDD). Provider network code is tested with `msw`, never live.

---

### Task 1: Bootstrap the monorepo with the shadcn CLI

**Files:**
- Create: the entire scaffold (`apps/web/`, `packages/ui/`, `turbo.json`, `package.json`, `pnpm-workspace.yaml`)

**Step 1: Confirm the repo is empty apart from the spec and this plan**

```bash
cd /primary01/git/video-production/opendirect
git status --porcelain
ls -A
```
Expected: only `product.md`, `docs/`, `.git/`.

**Step 2: Run the bootstrap command — EXACTLY this, no substitutions**

```bash
cd /primary01/git/video-production/opendirect
npx shadcn@latest init --preset bIkfFpI --template next --monorepo --pointer
```

When prompted for a project name, use `opendirect`. Choose **pnpm** as the package manager. If the CLI creates a nested `opendirect/` directory instead of scaffolding in place, move its contents up one level (`mv opendirect/{.,}* .` then `rmdir opendirect`) so `apps/` and `packages/` sit at the repo root, and re-check `git status`.

**Step 3: Verify the produced structure**

```bash
ls apps packages
cat turbo.json
cat apps/web/components.json
cat packages/ui/components.json
```
Expected: `apps/web`, `packages/ui`, a `turbo.json` with a `build` pipeline, and components.json files whose aliases point at `@workspace/ui`.

**Step 4: Install and build**

```bash
pnpm install
pnpm build
```
Expected: both succeed.

**Step 5: Confirm the shadcn theme landed**

```bash
grep -r "hugeicons" apps packages --include=package.json
grep -rn "radius" packages/ui/src/styles/globals.css apps/web/app/globals.css 2>/dev/null | head
```
Expected: the hugeicons icon package is a dependency and CSS variables for the `vega` / neutral theme are present.

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: bootstrap shadcn monorepo (preset bIkfFpI, next template)"
```

---

### Task 2: Repo hygiene — scripts, linting, typecheck, vitest, gitignore, CI

**Files:**
- Modify: `package.json` (root), `turbo.json`
- Create: `.gitignore` (append), `.npmrc`, `vitest.config.ts`, `tsconfig.base.json` (only if the scaffold lacks one), `.github/workflows/ci.yml`, `docs/DEVELOPMENT.md`

**Step 1: Add root scripts**

In root `package.json`, ensure `scripts` contains:

```json
{
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "vitest run",
    "test:watch": "vitest",
    "format": "prettier --write ."
  }
}
```

Add a `typecheck` script (`tsc --noEmit`) to `apps/web/package.json` and `packages/ui/package.json`, and register `typecheck` and `lint` tasks in `turbo.json` with `"dependsOn": ["^build"]` where appropriate.

**Step 2: Install dev tooling**

```bash
pnpm add -Dw vitest@5 @vitest/coverage-v8 msw@2 prettier typescript
```

**Step 3: Create `vitest.config.ts` at the repo root**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts", "apps/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

And `vitest.setup.ts`:

```ts
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./test/msw/server";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

Create `test/msw/server.ts`:

```ts
import { setupServer } from "msw/node";

export const server = setupServer();
```

`onUnhandledRequest: "error"` is deliberate: it makes any accidental live API call in a test fail loudly.

**Step 4: Write a smoke test to prove the harness works**

`test/harness.test.ts`:

```ts
import { expect, it } from "vitest";

it("runs the test harness", () => {
  expect(1 + 1).toBe(2);
});
```

**Step 5: Append to `.gitignore`**

```
# env
.env
.env.local
.env.*.local

# build
dist/
out/
release/
*.tsbuildinfo

# local data
*.db
*.db-journal
.opendirect/
```

**Step 6: Create `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
```

**Step 7: Verify**

```bash
pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
Expected: all pass, the smoke test reports 1 passed.

**Step 8: Commit**

```bash
git add -A
git commit -m "chore: add lint/typecheck/vitest tooling, msw harness and CI"
```

---

### Task 3: Electron desktop shell wrapping the Next.js renderer

**Files:**
- Create: `apps/desktop/package.json`, `apps/desktop/tsconfig.json`, `apps/desktop/tsup.config.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/window.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/electron.vite.env.d.ts`
- Modify: `apps/web/next.config.ts`, root `package.json`, `turbo.json`

**Step 1: Make the Next.js app statically exportable**

`apps/web/next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  distDir: "out",
  images: { unoptimized: true },
  // Electron serves from a custom protocol root; relative asset paths are required.
  assetPrefix: process.env.NODE_ENV === "production" ? "./" : undefined,
  trailingSlash: true,
};

export default nextConfig;
```

Every page under `apps/web/app` must be a client component tree (`"use client"` at the route roots) — there is no Node server at runtime.

**Step 2: Create the desktop workspace**

`apps/desktop/package.json`:

```json
{
  "name": "@opendirect/desktop",
  "private": true,
  "version": "0.0.0",
  "main": "dist/main/index.js",
  "scripts": {
    "build:main": "tsup",
    "build": "pnpm build:main",
    "typecheck": "tsc --noEmit",
    "dev": "cross-env NODE_ENV=development electron dist/main/index.js",
    "start": "electron dist/main/index.js"
  },
  "dependencies": {
    "electron-serve": "3.0.1",
    "electron-store": "11.0.2",
    "electron-log": "5.4.4",
    "electron-updater": "6.8.9",
    "better-sqlite3": "13.0.3",
    "drizzle-orm": "0.45.2",
    "p-queue": "9.3.3",
    "replicate": "1.4.0",
    "@openrouter/sdk": "1.2.128",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "electron": "44.4.1",
    "electron-builder": "26.15.3",
    "drizzle-kit": "0.31.10",
    "tsup": "8.5.1",
    "cross-env": "10.1.0",
    "concurrently": "10.0.5",
    "wait-on": "9.1.0",
    "typescript": "5.9.3"
  }
}
```

Install with `pnpm install`. Note `better-sqlite3` is a native module — it is intentionally a **dependency** (not bundled by tsup) so electron-builder can rebuild it per platform.

**Step 3: `apps/desktop/tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { "main/index": "src/main/index.ts" },
    outDir: "dist",
    format: ["cjs"],
    platform: "node",
    target: "node22",
    sourcemap: true,
    clean: true,
    external: ["electron", "better-sqlite3"],
  },
  {
    entry: { "preload/index": "src/preload/index.ts" },
    outDir: "dist",
    format: ["cjs"],
    platform: "node",
    target: "node22",
    sourcemap: true,
    external: ["electron"],
  },
]);
```

**Step 4: `apps/desktop/src/main/window.ts`**

```ts
import { join } from "node:path";
import { BrowserWindow, shell } from "electron";
import serve from "electron-serve";

const isDev = process.env.NODE_ENV === "development";
const loadProduction = serve({ directory: join(__dirname, "../../../web/out") });

export async function createMainWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    await win.loadURL("http://localhost:3000");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    await loadProduction(win);
  }

  return win;
}
```

**Step 5: `apps/desktop/src/main/index.ts`**

```ts
import { app, BrowserWindow } from "electron";
import log from "electron-log/main";
import { createMainWindow } from "./window";

log.initialize();

app.whenReady().then(async () => {
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

process.on("uncaughtException", (err) => log.error("uncaughtException", err));
```

**Step 6: `apps/desktop/src/preload/index.ts`** (stub for now; Task 5 fills it in)

```ts
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("opendirect", {
  version: process.versions.electron,
});
```

**Step 7: Add the dev orchestration script to the root `package.json`**

```json
"dev:desktop": "concurrently -k \"pnpm --filter web dev\" \"wait-on http://localhost:3000 && pnpm --filter @opendirect/desktop build:main && cross-env NODE_ENV=development pnpm --filter @opendirect/desktop start\""
```

**Step 8: Verify**

```bash
pnpm --filter web build          # produces apps/web/out
pnpm --filter @opendirect/desktop build
pnpm typecheck
ls apps/web/out/index.html apps/desktop/dist/main/index.js apps/desktop/dist/preload/index.js
```
Expected: all three files exist. (Launching the GUI is optional here; if a display is available, `pnpm dev:desktop` should show a window rendering the Next.js page.)

**Step 9: Commit**

```bash
git add -A
git commit -m "feat(desktop): add electron shell serving the next.js renderer"
```

---

### Task 4: Packaging, auto-update, changesets and the release workflow

**Files:**
- Create: `apps/desktop/electron-builder.yml`, `apps/desktop/src/main/updater.ts`, `.changeset/config.json`, `.github/workflows/release.yml`, `docs/RELEASING.md`, `CHANGELOG.md`
- Modify: `apps/desktop/src/main/index.ts`, root `package.json`

**Step 1: Install changesets**

```bash
pnpm add -Dw @changesets/cli@3.0.3
pnpm changeset init
```

Edit `.changeset/config.json` to set `"privatePackages": { "version": true, "tag": true }` so the private desktop app still gets versioned, and add root scripts:

```json
"changeset": "changeset",
"version": "changeset version",
"release": "pnpm build && pnpm --filter @opendirect/desktop dist"
```

**Step 2: `apps/desktop/electron-builder.yml`**

```yaml
appId: com.opendirect.app
productName: OpenDirect
directories:
  output: release
  buildResources: build
files:
  - dist/**
  - package.json
extraResources:
  - from: ../web/out
    to: web
asarUnpack:
  - "**/*.node"
publish:
  provider: github
  owner: REPLACE_WITH_GITHUB_OWNER
  repo: opendirect
mac:
  category: public.app-category.graphics-design
  target: [{ target: dmg, arch: [arm64, x64] }, { target: zip, arch: [arm64, x64] }]
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
win:
  target: [{ target: nsis, arch: [x64, arm64] }]
linux:
  target: [AppImage, deb]
  category: Graphics
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

Because `extraResources` copies the web bundle to `resources/web`, update `createMainWindow` in `window.ts` to resolve the production directory as:

```ts
const webRoot = app.isPackaged
  ? join(process.resourcesPath, "web")
  : join(__dirname, "../../../web/out");
```

Create `apps/desktop/build/entitlements.mac.plist` with `com.apple.security.cs.allow-jit`, `com.apple.security.cs.allow-unsigned-executable-memory` and `com.apple.security.cs.disable-library-validation` (the last is required for `better-sqlite3`), plus `com.apple.security.inherit`.

Add a `dist` script to `apps/desktop/package.json`: `"dist": "electron-builder --publish never"`.

**Step 3: `apps/desktop/src/main/updater.ts`**

```ts
import { autoUpdater } from "electron-updater";
import log from "electron-log/main";
import type { BrowserWindow } from "electron";

export function initAutoUpdater(win: BrowserWindow): void {
  if (!process.env.OPENDIRECT_ENABLE_UPDATER && !require("electron").app.isPackaged) return;

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) =>
    win.webContents.send("updater:status", { state: "available", version: info.version }),
  );
  autoUpdater.on("download-progress", (p) =>
    win.webContents.send("updater:status", { state: "downloading", percent: p.percent }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    win.webContents.send("updater:status", { state: "ready", version: info.version }),
  );
  autoUpdater.on("error", (err) =>
    win.webContents.send("updater:status", { state: "error", message: String(err) }),
  );

  void autoUpdater.checkForUpdates();
  setInterval(() => void autoUpdater.checkForUpdates(), 6 * 60 * 60 * 1000);
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall();
}
```

Call `initAutoUpdater(win)` from `index.ts` after the window is created.

**Step 4: `.github/workflows/release.yml`**

```yaml
name: Release
on:
  push:
    tags: ["v*"]
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - name: Build and publish desktop app
        working-directory: apps/desktop
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CSC_LINK: ${{ secrets.MAC_CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
          WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
        run: pnpm exec electron-builder --publish always
```

**Step 5: Write `docs/RELEASING.md`**

Document: (a) `pnpm changeset` on every user-facing PR; (b) `pnpm changeset version` bumps versions and writes `CHANGELOG.md`; (c) tag `v<version>` and push to fire the release workflow; (d) electron-builder uploads installers plus `latest.yml` / `latest-mac.yml` / `latest-linux.yml` to a GitHub Release, which is exactly what electron-updater polls; (e) **code signing**: macOS needs a Developer ID Application certificate exported as base64 into `MAC_CSC_LINK` and notarization credentials in `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` (electron-builder ≥ 24 notarizes automatically when these are set); Windows needs an EV or OV code-signing certificate in `WIN_CSC_LINK`; Linux AppImage/deb are unsigned but should ship a published SHA256; (f) unsigned local builds are fine for development — releases without signing will trip Gatekeeper and SmartScreen, so note this as a blocker before the first public release.

**Step 6: Verify**

```bash
pnpm typecheck
pnpm --filter @opendirect/desktop exec electron-builder --help > /dev/null && echo "electron-builder ok"
node -e "const y=require('js-yaml');" 2>/dev/null || true
pnpm exec changeset status --since=HEAD~1 || true
```
Do **not** run a full `electron-builder` build in CI-less environments; confirming the config parses and the toolchain is installed is sufficient here.

**Step 7: Commit**

```bash
git add -A
git commit -m "build: add electron-builder packaging, electron-updater and release workflow"
```

---

### Task 5: Typed IPC contract between main and renderer

**Files:**
- Create: `packages/contract/package.json`, `packages/contract/src/index.ts`, `packages/contract/src/ipc.ts`, `apps/desktop/src/main/ipc.ts`, `apps/web/lib/ipc.ts`, `apps/web/lib/query.tsx`
- Modify: `apps/desktop/src/preload/index.ts`, `apps/desktop/src/main/index.ts`, `apps/web/app/layout.tsx`

**Step 1: Create a shared `@opendirect/contract` workspace package**

It has zero runtime dependencies beyond `zod@4` and is imported by both main and renderer. `packages/contract/src/ipc.ts` defines one registry object:

```ts
import { z } from "zod";

export const ipcContract = {
  "app:info": { input: z.void(), output: z.object({ version: z.string(), platform: z.string() }) },
} as const;

export type IpcContract = typeof ipcContract;
export type IpcChannel = keyof IpcContract;
export type IpcInput<K extends IpcChannel> = z.input<IpcContract[K]["input"]>;
export type IpcOutput<K extends IpcChannel> = z.output<IpcContract[K]["output"]>;
```

Later tasks extend this single object; **never** add an `ipcMain.handle` without a contract entry.

**Step 2: Write the failing test**

`packages/contract/src/ipc.test.ts`:

```ts
import { expect, it } from "vitest";
import { ipcContract } from "./ipc";

it("validates app:info output", () => {
  const parsed = ipcContract["app:info"].output.parse({ version: "1.0.0", platform: "linux" });
  expect(parsed.platform).toBe("linux");
});

it("rejects malformed app:info output", () => {
  expect(() => ipcContract["app:info"].output.parse({ version: 1 })).toThrow();
});
```

Run `pnpm vitest run packages/contract` → expect FAIL (module not found), then create the files and re-run → PASS.

**Step 3: Main-side registrar — `apps/desktop/src/main/ipc.ts`**

```ts
import { ipcMain } from "electron";
import { ipcContract, type IpcChannel } from "@opendirect/contract";

type Handler<K extends IpcChannel> = (
  input: ReturnType<(typeof ipcContract)[K]["input"]["parse"]>,
) => Promise<unknown> | unknown;

export function handle<K extends IpcChannel>(channel: K, handler: Handler<K>): void {
  ipcMain.handle(channel, async (_event, raw) => {
    const spec = ipcContract[channel];
    const input = spec.input.parse(raw);
    try {
      const result = await handler(input as never);
      return { ok: true as const, data: spec.output.parse(result) };
    } catch (error) {
      return {
        ok: false as const,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  });
}
```

Errors are returned, not thrown, so the renderer always gets a discriminated result instead of an opaque Electron rejection.

**Step 4: Preload bridge — `apps/desktop/src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("opendirect", {
  invoke: (channel: string, input?: unknown) => ipcRenderer.invoke(channel, input),
  on: (channel: string, cb: (payload: unknown) => void) => {
    const listener = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, listener as never);
    return () => ipcRenderer.removeListener(channel, listener as never);
  },
});
```

**Step 5: Renderer client — `apps/web/lib/ipc.ts`**

```ts
import type { IpcChannel, IpcInput, IpcOutput } from "@opendirect/contract";

type Bridge = {
  invoke(channel: string, input?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: { message: string } }>;
  on(channel: string, cb: (payload: unknown) => void): () => void;
};

function bridge(): Bridge {
  const b = (globalThis as { opendirect?: Bridge }).opendirect;
  if (!b) throw new Error("OpenDirect IPC bridge unavailable — are you running outside Electron?");
  return b;
}

export async function invoke<K extends IpcChannel>(channel: K, input?: IpcInput<K>): Promise<IpcOutput<K>> {
  const res = await bridge().invoke(channel, input);
  if (!res.ok) throw new Error(res.error.message);
  return res.data as IpcOutput<K>;
}

export const subscribe = (channel: string, cb: (payload: unknown) => void) => bridge().on(channel, cb);
```

**Step 6: Install and wire TanStack Query**

```bash
pnpm --filter web add @tanstack/react-query@5.103.0
```

`apps/web/lib/query.tsx` exports a `<Providers>` client component creating a `QueryClient` with `{ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }`; wrap `apps/web/app/layout.tsx` children in it.

**Step 7: Verify**

```bash
pnpm typecheck && pnpm test && pnpm build
```

**Step 8: Commit**

```bash
git add -A
git commit -m "feat(ipc): add zod-validated typed IPC contract and react-query provider"
```

---

### Task 6: Settings store, encrypted API key vault, and the Settings screen

**Files:**
- Create: `apps/desktop/src/main/settings.ts`, `apps/desktop/src/main/settings.test.ts`, `apps/web/app/settings/page.tsx`, `apps/web/components/settings/provider-keys-form.tsx`
- Modify: `packages/contract/src/ipc.ts`, `apps/desktop/src/main/index.ts`

**Step 1: Write the failing test — `apps/desktop/src/main/settings.test.ts`**

Test the pure logic, not Electron: extract key handling into a `createKeyVault({ store, encrypt, decrypt, isEncryptionAvailable })` factory so the test can pass fakes.

```ts
import { describe, expect, it } from "vitest";
import { createKeyVault } from "./settings";

function fakeStore() {
  const data = new Map<string, unknown>();
  return {
    get: (k: string) => data.get(k),
    set: (k: string, v: unknown) => void data.set(k, v),
    delete: (k: string) => void data.delete(k),
  };
}

describe("key vault", () => {
  it("round-trips a key through encryption", () => {
    const vault = createKeyVault({
      store: fakeStore(),
      isEncryptionAvailable: () => true,
      encrypt: (s) => Buffer.from(`enc:${s}`),
      decrypt: (b) => b.toString().replace(/^enc:/, ""),
    });
    vault.setKey("replicate", "r8_secret");
    expect(vault.getKey("replicate")).toBe("r8_secret");
  });

  it("never returns the raw key in the redacted summary", () => {
    const vault = createKeyVault({ /* ...same fakes... */ } as never);
    vault.setKey("openrouter", "sk-or-v1-abcdef123456");
    const summary = vault.summary();
    expect(JSON.stringify(summary)).not.toContain("abcdef123456");
    expect(summary.openrouter).toEqual({ present: true, last4: "3456" });
  });

  it("falls back to plaintext with a warning when OS encryption is unavailable", () => {
    const vault = createKeyVault({ /* isEncryptionAvailable: () => false */ } as never);
    vault.setKey("replicate", "r8_x");
    expect(vault.getKey("replicate")).toBe("r8_x");
    expect(vault.encryptionAvailable()).toBe(false);
  });
});
```

**Step 2: Run it** — `pnpm vitest run apps/desktop/src/main/settings.test.ts` → FAIL.

**Step 3: Implement `apps/desktop/src/main/settings.ts`**

- `createKeyVault(deps)` stores each key as `{ enc: boolean; value: string }` (base64 when encrypted) under `apiKeys.<provider>`; `summary()` returns only `{ present, last4 }`.
- `getKeyWithEnvFallback(provider)` resolves in order: vault → `process.env.REPLICATE_API_TOKEN` / `process.env.OPENROUTER_API_KEY`. In development, load `.env.local` first via `dotenv` (`pnpm --filter @opendirect/desktop add dotenv@17.4.2`), reading from the repo root.
- A separate `createSettings(store)` handles non-secret prefs: `projectRoot`, `theme`, `defaultVideoModel`, `defaultImageModel`, `maxConcurrentJobs` (default 2), `pollIntervalMs` (default 3000).
- The real wiring in `index.ts` uses `new Store({ name: "opendirect" })` from `electron-store` and Electron's `safeStorage.{isEncryptionAvailable,encryptString,decryptString}`.
- **Never** log a key. Add a comment saying so above `setKey`.

**Step 4: Re-run the tests** → PASS.

**Step 5: Extend the IPC contract**

```ts
"settings:get": { input: z.void(), output: SettingsSchema },
"settings:set": { input: SettingsSchema.partial(), output: SettingsSchema },
"settings:keys:summary": { input: z.void(), output: z.object({
    encryptionAvailable: z.boolean(),
    replicate: KeyStatusSchema, openrouter: KeyStatusSchema }) },
"settings:keys:set": { input: z.object({ provider: z.enum(["replicate","openrouter"]), key: z.string().min(1) }), output: z.object({ ok: z.literal(true) }) },
"settings:keys:clear": { input: z.object({ provider: z.enum(["replicate","openrouter"]) }), output: z.object({ ok: z.literal(true) }) },
"settings:keys:verify": { input: z.object({ provider: z.enum(["replicate","openrouter"]) }), output: z.object({ valid: z.boolean(), message: z.string().optional() }) },
```

`settings:keys:verify` calls the provider's **model-listing** endpoint only (`GET https://api.replicate.com/v1/models` / `GET https://openrouter.ai/api/v1/models`) — never a generation endpoint.

**Step 6: Build the Settings screen**

`apps/web/app/settings/page.tsx` renders a shadcn `Tabs` with a "Providers" tab containing `<ProviderKeysForm/>`: two masked `Input`s (`type="password"`) with Save / Clear / Test buttons, each showing `•••• last4` when a key is present, plus an `Alert` when `encryptionAvailable === false` explaining keys are stored unencrypted on this OS. A "General" tab edits `projectRoot` (via a `dialog.showOpenDialog` IPC call), `maxConcurrentJobs` and `pollIntervalMs`. Use shadcn `Card`, `Label`, `Input`, `Button`, `Alert`, `Tabs`, `Badge` from `@workspace/ui`; add any missing ones with `pnpm dlx shadcn@latest add <name> -c apps/web`.

**Step 7: Verify**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

**Step 8: Commit**

```bash
git add -A
git commit -m "feat(settings): add encrypted API key vault and settings screen"
```

---

### Task 7: Developer env file with the supplied API keys

**Files:**
- Create: `.env.local` (gitignored), `.env.example`

**Step 1: Confirm `.env.local` is ignored**

```bash
git check-ignore -v .env.local
```
Expected: a match against the `.gitignore` rule added in Task 2. **If it does not match, stop and fix `.gitignore` before writing any key.**

**Step 2: Create `.env.example` (committed)**

```
# Copy to .env.local and fill in. .env.local is gitignored — never commit real keys.
REPLICATE_API_TOKEN=
OPENROUTER_API_KEY=
```

**Step 3: Create `.env.local` (never committed)**

```
REPLICATE_API_TOKEN=<value supplied by the orchestrator; leave empty if not provided>
OPENROUTER_API_KEY=<value supplied by the orchestrator; leave empty if not provided>
```

If the orchestrator has supplied real key values, write them here verbatim. If not, leave the values empty and note in the final report that the user must fill them in. Either way the variable **names** must be exactly `REPLICATE_API_TOKEN` and `OPENROUTER_API_KEY`.

**Step 4: Verify no key is staged**

```bash
git status --porcelain
git diff --cached --name-only | grep -x '.env.local' && echo "FAIL: key file staged" || echo "OK"
grep -rnE "r8_[A-Za-z0-9]{10,}|sk-or-v1-[A-Za-z0-9]{10,}" --exclude-dir=.git --exclude=.env.local . && echo "FAIL: key leaked into a tracked file" || echo "OK: no keys in tracked files"
```

**Step 5: Commit (the example only)**

```bash
git add .env.example
git commit -m "chore: add .env.example for local provider credentials"
```

---

### Task 8: Provider registry core — types, normalized model descriptor, cost model

**Files:**
- Create: `packages/contract/src/model.ts`, `apps/desktop/src/main/providers/types.ts`, `apps/desktop/src/main/providers/cost.ts`, `apps/desktop/src/main/providers/cost.test.ts`, `apps/desktop/src/main/providers/registry.ts`

**Step 1: Define the normalized descriptor in `packages/contract/src/model.ts`**

```ts
export const ModelDescriptorSchema = z.object({
  key: z.string(),                       // "replicate:bytedance/seedance-2.5"
  provider: z.enum(["replicate", "openrouter"]),
  slug: z.string(),                      // "bytedance/seedance-2.5"
  name: z.string(),
  description: z.string().nullable(),
  kind: z.enum(["video", "image", "text", "audio", "other"]),
  versionId: z.string().nullable(),      // Replicate version id; null for OpenRouter
  coverImageUrl: z.string().nullable(),
  inputSchema: z.record(z.string(), z.unknown()),   // JSON Schema (draft-07 compatible)
  outputSchema: z.record(z.string(), z.unknown()).nullable(),
  referenceSlots: z.array(ReferenceSlotSchema),
  commonControls: CommonControlsSchema,  // { prompt, aspectRatio?, duration?, resolution?, seed?, audio? }
  pricing: PricingSchema,
  raw: z.unknown(),                      // the provider payload, verbatim, for the Details panel
  fetchedAt: z.number(),
});

export const ReferenceSlotSchema = z.object({
  field: z.string(),                 // "reference_images"
  label: z.string(),                 // "Reference Images"
  kind: z.enum(["image", "video", "audio", "any"]),
  multiple: z.boolean(),
  max: z.number().nullable(),        // 30 for seedance-2.5 reference_images
  role: z.enum(["reference", "first_frame", "last_frame", "motion", "source", "unknown"]),
});

export const PricingSchema = z.object({
  basis: z.enum(["per_second", "per_output", "per_token", "unknown"]),
  currency: z.literal("USD"),
  skus: z.record(z.string(), z.string()),  // verbatim provider pricing keys
  estimate: z.object({ amount: z.number(), confidence: z.enum(["exact","estimated","unknown"]) }).nullable(),
  source: z.enum(["provider_api", "local_table", "none"]),
  note: z.string().nullable(),
});
```

**Step 2: Write the failing cost tests — `providers/cost.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { estimateCost } from "./cost";

describe("estimateCost", () => {
  it("prices a per-second OpenRouter video model", () => {
    const r = estimateCost({
      provider: "openrouter", kind: "video",
      pricingSkus: { duration_seconds_with_audio: "0.08", duration_seconds_without_audio: "0.05" },
      params: { duration: 8, generate_audio: true },
    });
    expect(r.amount).toBeCloseTo(0.64, 5);
    expect(r.confidence).toBe("estimated");
  });

  it("picks the no-audio SKU when audio is off", () => {
    const r = estimateCost({ provider: "openrouter", kind: "video",
      pricingSkus: { duration_seconds_with_audio: "0.08", duration_seconds_without_audio: "0.05" },
      params: { duration: 8, generate_audio: false } });
    expect(r.amount).toBeCloseTo(0.4, 5);
  });

  it("returns unknown confidence for token-based SKUs it cannot resolve", () => {
    const r = estimateCost({ provider: "openrouter", kind: "video",
      pricingSkus: { video_tokens: "0.0000107" }, params: { duration: 10 } });
    expect(r.confidence).toBe("unknown");
  });

  it("uses the local table for Replicate, which exposes no pricing API", () => {
    const r = estimateCost({ provider: "replicate", kind: "video",
      slug: "bytedance/seedance-2.5", pricingSkus: {}, params: { duration: 5 } });
    expect(r.confidence).toBe("estimated");
    expect(r.source).toBe("local_table");
  });

  it("degrades gracefully for an unknown Replicate model", () => {
    const r = estimateCost({ provider: "replicate", kind: "image",
      slug: "someone/unknown-model", pricingSkus: {}, params: {} });
    expect(r.confidence).toBe("unknown");
    expect(r.amount).toBe(0);
  });
});
```

**Step 3: Run** → FAIL. **Step 4: Implement `cost.ts`:**

- OpenRouter: iterate `pricing_skus`; if a key matches `/^duration_seconds/` treat the value as USD per second and multiply by `params.duration`, selecting the `_with_audio` / `_without_audio` and `_720p` variants from `params`. If only `*_tokens` SKUs exist, return `{ amount: 0, confidence: "unknown" }` with a note that OpenRouter reports the exact cost on completion.
- Replicate: look up `REPLICATE_PRICING` — a hand-maintained `Record<string, {basis, unit, usd, note}>` in `cost.ts` seeded with the recommended defaults (`bytedance/seedance-2.5`, `bytedance/seedance-2.0`, `google/nano-banana-2`, `google/nano-banana-pro`). Add a prominent file-header comment: *"Replicate's API exposes no pricing field (verified 2026-09-16 — `GET /v1/models/{owner}/{name}` returns run_count but no price). These numbers are transcribed by hand from each model's Replicate page and MUST be re-verified by the implementer against https://replicate.com/<slug> before release. Anything not listed here shows as 'cost unknown' in the UI."*
- Never invent a price. Unknown → `{ amount: 0, confidence: "unknown", source: "none" }`.

**Step 5: Re-run** → PASS.

**Step 6: Define the `ModelProvider` interface in `providers/types.ts`**

```ts
export interface ModelProvider {
  readonly id: "replicate" | "openrouter";
  isConfigured(): boolean;
  listModels(opts: { kinds: ModelKind[] }): Promise<ModelSummary[]>;
  getModel(slug: string): Promise<ModelDescriptor>;
  submit(req: GenerationRequest): Promise<ProviderJobRef>;   // implemented in Task 16
  poll(ref: ProviderJobRef): Promise<ProviderJobState>;
  cancel(ref: ProviderJobRef): Promise<void>;
}
```

`registry.ts` holds a `Map<ProviderId, ModelProvider>` and exposes `getProvider(id)` / `listConfigured()`.

**Step 7: Verify & commit**

```bash
pnpm typecheck && pnpm test
git add -A && git commit -m "feat(providers): add model descriptor, provider interface and cost estimator"
```

---

### Task 9: Replicate provider adapter — model listing and schema fetch

**Files:**
- Create: `apps/desktop/src/main/providers/replicate.ts`, `apps/desktop/src/main/providers/replicate.test.ts`, `apps/desktop/src/main/providers/reference-slots.ts`, `apps/desktop/src/main/providers/reference-slots.test.ts`, `test/fixtures/replicate/model-seedance-2.5.json`, `test/fixtures/replicate/collection-text-to-video.json`

**Step 1: Record fixtures using the ALLOWED read-only endpoints**

```bash
set -a; . ./.env.local; set +a
curl -s -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  https://api.replicate.com/v1/models/bytedance/seedance-2.5 > test/fixtures/replicate/model-seedance-2.5.json
curl -s -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  https://api.replicate.com/v1/models/google/nano-banana-pro > test/fixtures/replicate/model-nano-banana-pro.json
curl -s -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  https://api.replicate.com/v1/collections/text-to-video > test/fixtures/replicate/collection-text-to-video.json
```
These are GETs — no prediction is created. Confirm each file contains `latest_version.openapi_schema`.

**Step 2: Write the failing tests — `replicate.test.ts`**

Register msw handlers for `GET https://api.replicate.com/v1/models/:owner/:name` and `GET https://api.replicate.com/v1/collections/:slug` returning the fixtures, then assert:

```ts
it("maps a Replicate model to a descriptor with its JSON Schema", async () => {
  const d = await provider.getModel("bytedance/seedance-2.5");
  expect(d.key).toBe("replicate:bytedance/seedance-2.5");
  expect(d.kind).toBe("video");
  expect(d.versionId).toEqual(expect.any(String));
  expect(Object.keys(d.inputSchema.properties as object)).toContain("reference_images");
});

it("derives reference slots from the schema", async () => {
  const d = await provider.getModel("bytedance/seedance-2.5");
  const fields = d.referenceSlots.map((s) => s.field).sort();
  expect(fields).toEqual(["image", "last_frame_image", "reference_audios", "reference_images", "reference_videos"]);
  const refs = d.referenceSlots.find((s) => s.field === "reference_images")!;
  expect(refs.multiple).toBe(true);
  expect(refs.role).toBe("reference");
});

it("lifts prompt/duration/resolution/aspect_ratio into common controls", async () => { /* ... */ });

it("reports pricing as local-table with an explicit note", async () => {
  const d = await provider.getModel("bytedance/seedance-2.5");
  expect(d.pricing.source).toBe("local_table");
  expect(d.pricing.note).toMatch(/not exposed/i);
});

it("keeps unrecognised fields — they are never dropped", async () => {
  const d = await provider.getModel("bytedance/seedance-2.5");
  expect(Object.keys(d.inputSchema.properties as object)).toContain("watermark");
});
```

**Step 3: Run** → FAIL. **Step 4: Implement.**

`replicate.ts` uses the official SDK: `new Replicate({ auth })`, `replicate.models.get(owner, name)`, `replicate.collections.get(slug)`, `replicate.models.list()`. Mapping rules:

- `inputSchema = model.latest_version.openapi_schema.components.schemas.Input`; resolve any `$ref`/`allOf` into the `components.schemas` enum definitions so rjsf can render them (Cog emits `allOf: [{$ref: "#/components/schemas/aspect_ratio"}]` for enums — dereference these; write a `dereferenceCogSchema()` helper with its own unit test).
- `kind` from collection membership: `text-to-video`/`image-to-video`/`video-editing` → `video`; `text-to-image`/`image-editing` → `image`; else infer from the output schema's `format` (`uri` + `video/*`) and fall back to `other`.
- `commonControls`: `prompt`, `aspect_ratio`, `duration`, `resolution`, `seed`, `generate_audio` when present in `properties`.
- `listModels` seeds the catalog from collections `text-to-video`, `image-to-video`, `text-to-image`, `image-editing`, `official`, deduplicated by slug.

`reference-slots.ts` holds the shared heuristic used by both providers:

```ts
const ROLE_HINTS: Array<[RegExp, ReferenceRole]> = [
  [/^(first_frame|first_frame_image|start_image|start_frame)$/i, "first_frame"],
  [/^(last_frame|last_frame_image|end_image|end_frame)$/i, "last_frame"],
  [/(motion|camera)_?(reference|video)/i, "motion"],
  [/^(video|input_video|source_video|subject_video)$/i, "source"],
  [/(reference|ref)_?(image|images|video|videos|audio|audios)/i, "reference"],
  [/^(image|images|input_image|input_images|image_input|subject_image)$/i, "reference"],
];
```
A property becomes a slot when its type is `string` with `format: "uri"`, or an `array` of such strings. `max` comes from `maxItems`; `multiple` from `type === "array"`. Anything not matching a hint gets `role: "unknown"` **but is still a slot** if it is a URI field. Crucially, **no property is ever discarded** — everything that is not a common control or a slot is rendered under "Advanced" by Task 15.

`reference-slots.test.ts` covers each hint plus an unknown URI field (`weird_ref_thing` → `role: "unknown"`, still a slot) and a non-URI string (`prompt` → not a slot).

**Step 5: Re-run** → PASS.

**Step 6: Add a manually-run, network-touching smoke script**

`apps/desktop/scripts/verify-providers.ts` — not part of `pnpm test` — that hits only the allowed GET endpoints and prints the descriptor for `bytedance/seedance-2.5` and `google/nano-banana-pro`. Add a header comment: *"READ-ONLY. This script must never create a prediction."* Run it once manually:

```bash
pnpm --filter @opendirect/desktop exec tsx scripts/verify-providers.ts
```

**Step 7: Verify & commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add -A && git commit -m "feat(providers): add replicate adapter with schema and reference-slot derivation"
```

---

### Task 10: OpenRouter provider adapter — capabilities → JSON Schema

**Files:**
- Create: `apps/desktop/src/main/providers/openrouter.ts`, `apps/desktop/src/main/providers/openrouter.test.ts`, `apps/desktop/src/main/providers/openrouter-schema.ts`, `test/fixtures/openrouter/videos-models.json`, `test/fixtures/openrouter/images-models.json`, `test/fixtures/openrouter/models.json`

**Step 1: Record fixtures (read-only GETs, no key required for the model lists)**

```bash
curl -s https://openrouter.ai/api/v1/videos/models > test/fixtures/openrouter/videos-models.json
curl -s https://openrouter.ai/api/v1/images/models > test/fixtures/openrouter/images-models.json
curl -s "https://openrouter.ai/api/v1/models?output_modalities=video" > test/fixtures/openrouter/models.json
```

**Step 2: Write the failing tests — `openrouter.test.ts`**

```ts
it("lists video models from /api/v1/videos/models", async () => {
  const models = await provider.listModels({ kinds: ["video"] });
  expect(models.map((m) => m.slug)).toContain("bytedance/seedance-2.5");
  expect(models.length).toBeGreaterThan(20);
});

it("synthesises a JSON Schema from seedance-2.5 capabilities", async () => {
  const d = await provider.getModel("bytedance/seedance-2.5");
  const props = d.inputSchema.properties as Record<string, any>;
  expect(props.prompt.type).toBe("string");
  expect(props.duration.enum).toEqual(expect.arrayContaining([4, 30]));
  expect(props.resolution.enum).toEqual(["480p", "720p"]);
  expect(props.aspect_ratio.enum).toContain("21:9");
  expect(props.generate_audio.type).toBe("boolean");
  expect(props.seed.type).toBe("integer");
});

it("turns supported_frame_images into first/last frame slots", async () => {
  const d = await provider.getModel("bytedance/seedance-2.5");
  expect(d.referenceSlots.map((s) => s.role)).toEqual(
    expect.arrayContaining(["first_frame", "last_frame", "reference"]),
  );
});

it("exposes allowed_passthrough_parameters under advanced, never dropped", async () => {
  const d = await provider.getModel("bytedance/seedance-2.5");
  expect(Object.keys(d.inputSchema.properties as object)).toEqual(
    expect.arrayContaining(["watermark", "req_key", "output_format"]),
  );
});

it("carries pricing_skus verbatim with provider_api as the source", async () => {
  const d = await provider.getModel("bytedance/seedance-2.5");
  expect(d.pricing.source).toBe("provider_api");
  expect(d.pricing.skus.video_tokens).toBe("0.0000107");
});

it("maps image models' typed supported_parameters", async () => {
  const d = await provider.getModel("openai/gpt-image-2.5-sunburst");
  const props = d.inputSchema.properties as Record<string, any>;
  expect(props.aspect_ratio.enum).toContain("16:9");
  expect(props.n).toMatchObject({ type: "integer", minimum: 1, maximum: 10 });
  const refs = d.referenceSlots.find((s) => s.field === "input_references")!;
  expect(refs.max).toBe(16);
});
```

**Step 3: Run** → FAIL. **Step 4: Implement `openrouter-schema.ts` + `openrouter.ts`.**

`openrouter-schema.ts` converts a capability object into JSON Schema:
- video: `supported_durations` → `{type:"integer", enum:[...]}`; `supported_resolutions`/`supported_aspect_ratios`/`supported_sizes` → string enums; `generate_audio: true` → boolean; `seed: true` → integer; each entry of `allowed_passthrough_parameters` → `{type:"string"}` under a `x-opendirect-advanced: true` marker; `prompt` is always a required string.
- image: walk `supported_parameters`; `{type:"enum",values}` → string enum, `{type:"range",min,max}` → `{type:"integer",minimum,maximum}`. `input_references` becomes a reference slot with `max = range.max` rather than a numeric field.
- `supported_frame_images` entries become slots with roles `first_frame` / `last_frame`.
- Always set `x-opendirect-source: "openrouter-capabilities"` on the schema root so the Details panel can say the schema was synthesised rather than published.

`openrouter.ts` uses `@openrouter/sdk` for text helpers and plain `fetch` for the media model endpoints (the SDK's `client.models.list()` covers `/api/v1/models` but the `videos`/`images` model catalogs are fetched directly). Authorization header: `Bearer ${key}`.

**Step 5: Re-run** → PASS.

**Step 6: Add the recommended-defaults table**

In `providers/defaults.ts`:

```ts
export const RECOMMENDED = {
  video: [
    { key: "replicate:bytedance/seedance-2.5", label: "Seedance 2.5 (Replicate)" },
    { key: "replicate:bytedance/seedance-2.0", label: "Seedance 2.0 (Replicate)" },
    { key: "openrouter:bytedance/seedance-2.5", label: "Seedance 2.5 (OpenRouter)" },
  ],
  image: [
    { key: "replicate:google/nano-banana-2", label: "Nano Banana 2" },
    { key: "replicate:google/nano-banana-pro", label: "Nano Banana Pro" },
  ],
} as const;
```
These slugs were verified live on 2026-09-16 against Replicate search and `GET /api/v1/videos/models`. If any `getModel()` call 404s at runtime the picker must show the model as unavailable rather than crashing — add a test for the 404 path.

**Step 7: Verify & commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add -A && git commit -m "feat(providers): add openrouter adapter converting capabilities to json schema"
```

---

### Task 11: Model catalog cache, refresh, and the model picker UI

**Files:**
- Create: `apps/desktop/src/main/catalog.ts`, `apps/desktop/src/main/catalog.test.ts`, `apps/web/components/models/model-picker.tsx`, `apps/web/hooks/use-models.ts`
- Modify: `packages/contract/src/ipc.ts`

**Step 1: Failing test — `catalog.test.ts`**

- `refresh()` merges both providers, skipping any provider whose key is missing, and never throws when one provider fails.
- Descriptors are cached to disk (`app.getPath("userData")/model-catalog.json`) with `fetchedAt`; `list()` returns cached data without network when `Date.now() - fetchedAt < 24h`.
- `getModel(key)` fetches and caches a full descriptor on demand (list entries are summaries only — fetching 50 Replicate schemas eagerly is wasteful).

**Step 2: Implement `catalog.ts`.** Store as `{ version: 1, models: ModelSummary[], descriptors: Record<string, ModelDescriptor>, fetchedAt }`.

**Step 3: Extend the contract**

```ts
"models:list": { input: z.object({ kinds: z.array(ModelKindSchema).optional(), refresh: z.boolean().optional() }), output: z.array(ModelSummarySchema) },
"models:get": { input: z.object({ key: z.string() }), output: ModelDescriptorSchema },
"models:recommended": { input: z.void(), output: z.object({ video: z.array(RecommendedSchema), image: z.array(RecommendedSchema) }) },
```

**Step 4: Build `<ModelPicker/>`**

A shadcn `Command` inside a `Popover` (`pnpm dlx shadcn@latest add command popover -c apps/web`), grouped as **Recommended → Video → Image → All**, with the provider shown as a `Badge`, a search box, and a per-row price hint (`$0.64 est.` / `price unknown`). It reads through `useModels()` (TanStack Query, `queryKey: ["models", kinds]`) and has a "Refresh catalog" item that calls `models:list` with `refresh: true`.

**Step 5: Verify & commit**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add -A && git commit -m "feat(models): add catalog cache and model picker"
```

---

### Task 12: Data layer — SQLite schema, migrations, and the project folder

**Files:**
- Create: `apps/desktop/src/main/db/schema.ts`, `apps/desktop/src/main/db/client.ts`, `apps/desktop/src/main/db/migrate.ts`, `apps/desktop/drizzle.config.ts`, `apps/desktop/src/main/project.ts`, `apps/desktop/src/main/project.test.ts`, `apps/desktop/src/main/db/schema.test.ts`, `apps/desktop/drizzle/*` (generated)

**Step 1: Failing test — `project.test.ts`**

```ts
it("creates the project folder layout", async () => {
  const root = await mkdtemp(join(tmpdir(), "od-"));
  const project = await createProject({ root, name: "Infinite Hotel" });
  for (const d of ["assets", "generations", "thumbnails", "tmp"]) {
    expect(existsSync(join(project.path, d))).toBe(true);
  }
  expect(existsSync(join(project.path, "opendirect.db"))).toBe(true);
  expect(JSON.parse(await readFile(join(project.path, "project.json"), "utf8")).name).toBe("Infinite Hotel");
});

it("is idempotent when opened twice", async () => { /* openProject twice, no throw, same id */ });
```

**Step 2: Define the Drizzle schema — `db/schema.ts`**

```ts
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  path: text("path").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const containers = sqliteTable("containers", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  parentId: text("parent_id"),                       // containers nest
  kind: text("kind").notNull(),                      // "project" | "character" | "scene" | "folder"
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  kind: text("kind").notNull(),                      // "image" | "video" | "audio" | "text" | "prompt"
  relPath: text("rel_path"),                         // relative to project root; null for text assets
  text: text("text"),
  mimeType: text("mime_type"),
  width: integer("width"), height: integer("height"),
  durationMs: integer("duration_ms"),
  bytes: integer("bytes"),
  sha256: text("sha256"),
  thumbnailRelPath: text("thumbnail_rel_path"),
  label: text("label"),                              // free-form, e.g. "Character Sheet"
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  generationId: text("generation_id"),               // set when this asset came from a generation
  createdAt: integer("created_at").notNull(),
});

export const containerAssets = sqliteTable("container_assets", {
  containerId: text("container_id").notNull(),
  assetId: text("asset_id").notNull(),
  position: integer("position").notNull().default(0),
}, (t) => ({ pk: primaryKey({ columns: [t.containerId, t.assetId] }) }));

export const generations = sqliteTable("generations", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  containerId: text("container_id"),
  provider: text("provider").notNull(),
  modelSlug: text("model_slug").notNull(),
  modelVersion: text("model_version"),
  kind: text("kind").notNull(),                      // video | image | ...
  prompt: text("prompt"),
  paramsJson: text("params_json").notNull(),         // the exact params the user chose
  requestJson: text("request_json"),                 // the exact payload sent
  responseJson: text("response_json"),               // the raw provider response
  status: text("status").notNull(),                  // queued|submitted|running|succeeded|failed|canceled
  error: text("error"),
  providerJobId: text("provider_job_id"),
  estimatedCostUsd: real("estimated_cost_usd"),
  actualCostUsd: real("actual_cost_usd"),
  costConfidence: text("cost_confidence"),
  parentGenerationId: text("parent_generation_id"),  // branching
  branchNote: text("branch_note"),
  createdAt: integer("created_at").notNull(),
  startedAt: integer("started_at"),
  completedAt: integer("completed_at"),
});

export const generationInputs = sqliteTable("generation_inputs", {
  id: text("id").primaryKey(),
  generationId: text("generation_id").notNull(),
  assetId: text("asset_id").notNull(),
  slotField: text("slot_field").notNull(),           // "reference_images", "first_frame", ...
  position: integer("position").notNull().default(0),
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  generationId: text("generation_id").notNull(),
  state: text("state").notNull(),                    // pending|running|downloading|done|failed|canceled
  attempts: integer("attempts").notNull().default(0),
  lastPolledAt: integer("last_polled_at"),
  nextPollAt: integer("next_poll_at"),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
});
```

Add indexes on `assets.project_id`, `container_assets.container_id`, `generations.project_id`, `generations.parent_generation_id`, `jobs.state`.

**Step 3: Generate and wire migrations**

```bash
pnpm --filter @opendirect/desktop exec drizzle-kit generate
```
`db/client.ts` opens the DB with `new Database(path)`, sets `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON`, and `db/migrate.ts` runs `migrate(db, { migrationsFolder })` on project open.

**Step 4: Schema test** — `schema.test.ts` opens an in-memory DB (`new Database(":memory:")`), runs the migrations, inserts a project → container → asset → generation → generation_input chain, and asserts a lineage query (recursive CTE over `parent_generation_id`) returns the ancestors in order.

**Step 5: Implement `project.ts`** — `createProject`, `openProject`, `recentProjects` (in `electron-store`), `resolveAssetPath(project, relPath)`, and `assetRelPath(kind, id, ext)` returning `assets/<yyyy>/<mm>/<id>.<ext>` for uploads and `generations/<generationId>/<index>.<ext>` for outputs.

**Step 6: Verify & commit**

```bash
pnpm typecheck && pnpm test
git add -A && git commit -m "feat(db): add sqlite schema, migrations and project folder layout"
```

---

### Task 13: Repositories, IPC surface, and renderer data hooks

**Files:**
- Create: `apps/desktop/src/main/repo/{containers,assets,generations}.ts` + matching `.test.ts`, `apps/desktop/src/main/handlers.ts`, `apps/web/hooks/{use-containers,use-assets,use-generations}.ts`
- Modify: `packages/contract/src/ipc.ts`, `apps/desktop/src/main/index.ts`

**Step 1: Failing repository tests** (in-memory DB, one file per repo):

- `containers`: create / rename / reparent / delete (cascades `container_assets` but **not** assets), `listTree(projectId)`.
- `assets`: `importFiles(paths, containerId)` copies into `assets/…`, computes sha256, dedupes by hash within a project, generates a thumbnail, and links to the container; `addToContainer` / `removeFromContainer` (an asset may live in many containers); `listByContainer` with pagination.
- `generations`: `create`, `updateStatus`, `attachOutputs`, `listByContainer`, `lineage(generationId)` returning ancestors + descendants.

**Step 2: Implement.** Thumbnails: `pnpm --filter @opendirect/desktop add sharp` for images; for video, use the first frame via `ffmpeg-static` + `fluent-ffmpeg` — if `ffmpeg-static` proves awkward to package, fall back to rendering a `<video>` poster in the renderer and record `thumbnailRelPath: null`. Note the choice in `docs/DEVELOPMENT.md`.

**Step 3: Extend the contract** with `project:*`, `containers:*`, `assets:*`, `generations:*` channels, each with an explicit zod input/output.

**Step 4: Add renderer hooks** wrapping `invoke` in `useQuery`/`useMutation` with a shared `queryKeys` object, invalidating `["assets", containerId]` and `["generations", containerId]` on mutation.

**Step 5: Verify & commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add -A && git commit -m "feat(data): add repositories, ipc handlers and renderer data hooks"
```

---

### Task 14: App shell — sidebar, masonry board, drag & drop

**Files:**
- Create: `apps/web/app/page.tsx`, `apps/web/components/shell/{app-shell,sidebar,container-tree}.tsx`, `apps/web/components/board/{board,asset-card,empty-state}.tsx`, `apps/web/components/board/board.test.tsx`
- Modify: `apps/web/app/layout.tsx`

**Step 1: Install**

```bash
pnpm --filter web add masonic@4.1.0 @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 @dnd-kit/utilities
pnpm dlx shadcn@latest add sidebar resizable scroll-area context-menu dialog sheet tooltip skeleton -c apps/web
```

**Step 2: Layout**

- `<AppShell>` uses the shadcn `SidebarProvider` + `Sidebar` on the left and a `ResizablePanelGroup` for main content, with the creation bar (Task 15) pinned to the bottom via a `sticky bottom-0` container.
- Sidebar sections: **Project** (name, switcher), then `Characters`, `Scenes`, `Assets`, `Generations` — each a `containers` subtree rendered by `<ContainerTree>` with inline rename, right-click `ContextMenu` (New container, Rename, Delete), and `@dnd-kit` droppable targets so assets can be dragged from the board onto a container to add them.
- `<Board>` renders `<Masonry>` from `masonic` with `columnWidth={240} columnGutter={12}`, each cell an `<AssetCard>` showing the image/video thumbnail, label badge, and a hover action row.

**Step 3: Test — `board.test.tsx`** (vitest + `@testing-library/react`, `environment: "jsdom"` via a per-file `// @vitest-environment jsdom` pragma):

- renders one card per asset;
- shows the empty state with a "Drop files or generate something" message when the container is empty;
- dragging a card onto a sidebar container calls the `assets:addToContainer` mutation exactly once (assert against a mocked `invoke`).

**Step 4: Drag & drop file import** — an `onDrop` handler on the board calls `assets:import` with the dropped paths (`webUtils.getPathForFile` exposed through preload, since `File.path` is removed in Electron 32+).

**Step 5: Verify & commit**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add -A && git commit -m "feat(ui): add app shell, container sidebar and masonry board"
```

---

### Task 15: Creation bar — schema-driven form, reference slots, cost preview

**Files:**
- Create: `apps/web/components/create/{creation-bar,references-tray,reference-picker,advanced-params,cost-badge}.tsx`, `apps/web/components/create/schema-form.tsx`, `apps/web/lib/schema-form/{split-schema,widgets}.ts(x)`, `apps/web/lib/schema-form/split-schema.test.ts`
- Modify: `apps/web/components/shell/app-shell.tsx`

**Step 1: Install the schema-form stack**

```bash
pnpm --filter web add @rjsf/core@6.10.0 @rjsf/shadcn@6.10.0 @rjsf/utils@6.10.0 @rjsf/validator-ajv8@6.10.0
```

**Step 2: Failing test — `split-schema.test.ts`**

`splitSchema(descriptor)` must return `{ common, slots, advanced }` where:
- `common` contains only `prompt`, `aspect_ratio`, `duration`, `resolution`, `seed`, `generate_audio` (those that exist);
- `slots` are the reference slots from the descriptor;
- `advanced` is **everything else in the schema, with nothing omitted** — assert explicitly that `advanced.properties` plus `common` plus slot fields equals the full original property set. This test is the guardrail for the product rule "never hide unknown fields".

**Step 3: Run** → FAIL. **Step 4: Implement `split-schema.ts`.**

**Step 5: Build the creation bar**

```
[ + References ▸ chips ]  [ Describe what you want…            ]  [ Seedance 2.5 ▼ ] [ 16:9 ▼ ] [ ~$0.64 ] [ Generate ]
                                                                   ⌄ Settings   ⌄⌄ Advanced
```
- **References tray**: chips for each selected asset, grouped by slot when the model has more than one slot. Dropping an asset or a whole container onto the tray opens `<ReferencePicker>`.
- **Reference limits (product rule):** if a container with N assets is dropped and the target slot's `max` is M with `N > M`, do **not** auto-select. Show a dialog: *"Venkatesh — 100 assets. Seedance supports 12 references. **Select references →**"* with a grid for explicit selection and an opt-in `✨ Suggest 12` button (wired to the AI helper in Task 18; disabled if no helper is available). The chosen subset is persisted on the generation via `generation_inputs`.
- **Settings disclosure** renders `common` with plain shadcn controls (Select for enums, Slider+Input for numbers, Switch for booleans).
- **Advanced disclosure** renders `advanced` with `<Form>` from `@rjsf/shadcn` + `validator` from `@rjsf/validator-ajv8`, plus a read-only JSON preview of the request payload.
- **`<CostBadge>`** shows the Task 8 estimate: `~$0.64` for `estimated`, `$0.64` for `exact`, and `Cost unknown` with a tooltip explaining why (Replicate publishes no price via API / token-based SKU) for `unknown`. It re-computes on every param change.
- Generate is disabled while required fields are missing; the button's tooltip names the missing field.

**Step 6: Verify & commit**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add -A && git commit -m "feat(create): add schema-driven creation bar with reference slots and cost preview"
```

---

### Task 16: Job runner — submit, poll, download, job list

**Files:**
- Create: `apps/desktop/src/main/jobs/{runner,download,poll}.ts` + `runner.test.ts`, `download.test.ts`, `apps/desktop/src/main/providers/replicate-submit.ts`, `apps/desktop/src/main/providers/openrouter-submit.ts` + tests, `apps/web/components/jobs/{job-list,job-row}.tsx`
- Modify: `packages/contract/src/ipc.ts`

> ⛔ Every test in this task uses msw handlers. No request in this task's tests may reach `api.replicate.com` or `openrouter.ai`. `onUnhandledRequest: "error"` from Task 2 enforces this — do not weaken it.

**Step 1: Failing tests**

`replicate-submit.test.ts` (msw-mocked `POST /v1/predictions` returning a fixture):
- builds the payload as `{ version: <versionId>, input: {...} }` with local reference assets uploaded first via `POST /v1/files` (mocked) and referenced by their returned URLs;
- polls `GET /v1/predictions/:id` until `status === "succeeded"`;
- maps `status` `starting|processing|succeeded|failed|canceled` to the internal job state;
- records `responseJson` verbatim and reads `metrics.predict_time` into the generation row.

`openrouter-submit.test.ts` (msw-mocked `POST /api/v1/videos`, `GET /api/v1/videos/:id`):
- sends `frame_images` when first/last-frame slots are filled and `input_references` otherwise, and asserts `frame_images` wins when both are present;
- on `status: "completed"` reads `unsigned_urls` and writes `usage.cost` into `actualCostUsd` with `costConfidence: "exact"`.

`runner.test.ts`:
- `p-queue` concurrency is capped by the `maxConcurrentJobs` setting;
- a job that fails with a 5xx is retried with exponential backoff up to 3 attempts; a 4xx fails immediately;
- jobs left in `running` at startup are re-enqueued for polling (crash recovery);
- `cancel(jobId)` calls the provider cancel and marks the row `canceled`.

`download.test.ts`:
- streams a mocked output URL to `generations/<id>/0.mp4` using `node:stream/promises.pipeline`,
- verifies the byte length, computes sha256, creates the `assets` row, links it to the generation's container, and sets `assets.generationId`;
- a partial download is written to `tmp/` and only renamed into place on success (no half-files in the project).

**Step 2: Run them** → FAIL. **Step 3: Implement.**

- `runner.ts` owns a single `PQueue({ concurrency })`; on `enqueue(generationId)` it writes a `jobs` row first, so the queue is always reconstructible from SQLite.
- Polling uses a fixed interval from settings with jitter (Replicate's SDK `replicate.wait()` is deliberately not used — we need cancellable, restart-survivable polling driven by the DB).
- On success: download every output, create assets, set `generations.status = 'succeeded'`, `completedAt`, `actualCostUsd`.
- Progress is pushed to the renderer via `win.webContents.send("jobs:update", payload)`; the renderer subscribes with `subscribe()` and invalidates the relevant query keys.
- Add a module-level guard in both submit files:
  ```ts
  if (process.env.NODE_ENV === "test" && !process.env.OPENDIRECT_ALLOW_SUBMIT_IN_TEST) {
    // msw intercepts network in tests; this assertion documents the rule.
  }
  ```
  and a comment: *"Paid endpoint. Never call outside a user-initiated Generate action."*

**Step 4: Job list UI** — a `Sheet` opened from the status bar listing active and recent jobs with model, container, elapsed time, progress, estimated vs actual cost, Cancel, and Retry. Failed jobs surface `generations.error` inline.

**Step 5: Manual verification checklist (document, do not run)**

Add to `docs/DEVELOPMENT.md` a "first real generation" checklist to be performed **by the user, not an agent**: open the app, pick a cheap image model, confirm the cost badge, press Generate once, confirm the file lands in `generations/`.

**Step 6: Verify & commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add -A && git commit -m "feat(jobs): add background job runner with polling, download and job list"
```

---

### Task 17: Output cards — use as reference, add to, branch, compare, open, details

**Files:**
- Create: `apps/web/components/board/{output-card,card-actions,details-panel,lineage-view,compare-view}.tsx`, `apps/web/components/board/lineage-view.test.tsx`
- Modify: `apps/desktop/src/main/repo/generations.ts`, `packages/contract/src/ipc.ts`

**Step 1: Failing test — `lineage-view.test.tsx`**

Given a lineage payload `portrait.jpg + hotel-ref → image-42 → video-53, video-56`, the component renders each node once, draws the edges, and marks the currently focused generation.

**Step 2: Implement the six actions**

- **Use as reference** — appends the asset to the creation bar's reference tray for the active slot (or asks which slot when the model has several).
- **Add to…** — a `Command` dialog listing containers; creates a `container_assets` row.
- **Branch** — opens the creation bar pre-filled with the parent's exact params and references, sets `parentGenerationId`, and focuses the prompt so the user can edit it. Offer three quick-branch presets as prompt suffixes only (never auto-generated params): "make camera slower", "change expression", "different model".
- **Compare** — a side-by-side `Dialog` with synchronized video scrubbing (a single `requestAnimationFrame` loop driving both `<video>` elements) and a param diff table highlighting fields that differ.
- **Open** — `shell.openPath` on the absolute file path, plus "Reveal in folder" via `shell.showItemInFolder`.
- **Details** — a `Sheet` with tabs: *Provenance* (provider, model, version, created, parent, cost estimated vs actual), *Parameters* (the resolved params table), *Request* and *Response* (raw JSON in a `<pre>` with a copy button), *Lineage* (`<LineageView/>`).

Lineage data comes from a new `generations:lineage` IPC channel backed by a recursive CTE walking `parent_generation_id` in both directions.

**Step 3: Verify & commit**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add -A && git commit -m "feat(board): add output card actions, branching, compare and lineage details"
```

---

### Task 18: AI helpers backed by the local `claude` / `codex` CLIs

**Files:**
- Create: `apps/desktop/src/main/ai/{detect,run-cli,helpers}.ts` + `detect.test.ts`, `run-cli.test.ts`, `helpers.test.ts`, `apps/web/components/ai/{helper-menu,helper-result-dialog}.tsx`
- Modify: `packages/contract/src/ipc.ts`

**Step 1: Failing tests**

`detect.test.ts` — `detectLocalTools()` resolves `claude` and `codex` on `PATH` using `which` on posix / `where` on win32 (via a stubbed `execFile`), returning `{ claude: { available, path, version }, codex: {...} }`; when neither is found it returns both unavailable **without throwing**.

`run-cli.test.ts` — with a stubbed `spawn`:
- `runClaude(prompt)` invokes `claude -p "<prompt>" --output-format json` and parses the JSON envelope, returning the `result` text;
- `runCodex(prompt)` invokes `codex exec "<prompt>"` and returns stdout;
- a non-zero exit yields a typed `AiToolError` carrying stderr;
- a run exceeding the 120s timeout is killed and reported;
- **arguments are passed as an argv array, never through a shell string** — assert `spawn` was called with `shell: false` and the prompt as a discrete argv element (prompt-injection / shell-escape guard).

`helpers.test.ts` — the four helpers each build their prompt and post-process the output:
- `improvePrompt({ prompt, modelName })` → returns a rewritten prompt string;
- `describeReference({ assetPath })` → a description paragraph (the path is passed to the CLI, which can read the file itself);
- `analyzeVideo({ assetPath })` → a structured `{ summary, shots[] }` parsed from fenced JSON, falling back to raw text if parsing fails;
- `suggestShots({ containerName, notes })` → `string[]`.

**Step 2: Run** → FAIL. **Step 3: Implement.**

`detectLocalTools()` runs once at app start and is cached, with a manual "Re-detect" action in Settings. `run-cli.ts` uses `child_process.spawn(cmd, args, { shell: false, timeout, cwd: projectPath })`, streams stdout/stderr, and logs via `electron-log` (never the prompt contents at info level).

**Step 4: UI**

`<HelperMenu/>` is a `DropdownMenu` with a sparkle icon next to the prompt field and on asset cards. Items: *Improve prompt*, *Describe reference*, *Analyze video*, *Suggest shots*. Each item is hidden entirely when no local tool is available — **no greyed-out teasers**, per the product rule that AI is explicit and optional. When both tools are present, a submenu lets the user choose `claude` or `codex`; the default comes from a `preferredAiTool` setting. Results open in `<HelperResultDialog/>` with Apply / Copy / Discard — nothing is ever applied automatically.

**Step 5: Document the OpenRouter fallback (do not build it)**

Add `docs/ROADMAP.md` noting that the same four helpers can later be served by an OpenRouter text model through `client.callModel()`, behind the same `AiHelper` interface, gated by a Settings toggle since it spends the user's credits.

**Step 6: Verify & commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add -A && git commit -m "feat(ai): add local claude/codex helper tools with graceful detection"
```

---

### Task 19: Polish, end-to-end verification, and the release checklist

**Files:**
- Create: `README.md`, `docs/ARCHITECTURE.md`, `docs/RELEASE_CHECKLIST.md`, `LICENSE`, `apps/web/components/shell/status-bar.tsx`, `apps/web/app/error.tsx`
- Modify: `.github/workflows/ci.yml`

**Step 1: Fill the gaps**

- Empty states for every surface (no project, empty container, no models, no API key) — each with the one action that resolves it.
- Keyboard shortcuts: `⌘K` model picker, `⌘Enter` generate, `⌘,` settings, `⌘R` refresh catalog. Use `react-hotkeys-hook` (a library, not a hand-rolled listener).
- Toasts via shadcn `sonner` for job completion and failure.
- `<StatusBar>` showing active job count, the updater state from the `updater:status` channel, and the detected AI tools.
- Loading skeletons for the board and model picker; `apps/web/app/error.tsx` for renderer error boundaries.
- Add `LICENSE` (MIT) and a `README.md` covering what it is, install, dev setup (`pnpm install`, copy `.env.example`), and the ⛔ "no paid generations in dev/test" rule prominently.

**Step 2: Add coverage and a leak check to CI**

Append to `ci.yml`:

```yaml
      - name: Assert no committed secrets
        run: |
          ! grep -rnE "r8_[A-Za-z0-9]{20,}|sk-or-v1-[A-Za-z0-9]{20,}" --exclude-dir=.git --exclude-dir=node_modules .
      - name: Assert tests never hit live provider hosts
        run: grep -q 'onUnhandledRequest: "error"' vitest.setup.ts
```

**Step 3: Write `docs/RELEASE_CHECKLIST.md`**

1. `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green.
2. Re-verify the model slugs in `providers/defaults.ts` resolve (run `scripts/verify-providers.ts` — read-only).
3. Re-verify every entry in the `REPLICATE_PRICING` table against its model page; remove anything stale rather than shipping a wrong number.
4. `pnpm changeset version`, review `CHANGELOG.md`.
5. Local packaged smoke test on at least one OS: `pnpm --filter @opendirect/desktop dist`, install, open, create a project, import an asset, open the model picker, check the cost badge. **Exactly one** real generation, performed by the user, on the cheapest available image model.
6. Confirm signing secrets are present in the repo (`MAC_CSC_LINK`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`); without them the release ships unsigned and will be blocked by Gatekeeper/SmartScreen.
7. Tag `v<version>`, push, watch the Release workflow, confirm `latest*.yml` plus installers are attached to the GitHub Release.
8. Install the previous version, then confirm electron-updater finds and applies the new one.

**Step 4: Full verification**

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm --filter @opendirect/desktop build
grep -rnE "r8_[A-Za-z0-9]{20,}|sk-or-v1-[A-Za-z0-9]{20,}" --exclude-dir=.git --exclude-dir=node_modules --exclude=.env.local . || echo "no secrets committed"
```

**Step 5: Commit**

```bash
git add -A
git commit -m "docs: add readme, architecture notes and release checklist"
```

---

## Open questions for the implementer to resolve with the API (not by guessing)

1. **Replicate pricing** — no field exists on the model object today. Before release, check whether `GET /v1/models/{owner}/{name}` has gained a pricing field; if not, keep the curated table and the "cost unknown" UI state honest.
2. **Replicate file uploads** — confirm `POST /v1/files` is the right path for turning a local reference image into a URL the prediction can consume, versus inlining a `data:` URI. Test both against the *upload* endpoint only; never follow through to a prediction.
3. **`google/nano-banana-2` vs `google/nano-banana-2-lite`** — both exist on Replicate; confirm which is intended as the default image model and whether `nano-banana-pro` supersedes it.
4. **Video thumbnails** — decide between `ffmpeg-static` (packaging weight, licensing) and renderer-side `<video>` posters; record the decision in `docs/ARCHITECTURE.md`.
