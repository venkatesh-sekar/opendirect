# Model Registry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or
> superpowers:subagent-driven-development) to implement this plan task-by-task.
> Each task is self-contained: read **only** your task's section, the
> "Shared context" section below, and the design doc
> `docs/plans/2026-09-24-model-registry-design.md`. Use
> superpowers:test-driven-development inside each task. UI tasks (8, 9, 10, 11,
> 12) also use the `frontend-design:frontend-design` skill.

**Goal:** Give every model input a *meaning* (a role from a closed list of
ten), curated per model family in a layered registry (bundled, remote, user
overrides, then inferred/unverified). Use that registry to filter models by
capability, label and dim slots on the canvas, pick a provider and endpoint
per run, and translate one canonical request into each provider's fields.
Users get a first-class UI to write their own mappings.

**Architecture:** The mapping format, its zod schemas and every rule
(merge, endpoint choice, slot availability, request translation, mapping
suggestions, schema checks) are **pure functions in `packages/contract`**, so
main and the renderer run the same code. Main owns the layers (bundled JSON
from `registry/`, a remote copy fetched from raw GitHub and cached on disk,
user overrides kept in `electron-store`). It annotates every concrete
`ModelDescriptor` with roles and serves a **family descriptor** for
`family:<id>` keys. A family descriptor is shaped like a `ModelDescriptor`, so
the canvas pipeline (slots, edges, mentions, forms, batch) runs on it
unchanged. At submit, main translates a family request into a concrete
`provider:slug` request before the `queued` row is written, so the job
runner, replay and the paid path keep their current guarantees. Named
**shapes** (such as nested payloads) are applied by the runner after uploads.

**Tech Stack:** Next.js 16 (static export, client components), React 19,
TypeScript, zod 4.6, TanStack Query, shadcn components from `@workspace/ui`,
Hugeicons, `@dnd-kit` (already a web dependency), Vitest 5 + Testing Library
(jsdom) + msw 2, Electron main with better-sqlite3/drizzle and
`electron-store`.

---

## Shared context (read this for every task)

### Commands

Run from the repo root `/Users/venkatesh/git/opendirect`.

| What | Command |
|---|---|
| One test file | `pnpm vitest run <path>` |
| All tests | `pnpm test` |
| Typecheck (every package + root) | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Build (Next static export + Electron bundles) | `pnpm build` |
| New drizzle migration (Task 11 only) | `pnpm --filter @opendirect/desktop db:generate` |
| Live read-only provider check (manual, needs keys) | `pnpm --filter @opendirect/desktop verify:providers` |

CI (`.github/workflows/ci.yml`) runs `pnpm install --frozen-lockfile`,
`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. It also checks that
no provider keys are committed and that `vitest.setup.ts` still contains
`onUnhandledRequest: "error"`. **No new dependencies are needed**, so the
lockfile must not change.

Every task ends with its own test files passing, then `pnpm typecheck` and
`pnpm lint` passing, then one commit. End every commit message with:

```
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
```

### Next.js

`AGENTS.md`: *this Next.js version has breaking changes*. The docs ship at
**`apps/web/node_modules/next/dist/docs/`** (there is no copy at the repo
root). Most of this plan is `"use client"` components and pure modules. Two
places touch Next APIs:

- Task 8 adds a tab to `apps/web/app/settings/page.tsx` and reads a new
  `?map=` query param. Before editing, read
  `apps/web/node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`
  and `.../01-app/02-guides/single-page-applications.md`, and grep that docs
  folder for `useSearchParams`. Keep the existing `<Suspense>` wrapper: the
  static export prerenders with no query string.
- Task 10 navigates to `/settings?tab=models&map=<key>` with `useRouter` from
  `next/navigation`, the same way `settings/page.tsx` does today.

Anything else that imports `next/*`: stop and read the matching guide first.

### Money rules (unchanged, restated because this plan touches the paid path)

- ⛔ The catalog, the registry, remote fetches, verification and the mapping
  editor only ever make **free `GET`s**. No task adds a POST to any provider.
- ⛔ `provider.submit` stays the one paid call, made only by
  `jobs/runner.ts`. Translation happens **before** the `queued` row is
  written, so what SQLite records is exactly what gets sent.
- Tests never reach the network. `vitest.setup.ts` runs msw with
  `onUnhandledRequest: "error"`. Remote-registry tests register
  `http.get("https://raw.githubusercontent.com/...")` handlers on the shared
  `server` from `test/msw/server.ts`.

### Conventions seen in the codebase

- Files open with a doc comment that explains *why*. Keep that style and keep
  the `⛔` notes.
- Contract: zod 4 (`z.strictObject`, `z.partialRecord`, `z.enum`), exported
  from `packages/contract/src/index.ts`. Tests sit next to the code
  (`*.test.ts`).
- Main: pure logic in plain-Node modules with injected deps (see
  `catalog.ts`/`catalog-service.ts` and `settings.ts`/`settings-service.ts`).
  Electron wiring lives in the `*-service.ts` file.
- IPC: every channel is declared in `packages/contract/src/ipc.ts`
  (`ipcContract`). `apps/desktop/src/main/ipc-coverage.test.ts` fails if a
  channel has no `handle("…")` in main **or has no caller in `apps/web`**.
  Whoever adds a channel also adds the renderer hook that calls it, in the same
  task.
- Component tests start with `// @vitest-environment jsdom` and
  `import "@testing-library/jest-dom/vitest"`, mock `@/lib/ipc` with
  `vi.hoisted` (see `apps/web/components/canvas/prompt-bar.test.tsx` lines
  1–40), and wrap in `QueryClientProvider` + `TooltipProvider`.
- Colours: shadcn tokens only (`text-muted-foreground`, `bg-muted`, `border`,
  …). Components are in `packages/ui/src/components/` (alert, badge, button,
  card, command, dialog, dropdown-menu, input, label, popover, scroll-area,
  select, separator, sheet, switch, tabs, textarea, tooltip, …). Icons come
  from `@hugeicons/core-free-icons` through `HugeiconsIcon`.
- Settings forms: copy the patterns in
  `apps/web/components/settings/general-settings-form.tsx` and
  `provider-keys-form.tsx`. `useSettings` / `useUpdateSettings` are in
  `apps/web/lib/settings.ts`.

### Facts about today's code (verified while planning)

- Providers: **Replicate** (`providers/replicate.ts`) and **OpenRouter**
  (`providers/openrouter.ts` + `openrouter-schema.ts`). `ProviderId =
  "replicate" | "openrouter"`. No fal or Hugging Face adapter exists, and
  **this plan adds none**.
- OpenRouter's descriptors come from its capability manifest
  (`GET /api/v1/videos/models`, `/images/models`).
  `buildVideoInputSchema` synthesizes `first_frame`/`last_frame` from
  `supported_frame_images` and always adds `input_references` (`*/*`). The
  schema root carries `x-opendirect-source: "openrouter-capabilities"`. This
  manifest is what seeds "manifest-confidence" suggestions (Task 4).
- Recorded schema fixtures: `test/fixtures/replicate/model-{seedance-2.5,
  seedance-2.0,nano-banana-2,nano-banana-pro,flux-schnell}.json`,
  `test/fixtures/openrouter/{videos-models,images-models}.json`.
- Role inference: `apps/desktop/src/main/providers/reference-slots.ts`
  (`deriveReferenceSlots`, `ROLE_HINTS`). It emits `role: "unknown"` today.
- Descriptors are cached in `<userData>/model-catalog.json` by `catalog.ts`.
  **Registry annotation is applied on read, never persisted**, so a Reload
  takes effect immediately.
- `generations-submit.ts` validates `references[].slotField` against
  `descriptor.referenceSlots[].field` and writes the row.
  `jobs/runner.ts#referenceParams` uploads each asset (Replicate
  `uploadReference`, else a `data:` URL) and builds `params[field]`.
- Canvas edges store `slotField` (`canvas_edges.slot_field`). Nodes store
  `modelKey` (`canvas_nodes.model_key`). Workflows validate
  `recipe.modelKey` with `parseModelKey`.
- Settings persist through `electron-store` (`createSettings` in
  `settings.ts`: defaults merged, then `settingsSchema.safeParse`).

### Decisions made while planning (read these; later tasks depend on them)

1. **Family keys.** A mapped model is chosen as `family:<id>` (for example
   `family:seedance-2-5`). `familyKey(id)`, `parseFamilyKey(key)` and
   `isRunnableModelKey(key)` (a `provider:slug` or a family key) live in the
   contract. Unmapped models keep `provider:slug`. A node, a workflow recipe
   and `defaultVideoModel`/`defaultImageModel` may hold either kind of key.
2. **Slot keys.** A mapped input is keyed by its role, plus `:2`…`:9` when an
   endpoint has a second field with the same role (`reference`,
   `reference:2`). For family nodes, canvas edges store the **slot key** in
   `slotField`. For concrete `provider:slug` nodes, edges keep the provider
   field name as they do today. **Existing boards keep working unchanged.**
3. **Family descriptor = a `ModelDescriptor`.** `models:get({ key:
   "family:x", provider?, filled? })` returns a descriptor whose:
   - `referenceSlots` are the **union across all endpoints**, with `field` =
     slot key, and `verified: true`. The `required` flag comes from the
     chosen endpoint.
   - `inputSchema` is the chosen endpoint's schema with mapped input fields
     removed and mapped controls renamed to canonical names (`prompt`,
     `aspect_ratio`, …). An unmapped field that collides with a canonical
     name is exposed as `raw:<name>`. The **count** control keeps its
     provider field name, so `planBatch` still finds it.
   - `commonControls` use the canonical names.
   - `family` holds the full family, its source, configured providers,
     provider order and the endpoint choice.

   `provider:slug` and `pricing` are the chosen endpoint's. Because of this,
   `slots.ts`, `edges-to-inputs.ts`, mentions, the icon grid, the Advanced
   form and `planBatch` all work on a family node without knowing about
   families.
4. **Endpoint choice** (design §5.1–5.2). The candidate providers are the
   per-node override, or else `settings.providerOrder` filtered to configured
   providers, with any configured provider missing from the order appended.
   For each provider in turn, endpoints are checked in manifest order. The
   first endpoint whose inputs cover every filled slot key **and** whose
   required inputs are all filled wins. Otherwise the choice falls back to the
   first endpoint that covers the filled keys, and the missing required keys
   are reported. Otherwise it is an error that names the unsupported keys.
   `filled` = the distinct slot keys of the node's incoming edges.
5. **Translation happens in main at submit** (design §5.4–5.5).
   `GenerationRequest` gains `providerOverride` and `familyId`. A request whose
   `modelKey` is a family key is translated into a concrete one (endpoint key,
   provider field names, value-mapped and type-coerced controls, raw
   `advanced` fields merged last). This happens in `generations-submit.ts`
   before validation and before the row is written. An input the endpoint
   cannot take, an advanced field that would overwrite a mapped field, or an
   unmapped value is **an error, never a silent drop**. The renderer calls the
   same pure `translateFamilyParams` only to price the run.
6. **Shapes run in the runner**, after upload, because they need the final
   URLs. The concrete descriptor's slot carries `shape`, and
   `referenceParams` calls `applyShape(shape, urls)`. The shape registry
   (`SHAPES`) is code in the contract. A mapping can only *name* a shape.
7. **Role migration** (design §7). The enum becomes the ten roles. A legacy
   `"unknown"` in cached descriptors is read as `"reference"` through a
   `z.preprocess`, with `verified: false`. `ReferenceSlot` gains `verified`,
   `required` and `shape`, all defaulted, so old caches still parse.
8. **Registry files.** `registry/index.json` holds
   `{ "format": 1, "registryVersion": <int>, "families": [ids] }`, and
   `registry/models/<id>.json` holds one family per file, formatted by
   `formatFamilyJson`. The remote base URL defaults to
   `https://raw.githubusercontent.com/venkatesh-sekar/opendirect/main/registry`.
   The remote copy is used only when its `format === 1` and its
   `registryVersion` is greater than the bundled one. A later layer replaces a
   family **by id, wholesale** (no deep merge).
9. **User overrides** live in the app's settings store (`electron-store`, the
   same file as settings) under the key `modelRegistry.overrides`, as
   `Array<{ raw: unknown; updatedAt: number }>`. Raw is kept, so an entry that
   stops validating (after a format change, say) is still listed with its
   issues and can be fixed in the editor rather than being lost.
10. **New settings** (in `settingsSchema` and `settingsDefaults`):
    `providerOrder: ProviderId[]` (default `["replicate","openrouter"]`),
    `remoteRegistry: boolean` (default `true`), `registryUrl: string | null`
    (default `null`, meaning use the default URL), `includeUnverified: boolean`
    (default `false`).
11. **Per-node provider override** is a new nullable column
    `canvas_nodes.provider_override` (drizzle migration 0010). Workflows do not
    carry it.
12. **Known limitation, documented and not modelled:** some endpoints forbid
    certain combinations *within* one endpoint (for example Seedance "last
    frame … cannot be combined with reference images"). The format has no
    exclusivity rule. The slot **label** says it, and the provider rejects the
    run at submit with its own message. Add this to "Open questions" in the
    design doc (Task 13).

### Task map

| Id | Phase | Title | Depends on | Parallel group |
|---|---|---|---|---|
| 1 | A | Contract: ten roles, slot fields, keys, settings | — | G1 |
| 2 | A | Contract: mapping format, shapes, schema check, JSON formatter | 1 | G2 |
| 3 | A | Bundled registry files + guard tests | 2 | G3 (∥ 4) |
| 4 | A | Contract: merge, endpoint choice, availability, translation, family schema, suggestions | 2 | G3 (∥ 3) |
| 5 | A | Main: registry service (bundled + remote + overrides), IPC, hooks | 3, 4 | G4 |
| 6 | B | Main: descriptor annotation, family descriptors, family cost, capabilities | 5 | G5 (∥ 8, 13) |
| 7 | B | Main: submit-time translation + runner shapes | 6 | G6 (∥ 9, 10) |
| 8 | D | Settings → Models tab: status, reload, provider order, family browser | 5 | G5 (∥ 6, 13) |
| 9 | D | Mapping editor (create/edit/duplicate, suggestions, validation, preview, import/export) | 4, 8 | G6 (∥ 7, 10) |
| 10 | C | Model picker: families, capability filters, include unverified | 6, 8 | G6 (∥ 7, 9) |
| 11 | C | Canvas: family nodes, per-node provider override, incompatible edges | 7 | G7 |
| 12 | C | Canvas slot UI: role labels, unverified badge, dimming with reason | 8, 11 | G8 |
| 13 | E | Guards & docs: verify:providers registry mode, CONTRIBUTING.md, doc updates | 3, 5 | G5 (∥ 6, 8) |
| 14 | E | Integration pass: full suite, build, manual run | all | G9 |

Tasks in the same group touch disjoint files and can run in parallel. Tasks
in later groups need the earlier groups merged first.

---

## Phase A — contract + registry core

### Task 1: Contract — ten roles, slot fields, keys, settings

**Goal.** Migrate the role enum to the design's ten roles, give slots
`verified`/`required`/`shape`, add family-key helpers and the new settings.
Nothing behaves differently yet, except that inferred slots now say
`reference` + `verified: false` instead of `unknown`.

**Files**
- Modify: `packages/contract/src/model.ts`
- Create: `packages/contract/src/model.test.ts` (if absent; otherwise extend)
- Modify: `packages/contract/src/ipc.ts` (`settingsSchema`, `settingsDefaults`)
- Modify: `packages/contract/src/ipc.test.ts` (settings defaults)
- Modify: `packages/contract/src/workflow.ts` (recipe `modelKey` refine → `isRunnableModelKey`)
- Modify: `packages/contract/src/workflow.test.ts`
- Modify: `apps/desktop/src/main/providers/reference-slots.ts` (+ `.test.ts`)
- Modify: `apps/desktop/src/main/providers/replicate.test.ts`, `openrouter.test.ts` (role expectations)
- Modify: `apps/web/lib/mentions/resolve.ts` (+ `.test.ts`), `apps/web/lib/canvas/icon-grid.test.ts` (fixture role)
- Modify: `apps/desktop/src/main/settings.test.ts` (defaults)

**Interfaces**

```ts
// model.ts
/**
 * What an input controls in the output. ONE closed list. Rules (design §2,
 * docs/plans/2026-09-24-model-registry-design.md, and CONTRIBUTING.md):
 *  1. A role never encodes the media kind (`soundtrack`, not `audio`).
 *  2. Detail goes in the slot label, never a new role (no `face`).
 *  3. A new role must pass all three tests — controls something no other
 *     role does; ≥2 models from different vendors have it; the UX would
 *     filter or route it differently — otherwise it is `reference`.
 *  4. When unsure, `reference`.
 *  5. Changing this list is a contract change: bump REGISTRY_FORMAT and
 *     cite these rules in the PR.
 */
export const referenceRoleSchema = z.enum([
  "source", "mask", "first_frame", "last_frame",
  "character", "style", "structure", "motion", "soundtrack", "reference",
])
export const REFERENCE_ROLES = referenceRoleSchema.options

/** Pre-registry caches said "unknown"; it now reads as unverified `reference`. */
const legacyRole = (value: unknown) => (value === "unknown" ? "reference" : value)

export const referenceSlotSchema = z.object({
  field: z.string(),              // provider field, or a slot key on family descriptors
  label: z.string(),
  kind: z.enum(["image", "video", "audio", "any"]),
  multiple: z.boolean(),
  max: z.number().nullable(),
  role: z.preprocess(legacyRole, referenceRoleSchema),
  /** True only when a registry mapping (not a name guess) set the role. */
  verified: z.boolean().default(false),
  /** Whether the chosen endpoint requires this input. */
  required: z.boolean().default(false),
  /** Named payload shape from the contract's SHAPES; null = plain URL(s). */
  shape: z.string().nullable().default(null),
})

export const FAMILY_KEY_PREFIX = "family:"
export function familyKey(id: string): string
export function parseFamilyKey(key: string): string | null   // "family:x" → "x"; null otherwise or empty id
export function isRunnableModelKey(key: string): boolean       // parseModelKey(key) !== null || parseFamilyKey(key) !== null
```

`modelDescriptorSchema` stays as it is in this task. Task 2 adds `family` and
`mappedBy`, because they need the mapping schemas.

```ts
// ipc.ts settingsSchema additions
providerOrder: z.array(providerIdSchema).max(8),
remoteRegistry: z.boolean(),
registryUrl: z.string().url().nullable(),
includeUnverified: z.boolean(),
// settingsDefaults
providerOrder: ["replicate", "openrouter"], remoteRegistry: true,
registryUrl: null, includeUnverified: false,
```

**Steps (TDD)**
1. `model.test.ts`: (a) `referenceSlotSchema.parse({ …, role: "unknown" })`
   gives `role: "reference", verified: false, required: false, shape: null`.
   (b) `REFERENCE_ROLES` has exactly the ten values, in the order above.
   (c) `familyKey`/`parseFamilyKey` round trip. `parseFamilyKey("family:")`
   and `parseFamilyKey("replicate:a/b")` return null.
   (d) `isRunnableModelKey` accepts both kinds of key and rejects `"foo"`.
   Run it and see it fail. Implement. Run it and see it pass.
2. `workflow.test.ts`: a recipe with `modelKey: "family:seedance-2-5"`
   parses, and `"nope"` still fails. Change the refine to
   `isRunnableModelKey`.
3. `ipc.test.ts` / `settings.test.ts`: the defaults include the four new
   fields. A stored blob without them still reads (the merge with defaults).
   `settings:set({ providerOrder: ["openrouter"] })` round trips.
4. `reference-slots.ts`: `roleOf` returns `"reference"` where it returned
   `"unknown"`. Every slot gets `verified: false, required: false, shape:
   null`. Update the module doc comment (rule 1 now says "a slot that matches
   no hint is `reference`, unverified"). Update the provider tests that
   assert `"unknown"`.
5. `mentions/resolve.ts`: `rolePreference` becomes: `reference` + `verified`
   first (0), `reference` unverified next (1), then everything else (2).
   `RESERVED_ROLES` adds `mask`, `structure` and `soundtrack` (a mention must
   never land in one of those). Add a test for each.
6. `pnpm vitest run packages/contract apps/desktop/src/main/providers apps/web/lib/mentions apps/web/lib/canvas`, then `pnpm typecheck && pnpm lint`.
7. Commit: `feat(contract): ten reference roles, slot verification flags, family keys`.

**Acceptance**
- No `"unknown"` role remains in non-test source (`grep -rn '"unknown"' packages/contract/src/model.ts apps/desktop/src/main/providers/reference-slots.ts` finds no role use).
- Old catalog caches still parse. The schema test above covers this.
- `pnpm typecheck`, `pnpm lint` and the touched tests pass.

---

### Task 2: Contract — mapping format, shapes, schema check, JSON formatter

**Goal.** Define the registry file format (design §3) as zod, plus the three
small pure utilities every later task reuses: the shape registry,
`checkEndpointAgainstSchema` (does each mapped field exist and fit?), and
`formatFamilyJson` (the canonical file text).

**Files**
- Create: `packages/contract/src/registry/schema.ts`
- Create: `packages/contract/src/registry/shapes.ts`
- Create: `packages/contract/src/registry/check.ts`
- Create: `packages/contract/src/registry/format.ts`
- Create: `packages/contract/src/registry/index.ts` (re-exports)
- Create: `packages/contract/src/registry/schema.test.ts`, `shapes.test.ts`, `check.test.ts`, `format.test.ts`
- Modify: `packages/contract/src/index.ts` (`export * from "./registry"`)
- Modify: `packages/contract/src/model.ts` (descriptor `family`, `mappedBy`)

**Interfaces**

```ts
// schema.ts
export const REGISTRY_FORMAT = 1
export const DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/venkatesh-sekar/opendirect/main/registry"

export const controlNameSchema = z.enum([
  "prompt", "negative_prompt", "aspect_ratio", "duration",
  "resolution", "seed", "generate_audio", "count",
])
export type ControlName = z.output<typeof controlNameSchema>

/** `character`, `reference:2` … — a role, plus :2–:9 when a role repeats. */
export const slotKeySchema = z.string().regex(
  new RegExp(`^(${REFERENCE_ROLES.join("|")})(:[2-9])?$`)
)
export function slotKeyRole(key: string): ReferenceRole   // strips ":n"
export const familyIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)

export const mappingInputSchema = z.strictObject({
  field: z.string().min(1),
  kind: z.enum(["image", "video", "audio", "any"]),
  required: z.boolean().optional(),
  max: z.number().int().positive().optional(),
  label: z.string().min(1).max(80).optional(),
  shape: z.string().optional(),
})
export const mappingControlSchema = z.strictObject({
  field: z.string().min(1),
  /** canonical value → provider value */
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
})
export const mappingEndpointSchema = z.strictObject({
  provider: providerIdSchema,
  model: z.string().min(1),
  inputs: z.record(slotKeySchema, mappingInputSchema).default({}),
  controls: z.partialRecord(controlNameSchema, mappingControlSchema).default({}),
}).superRefine(/* see rules below */)
export const modelFamilySchema = z.strictObject({
  $schema: z.string().optional(),
  id: familyIdSchema,
  name: z.string().min(1).max(80),
  kind: z.enum(["video", "image", "audio"]),
  description: z.string().max(500).optional(),
  endpoints: z.array(mappingEndpointSchema).min(1),
}).superRefine(/* no duplicate provider+model */)
export type ModelFamily = z.output<typeof modelFamilySchema>
export type MappingEndpoint = z.output<typeof mappingEndpointSchema>

/** `format` is read as a number so a newer format produces a clear warning, not a parse error. */
export const registryIndexSchema = z.strictObject({
  format: z.number().int().positive(),
  registryVersion: z.number().int().nonnegative(),
  families: z.array(familyIdSchema),
})
export const registrySourceSchema = z.enum(["bundled", "remote", "user"])
export const registryWarningSchema = z.object({
  source: registrySourceSchema, familyId: z.string().nullable(), message: z.string(),
})
export const registryFamilyEntrySchema = z.object({
  family: modelFamilySchema,
  source: registrySourceSchema,
  /** Lower layers this entry replaced, e.g. ["bundled"]. */
  shadows: z.array(registrySourceSchema),
  warnings: z.array(z.string()),
})
export const registryStatusSchema = z.object({
  format: z.number(),
  bundledVersion: z.number(),
  activeVersion: z.number(),
  activeSource: z.enum(["bundled", "remote"]),
  remote: z.object({
    enabled: z.boolean(), url: z.string(),
    version: z.number().nullable(), fetchedAt: z.number().nullable(),
    error: z.string().nullable(),
  }),
  overrides: z.number(),
  families: z.number(),
  warnings: z.array(registryWarningSchema),
})
export const userOverrideSchema = z.object({
  id: z.string().nullable(),          // raw.id when it is a string
  raw: z.unknown(),
  family: modelFamilySchema.nullable(), // null when invalid
  issues: z.array(z.string()),
  updatedAt: z.number(),
})

/** Attached to family descriptors (Task 6). */
export const familyInfoSchema = z.object({
  family: modelFamilySchema,
  source: registrySourceSchema,
  configured: z.array(providerIdSchema),
  providerOrder: z.array(providerIdSchema),
  override: providerIdSchema.nullable(),
  choice: z.object({
    index: z.number().int().nullable(),   // index into family.endpoints
    missing: z.array(z.string()),          // required slot keys not yet filled
    unsupported: z.array(z.string()),      // filled keys no candidate endpoint takes
    message: z.string().nullable(),
  }),
})
```

`model.ts` → `modelDescriptorSchema` gains:

```ts
/** Set on `family:<id>` descriptors only. */
family: familyInfoSchema.nullable().default(null),
/** Set on a concrete descriptor whose endpoint a registry family maps. */
mappedBy: z.object({ familyId: z.string(), source: registrySourceSchema }).nullable().default(null),
```

`model.ts` imports from `./registry/schema`, and `registry/schema.ts` imports
`REFERENCE_ROLES` from `./model` → **import cycle**. Avoid it by moving
`referenceRoleSchema`/`REFERENCE_ROLES` into a new
`packages/contract/src/roles.ts`, imported by both files and re-exported from
`model.ts` so existing imports keep working.

Endpoint `superRefine` rules. Each rule emits a custom issue with a sentence a
person can act on:
1. Two inputs may not map the same `field`.
2. A control's `field` may not equal an input's `field`.
3. `shape`, when set, must be a key of `SHAPES`: "Unknown shape "x". A
   mapping can only name a shape the app ships: <list>".
4. `role:n` needs `role` (and `role:n-1`) present.
5. `count` control has no `values`.

```ts
// shapes.ts
/**
 * Named payload shapes (design §3). Code, not data: a mapping file can only
 * NAME one, so a remote registry can never run code. Each takes the final
 * URLs for one input, in position order, and returns the field's value.
 */
export type ShapeFn = (urls: readonly string[]) => unknown
export const SHAPES = {
  /**
   * Kling "elements": one element whose first image is the frontal photo and
   * the rest are extra references, per the payload in the design doc §3
   * (`elements: [{ frontal_image_url, reference_image_urls }]`). No bundled
   * mapping uses it yet (no Kling fixture is recorded); it is the worked,
   * tested example of the mechanism.
   */
  "kling-elements": (urls) =>
    urls.length === 0 ? [] : [{ frontal_image_url: urls[0], reference_image_urls: urls.slice(1) }],
} as const satisfies Record<string, ShapeFn>
export type ShapeName = keyof typeof SHAPES
export const SHAPE_NAMES = Object.keys(SHAPES) as ShapeName[]
export function applyShape(shape: string | null | undefined, urls: readonly string[], multiple: boolean): unknown
// no shape → multiple ? [...urls] : urls[0]; unknown shape → throws Error("Unknown shape …")
```

```ts
// check.ts — shared by the fixture test (T3), verify:providers (T13) and the editor (T9)
export interface SchemaIssue { path: string; message: string }
/**
 * Checks one endpoint's mapping against that endpoint's input JSON Schema
 * (a descriptor's `inputSchema`). Pure; never fetches.
 */
export function checkEndpointAgainstSchema(endpoint: MappingEndpoint, inputSchema: unknown): SchemaIssue[]
```

Rules for `checkEndpointAgainstSchema`:
- Every mapped `field` exists in `inputSchema.properties`.
- Input fields are URI strings or arrays of URI strings (the same test as
  `reference-slots.ts`). An array field with no `max` in the mapping is fine.
  A non-array field with `max > 1` is an issue.
- `shape` is only allowed on an array field or a non-URI field (a shape
  exists to produce structure).
- A control's `values` provider-side values must be members of the
  property's `enum` when it has one.
- `required: true` on an input whose field is in the schema's `required`
  list is fine. The reverse (the schema requires it, the mapping does not
  say so) is an issue: "… is required by the provider; mark it required".

```ts
// format.ts
/** The canonical file text: fixed key order, 2-space indent, trailing newline. */
export function formatFamilyJson(family: ModelFamily): string
// key order: $schema?, id, name, kind, description?, endpoints[]{provider, model, inputs{…in REFERENCE_ROLES order then :n}, controls{…in controlNameSchema order}}
// each input: field, kind, required?, max?, label?, shape? ; control: field, values?
```

**Tests (write first)**
- `schema.test.ts`: the design's `kling-v3-pro` example (with `shape:
  "kling-elements"`) parses. Each of the five refine rules fails with its
  sentence. An unknown top-level key fails (strict). `slotKeySchema` accepts
  `character` and `reference:2` and rejects `face`, `reference:1` and
  `reference:10`. `registryIndexSchema` accepts `format: 2`, because the
  version decision is the caller's.
- `shapes.test.ts`: `kling-elements` for 0, 1 and 3 urls. `applyShape(null,
  ["a"], false) === "a"`. `applyShape(null, ["a","b"], true)` deep-equals
  `["a","b"]`. An unknown shape throws.
- `check.test.ts`: use the real Replicate fixture schema
  (`test/fixtures/replicate/model-seedance-2.5.json` →
  `latest_version.openapi_schema.components.schemas.Input`, with the enum
  `$ref`s resolved by `dereferenceCogSchema` imported from
  `apps/desktop/src/main/providers/replicate.ts`, which vitest can import).
  Check one mapping with a misspelled field, one with `prompt` mapped as an
  input (not a URI), and one control value `"8K"` for `resolution` (not in
  the enum). Each yields exactly one issue.
- `format.test.ts`: key order is stable no matter the input order. The output
  ends with `\n`. `JSON.parse(formatFamilyJson(f))` deep-equals the parsed
  family.

**Verify:** `pnpm vitest run packages/contract/src/registry` → pass;
`pnpm typecheck && pnpm lint`.

**Commit:** `feat(contract): model registry mapping format, shapes and schema checks`

**Acceptance:** the schemas, `SHAPES`, `checkEndpointAgainstSchema` and
`formatFamilyJson` are exported from `@opendirect/contract`; there is no
import cycle (`pnpm typecheck` passes); cached descriptors without `family` or
`mappedBy` still parse.

---

### Task 3: Bundled registry files + guard tests (design §6)

**Goal.** Ship accurate mapping files for the models the app already
recommends and has recorded fixtures for. Add the CI guards that stop the
registry from drifting.

**Files**
- Create: `registry/index.json`
- Create: `registry/models/seedance-2-5.json`, `seedance-2-0.json`, `nano-banana-2.json`, `nano-banana-pro.json`, `flux-schnell.json`
- Create: `apps/desktop/src/main/model-registry/bundled.ts`
- Create: `apps/desktop/src/main/model-registry/bundled.test.ts`
- Create: `apps/desktop/src/main/model-registry/fixture-schemas.ts` (test helper: provider+model → input schema from recorded fixtures)

**Rules for writing the files.** Every field name, `max`, enum value and
description-derived label must come from the recorded fixture. **Never invent
a field.** To read a fixture, run the snippet below and use only what it
prints:

```bash
node -e 'const m=require("./test/fixtures/replicate/model-seedance-2.5.json");const s=m.latest_version.openapi_schema.components.schemas.Input.properties;for(const[k,v]of Object.entries(s))console.log(k,v.type,v.format||"",(v.items&&v.items.format)||"",(v.description||"").slice(0,120))'
```

The planning pass saw the following (re-check before writing):

- **seedance-2-5** (video). Replicate `bytedance/seedance-2.5`:
  - `first_frame` → `image` (image, "First frame")
  - `last_frame` → `last_frame_image` (image, "Last frame (needs a first frame)")
  - `reference` → `reference_images` (image, max 30, "Reference images (character, style, scene)")
  - `reference:2` → `reference_videos` (video, max 10, "Reference videos (motion, style)")
  - `soundtrack` → `reference_audios` (audio, max 10, "Reference audio (lip-sync, audio-driven)")
  - controls `prompt`, `duration`, `resolution`, `aspect_ratio`, `seed`,
    `generate_audio`, each with the same field name.
  - Maxima come from the descriptions ("up to 30 / 10 / 10").

  OpenRouter `bytedance/seedance-2.5` (from `videos-models.json`;
  `supported_frame_images: ["first_frame","last_frame"]`):
  - `first_frame` → `first_frame` (image), `last_frame` → `last_frame` (image)
  - `reference` → `input_references` (kind `any`, label "Input references")
  - controls `prompt`, `duration`, `resolution`, `aspect_ratio`, `seed`,
    `generate_audio`.
- **seedance-2-0** (video): the same pattern for Replicate
  `bytedance/seedance-2.0` (maxima 9 images, 3 videos, 3 audios, from its
  descriptions) and OpenRouter `bytedance/seedance-2.0`. The Replicate schema
  lists `prompt` as required, and that is a control, so no input is
  `required`.
- **nano-banana-2** (image): Replicate `google/nano-banana-2`, with
  `reference` → `image_input` (image, max 14, "Reference images"), and
  controls `prompt`, `aspect_ratio`, `resolution`.
- **nano-banana-pro** (image): Replicate `google/nano-banana-pro`, the same
  as nano-banana-2 (image_input max 14).
- **flux-schnell** (image): Replicate `black-forest-labs/flux-schnell`, with
  no inputs. Controls `prompt`, `aspect_ratio`, `seed`, and `count` →
  `num_outputs`.
- **OpenRouter endpoints for the Nano Banana families.** Add
  `google/gemini-3.1-flash-image` (Nano Banana 2) and
  `google/gemini-3-pro-image` (Nano Banana Pro) **only if** the `name` in
  `test/fixtures/openrouter/images-models.json` confirms the product name.
  Check with
  `node -e 'const i=require("./test/fixtures/openrouter/images-models.json");for(const m of i.data)console.log(m.id,"|",m.name)'`.
  If they are confirmed, map `reference` → `input_references` (image; no
  `max`, because the schema's `maxItems` from the manifest applies), and
  controls `prompt`, `aspect_ratio`, `resolution`, and `count` → `n`, each
  only when present in `supported_parameters`. If the name does not confirm
  it, leave the endpoint out and say so in the commit message.

All four roles in these files are `reference`, `first_frame`, `last_frame`
and `soundtrack`. That is honest: "character consistency, style guidance, and
scene composition" in one field is `reference` (rule 4, *when unsure*). **No
real fixture needs a named shape**, so `kling-elements` stays the tested
example from Task 2. Say this in `registry/index.json`'s commit message.

`registry/index.json`:
`{ "format": 1, "registryVersion": 1, "families": ["flux-schnell","nano-banana-2","nano-banana-pro","seedance-2-0","seedance-2-5"] }`.

Write each file with `formatFamilyJson` (for example a throwaway `node -e`
through `tsx`, or by hand in exactly that format). The guard test enforces
the format.

**`bundled.ts`**

```ts
/**
 * The registry floor, compiled into the app so it works offline (design §4.1).
 * Static JSON imports: tsup/esbuild inlines them. `resolveJsonModule` is already
 * on in packages/typescript-config/base.json.
 */
import index from "../../../../../registry/index.json" with { type: "json" }
import flux from "../../../../../registry/models/flux-schnell.json" with { type: "json" }
// … one import per file
export const BUNDLED_INDEX: unknown = index
export const BUNDLED_FAMILIES: ReadonlyArray<{ origin: string; raw: unknown }> = [
  { origin: "registry/models/flux-schnell.json", raw: flux }, …
]
```

If `with { type: "json" }` trips the NodeNext + `isolatedModules` config or
tsup, fall back to `import x from "….json"` without the attribute, confirm
`pnpm --filter @opendirect/desktop build` still inlines it, and note which
form worked in the file's doc comment.

**`fixture-schemas.ts`** (test-only helper; name it `*.ts`, not `*.test.ts`,
so it can be imported, and keep it out of production imports):

```ts
export function fixtureInputSchema(provider: ProviderId, model: string): Record<string, unknown> | null
// replicate: test/fixtures/replicate/model-<name>.json → dereferenceCogSchema(Input, schemas)
// openrouter: find id in videos-models.json → buildVideoInputSchema; else images-models.json → buildImageInputSchema
```

**Guard tests (`bundled.test.ts`), written first:**
1. **Every bundled file parses** with `modelFamilySchema` and has
   `id === basename`.
2. **Every named shape exists**: for each input with `shape`,
   `shape in SHAPES`. This is redundant with the schema refine on purpose,
   so the guard stays even if the refine is loosened.
3. **Every mapped field is real**: for each endpoint, `fixtureInputSchema`
   is not null ("record a fixture for <provider>:<model> before mapping it"),
   and `checkEndpointAgainstSchema(endpoint, schema)` returns `[]`.
4. **Index is consistent**: `registry/index.json` parses, `format ===
   REGISTRY_FORMAT`, and its `families` equal (as sets) the files in
   `registry/models/`, which equal the entries in `BUNDLED_FAMILIES` (read the
   directory with `readdirSync`). This catches a file added without an
   import.
5. **Canonical formatting**: each file's text `===
   formatFamilyJson(parsed)`.
6. **No duplicate endpoints across families** (the same `provider:model` in
   two families).

**Verify:** `pnpm vitest run apps/desktop/src/main/model-registry` → pass;
`pnpm typecheck && pnpm lint`. Then corrupt one field name locally, confirm
test 3 fails with a readable message, and revert.

**Commit:** `feat(registry): bundled mappings for Seedance, Nano Banana and FLUX with drift guards`

---

### Task 4: Contract — merge, endpoint choice, availability, translation, family schema, suggestions

**Goal.** All of the registry's behaviour as pure, exhaustively tested
functions. No I/O. (This task can run in parallel with Task 3.)

**Files**
- Create: `packages/contract/src/registry/merge.ts` (+ `.test.ts`)
- Create: `packages/contract/src/registry/resolve.ts` (+ `.test.ts`)
- Create: `packages/contract/src/registry/translate.ts` (+ `.test.ts`)
- Create: `packages/contract/src/registry/family-schema.ts` (+ `.test.ts`)
- Create: `packages/contract/src/registry/suggest.ts` (+ `.test.ts`)
- Modify: `packages/contract/src/registry/index.ts`

**Interfaces**

```ts
// merge.ts
export interface RegistryLayerInput {
  source: RegistrySource
  entries: ReadonlyArray<{ origin: string; raw: unknown }>
}
export interface MergedRegistry {
  families: RegistryFamilyEntry[]            // sorted by family.name
  warnings: RegistryWarning[]
  /** "provider:model" → family id, highest layer wins. */
  endpointIndex: Map<string, string>
}
/** Layers in precedence order: bundled, remote, user. Later replaces earlier BY ID, wholesale. */
export function mergeRegistry(layers: readonly RegistryLayerInput[]): MergedRegistry
```

Merge behaviour:
- An invalid entry becomes a warning of the form
  `"<origin>: <first zod issue path>: <message>"` (with `familyId` when
  `raw.id` is a string), and the lower layer's family stays in force (design
  §4: never silent).
- A duplicate id within one layer gives a warning, and the first entry wins.
- If an endpoint `provider:model` appears in two different families, a
  warning names both. The index maps it to the family from the higher layer,
  then to the alphabetically first one.
- `shadows` lists the lower sources an entry replaced.

```ts
// resolve.ts
export interface ChoiceInput {
  filled: readonly string[]            // slot keys
  providerOrder: readonly ProviderId[]
  configured: readonly ProviderId[]
  override: ProviderId | null
}
export function candidateProviders(family: ModelFamily, input: ChoiceInput): ProviderId[]
export type EndpointChoice =
  | { ok: true; index: number; endpoint: MappingEndpoint; missing: string[] }
  | { ok: false; index: number | null; unsupported: string[]; message: string }
export function chooseEndpoint(family: ModelFamily, input: ChoiceInput): EndpointChoice
export interface SlotAvailability { available: boolean; reason: string | null }
/** Design §5.3: for each union slot key, can SOME candidate endpoint take it together with what is filled? */
export function slotAvailability(family: ModelFamily, input: ChoiceInput): Record<string, SlotAvailability>
/** Union of all endpoints' inputs as ReferenceSlots (field = slot key, verified true, required false, shape null). */
export function familySlots(family: ModelFamily): ReferenceSlot[]
export function endpointKey(endpoint: MappingEndpoint): string   // modelKey(provider, model)
```

Choice rules (planning decision 4):
- `candidateProviders`: the override when set, even if unconfigured (the
  choice then fails with "Add a <Provider> key in Settings to run <Family> on
  <Provider>"). Otherwise `providerOrder ∩ configured`, then the remaining
  configured providers in `ProviderId` enum order, keeping only providers
  that have an endpoint in the family.
- `ok: false` with `index: null`: "No configured provider can run <Family>.
  Add a key for <providers> in Settings."
- `ok: false` with `index` set (the first endpoint of the first candidate,
  so the UI can still show a form): "<Family> has no endpoint on <providers>
  that takes <labels> together."
- Union slot order is `REFERENCE_ROLES` order, then `:n`. The union label is
  the first endpoint's label, else the role's default label: `first_frame` →
  "First frame", `reference` → "Reference", and so on.
  `ROLE_LABELS: Record<ReferenceRole, string>` is exported from `resolve.ts`
  and reused by the UI. The union `kind` is the widest seen (image+video →
  any). `max` is the largest, or null if any endpoint is unbounded.
  `multiple` is true if any endpoint's field is an array, which `familySlots`
  cannot see. Take a second argument
  `schemas?: Record<number, unknown>` (endpoint index → inputSchema). Without
  it, `multiple = (max ?? 2) > 1`.
- An availability reason reads: "Not with First frame on Replicate — no
  endpoint takes both". A filled key is always available.

```ts
// translate.ts
export class RegistryTranslationError extends Error {}
export interface TranslateInput {
  family: ModelFamily
  endpoint: MappingEndpoint
  endpointSchema: unknown                          // concrete descriptor inputSchema
  params: Record<string, unknown>                  // canonical names, raw names, "raw:<name>"
  references: readonly GenerationReference[]       // slotField = slot key
}
export interface TranslateOutput {
  params: Record<string, unknown>                  // provider field names
  references: GenerationReference[]                // slotField = provider field
}
export function translateFamilyRequest(input: TranslateInput): TranslateOutput
/** Controls + raw only (no references) — for cost quotes. */
export function translateFamilyParams(input: Omit<TranslateInput, "references">): Record<string, unknown>
```

Translation rules, each with a test:
- A canonical control with a mapping becomes `field`. With `values`, the
  value is looked up. A miss throws `"<Family> on <Provider>: <value> is not
  a <control> this endpoint takes (<allowed>)"`. Without `values`, the value
  is coerced to the property's JSON-Schema `type` (`"5"` → 5 for
  integer/number when numeric, `"true"`/`"false"` → boolean). Otherwise it is
  left untouched.
- A canonical control this endpoint does not map throws
  `"<Family> on <Provider> has no <control> control"`. Exception: `prompt`
  with an empty string is dropped (an empty prompt is "unset").
- `raw:<name>` → `<name>`. A bare key that is neither a control nor a mapped
  field passes through. A raw key must exist in the schema properties. A raw
  key equal to a mapped input or control field throws "…may not overwrite
  the mapped field <f>" (design §5.4). Raw values merge **last**.
- A reference whose slot key is not in `endpoint.inputs` throws
  `"<Family> on <Provider> cannot take a <Role label> input"` (design §5.5).
  More references than `max` throws. A missing required input throws.
- The references' `position` values are preserved per field.

```ts
// family-schema.ts
export interface FamilySchemaResult {
  inputSchema: Record<string, unknown>
  commonControls: CommonControls
}
/** Planning decision 3. */
export function familyInputSchema(endpoint: MappingEndpoint, endpointSchema: unknown): FamilySchemaResult
```

Family schema rules:
- Remove the mapped input fields.
- Rename each mapped control property to its canonical name, **except
  `count`**, which keeps its field name. When `values` is present, the
  canonical property's `enum` = the `values` keys whose mapped value is in the
  provider enum (or all keys if there is no provider enum), its `type` =
  `"string"`, and its `default` is reverse-mapped when possible.
- Copy the `title`/`description`/`x-order`.
- Rewrite `required` the same way.
- An unmapped property whose name equals a canonical name that is mapped
  elsewhere is renamed `raw:<name>`.
- `commonControls` = `{ prompt: "prompt" | null, aspectRatio: "aspect_ratio"
  | null, duration, resolution, seed, audio: "generate_audio" | null }`, set
  when mapped. A family descriptor with no mapping for a control reads `null`,
  and the unmapped field stays in Advanced under its own name.

```ts
// suggest.ts
export type SuggestionConfidence = "manifest" | "schema" | "name" | "none"
export interface FieldSuggestion {
  field: string
  as: { input: string; kind: MappingInput["kind"]; max?: number; label?: string }
     | { control: ControlName } | null
  confidence: SuggestionConfidence
  why: string                       // shown in the editor, e.g. "OpenRouter lists first_frame in supported_frame_images"
}
/** Drafts one endpoint mapping from a concrete descriptor (the editor's pre-fill). */
export function suggestEndpointMapping(descriptor: ModelDescriptor): { endpoint: MappingEndpoint; fields: FieldSuggestion[] }
```

Suggestion rules:
- If `descriptor.mappedBy` is set (already mapped), return that mapping
  unchanged, with confidence `"schema"` (the caller passes the family). Keep
  this simple: accept an optional `existing?: MappingEndpoint` argument and
  return it.
- OpenRouter-synthesized schema (`inputSchema["x-opendirect-source"] ===
  "openrouter-capabilities"`): `first_frame`/`last_frame` → those roles, and
  `input_references` → `reference`, all with confidence `"manifest"`.
- Every other URI slot: take `slot.role` from `descriptor.referenceSlots` (the
  name hints). Refine it from the description:
  `/first[- ]frame/i` → `first_frame`, `/last[- ]frame/i` → `last_frame`,
  `/lip[- ]?sync|audio[- ]driven/i` → `soundtrack`,
  `/\bmask\b/i` → `mask`, `/\bpose|depth|canny|edge map/i` → `structure`,
  `/\bstyle reference\b/i` alone (no "character") → `style`. A description
  refinement gets confidence `"schema"`, a name hint gets `"name"`, and the
  fallback `reference` gets `"none"`. A repeated role gets `:2`… in schema
  order.
- Kind: `slot.kind`, with `"any"` kept.
- Max: `slot.max` (it already reads `maxItems`/"up to N").
- Label: `slot.label`.
- Controls come from `descriptor.commonControls` plus `negative_prompt` when
  that property exists. `count` comes from the contract's batch count-field
  detector (look in `packages/contract/src/canvas-batch.ts` for the exported
  function behind `planBatch`'s `countField`; export it if it is private).

**Tests.** Build the fixtures in the test files from the real bundled shapes
(copy `seedance-2-5` in as a literal; do not import `registry/`, which is
Task 3's). Cover every rule above. At minimum:
- `chooseEndpoint`: with the order `["replicate","openrouter"]` and both
  configured, no filled keys → Replicate endpoint 0. Filled
  `["reference:2"]` with only OpenRouter configured → `ok:false` naming
  "Reference videos". An override to an unconfigured provider → a message
  that tells the user to add the key.
- `slotAvailability` with a synthetic two-endpoint family: filling `character`
  dims `last_frame` when only the other endpoint has it, with the reason
  text.
- `translateFamilyRequest`: a rename, values mapping, a values miss,
  coercion, a raw overwrite rejected, `raw:` collision, an unsupported role
  rejected, max exceeded, a required input missing.
- `familyInputSchema` on the real seedance-2.5 Replicate schema (use
  `fixtureInputSchema` from Task 3 if it has merged, else inline
  `dereferenceCogSchema`): no `image`/`last_frame_image`/`reference_*`
  properties remain, `duration` is present, and `watermark` is still present
  (Advanced).
- `suggestEndpointMapping` on the OpenRouter seedance descriptor (build it
  with `buildVideoInputSchema` + `deriveReferenceSlots` from
  `apps/desktop/src/main/providers`) → manifest-confidence frame roles. On
  the Replicate seedance-2.5 descriptor → `image` becomes `first_frame`
  ("schema"), and `reference_audios` becomes `soundtrack`.
- `mergeRegistry`: user replaces bundled, and `shadows` equals
  `["bundled"]`. An invalid remote entry leaves the bundled one in force and
  produces a warning. A duplicate endpoint across families gives a warning.

**Verify:** `pnpm vitest run packages/contract/src/registry` → pass;
`pnpm typecheck && pnpm lint`.

**Commit:** `feat(contract): registry merge, endpoint choice, slot availability and request translation`

---

### Task 5: Main — registry service (bundled + remote + overrides), IPC, renderer hooks

**Goal.** Main holds the merged registry. It loads the remote copy (free GET,
zod-validated, disk-cached, with a Reload action), stores user overrides in
the settings store, and exposes everything over IPC. Renderer hooks call
every channel, which keeps `ipc-coverage.test.ts` green.

**Files**
- Create: `apps/desktop/src/main/model-registry/remote.ts` (+ `remote.test.ts`, msw)
- Create: `apps/desktop/src/main/model-registry/overrides.ts` (+ `overrides.test.ts`)
- Create: `apps/desktop/src/main/model-registry/registry.ts` (pure core: `createModelRegistry(deps)`) (+ `registry.test.ts`)
- Create: `apps/desktop/src/main/model-registry/registry-service.ts` (Electron wiring: `userData` cache path, settings store, `dialog`, `log`)
- Create: `apps/desktop/src/main/model-registry/handlers.ts` (`registerRegistryHandlers(handle, registry)`)
- Modify: `packages/contract/src/ipc.ts` (channels below) + `ipc.test.ts`
- Modify: `apps/desktop/src/main/handlers.ts` or `index.ts` (wherever `registerModelHandlers` is called: register the new handlers next to it)
- Create: `apps/web/hooks/use-model-registry.ts`

**IPC channels** (add to `ipcContract`, each with a `/** */` comment that
states it makes free GETs at most):

| Channel | Input | Output |
|---|---|---|
| `registry:status` | void | `registryStatusSchema` |
| `registry:reload` | void | `registryStatusSchema` (forces a remote fetch when enabled) |
| `registry:families` | void | `z.array(registryFamilyEntrySchema)` |
| `registry:overrides:list` | void | `z.array(userOverrideSchema)` |
| `registry:overrides:save` | `{ family: z.unknown(), replaceId: z.string().nullable() }` | `userOverrideSchema` (main re-validates; invalid → throws with the issues joined) |
| `registry:overrides:delete` | `{ id: z.string() }` | `okSchema` |
| `registry:overrides:import` | void | `z.object({ candidates: z.array(userOverrideSchema) })` (native open dialog, `.json`; accepts one family or an array; **does not save**) |
| `registry:overrides:export` | `{ id: z.string() }` | `z.object({ path: z.string().nullable() })` (native save dialog; default name `<id>.json`; writes `formatFamilyJson`) |

**Core (`registry.ts`)**

```ts
export interface ModelRegistryDeps {
  bundled: { index: unknown; families: ReadonlyArray<{ origin: string; raw: unknown }> }
  remote: RemoteRegistrySource            // from remote.ts
  overrides: OverrideStore                // from overrides.ts
  settings: () => Pick<Settings, "remoteRegistry" | "registryUrl">
  now?: () => number
  onError?: (error: unknown) => void
}
export interface ModelRegistry {
  merged(): MergedRegistry                // cached; rebuilt after reload/save/delete
  status(): RegistryStatus
  reload(): Promise<RegistryStatus>
  /** Background refresh at most every 24h; never throws; never blocks. */
  refreshIfStale(): void
  family(id: string): RegistryFamilyEntry | null
  familyForEndpoint(provider: ProviderId, model: string): RegistryFamilyEntry | null
  overrides: { list(): UserOverride[]; save(raw: unknown, replaceId: string | null): UserOverride; delete(id: string): void }
}
```

Layer build:
- Bundled index is parsed. If it fails or its `format !== REGISTRY_FORMAT`,
  that is a bug: throw in tests, and in production warn and use the files
  anyway.
- The remote layer is included only when the cached remote index parses,
  `format === REGISTRY_FORMAT`, and `registryVersion > bundledVersion`.
  Otherwise add a warning. For a newer format: "The remote registry uses
  format N; this version of OpenDirect understands 1. Update the app to use
  it." For an older-or-equal version it is a status note (not a warning):
  `activeSource: "bundled"`.
- Then the user layer.

**Remote (`remote.ts`)**

```ts
export interface RemoteCache { version: 1; url: string; fetchedAt: number; index: unknown; files: Record<string, unknown> }
export interface RemoteRegistrySource {
  read(): RemoteCache | null                    // disk cache; unparsable → null
  fetch(baseUrl: string): Promise<RemoteCache>  // ⛔ free GETs only
  write(cache: RemoteCache): void               // write-then-rename, as catalog-service.ts does
}
export function createRemoteSource(deps: { path: string; fetch?: typeof fetch; now?: () => number }): RemoteRegistrySource
```

- `fetch`: `GET ${base}/index.json`, then `GET ${base}/models/${id}.json` for
  each listed id, at most 6 in flight, with a 15 s timeout (`AbortSignal.timeout`).
  Any non-2xx or JSON error in the index rejects with "Could not fetch the
  model registry from <url>: HTTP 404". A failure on a single file is stored
  as `files[id] = { __error: "HTTP 404" }`, which the merge then reports as
  a warning for that family.
- A failed fetch **keeps the previous cache** and sets `status.remote.error`.
- The cache path is `<userData>/model-registry.json` (`REGISTRY_CACHE_FILE`).
- Refresh is only ever triggered by `reload()` (the button) or
  `refreshIfStale()`. Call `refreshIfStale()` from the `registry:families`
  and `models:list` handlers (fire and forget). **Nothing at startup.**

**Overrides (`overrides.ts`)**

```ts
export const OVERRIDES_KEY = "modelRegistry.overrides"
export interface OverrideStore { list(): UserOverride[]; save(raw: unknown, replaceId: string | null, now: number): UserOverride; delete(id: string): void }
export function createOverrideStore(store: SettingsStore): OverrideStore
```

- `list()` parses each stored raw entry with `modelFamilySchema` and fills in
  `family`/`issues`.
- `save()` refuses invalid input: it throws an `Error` whose message lists
  the issues. It replaces the entry with `replaceId` (a rename), or else the
  entry with the same id, and otherwise appends.
- `delete()` removes by id.
- Use `SettingsStore` from `settings.ts`. The instance is
  `getSettingsService().store`.

**Hooks (`apps/web/hooks/use-model-registry.ts`)**

- `useRegistryStatus()`, `useReloadRegistry()` (a mutation; on success it
  invalidates `["registry"]` and `["models"]` and toasts "Registry reloaded ·
  v<activeVersion> from <source>" or the error).
- `useRegistryFamilies()`, `useRegistryOverrides()`, `useSaveOverride()`,
  `useDeleteOverride()`, `useImportOverrides()`, `useExportOverride()`.
- Every mutation invalidates `["registry"]` and `["models"]`, because a
  mapping change changes the descriptors.
- Query keys go in `apps/web/hooks/query-keys.ts` if that file centralizes
  them (it does: follow its pattern and extend `query-keys.test.ts`).

**Tests (first)**
- `remote.test.ts` (msw handlers on `server`): a happy fetch writes the cache.
  A 404 on the index rejects and keeps the old cache. A 404 on one file is
  recorded as `__error`. The test asserts that only GETs were made (collect
  `request.method` in the handlers).
- `overrides.test.ts`: in-memory `SettingsStore` fake. Save valid, save
  invalid (throws, nothing stored), rename via `replaceId`, delete, and a
  corrupted stored entry is listed with its issues.
- `registry.test.ts`: bundled only. Remote newer → `activeSource: "remote"`
  and the remote family wins. Remote newer but format 2 → a warning and
  bundled stays. Remote older → bundled. A user override shadows both.
  `familyForEndpoint` works. `refreshIfStale` fetches once inside 24 h (fake
  clock). `remoteRegistry: false` never fetches.
- `ipc.test.ts`: the new channels parse sample payloads.
- `ipc-coverage.test.ts` must pass without edits (the hooks reference every
  channel).

**Verify:** `pnpm vitest run apps/desktop/src/main/model-registry apps/desktop/src/main/ipc-coverage.test.ts packages/contract` → pass; `pnpm typecheck && pnpm lint`.

**Commit:** `feat(registry): layered registry service with remote cache, user overrides and IPC`

---

## Phase B — request translation

### Task 6: Main — descriptor annotation, family descriptors, family cost, capabilities

**Goal.** Every descriptor that leaves main carries roles from the registry.
`models:get` serves `family:<id>` keys. `cost:estimate` prices a family run.
The picker gets cached capability data.

**Files**
- Create: `apps/desktop/src/main/model-registry/annotate.ts` (+ `.test.ts`)
- Create: `apps/desktop/src/main/model-registry/family-descriptor.ts` (+ `.test.ts`)
- Modify: `apps/desktop/src/main/catalog.ts` (`registerModelHandlers` takes a `registry` getter and a `settings` getter; `models:get` branches on family keys)
- Modify: `apps/desktop/src/main/catalog.test.ts`
- Modify: `apps/desktop/src/main/handlers.ts` (`cost:estimate`, and the `getModel` passed to submit/preflight/runner goes through annotation)
- Modify: `apps/desktop/src/main/jobs-service.ts` (runner `getModel` → annotated)
- Modify: `packages/contract/src/ipc.ts` (`models:get` input; `cost:estimate` input; new `registry:capabilities`)
- Modify: `apps/web/hooks/use-models.ts` (`useModel(key, opts?)`), `apps/web/hooks/use-generations.ts` (`useCostEstimate` passes `provider`/`filled`), `apps/web/hooks/use-model-registry.ts` (`useCapabilities`)

**Interfaces**

```ts
// annotate.ts
/** Applies a registry mapping to a concrete descriptor. Pure; never mutates. */
export function annotateDescriptor(descriptor: ModelDescriptor, entry: RegistryFamilyEntry | null): ModelDescriptor
```

- With no entry, return the descriptor unchanged (slots already `verified:
  false`).
- With an entry, find the endpoint by provider + slug. For each slot whose
  `field` is mapped:
  - `role = slotKeyRole(key)`, `verified: true`
  - `label = input.label ?? slot.label`
  - `kind = input.kind`, and `max = input.max ?? slot.max`
  - `required = input.required ?? false`, `shape = input.shape ?? null`
- Unmapped slots stay as they are (`verified: false`).
- `commonControls` fields are overridden by the mapped control fields.
- `mappedBy = { familyId, source }`.

```ts
// family-descriptor.ts
export interface FamilyDescriptorInput {
  entry: RegistryFamilyEntry
  choice: EndpointChoice                   // from chooseEndpoint
  endpointDescriptor: ModelDescriptor      // annotated concrete descriptor of choice.index
  configured: ProviderId[]
  providerOrder: ProviderId[]
  override: ProviderId | null
}
export function buildFamilyDescriptor(input: FamilyDescriptorInput): ModelDescriptor
```

The family descriptor is built per planning decision 3:
- `key` = `familyKey(id)`, `name` = `family.name`, `kind` = `family.kind`.
- `provider`/`slug`/`versionId`/`pricing`/`outputSchema`/`fetchedAt` come
  from the endpoint.
- `inputSchema` + `commonControls` from `familyInputSchema`.
- `referenceSlots` = `familySlots(family, schemasByIndex)` with `required`
  set from the chosen endpoint.
- `raw` = `{ family, endpoint: endpointDescriptor.key }`.
- `family` = `familyInfoSchema` data.

`models:get` input becomes
`{ key: z.string(), provider: providerIdSchema.nullable().optional(), filled: z.array(z.string()).max(40).optional() }`.
For a family key:
1. Look up the registry entry. If there is none: "Unknown model family
   "<id>". It may have been removed from the registry. Pick another model."
2. `configured` = `listConfigured().map(p => p.id)`.
3. `chooseEndpoint`. If `index === null`, throw its message.
4. `catalog().getModel(endpointKey)` → annotate → build. Also fetch the
   other endpoints' schemas **only if they are already cached** (to compute
   `multiple`). No extra network.

`models:get` for a concrete key returns the annotated descriptor.

`cost:estimate` input gains `provider` and `filled` (both optional). For a
family key, run the same resolution, then `translateFamilyParams` (catch a
`RegistryTranslationError` → return an `unknown` quote whose `note` is the
error message), then `estimateCost` on the concrete descriptor.

`registry:capabilities`: void →
`z.record(z.string(), z.array(referenceRoleSchema))`. Build it from the
**cached** descriptors only (read the catalog file through a new
`catalog.cachedDescriptors()` accessor, which makes no network call): for each
unmapped key, the distinct roles of its `referenceSlots`.

Wire annotation everywhere a descriptor is produced for callers:
- the `models:get` handler
- the `getModel` passed to `submitGeneration`/`submitBatch`/preflight in
  `handlers.ts` (lines ~317 and ~354)
- the runner's `getModel` in `jobs-service.ts`

Use one helper, `annotatedModel(key, opts)`, in `registry-service.ts`.

`useModel(key, opts?: { provider?: ProviderId | null; filled?: string[] })`:
the query key includes the sorted `filled` and the `provider` **only for
family keys**, so concrete keys keep their cache.
`modelDescriptorQuery(key, opts)` follows the same rule.

**Tests (first)**
- `annotate.test.ts`: the Replicate seedance-2.5 descriptor (build it from
  the fixture with `createReplicateProvider` + an msw handler, as
  `replicate.test.ts` does, or construct it via `fixtureInputSchema` +
  `deriveReferenceSlots`) annotated with the bundled family. `image` is
  `first_frame`/verified, and `reference_audios` is `soundtrack`, labelled
  from the mapping. With no entry, the descriptor is unchanged.
- `family-descriptor.test.ts`: the slots are the union keys; `inputSchema`
  has no mapped input fields; `commonControls.duration === "duration"`; the
  count stays raw for flux-schnell (`num_outputs` is present in `inputSchema`
  and `planBatch` finds it); `modelDescriptorSchema.parse(result)` succeeds.
- `catalog.test.ts`: `models:get` with a family key and a fake registry picks
  the OpenRouter endpoint when Replicate is unconfigured. It throws the
  "no configured provider" message when neither is configured.
- The `cost:estimate` handler test (wherever `handlers.ts` is tested; if it is
  not, put a unit test on an extracted `estimateFor(key, params, opts)`
  function).

**Verify:** `pnpm vitest run apps/desktop/src/main packages/contract apps/web/hooks` → pass; `pnpm typecheck && pnpm lint`.

**Commit:** `feat(registry): annotate descriptors with roles and serve family descriptors`

---

### Task 7: Main — submit-time translation + runner shapes

**Goal.** A family request is translated into a concrete request before its
`queued` row exists (design §5.4–5.5). Named shapes are applied after upload.

**Files**
- Modify: `packages/contract/src/generation.ts` (`providerOverride`, `familyId`) + `packages/contract/src/ipc.test.ts`
- Create: `apps/desktop/src/main/model-registry/translate-submit.ts` (+ `.test.ts`)
- Modify: `apps/desktop/src/main/generations-submit.ts` (+ `generations-submit.test.ts`)
- Modify: `apps/desktop/src/main/handlers.ts` (pass `translate`)
- Modify: `apps/desktop/src/main/jobs/runner.ts` (+ `runner.test.ts`)

**Interfaces**

```ts
// generation.ts additions to generationRequestSchema
/** Per-node provider override for a family request; null = settings order. */
providerOverride: providerIdSchema.nullable().default(null),
/** Set by main on the translated request: which family this concrete run came from. */
familyId: z.string().nullable().default(null),
```

```ts
// translate-submit.ts
export interface TranslateDeps {
  family(id: string): RegistryFamilyEntry | null
  configured(): ProviderId[]
  providerOrder(): ProviderId[]
  getModel(key: string): Promise<ModelDescriptor>     // annotated concrete
}
/** Family request → concrete request. Concrete requests pass through untouched. */
export async function translateSubmission(request: GenerationRequest, deps: TranslateDeps): Promise<GenerationRequest>
```

`translateSubmission` steps:
1. Parse the family key. If it is not a family key, return the request as
   it is.
2. `filled` = the distinct `references[].slotField`.
3. `chooseEndpoint`. If it is not `ok`, throw an `Error` with its message,
   or with "Needs <labels> before it can run" when `missing` is non-empty.
4. `getModel(endpointKey)`.
5. `translateFamilyRequest`.
6. Return `{ ...request, modelKey: endpointKey, params, references, familyId: id }`.

`prompt` stays as it is. `params` carry the prompt under the provider field,
as they already do for concrete requests.

`generations-submit.ts`: `SubmitDeps` gains
`translate?(request: GenerationRequest): Promise<GenerationRequest>`.
`submitGeneration` and `submitBatch` call it **first**, then run the existing
`resolveForSubmission` on the concrete request. That keeps every existing
guard (slot exists, capacity, kind, positions, param validation) as the
safety net. `handlers.ts` wires `translate` to `translateSubmission` with the
registry service and settings.

Runner:
- `RunnerModelShape.referenceSlots` items gain
  `shape?: string | null` and `field`, `label`, `multiple`.
- In `referenceParams`, sort each field's URLs by input `position` (confirm
  `listInputs` already orders them; add ordering if not), then
  `params[field] = applyShape(slot?.shape ?? null, urls, many)`.
- `redacted[field]` stays the list of marks, **not shaped**, because it is a
  record for humans. Add a comment saying so.
- An unknown shape throws a `TerminalJobError` with "This model's mapping
  names a shape (<x>) this version of OpenDirect does not have. Update the
  app or remove the mapping." This happens **before** `provider.submit`, so it
  costs nothing.

**Tests (first)**
- `translate-submit.test.ts`: a family request with `first_frame` + `duration:
  "5"` → modelKey `replicate:bytedance/seedance-2.5`, `references[0].slotField
  === "image"`, `params.duration === 5`, `familyId` set. A `character`
  reference throws "cannot take a Character input". With only OpenRouter
  configured, the request goes to the OpenRouter endpoint with
  `input_references`. A concrete request is returned unchanged
  (`toBe(request)`).
- `generations-submit.test.ts`: submitting a family request writes a row with
  `provider: "replicate"`, the concrete `modelSlug` and a translated
  `requestJson`. The existing concrete-request tests still pass unmodified.
  A translation error writes **no row** (count the rows before and after).
- `runner.test.ts`: a fake provider plus a descriptor slot with `shape:
  "kling-elements"` → the submitted params hold
  `[{ frontal_image_url, reference_image_urls }]`. An unknown shape fails the
  job terminally, and `submit` is never called (assert the spy).

**Verify:** `pnpm vitest run apps/desktop/src/main packages/contract` → pass; `pnpm typecheck && pnpm lint`.

**Commit:** `feat(generation): translate family requests before queueing; apply named shapes after upload`

---

## Phase D — mappings settings UI

(Phase D comes before C in this document because Task 8 creates the shared
role UI pieces that Tasks 10 and 12 reuse.)

### Task 8: Settings → Models tab — status, reload, provider order, family browser

**Goal.** A new **Models** tab in Settings. It shows registry status with a
Reload button, provider preference order, remote registry settings, and a
browsable list of families with source badges and warnings, with
edit/duplicate/delete/export/import entry points. The editor itself is
Task 9; this task wires a stub that opens it. Use
`frontend-design:frontend-design`.

**Files**
- Modify: `apps/web/app/settings/page.tsx` (TABS += `"models"`; read `?map=`; see the Next.js note)
- Modify: `apps/web/app/settings/page.test.tsx`
- Create: `apps/web/lib/registry/role-meta.ts` (+ `.test.ts`): per role `{ label, short, description, icon }`, where `label` reuses `ROLE_LABELS` from the contract. `description` is the design §2 "The input says…" sentence. Icons are Hugeicons picked per role (for example UserIcon → character, PaintBoardIcon → style, …). Pick existing icons from `@hugeicons/core-free-icons`, and confirm each import resolves.
- Create: `apps/web/components/models/role-badge.tsx`: `<RoleBadge role verified? />` (icon + label; when `verified === false`, a dashed outline plus the suffix "unverified" and a tooltip: "Guessed from the field name. Add a mapping in Settings → Models to verify it.")
- Create: `apps/web/components/models/slot-chip.tsx`: `<SlotChip slot: ReferenceSlot availability?: SlotAvailability />`. It shows the role icon, the label, the kind glyph, "×max", a required dot, and the unverified badge. When `availability.available === false` it is dimmed (`opacity-50`) with the reason in a tooltip and `aria-disabled`. **Tasks 9, 10 and 12 reuse this; it is the single look for a slot everywhere.**
- Create: `apps/web/components/settings/models/models-settings.tsx` (the tab body)
- Create: `apps/web/components/settings/models/registry-status-card.tsx`
- Create: `apps/web/components/settings/models/provider-order.tsx`
- Create: `apps/web/components/settings/models/family-list.tsx`
- Create: `apps/web/components/settings/models/*.test.tsx` for each of the above

**UX spec**

Tab layout, top to bottom, in the page's existing `max-w-3xl` column:

1. **Registry card** (`Card`):
   - Title "Model registry". Beneath it one line: "v12 · from GitHub
     (remote) · checked 3 min ago", or "v1 · bundled with the app".
   - A `Reload registry` button (a spinner while pending; a disabled state
     with a tooltip when remote is off).
   - A `Switch` for "Fetch updates from GitHub" (`remoteRegistry`).
   - A collapsible "Registry URL" `Input` (placeholder = `DEFAULT_REGISTRY_URL`,
     "Reset" link; saved on blur like the General tab).
   - When `status.warnings.length`, an `Alert` (variant default, warning icon)
     "N mappings were skipped" with an expandable list:
     `source · familyId · message`.
   - Remote error: an inline destructive `Alert` with the message, and the
     note "Using the bundled registry".
2. **Provider preference card**: "When a model runs on several providers,
   OpenDirect uses the first one you have a key for. A canvas node can
   override this."
   - A vertical list of providers with drag handles. Copy the dnd-kit
     sortable + keyboard sensor pattern from
     `apps/web/components/workspace/reference-strip.tsx` (lines ~160–215),
     and also add Up/Down icon buttons for pointer-free use.
   - Each row shows a "No key" `Badge` (outline) when `useKeysSummary()` says
     it is absent, with the link "Add key" → `?tab=providers`.
   - Saves `providerOrder` immediately (`useUpdateSettings`).
3. **Families** section:
   - A header row with a search `Input` ("Search models, providers, roles"),
     a source filter (`All / Bundled / Remote / Custom`, the same chip style
     as the model picker's kind filters), `Import…`, and a primary button
     `New mapping`.
   - Each row (`family-list.tsx`):
     - The name, a kind badge, a source badge (`Bundled` secondary, `Remote`
       outline, `Custom` default/primary). "Overrides bundled" small text when
       `shadows` is non-empty.
     - The union roles as `RoleBadge`s (verified).
     - The endpoints as `provider · model` in mono text-xs.
     - A warnings count, with a tooltip listing them.
     - A row menu (`DropdownMenu`): **Edit** (custom only), **Duplicate as
       custom** (every row; opens the editor with a copy whose id is
       `<id>-custom`), **Export JSON…**, **Copy JSON**, and **Delete**
       (custom only; `AlertDialog` confirm: "Delete <name>? The bundled
       mapping (if any) takes over again.").
   - Invalid stored overrides (`useRegistryOverrides()` entries with
     `family === null`) are listed at the top in a destructive-tinted row:
     "Custom mapping can't be used", the first issue, and the actions **Fix**
     (opens the editor on the raw JSON) and **Delete**.
   - Empty search → "No mappings match. Map a model yourself with New
     mapping."
4. **`?map=<modelKey>` deep link**: when present, the tab opens the editor for
   that model (Task 9 implements the editor; here, call
   `openEditor({ from: { modelKey } })` on a context or state the editor
   will read).

**Tests**
- `page.test.tsx`: `?tab=models` renders the tab.
- `registry-status-card.test.tsx`: renders the version/source line. Reload
  calls `registry:reload`. The warnings list expands. The remote error shows.
- `provider-order.test.tsx`: moving OpenRouter up calls `settings:set` with
  `providerOrder: ["openrouter","replicate"]` (Up button). "No key" shows for
  a missing key.
- `family-list.test.tsx`: source badges, the search filter, delete only on
  custom rows, the confirm dialog, and an invalid override row.
- `role-meta.test.ts`: every `REFERENCE_ROLES` entry has meta (an exhaustive
  map).

**Verify:** `pnpm vitest run apps/web/components/settings apps/web/components/models apps/web/lib/registry apps/web/app/settings` → pass; `pnpm typecheck && pnpm lint`.

**Commit:** `feat(settings): Models tab with registry status, provider order and family browser`

---

### Task 9: Mapping editor — create/edit/duplicate, suggestions, live validation, preview, import/export

**Goal.** The first-class UI for layer 3 (user overrides). A user picks any
provider model from the catalog, sees its schema fields, assigns each field a
role (with kind/max/required/label/shape) or a canonical control (with a
value mapping) from dropdowns that are pre-filled with suggestions, sees live
validation and a canvas preview, and saves. Export produces a file ready to
contribute upstream. Use `frontend-design:frontend-design`.

**Files**
- Create: `apps/web/lib/registry/editor-state.ts` (+ `editor-state.test.ts`): the pure reducer
- Create: `apps/web/components/settings/models/mapping-editor.tsx` (a `Sheet`, right side, `sm:max-w-4xl`, full height, scrollable body, sticky footer)
- Create: `apps/web/components/settings/models/endpoint-picker.tsx` (a model search `Command` in a `Popover`)
- Create: `apps/web/components/settings/models/field-mapping-table.tsx`
- Create: `apps/web/components/settings/models/value-map-editor.tsx`
- Create: `apps/web/components/settings/models/mapping-preview.tsx`
- Create: `apps/web/components/settings/models/mapping-editor.test.tsx`, `field-mapping-table.test.tsx`
- Modify: `apps/web/components/settings/models/models-settings.tsx`, `family-list.tsx` (open the editor)

**State (`editor-state.ts`)**

```ts
export interface EditorEndpoint {
  provider: ProviderId
  model: string
  /** One row per schema property of the endpoint (in schema x-order). */
  rows: FieldRow[]
  loading: boolean
  error: string | null
}
export interface FieldRow {
  field: string
  schema: Record<string, unknown>               // the property (type, enum, format, description)
  isUri: boolean                                // URI string or URI array
  isArray: boolean
  target: { kind: "advanced" }
        | { kind: "input"; key: string; input: MappingInput }
        | { kind: "control"; control: ControlName; values?: Record<string, string | number | boolean> }
  suggestion: FieldSuggestion | null
  touched: boolean                              // user changed it; suggestions never overwrite a touched row
}
export interface EditorState {
  id: string; name: string; kind: "video" | "image" | "audio"; description: string
  idTouched: boolean                            // id auto-slugs from name until edited
  endpoints: EditorEndpoint[]
  active: number                                // active endpoint tab
  replaceId: string | null                      // editing an existing override
}
export type EditorAction =
  | { type: "setName"; name: string } | { type: "setId"; id: string } | …
  | { type: "addEndpoint"; provider: ProviderId; model: string }
  | { type: "endpointLoaded"; index: number; descriptor: ModelDescriptor }  // builds rows + applies suggestEndpointMapping to untouched rows
  | { type: "setTarget"; index: number; field: string; target: FieldRow["target"] }
  | { type: "applyAllSuggestions"; index: number }
  | { type: "removeEndpoint"; index: number } | { type: "moveEndpoint"; index: number; to: number }
export function editorReducer(state: EditorState, action: EditorAction): EditorState
export function toFamily(state: EditorState): unknown                // the draft JSON (may be invalid)
export function fromFamily(family: ModelFamily, replaceId: string | null): EditorState  // rows filled when descriptors load
export interface EditorIssue { where: "family" | { endpoint: number; field?: string }; message: string }
/** modelFamilySchema.safeParse(toFamily(state)) issues + checkEndpointAgainstSchema per loaded endpoint, mapped to rows. */
export function validateEditor(state: EditorState, schemas: Record<number, unknown>): EditorIssue[]
export function slugify(name: string): string   // "Kling 3 Pro" → "kling-3-pro"
```

Slot keys are assigned automatically. Choosing role `reference` for a second
field makes its key `reference:2`, and removing the first renumbers the rest.
Test this.

**UX spec (`mapping-editor.tsx`)**

- **Header**: "New mapping", "Edit <name>" or "Duplicate of <name>". A
  source note: "Saved on this computer. It overrides the bundled and remote
  registry for this model."
- **Family section** (a two-column grid): Name `Input` (required); ID
  `Input`, mono, auto-slugged, with helper text "Used as the file name if you
  contribute it"; Kind `Select` (Video/Image/Audio); Description `Textarea`
  (optional, 500 characters, with a counter).
- **Endpoints** section: `Tabs`, one per endpoint, labelled with a provider
  badge and the model slug, plus a trailing `+ Add endpoint` that opens
  `endpoint-picker`.
  - `endpoint-picker`: a `Command` over `useModels()` summaries filtered to
    the family kind, grouped by provider, searching name and slug. Items show
    "Mapped by <family>" when the summary is already an endpoint of a family,
    and picking one warns inline "This will override <family> for this
    model". A footer item "Use a model slug…" reveals a provider `Select` +
    slug `Input` (for Replicate models not in the seed collections), which
    becomes `models:get` with `replicate:<slug>`. It is disabled for a
    provider with no key, with the tooltip "Add a <Provider> key to load its
    schema".
  - On add, the editor loads `useModel(key)` (free GET). The descriptor fills
    the rows. The `suggestEndpointMapping` pre-fill applies to every
    untouched row, and a banner reads: "Pre-filled from the model's schema
    and <provider manifest>. Review each row."
  - Endpoint tab menu: Move left/right (manifest order = preference) and
    Remove.
- **Field mapping table** (`field-mapping-table.tsx`), one row per schema
  field. Columns:
  1. **Field**: the name in mono, the type chip (`uri[]`, `string`,
     `integer`, `enum(5)`), and the description as muted text with
     `line-clamp-2` (the full text in a tooltip).
  2. **Maps to**: a `Select` with groups:
     - "Advanced (not mapped)" (the default for scalars)
     - "Inputs" (the ten roles with role icons and descriptions; only enabled
       for URI fields; for a non-URI field this group is disabled with the
       reason "Only file/URL fields can be inputs")
     - "Controls" (the eight canonical controls; a control already used by
       another row shows "(used by <field>)" and choosing it moves it)
  3. **Details**, depending on the target:
     - input → Kind `Select` (image/video/audio/any), Max number `Input`
       (arrays only), Required `Switch`, Label `Input` (placeholder = role
       default label), and Shape `Select` (only when `SHAPE_NAMES` is
       non-empty; "None" by default).
     - control → a "Values…" button that opens `value-map-editor` when the
       field has an `enum` or when the control is `aspect_ratio`/`duration`/
       `resolution`. `value-map-editor` is a two-column table: canonical value
       (free text, with suggestions from common vocabularies, for example
       `16:9, 9:16, 1:1, 4:3, 3:4, 21:9` for aspect ratio) → provider value
       (a `Select` over the enum, or free text typed per the schema type).
       "Identity" means no `values` at all (the default).
  4. **Suggestion**: when the row's current target differs from the
     suggestion, a small ghost button "Suggested: <Role> · <confidence>"
     applies it. The tooltip shows `why`. The confidence is styled:
     manifest = solid, schema = outline, name = dashed.
  - A table toolbar: "Apply all suggestions", "Reset endpoint", and a filter
    "Show: all fields / mapped / inputs only".
- **Validation**:
  - `validateEditor` runs on every change (`useMemo`).
  - Row-level issues render under the row (`text-destructive text-xs`).
    Family-level issues render in an `Alert` above the footer.
  - Save is disabled while there are issues, and a tooltip lists the count.
  - Server-side validation errors on save (from `registry:overrides:save`)
    show in the same Alert.
- **Preview** (`mapping-preview.tsx`), a right-hand column on `lg`, collapsed
  under the table on small widths. Title "On the canvas".
  - It renders `familySlots(draftFamily)` as `SlotChip`s (Task 8),
    **exactly** the component the prompt bar will use.
  - Below that, "Controls in the bar": the mapped canonical controls as muted
    chips.
  - Below that, "Runs on": each endpoint with a provider badge, marked
    "used first" per the current `providerOrder` and keys.
  - For a family with more than one endpoint, a mini "Try it" row: toggle
    role chips as "filled" to see `slotAvailability` dimming live, with the
    same reasons the canvas shows.
- **Footer** (sticky): `Cancel`, and `Export JSON…` + `Copy JSON`, both
  enabled only when the draft is valid. Copy puts
  `formatFamilyJson(family)` on the clipboard and toasts "Copied. To
  contribute it, save it as registry/models/<id>.json and open a pull request
  (see CONTRIBUTING.md)". Then the primary `Save mapping`: it calls
  `registry:overrides:save` with `replaceId`, closes, toasts "Saved. Canvas
  nodes using <name> update now", and invalidates the queries.
- **Import** (from the family list): `registry:overrides:import` returns the
  candidates. One valid candidate opens the editor pre-filled (unsaved).
  Several open a small chooser `Dialog`. An invalid one opens the editor
  anyway, with its issues shown, so the user can fix rather than retype.
- **Close with unsaved changes** → `AlertDialog` "Discard changes?"
- **Accessibility**: every Select has a label (`aria-label="Maps to for
  <field>"`), the table is a real `<table>` with a header row, and focus
  moves to the first invalid control on a failed Save.

**Tests (first)**
- `editor-state.test.ts`:
  - `endpointLoaded` with the Replicate seedance-2.5 descriptor pre-fills
    `image` → `first_frame`.
  - A touched row is not overwritten by `applyAllSuggestions`.
  - The second `reference` becomes `reference:2`, and removing the first
    renumbers it.
  - `toFamily` → `modelFamilySchema` succeeds for the bundled seedance
    mapping rebuilt through `fromFamily`: the round trip equals
    `formatFamilyJson` output.
  - `validateEditor` flags a control mapped to a missing field (via
    `checkEndpointAgainstSchema`).
  - `slugify`.
- `field-mapping-table.test.tsx`: the Inputs group is disabled for a scalar
  field; choosing a control already used moves it; the value-map editor
  writes `values`.
- `mapping-editor.test.tsx` (mock `@/lib/ipc`: `models:list`, `models:get`
  with the seedance fixture descriptor, `registry:overrides:save`):
  - New mapping → pick the model → rows pre-filled → Save → the
    `registry:overrides:save` payload deep-equals the expected family JSON.
  - Save is disabled with an invalid id.
  - Copy JSON writes `formatFamilyJson` output (mock
    `navigator.clipboard.writeText`).
  - The `?map=replicate:bytedance/seedance-2.5` deep link opens the editor
    with that endpoint loading.

**Verify:** `pnpm vitest run apps/web/lib/registry apps/web/components/settings/models` → pass; `pnpm typecheck && pnpm lint`.

**Commit:** `feat(settings): mapping editor for custom model mappings with suggestions, validation and preview`

---

## Phase C — canvas UX

### Task 10: Model picker — families, capability filters, include unverified

**Goal.** The picker shows each mapped family once, with provider badges. It
can filter by capability ("takes a character"). Unmapped models are left out
of a capability filter unless **Include unverified** is on, and then carry an
"unverified" badge. Use `frontend-design:frontend-design`.

**Files**
- Modify: `apps/web/components/models/model-picker.tsx` (+ `model-picker.test.tsx`)
- Create: `apps/web/lib/registry/picker-rows.ts` (+ `.test.ts`): pure grouping and filtering

**Interfaces**

```ts
export type PickerRow =
  | { type: "family"; key: string; entry: RegistryFamilyEntry; roles: ReferenceRole[]; providers: Array<{ id: ProviderId; configured: boolean }>; priceHint: PriceHint | null }
  | { type: "model"; key: string; summary: ModelSummary; roles: ReferenceRole[] | null; verified: false }
export interface PickerFilter { kind: "all" | ModelKind; roles: ReferenceRole[]; includeUnverified: boolean; search: string }
export function buildPickerRows(input: {
  families: RegistryFamilyEntry[]; summaries: ModelSummary[]; capabilities: Record<string, ReferenceRole[]>;
  configured: ProviderId[]; filter: PickerFilter;
}): { families: PickerRow[]; models: PickerRow[]; hiddenUnverified: number }
```

Rules for `buildPickerRows`:
- A summary whose key is an endpoint of a family is **not** listed on its own.
  The family row stands for it (price hint = the cheapest endpoint's hint
  among the summaries).
- A family is listed if its kind matches and it has at least one endpoint.
  Families with no configured provider stay listed but are marked (so the
  user learns the model exists).
- Role filter (AND across the selected roles): a family matches on its union
  roles. With `includeUnverified` off, unmapped models are excluded and
  `hiddenUnverified` counts them. With it on, an unmapped model matches when
  its cached `capabilities` include the roles. Models with no cached
  capability data are included under a trailing group "Not inspected yet"
  (only while a role filter is active).
- Search matches the family name, id, endpoint slugs and role labels.

**UX spec**
- Under the existing kind chips, add a second chip row labelled "Takes"
  (`text-xs text-muted-foreground`), with one toggle chip per role using
  `RoleBadge` visuals. It scrolls horizontally inside the 26rem popover. The
  roles are ordered by usefulness: Character, Style, First frame, Last frame,
  Reference, Structure, Motion, Soundtrack, Source, Mask.
- At the right of that row is a compact `Switch` "Include unverified" bound to
  `settings.includeUnverified` (persisted through `useUpdateSettings`; give
  this one call a silent variant or pass `{ silent: true }`, because a toast
  every time the switch is flipped is noise).
- Group order is Recommended (existing), then **Models** (families), then
  **Other models** (unmapped).
  - Family row: name, kind, provider badges (solid when configured, outline
    "no key" otherwise), up to 4 role icons with a "+N" overflow, and the
    price hint.
  - Unmapped row: the existing layout, plus an "unverified" outline badge
    when a role filter is active or the model has cached capabilities, and a
    trailing icon button "Map this model…" (visible on hover/focus) →
    `router.push("/settings?tab=models&map=<key>")`.
- When a filter hides unverified models, a footer line reads: "N unverified
  models hidden · Include unverified".
- Picking a family row calls `onChange(familyKey(id))`. The trigger label
  shows the family name when `value` is a family key (look it up in the
  families list), or the family name + provider when `value` is a concrete
  key that is a family endpoint (older boards).
- Recommended entries whose key is a family endpoint render as that family's
  row, and picking one chooses the family key.

**Tests (first)**
- `picker-rows.test.ts`:
  - Seedance summaries collapse into one family row.
  - The Character filter hides every bundled family (none maps `character`)
    and all unmapped models.
  - Include unverified + cached capabilities `{ "replicate:x/y":
    ["character"] }` shows `x/y` as unverified.
  - The First frame filter lists both Seedance families.
  - Search by slug finds the family.
- `model-picker.test.tsx`:
  - Choosing a family calls `onChange("family:seedance-2-5")`.
  - The "Include unverified" switch calls `settings:set`.
  - The "Map this model…" button navigates (mock `next/navigation`'s
    `useRouter` the way other tests in the repo do; grep for
    `vi.mock("next/navigation"`).
  - The existing picker tests still pass.

**Verify:** `pnpm vitest run apps/web/components/models apps/web/lib/registry` → pass; `pnpm typecheck && pnpm lint`.

**Commit:** `feat(picker): model families, capability filters and include-unverified`

---

### Task 11: Canvas — family nodes, per-node provider override, incompatible edges

**Goal.** A generate node can run a family. Its edges carry slot keys, the
endpoint follows what is wired, the user can override the provider per node,
and a wire the resolved endpoint cannot take blocks the run with a reason.
**Old boards behave exactly as before.**

**Files**
- Modify: `apps/desktop/src/main/db/schema.ts` (`canvasNodes.providerOverride: text("provider_override")`), then run `pnpm --filter @opendirect/desktop db:generate` (creates `apps/desktop/drizzle/0010_*.sql` + snapshot + journal entry; commit them)
- Modify: `apps/desktop/src/main/repo/canvas.ts` (+ `canvas.test.ts`): map the column on create/update/read
- Modify: `packages/contract/src/canvas.ts`: `canvasNodeSchema.providerOverride: providerIdSchema.nullable().default(null)`; `canvasNodePatchSchema.providerOverride: providerIdSchema.nullable().optional()`
- Modify: `apps/web/components/canvas/prompt-bar.tsx` (+ `prompt-bar.test.tsx`)
- Create: `apps/web/components/canvas/provider-override.tsx` (+ test)
- Modify: `apps/web/lib/canvas/edges-to-inputs.ts` (+ test): new block code `"incompatible-slot"`
- Modify: `apps/web/components/canvas/canvas.tsx`: new-edge slot choice skips unavailable slots, and passes filled/override to `useModel` wherever it resolves a target's descriptor (~line 523–545)
- Modify: `apps/web/lib/create/request.ts` (+ test): `buildGenerationRequest` sets `providerOverride`
- Modify: `apps/web/hooks/use-generate-plan.ts`: pass `provider`/`filled` to `useCostEstimate`
- Modify: `apps/desktop/src/main/db/schema.test.ts` if it snapshots the migrations

**Behaviour**
- `filled` for a node = the sorted distinct `slotField`s of its incoming
  non-text edges. Mention-resolved slots count too: take them from
  `resolveMentions`' result, which already names slots. The prompt bar
  computes it and passes `{ provider: node.providerOverride, filled }` to
  `useModel(draft.modelKey, …)`. Every other `useModel` call for a target
  node (`canvas.tsx`, `reference-edge.tsx`) passes the same options, from a
  shared helper `modelOptionsForNode(node, edges)` in
  `apps/web/lib/canvas/slots.ts`, so all of them hit one query.
- `descriptor.family` present → the node is a family node:
  - `availability = slotAvailability(family.family, { filled, providerOrder,
    configured, override })`.
  - `edgesToInputs` gains an optional `availability`. An edge whose slot key
    is `available: false` blocks with code `"incompatible-slot"`, the message
    = the reason, and `edgeId`/`nodeId` set so the canvas highlights it.
  - `firstFreeSlot` is given only the available slots.
  - `descriptor.family.choice.message` non-null → Generate is disabled with
    that sentence (through the existing "why disabled" path in
    `useGeneratePlan`; add it as an input `blockedReason`).
  - `choice.missing` → the existing `missingRequirements` path. The family
    descriptor's slots carry `required`; make `missingRequirements` read
    `slot.required` in addition to whatever it checks today.
- **Provider override control** (`provider-override.tsx`): a compact `Select`
  beside the model chip in the prompt bar's toolbar, shown only for family
  nodes. It lists "Auto · <resolved provider>" plus one item per provider the
  family has an endpoint on. Unconfigured providers are disabled with "No
  key". Changing it patches the node (`canvas:node:update` with
  `providerOverride`). The toolbar row must not wrap: follow the
  width/overflow rules in the prompt-composer plan Task 7
  (`docs/plans/2026-09-23-prompt-composer-plan.md`), and collapse to an
  icon-only trigger with a tooltip below the existing breakpoint.
- **Changing the model** from a family to anything else, or vice versa,
  leaves the edges as they are. They render unresolved until re-labelled (the
  existing `isUnresolvedSlot` behaviour). No data is rewritten.
- Request: for a family node `modelKey` = the family key, the references
  carry slot keys, and `params` carry canonical + raw names. All of that
  follows from the family descriptor with no special casing, plus
  `providerOverride: node.providerOverride`.

**Tests (first)**
- `edges-to-inputs.test.ts`: `incompatible-slot` blocks with the reason. With
  no availability passed, the output is unchanged (a regression guard).
- `prompt-bar.test.tsx` (mock `models:get` to return a family descriptor built
  from the seedance-2-5 mapping):
  - Wiring an image fills `first_frame`, and Generate submits
    `{ modelKey: "family:seedance-2-5", references: [{ slotField:
    "first_frame" … }], providerOverride: null }`.
  - The override Select patches the node.
  - An unavailable slot's edge shows the block sentence.
  - **Regression**: an existing concrete-key node
    (`replicate:bytedance/seedance-2.5`, edge `slotField: "reference_images"`)
    submits exactly what it submits on `main`. Capture the expected payload
    first by running the test against the current code.
- `canvas.test.ts` (repo): `providerOverride` round trip. A node created
  without it reads as null.
- `request.test.ts`: `providerOverride` is carried.

**Verify:** `pnpm vitest run apps/web/components/canvas apps/web/lib/canvas apps/web/lib/create apps/desktop/src/main/repo apps/desktop/src/main/db` → pass; `pnpm typecheck && pnpm lint`.

**Commit:** `feat(canvas): run model families with a per-node provider override`

---

### Task 12: Canvas slot UI — role labels, unverified badge, dimming with reason

**Goal.** Wherever the canvas shows a slot (the reference strip/tray groups
under the prompt bar, the edge label and its slot menu, and the generate
node's slot list if it has one), it shows the role label, an unverified badge
for inferred roles, and dims slots the current wiring rules out, with the
reason (design §5.3). Use `frontend-design:frontend-design`.

**Files**
- Modify: `apps/web/components/canvas/reference-tray.tsx` (`CanvasReferenceStrip` groups) (+ test)
- Modify: `apps/web/components/canvas/edges/reference-edge.tsx` (label + slot menu) (+ test)
- Modify: `apps/web/components/canvas/nodes/generate-node.tsx` (+ test), **only if** it renders slot names. Grep for `referenceSlots`/`slotLabel` first. If it does not, leave it alone.
- Modify: `apps/web/lib/canvas/slots.ts`: `slotLabel` returns the slot's label, which is already the mapping label on annotated/family descriptors. Add `slotRoleText(slot)` → `"Character"` / `"Reference · unverified"`.

**UX spec**
- **Strip group header**: `SlotChip` (Task 8) in place of the plain label, so
  each group shows the role icon, the label, the count/max, a required dot,
  and the unverified badge.
  - An empty group whose slot is unavailable is dimmed, with its reason
    tooltip. It is not a drop target: set `aria-disabled` and make the
    "+"/gallery button disabled with the reason.
  - A filled group that became unavailable (the user switched provider
    override) gets a destructive ring and the reason inline. The run is
    blocked (Task 11).
- **Edge label**: the role icon + label, with an "unverified" dotted
  underline and tooltip ("Guessed from the field name…").
  - The slot menu lists the slots as `SlotChip` items. Unavailable ones are
    disabled with the reason as the item's secondary text (keyboard users get
    it too, not only a tooltip).
  - When the target is a concrete model with unverified slots, the menu
    footer reads "Wrong input? Map this model…" → the settings deep link.
- **Unmapped models** show every slot as usable, with the unverified badge
  (design §4.4). There is no dimming, because `availability` is undefined.

**Tests (first)**
- `reference-tray.test.tsx`: an unavailable empty group is dimmed with the
  reason in accessible text (`getByText` or `aria-describedby`), and its add
  button is disabled. An unverified slot shows "unverified".
- `reference-edge.test.tsx`: the menu disables an unavailable slot and shows
  the reason. Choosing an available one updates the edge (existing
  behaviour).
- `slots.ts` unit tests for `slotRoleText`.

**Verify:** `pnpm vitest run apps/web/components/canvas apps/web/lib/canvas` → pass; `pnpm typecheck && pnpm lint`.

**Commit:** `feat(canvas): role labels, unverified badges and dimmed incompatible slots`

---

## Phase E — guards, docs, verify script

### Task 13: Guards & docs — verify:providers registry mode, CONTRIBUTING.md, doc updates

**Goal.** Design §6's remaining guards: a read-only live check of mappings,
contributor docs, and the architecture docs brought up to date.

**Files**
- Modify: `apps/desktop/scripts/verify-providers.ts`
- Create: `apps/desktop/scripts/verify-registry.ts` (the pure part: `verifyRegistry(families, fetchSchema) → Report`) + `apps/desktop/scripts/verify-registry.test.ts`. The root vitest `include` does not cover `apps/desktop/scripts/**`. Either put the pure module under `apps/desktop/src/main/model-registry/verify.ts` (preferred, since it is then covered) and have the script import it, or add the pattern to `vitest.config.ts`. **Choose the first.**
- Create: `CONTRIBUTING.md` (repo root)
- Modify: `docs/ARCHITECTURE.md` (the Providers section: registry layers, family keys, translation point, shapes)
- Modify: `docs/DEVELOPMENT.md` (how to add a mapping; how to test it; registry cache file location)
- Modify: `docs/plans/2026-09-24-model-registry-design.md` (mark §5 and §7 **accepted**; record the hosting decision; add planning decision 12 to Open questions)
- Modify: `packages/contract/src/roles.ts` doc comment: link `CONTRIBUTING.md#roles` (Task 1 wrote the rules).

**verify:providers registry mode**
- `pnpm --filter @opendirect/desktop verify:providers -- --registry [--file path/to/family.json]`
- It loads the bundled families (from `registry/`, read with `fs`, the same
  files the app bundles) plus an optional extra file.
- For each endpoint, it fetches the **live** schema through the adapters'
  free reads: `createReplicateProvider({getKey}).getModel(slug)` and
  `createOpenRouterProvider({getKey}).getModel(slug)`. Only `GET`s.
- It runs `checkEndpointAgainstSchema` and prints a table
  `family · provider:model · OK | issues`.
- A provider with no key prints "skipped (no REPLICATE_API_TOKEN)".
- It exits with code 1 if any issue is found, and 0 otherwise (a skip is not
  a failure).
- Keep the file's ⛔ READ-ONLY header and extend it: "Registry mode performs
  the same GETs, one per mapped endpoint."
- `verify.ts` test: the fake `fetchSchema` returns a schema where
  `reference_images` was renamed. The report flags exactly that field, and
  skipped providers are reported as skipped.

**CONTRIBUTING.md** (concise, practical):
1. Dev setup (link DEVELOPMENT.md) and the commands table.
2. **Adding or fixing a model mapping**:
   - The file layout (`registry/index.json`, `registry/models/<id>.json`).
   - The format with an annotated example (the seedance-2-5 file).
   - Slot keys (`role`, `role:2`), controls and `values`.
   - When to use `kind: "any"`.
   - Shapes (they can only be named; adding one is a code change in
     `packages/contract/src/registry/shapes.ts` with a test).
   - "Every mapped field needs a recorded fixture": how to record one for
     Replicate (save the `GET /v1/models/{owner}/{name}` JSON to
     `test/fixtures/replicate/model-<name>.json`) and OpenRouter (the
     listing fixtures).
   - Bump `registryVersion` in `index.json` on every change.
   - Format the file with `formatFamilyJson` (the test enforces it).
   - Run `pnpm vitest run apps/desktop/src/main/model-registry`, and
     optionally `verify:providers -- --registry` with your keys.
   - The fastest path: build it in **Settings → Models → New mapping**, then
     **Copy JSON**.
3. **Roles** (anchor `#roles`): the ten-role table and the five rules from
   design §2, verbatim. The three-test rule for a new role. "Changing the
   list is a contract change: bump `REGISTRY_FORMAT`, cite these rules in the
   PR."
4. The PR checklist: tests, typecheck, lint, a changeset
   (`pnpm changeset`) for app changes (not needed for registry-only PRs,
   since `registry/` is fetched at runtime).
5. ⛔ Money rule: never add a paid call to tests or scripts.

**Verify:** `pnpm vitest run apps/desktop/src/main/model-registry` → pass; `pnpm typecheck && pnpm lint`. Manually, with keys in `.env.local` (optional; state in the commit whether you ran it): `pnpm --filter @opendirect/desktop verify:providers -- --registry`.

**Commit:** `docs(registry): CONTRIBUTING guide, architecture notes and verify:providers registry mode`

---

### Task 14: Integration pass

**Goal.** Everything works together, the whole suite and the build pass, and
the app behaves as intended in a real run (with no paid calls).

**Steps**
1. `pnpm install --frozen-lockfile` (the lockfile is unchanged).
2. `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Fix anything
   red at its root (use superpowers:systematic-debugging).
3. `grep -rn "\"unknown\"" apps/desktop/src/main/providers/reference-slots.ts packages/contract/src` shows no role use.
4. The IPC coverage test passes (it is part of `pnpm test`).
5. Manual run (`pnpm dev:desktop`, see the `run` skill, or
   `docs/DEVELOPMENT.md`). With any key configured:
   1. Settings → Models: the status shows bundled v1. Reload with remote on:
      either "remote v1 not newer, using bundled" or a clear error (the
      remote `registry/` exists on `main` only after this branch merges). No
      crash.
   2. Model picker: Seedance 2.5 appears once, with provider badges. The
      "Character" filter shows nothing (honest: no bundled mapping claims
      character). Include unverified shows unmapped models with badges.
   3. Canvas: choose Seedance 2.5 (family) and wire an image → the "First
      frame" slot. Wire a video → "Reference videos". Set the override to
      OpenRouter, and "Reference videos" dims with its reason. **Do not press
      Generate** unless you intend to pay. The request payload can be checked
      in the Full prompt panel / devtools instead.
   4. An old board (open any existing project) looks and behaves unchanged.
   5. Settings → Models → New mapping → pick a Replicate model not in the
      registry → the rows are pre-filled → map one field to `character` →
      the preview shows the Character chip → Save → the picker's Character
      filter now lists it → Copy JSON gives a canonical file.
6. `pnpm changeset`: a minor bump for `@opendirect/desktop`, with the summary
   "Model registry: families, capability filters, custom mappings".
7. Commit: `chore(registry): integration fixes and changeset`.

**Acceptance:** CI-equivalent commands pass. Every manual step behaves as
described. No new network calls other than GETs to the registry URL and the
existing provider listing endpoints.
