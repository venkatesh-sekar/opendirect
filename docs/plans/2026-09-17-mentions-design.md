# Mentions and Intelligent Substitution

A validated design. The user asked for one thing:

> "the character, scenarios are all should be @able like i can create a
> character venkz and can do @venkz to reference it if model allows it. we will
> do intelligent substitution"

Two halves. **`@able`** is a handle on a container and a picker in the prompt
bar. **Intelligent substitution** is the part that matters: at run time the
same `@venkz` becomes an attached reference image on a model that takes images,
and a sentence of prose on a model that does not — and the user sees which one
it will be *before* they press Run.

---

## 1. Goal and non-goals

### Goal

- A character or scene has a **handle** — `venkz` — unique in the project,
  derived from its name, editable.
- Typing `@` in any prompt bar opens a picker of those handles; choosing one
  writes the literal text `@venkz` into the prompt and paints it as a chip.
- At run time `@venkz` resolves against **the chosen model's own schema**:
  an image slot if the model declares one, otherwise prose.
- The resolution is visible in the reference tray before the run, including
  the downgrade: `@venkz → text only (this model has no image input)`.

### Non-goals

- **No new generation path.** Resolution produces the same
  `GenerationRequest`, submitted through the same `generations:submit`, run by
  the same job runner. Main's existing validation is unchanged and still the
  last word.
- **No auto-run, no auto-import, no auto-pick.** A mention attaches an asset
  the container already holds. It never generates a missing character sheet
  and never spends money. ⛔ No test in this feature may reach a provider.
- **No rich-text document.** The prompt stays a plain string end to end —
  `@venkz` is characters in `generations.prompt`, replayable forever.
- **No handles on assets or canvas nodes in v1.** See §8.
- **No LLM in the loop.** "Intelligent" here means *schema-aware*, not
  model-assisted. Substitution is a pure function with no network.

---

## 2. Data model

### Where a handle lives

A Character is a container and a Scene is a container — `product.md` is
explicit, and `containers.kind` already carries the label. So the handle is a
column on `containers`, not a new table.

`apps/desktop/src/main/db/schema.ts`:

```ts
export const containers = sqliteTable(
  "containers",
  {
    // … existing columns …
    /** `venkz`. Null for `project` and `folder` containers. Unique per project. */
    handle: text("handle"),
    /**
     * What `@venkz` becomes in the prompt when the model takes no image —
     * the user's own words for who or where this is.
     */
    description: text("description"),
  },
  (t) => [
    // … existing indexes …
    uniqueIndex("containers_project_handle_unq").on(t.projectId, t.handle),
  ]
)
```

SQLite treats `NULL`s as distinct in a unique index, so every folder and
project row keeping `handle IS NULL` costs nothing and no backfill is needed.

Migration: `pnpm --filter desktop drizzle-kit generate` produces
`apps/desktop/drizzle/0004_*.sql`. It is additive — two nullable columns and
one index — so an existing project folder opens, migrates and carries on with
every handle null until the first rename derives one.

### Contract

`packages/contract/src/project.ts`:

```ts
export const containerSchema = z.object({
  // … existing fields …
  handle: z.string().nullable(),
  description: z.string().nullable(),
})
```

New pure module `packages/contract/src/handle.ts`, imported by both processes
so the renderer validates what main will accept:

```ts
/** `venkz`, `hotel-lobby`. Lowercase, digits, single hyphens, 1–32 chars. */
export const HANDLE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const HANDLE_MAX = 32

/** "Venkz Sekar!" → "venkz-sekar". Returns null when nothing survives. */
export function slugifyHandle(name: string): string | null

/** `base`, else `base-2`, `base-3`… skipping everything in `taken`. */
export function uniqueHandle(base: string, taken: ReadonlySet<string>): string
```

`slugifyHandle` normalises to NFKD, strips diacritics and everything outside
`[a-z0-9]`, collapses runs to one hyphen, trims hyphens, truncates to
`HANDLE_MAX`. A name of pure punctuation or pure CJK yields `null`, and a null
handle is simply not `@`-able — ⛔ never a generated id like `c-4f2a`, which
nobody would type.

### Deriving, and not clobbering

In `apps/desktop/src/main/repo/containers.ts`:

- `createContainer` sets `handle` when `kind` is `character` or `scene`:
  `uniqueHandle(slugifyHandle(name) ?? "", existingHandles(db, projectId))`,
  and leaves it null when the slug is null.
- `renameContainer` re-derives **only if the stored handle is still the one
  the old name would produce** — `row.handle === slugifyHandle(row.name)`.
  A hand-edited handle survives every rename, and no extra column records
  "was it edited".
- New `setContainerHandle(db, id, handle)` validates against `HANDLE_PATTERN`
  and the project's unique set, and throws a sentence the renderer shows.

Channel, in `packages/contract/src/ipc.ts`:

```ts
"containers:setHandle": {
  input: z.object({ id: z.string(), handle: z.string().nullable() }),
  output: containerSchema,
},
"containers:setDescription": {
  input: z.object({ id: z.string(), description: z.string().nullable() }),
  output: containerSchema,
},
```

---

## 3. The prompt editor

### The choice: textarea + cmdk popover anchored by a mirror div

Five lines of justification, as asked.

1. **It is already installed.** `cmdk@1.1.1` and `@floating-ui/react-dom@2.1.9`
   are in the tree; `@tiptap/*`, ProseMirror and Lexical are not — Tiptap's
   mention setup is six packages and roughly 120 KB gzipped of editor we
   would use for one `@`.
2. **The prompt is a string and must stay one.** `prompt-bar.tsx` keeps
   `draft.prompt: string`, `composePrompt` concatenates strings, and
   `generations.prompt` stores the string that was paid for. A ProseMirror
   document would add a serialise/parse pair on every keystroke whose only job
   is to hand back the string we already had.
3. **The existing bar is a `<Textarea>`** with autosize, `aria-label="Prompt"`,
   and an AI helper that replaces its value wholesale. All of that keeps
   working; a Tiptap swap rewrites `HelperResultDialog`'s apply path too.
4. **Chips without a document model** are a highlight overlay: an absolutely
   positioned `<div>` mirroring the textarea's text with `@handle` wrapped in a
   `<mark>`, under a transparent-text textarea. This is the standard trick, it
   is ~40 lines, and it degrades to plain text if it ever breaks.
5. **Testability.** A textarea is `fireEvent.change` in vitest; a ProseMirror
   view needs a real layout. The repo's tests are jsdom.

Rejected: Tiptap + `@tiptap/extension-mention` (correct but heavy, and its
`storeAsText` path ends up back at a string anyway); a bare `<datalist>` (no
caret anchoring, no fuzzy match); `react-mentions` (unmaintained for React 19).

### The parts

`apps/web/lib/mentions/parse.ts` — pure, no DOM:

```ts
/** `@venkz` when preceded by start-of-string or whitespace/punctuation. */
export const MENTION_PATTERN: RegExp

export interface MentionToken { handle: string; start: number; end: number }

/** Every mention in the text, in order of appearance. */
export function findMentions(text: string): MentionToken[]

/** The mention being typed at the caret, or null. `query` may be "". */
export function activeMentionQuery(
  text: string,
  caret: number
): { query: string; start: number; end: number } | null

/** Replaces `range` with `@handle ` and returns the new text and caret. */
export function insertMention(
  text: string,
  range: { start: number; end: number },
  handle: string
): { text: string; caret: number }
```

`apps/web/lib/mentions/caret.ts` — `caretRect(textarea, index): DOMRect`, the
mirror-div measurement (clone the computed style into an offscreen `<div>`,
slice the text at `index`, measure a zero-width span). Used only for
positioning; a failure returns the textarea's own rect, so the picker opens
bottom-left rather than not at all.

`apps/web/components/canvas/mention-textarea.tsx` — the composed control:

```tsx
export interface MentionTextareaProps {
  value: string
  onChange: (value: string) => void
  subjects: readonly MentionSubject[]
  placeholder?: string
  "aria-label"?: string
}
```

A `<Textarea>` (unchanged props from the bar), a `<mark>`-painting overlay, and
a `cmdk` `<Command>` inside a popover anchored with `useFloating` to
`caretRect`. `↑`/`↓`/`Enter`/`Tab` select, `Esc` dismisses, and the popover is
suppressed while it is closed so the textarea's own keys are untouched.
`role="listbox"` on the list, `aria-activedescendant` on the textarea —
`cmdk` gives both.

It replaces exactly one element in `prompt-bar.tsx` (the `<Textarea>` at
`apps/web/components/canvas/prompt-bar.tsx:608`). The creation bar can adopt
it later; nothing forces it to.

---

## 4. Intelligent substitution

### Where it happens: the renderer, before the IPC

Decided, and the reason is the requirement itself: **the user must see the
plan before paying for it.** The tray badge, the downgrade note and the run
are all the same computation, and the model descriptor the computation needs
(`descriptor.referenceSlots`, already derived by
`apps/desktop/src/main/providers/reference-slots.ts`) is already in the
renderer via `useModel`. Resolving in main would mean either computing it
twice or adding a preview channel that returns what the run will be — a second
source of truth for one screen.

So: `resolveMentions` runs in `prompt-bar.tsx`, between `edgesToInputs` and
`buildGenerationRequest`. What reaches `generations:submit` is an ordinary
request with an ordinary prompt and ordinary references, and main's existing
guards in `apps/desktop/src/main/generations-submit.ts` — slot must exist on
the model, asset must exist in the project — are unchanged and still the last
word. A renderer bug still cannot submit an incoherent run.

### The pure function

New file `apps/web/lib/mentions/resolve.ts`. No IPC, no fetch, no `Date`, no
randomness — a function of its arguments.

```ts
import type { GenerationReference, ReferenceSlot } from "@opendirect/contract"

/** One `@`-able thing, flattened for both the picker and the resolver. */
export interface MentionSubject {
  containerId: string
  kind: "character" | "scene"
  handle: string
  name: string
  /** The user's prose. What `@venkz` becomes when there is no image slot. */
  description: string | null
  /** Reference images, best first — see `rankReferenceImages`. */
  images: readonly { assetId: string; label: string | null }[]
}

export interface ResolveMentionsInput {
  /** The raw prompt, `@venkz` and all. */
  prompt: string
  subjects: readonly MentionSubject[]
  /** The chosen model's own slots — `descriptor.referenceSlots`. */
  slots: readonly ReferenceSlot[]
  /** Slots already filled by canvas edges, keyed by field. */
  occupied: Readonly<Record<string, number>>
  /** Images one mention may attach. Default 1. */
  perSubject?: number
}

export type MentionOutcome =
  | {
      kind: "image"
      handle: string
      containerId: string
      slotField: string
      assetIds: string[]
      /** What replaced `@venkz` in the prompt. */
      substitution: string
    }
  | {
      kind: "text"
      handle: string
      containerId: string
      reason: "no-image-slot" | "slots-full" | "no-images"
      substitution: string
    }
  /** A handle no container claims. Left in the prompt verbatim. */
  | { kind: "unresolved"; handle: string }

export interface ResolvedMentions {
  /** The prompt as submitted. Resolved mentions are gone from it. */
  prompt: string
  /** References to merge with the edge-derived ones. */
  references: GenerationReference[]
  /** One entry per distinct handle, in order of first appearance. */
  outcomes: MentionOutcome[]
}

export function resolveMentions(input: ResolveMentionsInput): ResolvedMentions
```

### The rules

1. **Order and dedupe.** `findMentions` gives the mentions in order. A handle
   mentioned twice attaches **once** and substitutes **both** times.
2. **Slot allocation.** A running tally starts from `occupied` — the edges the
   user drew always win, because they are an explicit gesture. For each
   subject in order, the first slot that (a) accepts `image`
   (`slot.kind === "image" || slot.kind === "any"`), (b) has capacity left by
   `slotCapacity` from `apps/web/lib/canvas/slots.ts`, and (c) passes the role
   preference below.
3. **Role preference.** Characters prefer `role: "reference"`, then
   `"unknown"`, then anything else that takes an image. Scenes prefer the
   same. ⛔ Neither ever lands in `first_frame`, `last_frame`, `motion` or
   `source` — those carry frame semantics a user wires deliberately, and
   quietly making a character sheet the first frame of a video would be a paid
   surprise.
4. **How many images.** A `multiple` slot takes
   `min(perSubject, remaining capacity, images.length)`, best image first. A
   single-value slot takes one. Scenes take one, always.
5. **The image substitution** names the position so the model can tie the word
   to the picture:
   - character → `Venkz (the person in reference image 2)`
   - scene → `The Hotel Lobby (the location in reference image 3)`

   The number is 1-based across every image the request will send, in
   `GenerationReference` order, so it matches what the provider receives. A
   model with exactly one image slot holding exactly one image drops the
   number: `Venkz (the person in the reference image)`.
6. **The text substitution** is `description` when there is one, otherwise the
   plain `name`. Reasons, and the note the tray shows:
   - `no-image-slot` — this model has no image input
   - `slots-full` — the model's image slots are already taken by edges
   - `no-images` — the character has no reference image yet
7. **Unknown handle.** `@nobody` stays in the prompt, character for character,
   and is reported as `unresolved`. ⛔ Never deleted, never fuzzy-matched to a
   near neighbour: a silently corrected mention is a paid mistake.
8. **Whitespace.** The substitution replaces `@venkz` only; the surrounding
   text is untouched, so `a shot of @venkz, smiling` reads correctly.

### Wiring it in

`apps/web/components/canvas/prompt-bar.tsx`, replacing the `request` memo's
prompt and references:

```ts
const subjects = useMentionSubjects().data ?? []

const mentions = useMemo(
  () =>
    resolveMentions({
      prompt: composePrompt(inputs.promptPrefix, draft.prompt),
      subjects,
      slots: descriptor?.referenceSlots ?? [],
      occupied: countBySlot(isBlocked(inputs) ? [] : inputs.references),
    }),
  [descriptor, draft.prompt, inputs, subjects]
)

// … inside buildGenerationRequest:
values: {
  prompt: mentions.prompt,
  references: groupReferences([...inputs.references, ...mentions.references]),
  // …
}
```

`countBySlot` is a three-line helper next to `groupReferences`. Because the
mention references are appended after the edge ones, `buildGenerationRequest`'s
per-slot `forEach` gives them the later positions — the user's own wiring keeps
index 0.

The cost estimate and `planBatch` both read the request, so the price on the
button already accounts for an attached reference. Nothing extra is needed.

### The subject index

The picker and the resolver want the same list, and building it needs one
`assets:list` per container — N round trips from the renderer. So one
read-only channel:

```ts
"mentions:subjects": { input: z.void(), output: z.array(mentionSubjectSchema) },
```

- `packages/contract/src/project.ts` — `mentionSubjectSchema`, mirroring the
  interface above.
- `apps/desktop/src/main/repo/mentions.ts` — pure Drizzle,
  `listMentionSubjects(db, projectId): MentionSubjectDto[]`: every container
  of kind `character` or `scene` with a non-null handle, joined to its
  `container_assets` where `assets.kind = 'image'`, ranked.
- `apps/desktop/src/main/mentions-service.ts` — the thin Electron sheet, the
  same shape as `canvas-service.ts`.
- `apps/web/hooks/use-mentions.ts` — `useMentionSubjects()`, a TanStack query
  under `queryKeys.mentions.subjects()`, invalidated by the container and
  asset mutations that already invalidate the tree.

**Ranking**, in `repo/mentions.ts` and unit-tested:

```ts
export function rankReferenceImages(assets: readonly AssetDto[]): AssetDto[]
```

Pinned first; then `label` matching `/character sheet|turnaround|model sheet|reference/i`;
then oldest first, because the first image imported into a character is
usually the canonical one. ⛔ It ranks; it never picks. The picking is
`resolveMentions`'s, under a limit the model stated.

---

## 5. Showing the plan before the run

`apps/web/components/canvas/reference-tray.tsx` takes one new optional prop:

```ts
/** What the prompt's mentions will contribute. Read-only. */
mentions?: readonly MentionOutcome[]
```

- **Image outcomes** render after the edge thumbs: the asset's thumbnail, a
  dashed ring to say "this one came from the prompt, not from an edge", and a
  small `@venkz` badge bottom-left. `data-testid="mention-thumb"`,
  `data-handle`, `data-slot`. There is no ✕ — you remove it by deleting
  `@venkz` from the prompt, which is where it came from. `title` reads
  `@venkz → Reference Images`.
- **Text and unresolved outcomes** render as a one-line note under the tray
  row, `data-testid="mention-note"`, in `text-muted-foreground`:
  - `@venkz → text only (this model has no image input)`
  - `@venkz → text only (the image slots are already wired)`
  - `@venkz → text only (no reference image yet)`
  - `@nobody → no character or scene with that handle` — this one is
    `text-destructive`, because it is the one case the prompt still contains
    an `@`.

A `<Tooltip>` on a mention thumb shows the substitution verbatim, so the user
can read the exact sentence the model will get.

The prompt bar passes `mentions={mentions.outcomes}` and nothing else changes:
the bar's own `blockedReason`, cost badge and Run button are untouched. ⛔ An
unresolved mention does **not** block the run — the user may well want a
literal `@` in their prompt.

---

## 6. Creation flow

### The "+" must leave something with a handle

`apps/web/components/shell/sidebar.tsx:104-115` creates `"Untitled"`.
`"Untitled"` slugs to `untitled`, and three of them become `untitled`,
`untitled-2`, `untitled-3` — technically fine, useless to type. So:

1. The created name becomes `New character` / `New scene` / `New folder`
   (`section.childKind`), which at least reads as a placeholder.
2. Creation **opens the inline rename immediately**. `container-tree.tsx`
   already has the whole mechanism — `draftName`, `commitRename`, the
   `<input aria-label="Rename …">` at line 238. It needs one prop threaded
   down: `ProjectSidebar → ContainerTree → ContainerRow` as
   `autoRenameId: string | null`, set from `createContainer.mutate`'s
   `onSuccess` and cleared on commit. A row whose `node.id === autoRenameId`
   sets `draftName` once on mount and focuses the input.
3. The handle follows the rename in main (§2), so by the time the user has
   typed "Venkz" and pressed Enter, `@venkz` exists. The row shows it as
   dimmed `@venkz` after the name, which is also the affordance that says
   this thing is mentionable.
4. The context menu gains **Edit handle…** and **Description…**, both small
   dialogs over `containers:setHandle` / `containers:setDescription`. The
   handle dialog shows the pattern and the uniqueness error inline.

### Save as character

A media node on the canvas, or an asset card, should become a character
without a trip to the sidebar.

- `apps/web/components/canvas/nodes/media-node.tsx` gains a `<ContextMenu>`,
  the same shape `generate-node.tsx:285` already uses, with **Save as
  character** and **Save as scene**.
- One channel:

  ```ts
  "containers:createFromAsset": {
    input: z.object({
      assetId: z.string(),
      kind: z.enum(["character", "scene"]),
      name: z.string().min(1),
    }),
    output: containerSchema,
  },
  ```

- `apps/desktop/src/main/repo/containers.ts` —
  `createContainerFromAsset(db, input)`: `createContainer` (handle derived),
  then `addAssetToContainer`, in one `db.transaction` so a failed link never
  leaves an empty character behind.
- The default name is the asset's `label ?? originalName` with its extension
  stripped, so `venkz-sheet-v3.png` proposes `venkz sheet v3` → handle
  `venkz-sheet-v3`. The renderer then selects the new container in the sidebar
  with `autoRenameId` set, so the user's first keystroke fixes the name and
  the handle follows.

⛔ It copies nothing and moves nothing: `container_assets` is many-to-many by
design, so the asset stays exactly where it already was as well.

---

## 7. Tasks

Seven, each independently shippable and each leaving the tree green.

### Task 1 — Handles in the contract and the database

Files: `packages/contract/src/handle.ts` (new), `packages/contract/src/index.ts`,
`packages/contract/src/project.ts`, `packages/contract/src/ipc.ts`,
`apps/desktop/src/main/db/schema.ts`, `apps/desktop/drizzle/0004_*.sql`
(generated), `apps/desktop/src/main/repo/containers.ts`,
`apps/desktop/src/main/handlers.ts`.

Adds `handle` and `description`, the unique index, `slugifyHandle` /
`uniqueHandle`, derivation on create, non-clobbering re-derivation on rename,
`containers:setHandle` and `containers:setDescription`.

Tests: `packages/contract/src/handle.test.ts` (slug cases: diacritics, CJK →
null, truncation, collisions `venkz` → `venkz-2`);
`apps/desktop/src/main/repo/containers.test.ts` (derive on create, collision
within a project, rename re-derives, hand-edited handle survives a rename,
`setContainerHandle` rejects `Venkz!` and a duplicate);
`apps/desktop/src/main/db/schema.test.ts` (the new columns);
`apps/desktop/src/main/ipc-coverage.test.ts` picks the channels up for free.

### Task 2 — The mention subject index

Files: `packages/contract/src/project.ts` (`mentionSubjectSchema`),
`packages/contract/src/ipc.ts`, `apps/desktop/src/main/repo/mentions.ts` (new),
`apps/desktop/src/main/mentions-service.ts` (new),
`apps/desktop/src/main/index.ts` (register),
`apps/web/hooks/use-mentions.ts` (new), `apps/web/hooks/query-keys.ts`.

Tests: `apps/desktop/src/main/repo/mentions.test.ts` against `:memory:` —
containers without a handle are excluded, folders are excluded, non-image
assets are excluded, `rankReferenceImages` puts pinned then
"Character Sheet" then oldest; `apps/web/hooks/query-keys.test.ts` for the key.

Ships nothing visible, and is a clean seam for tasks 3–5.

### Task 3 — `resolveMentions`, the pure substitution

Files: `apps/web/lib/mentions/parse.ts` (new),
`apps/web/lib/mentions/resolve.ts` (new).

Tests: `apps/web/lib/mentions/parse.test.ts` (`@venkz` at start, mid-sentence,
after punctuation, not inside an email, `activeMentionQuery` at each caret
position); `apps/web/lib/mentions/resolve.test.ts` — the heart of this
feature, driven by slots built from **literal JSON Schemas through
`deriveReferenceSlots`**, never a live model:

- model with `reference_images` (array, `maxItems: 4`) → attaches, prompt
  reads `Venkz (the person in reference image 1)`
- model with only `prompt` → `kind: "text"`, `reason: "no-image-slot"`,
  prompt carries the description
- character with no description and no images → substitutes the bare name
- `image` single slot already filled by an edge → `reason: "slots-full"`
- two mentions, one slot with capacity 1 → first attaches, second downgrades
- the same handle twice → one reference, two substitutions
- `@nobody` → `unresolved`, prompt still contains `@nobody`
- a model whose only image slot is `first_frame` → downgrades rather than
  hijacking the frame
- scene + character on a multi-image model → both attach, numbered 1 and 2

⛔ Every test is a literal object. No msw handler, no provider, no cost.

### Task 4 — The `@` picker in the prompt bar

Files: `apps/web/lib/mentions/caret.ts` (new),
`apps/web/components/canvas/mention-textarea.tsx` (new),
`apps/web/components/canvas/prompt-bar.tsx` (swap the `<Textarea>`).

Tests: `apps/web/components/canvas/mention-textarea.test.tsx` — typing `@ve`
opens the list filtered to Venkz; `Enter` writes `@venkz ` into `value`;
`Esc` closes and leaves the text alone; the overlay renders a `<mark>` per
mention. `prompt-bar.test.tsx` gains one case: the bar still submits the
literal prompt text.

At the end of this task `@venkz` is typeable and does nothing at run time yet.
That is a fine place to stop.

### Task 5 — Substitution at run time

Files: `apps/web/components/canvas/prompt-bar.tsx` (the `mentions` memo,
`countBySlot`, the merged references and prompt).

Tests: `apps/web/components/canvas/prompt-bar.test.tsx` — with a mocked
`mentions:subjects` and a mocked descriptor, pressing Run submits a request
whose `prompt` has no `@` and whose `references` include the character's
asset in `reference_images`; with an image-less model the same click submits
the description and no extra reference. Both assert the **payload handed to
the mocked `generations:submitBatch`**; ⛔ nothing is sent anywhere.

### Task 6 — Showing the plan before the run

Files: `apps/web/components/canvas/reference-tray.tsx` (the `mentions` prop,
the badge, the note), `apps/web/components/canvas/prompt-bar.tsx` (pass it).

Tests: `apps/web/components/canvas/reference-tray.test.tsx` (new) — an image
outcome renders a `mention-thumb` with `data-handle="venkz"` and no remove
button; a `no-image-slot` outcome renders the exact sentence
`@venkz → text only (this model has no image input)`; an unresolved handle
renders the destructive note.

### Task 7 — Creating something that has a handle

Files: `apps/web/components/shell/sidebar.tsx`,
`apps/web/components/shell/container-tree.tsx`,
`apps/web/components/canvas/nodes/media-node.tsx`,
`apps/desktop/src/main/repo/containers.ts`
(`createContainerFromAsset`), `packages/contract/src/ipc.ts`,
`apps/desktop/src/main/handlers.ts`, `apps/web/hooks/use-containers.ts`.

Tests: `apps/desktop/src/main/repo/containers.test.ts`
(`createContainerFromAsset` links the asset, derives the handle, and rolls the
container back when the link fails); a sidebar test that "+" creates and
opens the rename input focused; a `container-tree` test that the row shows
`@venkz` once the handle exists.

---

## 8. Open questions and later

- **Handles on assets.** `@hotel-sheet` for one specific image is a natural
  next step and the resolver already takes a `MentionSubject`, so it is a new
  source for the index rather than new logic. Left out because a character
  with several images is the thing the user asked for.
- **Handles on canvas nodes.** `@shot-4` to feed a node's pick into another
  prompt overlaps with drawing an edge, which is better. Probably never.
- **`@` in the Advanced form's own text fields.** Only the prompt is
  substituted in v1. A negative-prompt field that mentions a character is a
  plausible ask.
- **Per-model image budget.** `perSubject` defaults to 1. A model with
  `maxItems: 8` could reasonably take three views of a character; that wants a
  per-character "how many views to send" control rather than a guess.
- **Substitution phrasing.** `(the person in reference image 1)` is a guess at
  what models parse best. It is one string constant in `resolve.ts`, and worth
  revisiting against real outputs.
- **A mention that resolves differently per sibling in a batch.** It does not:
  every sibling of a batch shares one request. Correct, and worth stating.

---

## 9. Libraries adopted

None. `cmdk@1.1.1` (MIT) and `@floating-ui/react-dom@2.1.9` (MIT) are already
in the tree; so are zod, Drizzle, TanStack Query and the shadcn primitives.
`@tiptap/*` was evaluated and declined — see §3.
