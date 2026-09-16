# OpenDirect

A local-first desktop workspace for generative media.

**Containers** hold **Assets**, any Asset can be a **Reference**, and the
generation UI is built from each model's own schema rather than from a list of
parameters OpenDirect decided to support. Your projects are ordinary folders on
your disk — media, a SQLite index and a `project.json` — so nothing you make is
locked inside the app, and nothing leaves your machine except the generation
requests you explicitly start.

It talks to **Replicate** and **OpenRouter** with your own API keys. There is no
OpenDirect account, no server and no telemetry.

---

> ## ⛔ Nothing in development or in the test suite triggers a paid generation
>
> Every provider submission and polling path is tested against recorded
> fixtures through [`msw`](https://mswjs.io/), and `vitest.setup.ts` runs the
> mock server with `onUnhandledRequest: "error"` — any HTTP request a test does
> not explicitly mock **fails the test** instead of quietly reaching a paid
> endpoint. The only live calls the app makes outside a real run are the
> providers' free listing endpoints (`GET /v1/models`, `GET /api/v1/models`, …).
>
> The first real generation is a manual, human-run checklist:
> [`docs/DEVELOPMENT.md` → *First real generation*](docs/DEVELOPMENT.md#first-real-generation--a-manual-check-for-a-human).
> Run it yourself, once, on a cheap image model. Do not automate it.

---

## Quickstart

```bash
pnpm install
pnpm dev:desktop
```

`pnpm dev:desktop` starts the Next.js renderer on `localhost:3000` and the
Electron shell pointed at it. The window opens on the project launcher: create a
project folder, or open one you already have.

### Setting your API keys

Two ways, and the app prefers the first:

1. **Settings → Providers** (`⌘,`). Keys are encrypted at rest with Electron's
   `safeStorage`, which uses the OS keychain. This is the one to use.
2. **`.env.local` at the repo root**, for development convenience only:

   ```bash
   cp .env.example .env.local
   # REPLICATE_API_TOKEN=…
   # OPENROUTER_API_KEY=…
   ```

   `.env.local` is gitignored and is read by the main process in development
   only. It is never packaged, and the AI helpers below never see it — child
   processes get a scrubbed environment.

Verifying a key calls a **listing** endpoint, never a generation.

### Keyboard

| Chord              | What it does                                    |
| ------------------ | ----------------------------------------------- |
| `⌘K`               | Model picker                                    |
| `⌘Enter`           | Generate (stands down while a dialog is open)   |
| `⌘,`               | Settings                                        |
| `⌘R` / `⌘⇧R` (dev) | Refresh the model catalog                       |

On Windows and Linux read `⌘` as `Ctrl`. Catalog refresh is `⌘R` in the packaged
app, whose menu does not bind Reload, and `⌘⇧R` in development, where Chromium
still owns `⌘R` — the renderer asks main which one it got, so the two can never
disagree.

## Scripts

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build   # before every commit
pnpm --filter @opendirect/desktop dist                   # local installers
```

The full table is in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Architecture in one page

```
apps/web            Next.js 16, static export (`output: 'export'`) — the renderer
apps/desktop        Electron 44 main process — everything privileged
packages/ui         shadcn/ui components (style `vega`, hugeicons)
packages/contract   the zod IPC contract both processes validate against
```

**All privilege lives in the main process.** The renderer runs with
`contextIsolation: true`, `nodeIntegration: false` and a single typed `invoke`
bridge. SQLite, the project folder, the provider HTTP calls, the job runner and
child-process spawning never touch the renderer; local media reaches it over a
containment-checked `asset://` protocol rather than `file://`.

**Models are not hardcoded.** Replicate hands back literal JSON Schema and
OpenRouter a typed parameter map; both are normalised into a `ModelDescriptor`
and rendered into a form with `@rjsf/shadcn`. A parameter OpenDirect has never
heard of still reaches you, under **Advanced**.

**Generations are durable.** A run is a row in SQLite before it is a request to
a provider, and once a `provider_job_id` exists every later attempt *polls* it
instead of submitting again — so a crash, a restart or a Retry can never pay for
the same run twice.

**Costs are honest.** OpenRouter publishes prices and reports actual cost;
Replicate publishes neither, so its figures come from a curated table shown as
an explicit estimate, and a model with no usable rate reads **Cost unknown** —
never `$0.00`.

**The AI helpers are your own CLI.** "Improve prompt" and friends spawn the
`claude` or `codex` binary already on your `PATH`, on your subscription. If
neither is installed the menus are not rendered at all. OpenDirect ships no
assistant of its own.

Full detail — every layer, every decision and why — is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## How this repo was bootstrapped

The monorepo scaffold is the shadcn CLI's, generated with exactly:

```bash
npx shadcn@latest init --preset bIkfFpI --template next --monorepo --pointer
```

Preset `bIkfFpI` decodes to style `vega`, base colour `neutral`, icon library
`hugeicons`, font `inter`; `--monorepo` produces `apps/web` + `packages/ui` with
the `@workspace/ui/*` aliases, and `--pointer` puts `cursor: pointer` on
buttons. `apps/desktop` and `packages/contract` were added on top.

## Docs

| File                                                     | What is in it                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------------- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)           | The system, layer by layer, and the decisions behind it                     |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)             | Setup, every subsystem in detail, and the manual first-generation checklist |
| [`docs/RELEASING.md`](docs/RELEASING.md)                 | Changesets, tagging, signing, auto-update                                   |
| [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md) | The list to work through before cutting a release                           |
| [`docs/ROADMAP.md`](docs/ROADMAP.md)                     | What is deliberately not built yet                                          |

## License

[MIT](LICENSE).
