# Contributing to OpenDirect

Thanks for helping. Most contributions fall into one of two kinds: a change to
the app, or a change to the **model registry** (the JSON files that tell the
app what each model input means and what each provider calls it). Registry
changes are the easier place to start and need no TypeScript.

## Setup

Follow [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for prerequisites
(Node.js 22.18 or newer, pnpm 10 through `corepack enable`). Then:

```bash
pnpm install
```

Everything below runs from the repo root.

| Command | What it does |
| --- | --- |
| `pnpm dev:desktop` | Runs the app (Next.js dev server plus the Electron shell) |
| `pnpm test` | Every test, offline |
| `pnpm vitest run <path>` | One test file or folder |
| `pnpm typecheck` | `tsc --noEmit` in every workspace |
| `pnpm lint` | ESLint in every workspace |
| `pnpm build` | Builds every workspace |
| `pnpm changeset` | Records a user-facing change for the next release |
| `pnpm --filter @opendirect/desktop verify:providers -- --registry` | Checks the registry against the providers' live schemas (needs keys; read-only) |

## Adding or fixing a model mapping

### Where the files live

```
registry/
  index.json              { "format": 1, "registryVersion": 1, "families": ["seedance-2-5", …] }
  models/<id>.json        one model family per file
```

The app ships a copy of `registry/` and also fetches the newest version from
this repo's `main` branch at runtime. A merged registry change therefore
reaches users without an app release.

A **family** is one model as a person thinks of it ("Seedance 2.5"). It lists
one or more **endpoints**: a provider plus that provider's model slug. The
picker shows the family once, and the app picks an endpoint to run it on.

### The format, by example

This is `registry/models/seedance-2-5.json`, trimmed. The comments are for
this page only; real files are plain JSON.

```jsonc
{
  "id": "seedance-2-5",          // must match the file name; lowercase, digits, dashes
  "name": "Seedance 2.5",        // what the picker shows
  "kind": "video",               // video | image | audio: what the model outputs
  "description": "ByteDance's flagship multimodal video model …",
  "endpoints": [
    {
      "provider": "replicate",
      "model": "bytedance/seedance-2.5",
      // Inputs: media the model takes. The key is a slot key (see below),
      // the value says which provider field receives it.
      "inputs": {
        "first_frame": {
          "field": "image",                 // the provider's field name
          "kind": "image",                  // image | video | audio | any
          "label": "First frame (not with reference images, videos or audio)"
        },
        "reference": {
          "field": "reference_images",
          "kind": "image",
          "max": 30,                        // list fields: how many items
          "label": "Reference images (character, style, scene; not with frames)"
        },
        "reference:2": {                    // a second input with the same role
          "field": "reference_videos",
          "kind": "video",
          "max": 10,
          "label": "Reference videos (motion, style, editing, extension)"
        }
      },
      // Controls: the canonical scalar settings, renamed to the provider's fields.
      "controls": {
        "prompt": { "field": "prompt" },
        "duration": { "field": "duration" },
        "generate_audio": { "field": "generate_audio" }
      }
    },
    {
      "provider": "openrouter",
      "model": "bytedance/seedance-2.5",
      "inputs": {
        "first_frame": { "field": "first_frame", "kind": "image", "label": "First frame" },
        "reference": { "field": "input_references", "kind": "any", "label": "Input references" }
      },
      "controls": { "prompt": { "field": "prompt" } }
    }
  ]
}
```

An input may also set `"required": true` when the provider will not run
without it. The schema check insists on this: if the provider's schema marks
a field required, the mapping must too.

Endpoints are listed in order of preference. When a family runs on several
endpoints of the same provider, the app takes the first one that accepts
every input the user connected.

Anything the mapping leaves out is still available in the node's Advanced
form under the provider's own field name. You only need to map what the app
should understand.

### Slot keys

An input's key is its [role](#roles). When one endpoint has two fields with
the same role, number the extra ones `role:2`, `role:3` and so on, up to
`:9`, with no gaps: `reference:2` needs `reference`. Canvas edges into a
family node store the slot key, so renaming a slot key breaks users' saved
boards. Change the `field`, not the key, when a provider renames something.

### Controls and `values`

The controls are a fixed list: `prompt`, `negative_prompt`, `aspect_ratio`,
`duration`, `resolution`, `seed`, `generate_audio`, `count`. Map the ones the
endpoint has. `count` is the provider's field for how many outputs one run
makes (such as `num_outputs`); map it only when the model has one.

When the provider uses a different vocabulary from everyone else, add
`values`, a map from the canonical value to the provider's value:

```json
"duration": { "field": "duration", "values": { "5": 5, "10": 10 } },
"aspect_ratio": { "field": "orientation", "values": { "16:9": "landscape", "9:16": "portrait" } }
```

Leave `values` out when the provider already accepts the canonical values.
Every mapped value must be one the provider's schema accepts; the tests
check it. `count` cannot have `values`.

### When to use `"kind": "any"`

`kind` is the one thing the app enforces: it will not connect a video to an
image input. Use `image`, `video` or `audio` whenever the field takes one
kind of media. Use `any` only when the provider really accepts several kinds
through one field, as OpenRouter's `input_references` does. Do not use `any`
because you are unsure; check the provider's docs.

### Shapes

Most fields take a URL or a list of URLs. A few want a nested payload, such
as Kling's `elements: [{ frontal_image_url, reference_image_urls }]`. For
those, an input names a **shape**:

```json
"character": { "field": "elements", "kind": "image", "max": 4, "shape": "kling-elements" }
```

A mapping can only name a shape the app already ships. Shapes are code, in
`packages/contract/src/registry/shapes.ts`, so that a registry file fetched
from the internet can never run code. Adding a shape is an app change: add
the function to `SHAPES`, add a test beside it in `shapes.test.ts`, and add a
changeset. Until that release is out, a remote registry file that names the
new shape is rejected by older apps with a warning, so land the shape first
and the mapping after.

### Every mapped endpoint needs a recorded fixture

The tests check each mapped field against the provider's recorded schema,
never the live API. If an endpoint has no fixture, the test tells you to
record one.

- **Replicate.** Save the response of
  `GET https://api.replicate.com/v1/models/{owner}/{name}` (with your
  `Authorization: Bearer $REPLICATE_API_TOKEN` header) to
  `test/fixtures/replicate/model-<name>.json`. The test matches it by the
  `owner` and `name` inside the file.
- **OpenRouter.** Mappings are checked against the capability listings in
  `test/fixtures/openrouter/videos-models.json` (from
  `GET https://openrouter.ai/api/v1/videos/models`) and
  `images-models.json` (from `GET https://openrouter.ai/api/v1/images/models`).
  If the model is missing, re-record the listing. Other OpenRouter tests read
  these files too, so run the whole suite afterwards.

Both are free `GET`s. Never record a fixture by running a model.

### Steps

1. Add or edit `registry/models/<id>.json`.
2. For a new family, add its id to `families` in `registry/index.json` and
   add an import for the file to
   `apps/desktop/src/main/model-registry/bundled.ts` (the test fails if the
   two lists disagree).
3. Bump `registryVersion` in `registry/index.json`. Do this on **every**
   registry change: installed apps only take the remote copy when its
   version is higher than the one they have.
4. Format the file canonically. The test compares each file with
   `formatFamilyJson` from `@opendirect/contract` (fixed key order, 2-space
   indent, trailing newline) and fails on any difference. A mapping exported
   from the app is already in this format.
5. Run the guards:

   ```bash
   pnpm vitest run apps/desktop/src/main/model-registry
   ```

   This checks that every file parses, names only shipped shapes, maps only
   fields the recorded schema has, stays within each field's `maxItems`, is
   listed everywhere it should be, and is formatted canonically.
6. Optionally, check the mapping against the providers' live schemas:

   ```bash
   pnpm --filter @opendirect/desktop verify:providers -- --registry
   pnpm --filter @opendirect/desktop verify:providers -- --registry --file path/to/family.json
   ```

   It reads `REPLICATE_API_TOKEN` and `OPENROUTER_API_KEY` from `.env.local`
   and makes only free `GET`s: one per Replicate endpoint, and for
   OpenRouter at most two in total (its video and image model listings,
   fetched once and reused). A provider without a key is reported as
   skipped. Run it from the repo root; `--file` paths are relative to where
   you typed the command. It exits with 1 when a mapped field no longer exists
   upstream, which is how we notice a provider renaming something.

### The fastest path: build it in the app

You do not have to write the JSON by hand. In **Settings → Models**, create a
new mapping (or duplicate an existing one). You can also start from the model
picker: an unmapped model has a **Map this model** button on its row (or
press ⌘E, Ctrl+E off a Mac, with the row highlighted). The editor loads the
model's schema, so it needs a key for that provider. It pre-fills one row per field with a suggested role
or control, validates as you go using the same checks as the tests, and shows
a preview of the canvas node your mapping produces. Save it and it takes
effect in your copy of the app straight away, as a user override that sits
above the bundled and remote registry.

To turn it into a pull request:

1. Export the mapping (or copy its JSON) from **Settings → Models**. The
   output is already in the canonical format.
2. Save it as `registry/models/<id>.json`, with the file name matching `id`.
3. Follow steps 2 to 6 above: index, `bundled.ts`, `registryVersion`,
   fixture, guards.
4. Open the PR. Say which models you tested it with and, if you ran it, paste
   the `verify:providers -- --registry` output.

Once your change is merged and your app picks up the new remote registry,
you can delete your local override.

## Roles

A role says what an input controls in the output. It drives the model
picker's filters, the slot labels on the canvas and which slot an asset goes
to. The list is closed; these are the only ten.

| The input says… | Role | Meaning | Precedent |
|---|---|---|---|
| **what to change** | `source` | The image or video being edited | img2img, video-to-video, inpaint input |
| | `mask` | Which region of the source to change | Inpainting masks |
| **when** (pinned in time) | `first_frame` | The output starts on this | OpenRouter `frame_type`, AI SDK `frameImages`, Runway `position` |
| | `last_frame` | The output ends on this | same |
| **what to keep** | `character` | Identity: a person, creature or product | IP-Adapter FaceID, Kling `elements`, Soul ID |
| | `style` | Look, palette, medium | IP-Adapter style, Midjourney `--sref` |
| | `structure` | Layout, pose, depth, edges | ControlNet pose / depth / canny |
| | `motion` | How things move | Motion transfer, Kling motion control |
| | `soundtrack` | What the output sounds like or lip-syncs to | Audio-driven and lip-sync models |
| **nothing specific** | `reference` | General context; the model decides | AI SDK `inputReferences`, OpenRouter `input_references` |

The rules that keep the list from growing (from the
[design doc](docs/plans/2026-09-24-model-registry-design.md), §2):

1. **A role never encodes the media kind.** `motion` may be a video or an image
   sequence; `structure` may be a pose image or a pose video. That is why it is
   `soundtrack`, not `audio`.
2. **Detail goes in the label, not a new role.** "Face photo, frontal only" is
   the label of a `character` slot. "Up to 3 style images" is `style` with
   `max: 3`. There is deliberately no `face` role: we cannot tell it from
   `character`, and users do not think in that distinction.
3. **A new role must pass all three tests**, otherwise it is `reference` with a
   clear label:
   - It answers "what does it control" differently from every existing role.
   - At least two models from different vendors have it.
   - The UX would filter or route it differently.
4. **When unsure, use `reference`.** It is never wrong, only less useful.
5. **Changing the list is a contract change.** Bump `REGISTRY_FORMAT` in
   `packages/contract/src/registry/schema.ts`, update `referenceRoleSchema`
   in `packages/contract/src/roles.ts`, and cite these rules in the PR,
   saying how the new role passes each of the three tests.

In practice: if a provider's field takes "reference images" that could be
anything, map it as `reference`. Only pick `character` or `style` when the
provider's docs say that is what the field is for.

## Pull request checklist

- [ ] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass.
- [ ] App changes include a changeset (`pnpm changeset`). Registry-only PRs
      (files under `registry/` and their fixtures) do not need one, because
      the registry is fetched at runtime rather than released with the app.
- [ ] Registry changes bump `registryVersion` in `registry/index.json`.
- [ ] New provider endpoints have a recorded fixture under `test/fixtures/`.
- [ ] No API keys in any file. CI searches for them and fails the build.

## ⛔ Never spend money in tests or scripts

Running a model costs the person whose key it is. Tests never reach the
network: `vitest.setup.ts` runs `msw` with `onUnhandledRequest: "error"`, so
an unmocked request fails the test, and CI checks that the setting is still
there. Scripts such as `verify:providers` only make free, read-only `GET`s.
Do not add a request that creates a prediction, a generation or any other
paid job to a test, a fixture recorder or a script. Generation code is tested
against recorded responses only.
