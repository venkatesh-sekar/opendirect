# Model Registry: curated capabilities across providers

A validated design (brainstormed 2026-09-24). The user asked:

> "Right now it's only Replicate, but in future I can make it Hugging Face and
> other things… proper adapters… full first-class support for generating
> videos, images, reference images, face images, character images… if you want
> to give a character reference, only show the models that have it… the model
> names can all be different, but maybe we can have mappings."

Sections 1–4 were reviewed and agreed. Sections 5 (request translation) and
7 (migration) were reviewed while writing the implementation plan
(`2026-09-24-model-registry-plan.md`) and are **accepted** as written there;
the plan's "Decisions made while planning" fill in the details.

---

## Why

The adapter layer already exists (`ModelProvider`, `registry.ts`, one
`ModelDescriptor` shape). What is missing is **meaning**. Today
`reference-slots.ts` guesses a slot's role from its field name with regexes.
That works for `start_image`, but it cannot tell that Kling's `elements` is a
character reference or that some model's `image_urls` is a style reference, so
a filter like "only models that take a character" can never be trusted.

## Prior art, and what we take from it

Researched 2026-09-24. Nobody publishes an open, curated, per-model field
mapping for media models, so the registry itself is ours. The vocabulary and
the architecture are borrowed:

| Source | What we take |
|---|---|
| **Vercel AI SDK** `experimental_generateVideo` | Canonical names: `frameImages{first_frame,last_frame}`, `inputReferences`, `generateAudio`, `aspectRatio`, `duration`, and the `providerOptions` passthrough idea |
| **OpenRouter** `/api/v1/videos/models` | A per-model capability manifest (`supported_frame_images`, `supported_durations`, …) as the thing the UI filters on |
| **Hugging Face Inference Providers** | One canonical model id → many provider ids, in a registry fetched at runtime and cached, with a hardcoded floor that overrides it |
| **fal.ai** | Evidence that one "model" is really several endpoints (Kling 3 Pro: text-to-video, image-to-video, reference-to-video, motion-control), so our unit must be a family |
| **LiteLLM / AI SDK** | An explicit policy for unsupported inputs: reject, never silently drop |
| **ControlNet / IP-Adapter / Runway** | The conditioning taxonomy the roles are anchored to (section 2) |

We do **not** depend on the AI SDK at runtime. Its providers map fields
generically and carry no per-model capability data, and our adapters already
handle Replicate version pinning, uploads, polling and cost.

---

## 1. A slot has a kind and a role, and only the kind is enforced

| | **Kind** (enforced) | **Role** (meaning, never checked) |
|---|---|---|
| Values | `image` / `video` / `audio`, plus `max`, `required` | one of the ten roles below |
| Checked? | Yes. A video cannot go into an image slot. Transport (`image_url` vs an uploaded file vs a data URI) is the adapter's job | No. We cannot tell a scene from a character. If a user points a scene at a `character` slot, it is sent |
| Used for | Correctness | Filtering, labels, picking a slot when a model has several, auto-routing assets from a Character container |

## 2. The roles: a closed list, anchored to one question

**A role answers: what does this input control in the output?** That is the
standard conditioning taxonomy; every provider uses it under different names.

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

### Rules that keep the list from growing

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
5. **Changing the list is a contract change.** It bumps the registry format
   version and needs these rules cited in the PR.

## 3. The mapping file: one family, many endpoints

The unit is a **model family** that spans providers. The picker shows Kling 3
Pro once; adding a provider gives already-mapped models another place to run.

```jsonc
// registry/models/kling-v3-pro.json
{
  "id": "kling-v3-pro",
  "name": "Kling 3 Pro",
  "kind": "video",
  "endpoints": [
    {
      "provider": "fal",
      "model": "fal-ai/kling-video/v3/pro/image-to-video",
      "inputs": {
        "first_frame": { "field": "start_image_url", "kind": "image", "required": true },
        "last_frame":  { "field": "end_image_url", "kind": "image" },
        "character":   { "field": "elements", "kind": "image", "shape": "kling-elements", "max": 4,
                         "label": "Characters (frontal photo + references)" }
      },
      "controls": {
        "prompt":   { "field": "prompt" },
        "duration": { "field": "duration", "values": { "5": "5", "10": "10" } },
        "generate_audio": { "field": "generate_audio" }
      }
    },
    { "provider": "replicate", "model": "kwaivgi/kling-v3-pro", "inputs": { "…": "…" } }
  ]
}
```

- **Controls** are the canonical scalar set: `prompt`, `negative_prompt`,
  `aspect_ratio`, `duration`, `resolution`, `seed`, `generate_audio`, `count`.
  `values` maps canonical values to the provider's (`"5"` → `5`, `"16:9"` →
  `"landscape"`), so the UI offers one vocabulary.
- **Most mappings are a rename** and stay declarative.
- **Shapes** are small, named TypeScript functions for nested payloads, such as
  Kling's `elements: [{ frontal_image_url, reference_image_urls }]`. They live
  in app code, not a JSON rule language. A mapping file may only *name* a
  shape the app ships, so a remote registry can never run code.
- **Everything not mapped** in the endpoint's own schema stays reachable under
  Advanced, exactly as the generated form works today.

## 4. Where mappings come from

Merged in four layers; later wins.

1. **Bundled.** `registry/` ships in the app, so it works offline and is the floor.
2. **Remote.** Fetched from raw GitHub (URL overridable in settings), validated
   with zod, cached on disk. Used only when its `registryVersion` is newer and
   its format version is one this build understands. A **Reload registry**
   action refetches it.
3. **User overrides.** A local file (later a UI) in the same format, so a user
   can map any model themselves. Contributing upstream means turning that
   override into a PR.
4. **Unmapped models (degraded mode).** Today's schema inference remains. Every
   slot is usable, but roles show as **unverified**, and these models are left
   out of capability filters unless "include unverified" is on.

A remote or user entry that fails validation is dropped with a visible warning
and the lower layer stays in force. It never fails silently.

---

## 5. Request translation (accepted)

The canvas composes a canonical request against the family:

```ts
{ family: "kling-v3-pro",
  inputs:   { first_frame: [asset], character: [asset, asset] },
  controls: { prompt: "…", duration: "5" },
  advanced: { cfg_scale: 0.5 } }   // raw fields, keyed per endpoint
```

1. **Provider.** The user's provider preference order (settings), filtered to
   configured keys, with a per-node override.
2. **Endpoint.** Among that provider's endpoints for the family, keep those
   whose inputs cover every filled role and whose required roles are filled.
   Ties go to manifest order, which is the curator's preference.
3. **Compatible combinations in the UI.** The family's capabilities are the
   union of its endpoints, but not every combination exists on one endpoint.
   When a slot is filled, slots that no remaining endpoint supports are dimmed
   with the reason, instead of failing at submit.
4. **Translate.** Each role becomes its field (through its shape if named); each
   asset goes through the adapter's transport (`uploadReference`, a URL, or a
   data URI); each control is renamed and value-mapped. `advanced` fields merge
   last and may not overwrite a mapped field.
5. **Reject, never drop.** An input the chosen endpoint cannot take is an error
   before submit. The UI should have prevented it; the adapter is the safety net.

Unmapped models skip steps 2–3 and submit the inferred slots under their raw
field names, as today.

## 6. Guards against drift

The point of writing this down is that the design does not get muddier over
time. These make the rules mechanical:

- `referenceRoleSchema` in `packages/contract/src/model.ts` is the one closed
  enum, and its doc comment carries the section 2 rules and links here.
- A unit test loads every bundled mapping through the zod schema and checks
  each named shape exists.
- A unit test checks every mapped field against the recorded schema fixture for
  that endpoint, so a mapping to a field that does not exist fails CI.
- The read-only `verify:providers` script grows a registry mode that compares
  mapped fields with each provider's live schema (free `GET`s only), so an
  upstream rename shows up as a report, not a broken generation.
- `CONTRIBUTING.md` documents the mapping format and the three-test rule for
  roles.

## 7. Migration from today (accepted)

- `referenceRoleSchema`: `unknown` becomes `reference` plus a `verified: false`
  flag on the slot; `motion` and the frame roles keep their names; `character`,
  `style`, `structure`, `mask`, `soundtrack` are added.
- `ProviderId` grows as adapters are added (`fal`, `huggingface`); nothing else
  changes shape to add one.
- Canvas edges store `slotField`, not a role, so existing boards keep working.
  A family-level slot key (the role, plus index when a role repeats) replaces
  `slotField` for mapped models.
- OpenRouter's capability endpoint can seed and cross-check its mappings.

## Open questions

- Trained identities (Soul ID, LoRAs, saved characters) are a different
  primitive from a per-request `character` image: created once, referenced by
  id. Out of scope here, but the role list should not have to change for it.
- Exclusive inputs within one endpoint. Some endpoints forbid certain
  combinations of their own inputs (Seedance: a last frame "cannot be combined
  with reference images"). The format has no exclusivity rule, so this is
  documented and not modelled: the slot label says it, and the provider
  rejects the run at submit with its own message. Section 5.3's dimming only
  covers combinations no endpoint supports at all. This is how it shipped:
  the bundled Seedance labels read "First frame (not with reference images,
  videos or audio)" and so on. Those labels are long enough to be cut off on
  a canvas wire, so a short-label field may be worth adding if this stays
  unmodelled.
- Single-image inputs without a `max`. A family slot is a list when any
  endpoint's field is a list, and an endpoint whose schema has not been
  fetched (no key for that provider) is judged by `max` alone, where no `max`
  means a list. So with only an OpenRouter key, the bundled Seedance
  "First frame" slot offers several images until Replicate's schema is
  known. Writing `max: 1` on single-URL inputs in the bundled files would
  settle it; it has not been done yet.

## Decided

- **A refused remote copy.** A fetched copy in a newer format, or whose
  `index.json` does not validate, is reported and never written over a cache
  that works. A bad index is retried after an hour; a newer format waits for
  an app update.
- **Retries keep their shapes.** The queued row records `familyId` and each
  field's shape, and the runner keeps both when it rewrites the recorded
  request after submitting, so a retry of a cancelled run shapes its payload
  as it was queued.
- **One bad setting does not reset the rest.** Settings are validated field
  by field on read, so a hand-edited `http://` registry URL falls back to the
  default URL alone.

- **Hosting.** The remote registry is this repo's `registry/` on `main`,
  fetched from
  `https://raw.githubusercontent.com/venkatesh-sekar/opendirect/main/registry`
  (overridable in settings). A merged registry PR reaches users without an app
  release, which removes the reason for a separate repo; the app still only
  takes a copy whose `registryVersion` beats the bundled one and whose
  `format` it reads.
