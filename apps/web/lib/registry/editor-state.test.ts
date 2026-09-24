/**
 * The mapping editor's state, without the UI: the pre-fill, the rules that
 * keep a person's own choices from being overwritten, slot-key numbering,
 * the round trip through `formatFamilyJson`, and validation addressed to
 * rows.
 *
 * ⛔ No network: the descriptors are built from recorded fixtures.
 */
import {
  formatFamilyJson,
  modelFamilySchema,
  type ModelFamily,
} from "@opendirect/contract"
import { describe, expect, it } from "vitest"

import {
  editorReducer,
  emptyEditor,
  fromFamily,
  endpointNotices,
  fromRaw,
  inputTarget,
  isDirty,
  slugify,
  toFamily,
  validateEditor,
  withBaseline,
  type EditorState,
  type FieldRow,
} from "./editor-state"
import { bundledSeedance, seedanceDescriptor } from "./test-descriptors"

function withSeedance(state: EditorState = emptyEditor()): EditorState {
  const added = editorReducer(state, {
    type: "addEndpoint",
    provider: "replicate",
    model: "bytedance/seedance-2.5",
  })
  return editorReducer(added, {
    type: "endpointLoaded",
    index: added.endpoints.length - 1,
    descriptor: seedanceDescriptor(),
  })
}

function row(state: EditorState, field: string, index = 0): FieldRow {
  const found = state.endpoints[index]!.rows.find((r) => r.field === field)
  if (!found) throw new Error(`no row ${field}`)
  return found
}

function keyOf(r: FieldRow): string | null {
  return r.target.kind === "input" ? r.target.key : null
}

describe("slugify", () => {
  it("turns a name into a family id", () => {
    expect(slugify("Kling 3 Pro")).toBe("kling-3-pro")
    expect(slugify("  Seedance 2.5 (custom)! ")).toBe("seedance-2-5-custom")
    expect(slugify("Ünïcode — Model")).toBe("unicode-model")
    expect(slugify("")).toBe("")
    expect(slugify("x".repeat(100))).toHaveLength(64)
  })
})

describe("name and id", () => {
  it("auto-slugs the id from the name until the id is edited", () => {
    let state = editorReducer(emptyEditor(), {
      type: "setName",
      name: "Kling 3 Pro",
    })
    expect(state.id).toBe("kling-3-pro")
    state = editorReducer(state, { type: "setId", id: "kling-mine" })
    state = editorReducer(state, { type: "setName", name: "Kling 3 Pro v2" })
    expect(state.id).toBe("kling-mine")
  })

  it("lets the id be cleared and retyped, then follows the name again", () => {
    let state = editorReducer(emptyEditor(), { type: "setName", name: "Kling" })
    state = editorReducer(state, { type: "setId", id: "" })
    expect(state.id).toBe("")
    state = editorReducer(state, { type: "setId", id: "k" })
    expect(state.id).toBe("k")
    state = editorReducer(state, { type: "setId", id: "" })
    state = editorReducer(state, { type: "setName", name: "Kling 3" })
    expect(state.id).toBe("kling-3")
  })

  it("never auto-slugs onto an id that is already taken", () => {
    const state = editorReducer(emptyEditor({ takenIds: ["kling-3-pro"] }), {
      type: "setName",
      name: "Kling 3 Pro",
    })
    expect(state.id).toBe("kling-3-pro-2")
  })
})

describe("endpointLoaded", () => {
  it("pre-fills the Replicate Seedance 2.5 image field as the first frame", () => {
    const state = withSeedance()
    const image = row(state, "image")
    expect(image.target).toMatchObject({
      kind: "input",
      key: "first_frame",
      input: { kind: "image" },
    })
    expect(image.suggestion?.confidence).toBe("schema")
    expect(row(state, "prompt").target).toEqual({
      kind: "control",
      control: "prompt",
    })
    expect(row(state, "watermark").target).toEqual({ kind: "advanced" })
  })

  it("lists rows in the schema's x-order and flags URI fields", () => {
    const state = withSeedance()
    const fields = state.endpoints[0]!.rows.map((r) => r.field)
    expect(fields.slice(0, 4)).toEqual([
      "prompt",
      "image",
      "last_frame_image",
      "reference_images",
    ])
    expect(row(state, "image").isUri).toBe(true)
    expect(row(state, "reference_images").isArray).toBe(true)
    expect(row(state, "seed").isUri).toBe(false)
    expect(state.endpoints[0]!.loading).toBe(false)
  })

  it("names an empty mapping after the model it loaded", () => {
    const state = withSeedance()
    expect(state.name).toBe("Seedance 2.5")
    expect(state.id).toBe("seedance-2-5")
    expect(state.kind).toBe("video")
  })

  it("ignores a descriptor for a different endpoint", () => {
    const added = editorReducer(emptyEditor(), {
      type: "addEndpoint",
      provider: "openrouter",
      model: "x/y",
    })
    const state = editorReducer(added, {
      type: "endpointLoaded",
      index: 0,
      descriptor: seedanceDescriptor(),
    })
    expect(state.endpoints[0]!.loading).toBe(true)
  })
})

describe("suggestions never overwrite a person's choice", () => {
  it("applyAllSuggestions leaves a touched row alone", () => {
    let state = withSeedance()
    state = editorReducer(state, {
      type: "setTarget",
      index: 0,
      field: "image",
      target: { kind: "advanced" },
    })
    state = editorReducer(state, {
      type: "setTarget",
      index: 0,
      field: "seed",
      target: { kind: "advanced" },
    })
    state = editorReducer(state, { type: "applyAllSuggestions", index: 0 })
    expect(row(state, "image").target).toEqual({ kind: "advanced" })
    expect(row(state, "image").touched).toBe(true)
  })

  it("resetEndpoint puts every row back to its pre-fill", () => {
    let state = withSeedance()
    state = editorReducer(state, {
      type: "setTarget",
      index: 0,
      field: "image",
      target: { kind: "advanced" },
    })
    state = editorReducer(state, { type: "resetEndpoint", index: 0 })
    expect(keyOf(row(state, "image"))).toBe("first_frame")
    expect(row(state, "image").touched).toBe(false)
  })
})

describe("slot keys", () => {
  it("numbers a repeated role and renumbers when the first goes", () => {
    let state = withSeedance()
    expect(keyOf(row(state, "reference_images"))).toBe("reference")
    state = editorReducer(state, {
      type: "setTarget",
      index: 0,
      field: "reference_videos",
      target: {
        kind: "input",
        key: "reference",
        input: { field: "reference_videos", kind: "video" },
      },
    })
    expect(keyOf(row(state, "reference_videos"))).toBe("reference:2")

    state = editorReducer(state, {
      type: "setTarget",
      index: 0,
      field: "reference_audios",
      target: {
        kind: "input",
        key: "reference",
        input: { field: "reference_audios", kind: "audio" },
      },
    })
    expect(keyOf(row(state, "reference_audios"))).toBe("reference:3")

    state = editorReducer(state, {
      type: "setTarget",
      index: 0,
      field: "reference_images",
      target: { kind: "advanced" },
    })
    expect(keyOf(row(state, "reference_videos"))).toBe("reference")
    expect(keyOf(row(state, "reference_audios"))).toBe("reference:2")
  })

  it("moves a control that another row already uses", () => {
    let state = withSeedance()
    state = editorReducer(state, {
      type: "setTarget",
      index: 0,
      field: "output_format",
      target: { kind: "control", control: "prompt" },
    })
    expect(row(state, "output_format").target).toEqual({
      kind: "control",
      control: "prompt",
    })
    expect(row(state, "prompt").target).toEqual({ kind: "advanced" })
  })
})

describe("toFamily / fromFamily", () => {
  it("round-trips the bundled Seedance mapping exactly", () => {
    const bundled = bundledSeedance()
    let state = fromFamily(bundled, null)
    state = editorReducer(state, {
      type: "endpointLoaded",
      index: 0,
      descriptor: seedanceDescriptor(),
      existing: bundled.endpoints[0],
    })
    expect(state.endpoints[0]!.loading).toBe(false)
    const family = toFamily(state)
    expect(modelFamilySchema.safeParse(family).success).toBe(true)
    expect(formatFamilyJson(family)).toBe(
      formatFamilyJson(modelFamilySchema.parse(bundled))
    )
  })

  it("keeps an endpoint's mapping while its schema is still loading", () => {
    const bundled = bundledSeedance()
    const family = toFamily(fromFamily(bundled, "seedance-2-5"))
    expect(family.endpoints[1]).toEqual(bundled.endpoints[1])
  })

  it("keeps a mapped field the schema no longer has, so it can be fixed", () => {
    const bundled = bundledSeedance()
    const broken: ModelFamily = structuredClone(bundled)
    broken.endpoints[0]!.inputs.character = {
      field: "gone_field",
      kind: "image",
    }
    let state = fromFamily(broken, null)
    state = editorReducer(state, {
      type: "endpointLoaded",
      index: 0,
      descriptor: seedanceDescriptor(),
      existing: broken.endpoints[0],
    })
    const gone = row(state, "gone_field")
    expect(gone.missing).toBe(true)
    const issues = validateEditor(state)
    expect(issues).toContainEqual(
      expect.objectContaining({
        where: { endpoint: 0, field: "gone_field" },
        message: expect.stringContaining("gone_field"),
      })
    )
  })

  it("reads what it can of a mapping that does not validate", () => {
    const state = fromRaw({
      id: "Bad Id",
      name: "Broken",
      kind: "video",
      endpoints: [
        {
          provider: "replicate",
          model: "a/b",
          inputs: { character: { field: "face", kind: "image" } },
          controls: { prompt: { field: "text" } },
        },
      ],
    })
    expect(state.name).toBe("Broken")
    expect(state.id).toBe("Bad Id")
    expect(state.endpoints[0]!.mapping?.inputs.character?.field).toBe("face")
    expect(validateEditor(state)).toContainEqual(
      expect.objectContaining({ where: "family", path: "id" })
    )
  })
})

describe("validateEditor", () => {
  it("flags a control mapped to a field the endpoint does not have", () => {
    let state = withSeedance()
    state = editorReducer(state, {
      type: "setTarget",
      index: 0,
      field: "seed",
      target: { kind: "advanced" },
    })
    // A mapping that names a field the schema lacks (as an import would).
    const bundled = bundledSeedance()
    const bad: ModelFamily = structuredClone(bundled)
    bad.endpoints = [bad.endpoints[0]!]
    bad.endpoints[0]!.controls.seed = { field: "random_seed" }
    let fixed = fromFamily(bad, null)
    fixed = editorReducer(fixed, {
      type: "endpointLoaded",
      index: 0,
      descriptor: seedanceDescriptor(),
      existing: bad.endpoints[0],
    })
    expect(validateEditor(fixed)).toContainEqual(
      expect.objectContaining({
        where: { endpoint: 0, field: "random_seed" },
        path: "endpoints.0.controls.seed",
      })
    )
    expect(validateEditor(state)).toEqual([])
  })

  it("flags an invalid id and a family with no endpoints", () => {
    const state = editorReducer(emptyEditor(), { type: "setId", id: "Bad Id" })
    const paths = validateEditor(state).map((issue) => issue.path)
    expect(paths).toContain("id")
    expect(paths).toContain("name")
    expect(paths).toContain("endpoints")
    expect(validateEditor(state).map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "Give the mapping a name.",
        "Add at least one endpoint.",
      ])
    )
  })

  it("puts a schema problem under the row it is about", () => {
    let state = withSeedance()
    state = editorReducer(state, {
      type: "setTarget",
      index: 0,
      field: "image",
      target: {
        kind: "input",
        key: "first_frame",
        input: { field: "image", kind: "image", max: 3 },
      },
    })
    expect(validateEditor(state)).toContainEqual(
      expect.objectContaining({
        where: { endpoint: 0, field: "image" },
        path: "endpoints.0.inputs.first_frame.max",
      })
    )
  })
})

describe("endpoints", () => {
  it("adds, activates, moves and removes endpoints", () => {
    let state = editorReducer(emptyEditor(), {
      type: "addEndpoint",
      provider: "replicate",
      model: "a/one",
    })
    state = editorReducer(state, {
      type: "addEndpoint",
      provider: "openrouter",
      model: "b/two",
    })
    expect(state.active).toBe(1)
    // Adding one that is already there only switches to it.
    state = editorReducer(state, {
      type: "addEndpoint",
      provider: "replicate",
      model: "a/one",
    })
    expect(state.endpoints).toHaveLength(2)
    expect(state.active).toBe(0)

    state = editorReducer(state, { type: "moveEndpoint", index: 1, to: 0 })
    expect(state.endpoints.map((e) => e.model)).toEqual(["b/two", "a/one"])
    state = editorReducer(state, { type: "removeEndpoint", index: 0 })
    expect(state.endpoints.map((e) => e.model)).toEqual(["a/one"])
    expect(state.active).toBe(0)
  })

  it("records a failed schema load on the endpoint", () => {
    let state = editorReducer(emptyEditor(), {
      type: "addEndpoint",
      provider: "replicate",
      model: "a/one",
    })
    state = editorReducer(state, {
      type: "endpointFailed",
      index: 0,
      message: "404",
    })
    expect(state.endpoints[0]).toMatchObject({ loading: false, error: "404" })
  })
})

describe("renaming an unknown slot key", () => {
  const withInputs = (inputs: Record<string, unknown>) => ({
    id: "x",
    name: "X",
    kind: "video",
    endpoints: [{ provider: "replicate", model: "a/b", inputs, controls: {} }],
  })

  it("takes the first free reference name and never overwrites a valid input", () => {
    const state = fromRaw(
      withInputs({
        "reference:2": { field: "kept", kind: "image" },
        charcter: { field: "renamed", kind: "image" },
      }),
      "x"
    )
    const inputs = state.endpoints[0]!.mapping!.inputs
    expect(inputs["reference:2"]?.field).toBe("kept")
    expect(inputs.reference?.field).toBe("renamed")
  })

  it("leaves an input out, and says so, when every reference name is taken", () => {
    const taken = Object.fromEntries(
      [
        "reference",
        ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `reference:${n}`),
      ].map((key, n) => [key, { field: `f${n}`, kind: "image" }])
    )
    const state = fromRaw(
      withInputs({ ...taken, charcter: { field: "extra", kind: "image" } }),
      "x"
    )
    const inputs = state.endpoints[0]!.mapping!.inputs
    expect(Object.keys(inputs)).not.toContain("reference:10")
    expect(Object.keys(inputs)).toHaveLength(9)
    expect(Object.values(inputs).map((i) => i.field)).not.toContain("extra")
    expect(state.repairs).toContainEqual(
      expect.objectContaining({
        field: "extra",
        blocking: true,
        message: expect.stringMatching(/"charcter" is not a role/),
      })
    )
  })
})

describe("a stored mapping that does not validate", () => {
  const raw = {
    id: "broken",
    name: "Broken",
    kind: "vid",
    endpoints: [
      {
        provider: "replicate",
        model: "bytedance/seedance-2.5",
        inputs: {
          charcter: { field: "reference_images", kind: "image" },
          first_frame: { field: "image", kind: "image" },
        },
        controls: { prompt: { field: "prompt" }, loudness: { field: "seed" } },
      },
      { provider: "fal", model: "x/y", inputs: {}, controls: {} },
    ],
  }

  it("reads an unknown slot key as reference and says so under its row", () => {
    let state = fromRaw(raw, "broken")
    expect(state.endpoints[0]!.mapping?.inputs.reference?.field).toBe(
      "reference_images"
    )
    state = editorReducer(state, {
      type: "endpointLoaded",
      index: 0,
      descriptor: seedanceDescriptor(),
    })
    const issue = validateEditor(state).find(
      (i) =>
        i.where !== "family" &&
        i.where.endpoint === 0 &&
        i.where.field === "reference_images"
    )
    expect(issue?.message).toMatch(/"charcter" is not a role/)

    // Choosing a role for the row settles it.
    state = editorReducer(state, {
      type: "setTarget",
      index: 0,
      field: "reference_images",
      target: {
        kind: "input",
        key: "character",
        input: { field: "reference_images", kind: "image" },
      },
    })
    expect(validateEditor(state).some((i) => /charcter/.test(i.message))).toBe(
      false
    )
  })

  it("notes a control it does not know without blocking", () => {
    const state = fromRaw(raw, "broken")
    expect(endpointNotices(state, 0).map((n) => n.message)).toContainEqual(
      expect.stringMatching(/"loudness" is not a control/)
    )
    expect(validateEditor(state).some((i) => /loudness/.test(i.message))).toBe(
      false
    )
  })

  it("flags an unknown provider instead of reading it as Replicate", () => {
    const state = fromRaw(raw, "broken")
    expect(state.endpoints[1]!.error).toMatch(/"fal" is not a provider/)
    expect(toFamily(state).endpoints[1]!.provider).toBe("fal")
    expect(validateEditor(state)).toContainEqual(
      expect.objectContaining({
        where: { endpoint: 1 },
        path: "endpoints.1.provider",
      })
    )
  })

  it("flags an unknown kind until one is chosen", () => {
    let state = fromRaw(raw, "broken")
    expect(validateEditor(state)).toContainEqual(
      expect.objectContaining({ where: "family", path: "kind" })
    )
    state = editorReducer(state, { type: "setKind", kind: "video" })
    expect(validateEditor(state).some((i) => i.path === "kind")).toBe(false)
  })
})

describe("schemas that fail to load", () => {
  function failed(): EditorState {
    let state = editorReducer(emptyEditor(), {
      type: "addEndpoint",
      provider: "replicate",
      model: "bytedance/seedance-2.5",
    })
    state = editorReducer(state, { type: "setName", name: "X" })
    return editorReducer(state, {
      type: "endpointFailed",
      index: 0,
      message: "404",
    })
  }

  it("will not save a new endpoint that maps nothing", () => {
    expect(validateEditor(failed())).toContainEqual(
      expect.objectContaining({
        where: { endpoint: 0 },
        message: expect.stringMatching(/didn't load/),
      })
    )
  })

  it("keeps an endpoint with an existing mapping as it is", () => {
    const bundled = bundledSeedance()
    let state = fromFamily(
      { ...bundled, endpoints: [bundled.endpoints[0]!] },
      null
    )
    state = editorReducer(state, {
      type: "endpointFailed",
      index: 0,
      message: "offline",
    })
    expect(validateEditor(state)).toEqual([])
  })

  it("retries, and takes a success that lands after the failure", () => {
    let state = editorReducer(failed(), { type: "retryEndpoint", index: 0 })
    expect(state.endpoints[0]).toMatchObject({ loading: true, error: null })

    state = editorReducer(failed(), {
      type: "endpointLoaded",
      index: 0,
      descriptor: seedanceDescriptor(),
    })
    expect(state.endpoints[0]!.rows.length).toBeGreaterThan(0)
  })

  it("loads again under a corrected slug", () => {
    const state = editorReducer(failed(), {
      type: "changeEndpointModel",
      index: 0,
      model: "bytedance/seedance-2.0",
    })
    expect(state.endpoints[0]).toMatchObject({
      model: "bytedance/seedance-2.0",
      loading: true,
      error: null,
    })
  })
})

describe("kind", () => {
  it("flags an endpoint whose model makes another kind", () => {
    let state = withSeedance()
    expect(validateEditor(state)).toEqual([])
    state = editorReducer(state, { type: "setKind", kind: "image" })
    expect(validateEditor(state)).toContainEqual(
      expect.objectContaining({
        where: { endpoint: 0 },
        message: expect.stringMatching(/makes video/),
      })
    )
  })
})

describe("isDirty", () => {
  it("is false until the draft differs from what was opened", () => {
    const bundled = bundledSeedance()
    let state = withBaseline(fromFamily(bundled, "seedance-2-5"))
    expect(isDirty(state)).toBe(false)
    // Loading a schema is not an edit.
    state = editorReducer(state, {
      type: "endpointLoaded",
      index: 0,
      descriptor: seedanceDescriptor(),
    })
    expect(isDirty(state)).toBe(false)
    // Nor is looking at another endpoint.
    state = editorReducer(state, { type: "setActive", index: 1 })
    expect(isDirty(state)).toBe(false)

    state = editorReducer(state, { type: "setName", name: "Other" })
    expect(isDirty(state)).toBe(true)
    state = editorReducer(state, { type: "setName", name: bundled.name })
    expect(isDirty(state)).toBe(false)
  })

  it("pre-filling a new mapping from its model is not an edit", () => {
    let state = withBaseline(
      editorReducer(emptyEditor(), {
        type: "addEndpoint",
        provider: "replicate",
        model: "bytedance/seedance-2.5",
      })
    )
    state = editorReducer(state, {
      type: "endpointLoaded",
      index: 0,
      descriptor: seedanceDescriptor(),
    })
    expect(isDirty(state)).toBe(false)
  })

  it("is clean again once saved", () => {
    let state = withBaseline(withSeedance())
    state = editorReducer(state, { type: "setName", name: "Mine" })
    state = editorReducer(state, {
      type: "saved",
      family: toFamily(state),
      id: state.id,
    })
    expect(isDirty(state)).toBe(false)
    expect(state.replaceId).toBe(state.id)
  })

  it("keeps edits made while a save was in flight as unsaved", () => {
    let state = withBaseline(withSeedance())
    state = editorReducer(state, { type: "setName", name: "Mine" })
    const sent = { family: toFamily(state), id: state.id }
    // The person keeps typing before the save answers.
    state = editorReducer(state, { type: "setId", id: "mine-renamed" })
    state = editorReducer(state, { type: "setName", name: "Mine, later" })
    state = editorReducer(state, { type: "saved", ...sent })

    expect(isDirty(state)).toBe(true)
    // The stored entry is the one sent, so that is what a next save replaces.
    expect(state.replaceId).toBe(sent.id)
    expect(state.id).toBe("mine-renamed")
  })
})

describe("taken ids and undo", () => {
  it("auto-slugs around ids that arrive later", () => {
    let state = editorReducer(emptyEditor(), {
      type: "setTakenIds",
      ids: ["kling"],
    })
    state = editorReducer(state, { type: "setName", name: "Kling" })
    expect(state.id).toBe("kling-2")
  })

  it("undoes a bulk action", () => {
    const before = withSeedance()
    const uid = before.endpoints[0]!.uid
    let state = editorReducer(before, {
      type: "setTarget",
      index: 0,
      field: "image",
      target: { kind: "advanced" },
    })
    state = editorReducer(state, { type: "resetEndpoint", index: 0 })
    expect(keyOf(row(state, "image"))).toBe("first_frame")
    state = editorReducer(state, { type: "undoBulk", uid })
    expect(row(state, "image").target).toEqual({ kind: "advanced" })
  })

  it("does not undo a bulk action once a row was edited after it", () => {
    const before = withSeedance()
    const uid = before.endpoints[0]!.uid
    let state = editorReducer(before, {
      type: "setTarget",
      index: 0,
      field: "image",
      target: { kind: "advanced" },
    })
    state = editorReducer(state, { type: "resetEndpoint", index: 0 })
    // An edit after the bulk action: undo must not throw it away.
    state = editorReducer(state, {
      type: "setTarget",
      index: 0,
      field: "seed",
      target: { kind: "advanced" },
    })
    const edited = state
    state = editorReducer(state, { type: "undoBulk", uid })
    expect(state.endpoints[0]!.rows).toBe(edited.endpoints[0]!.rows)
    expect(state.undo).toBeNull()
  })
})

describe("bulk actions and read-time notes", () => {
  const raw = {
    id: "broken",
    name: "Broken",
    kind: "video",
    endpoints: [
      {
        provider: "replicate",
        model: "bytedance/seedance-2.5",
        inputs: { charcter: { field: "image", kind: "image" } },
        controls: {},
      },
    ],
  }

  function loaded(): EditorState {
    return editorReducer(fromRaw(raw, "broken"), {
      type: "endpointLoaded",
      index: 0,
      descriptor: seedanceDescriptor(),
    })
  }

  const blocksImage = (state: EditorState) =>
    validateEditor(state).some((i) =>
      /"charcter" is not a role/.test(i.message)
    )

  it("settles the note of a row a bulk action gave a suggestion to, and undo brings it back", () => {
    let state = loaded()
    expect(blocksImage(state)).toBe(true)
    expect(row(state, "image").suggestion).not.toBeNull()

    state = editorReducer(state, { type: "applyAllSuggestions", index: 0 })
    expect(blocksImage(state)).toBe(false)

    state = editorReducer(state, {
      type: "undoBulk",
      uid: state.endpoints[0]!.uid,
    })
    expect(blocksImage(state)).toBe(true)
  })
})

describe("inputTarget", () => {
  const required: FieldRow = {
    field: "image",
    schema: { type: "string", format: "uri" },
    isUri: true,
    isArray: false,
    required: true,
    missing: false,
    guess: { kind: "image", max: null },
    target: { kind: "advanced" },
    baseline: { kind: "advanced" },
    suggestion: null,
    touched: false,
  }

  it("starts a new input required when the provider requires the field", () => {
    expect(inputTarget(required, "character")).toMatchObject({
      key: "character",
      input: { field: "image", kind: "image", required: true },
    })
  })

  it("keeps required off when the person turned it off", () => {
    const off: FieldRow = {
      ...required,
      target: {
        kind: "input",
        key: "character",
        input: { field: "image", kind: "image" },
      },
    }
    const next = inputTarget(off, "style")
    expect(next.kind === "input" && next.input.required).toBeFalsy()
  })

  it("keeps the label only while the role stays", () => {
    const labelled: FieldRow = {
      ...required,
      target: {
        kind: "input",
        key: "character",
        input: { field: "image", kind: "image", label: "Face" },
      },
    }
    const same = inputTarget(labelled, "character")
    const other = inputTarget(labelled, "style")
    expect(same.kind === "input" && same.input.label).toBe("Face")
    expect(other.kind === "input" && other.input.label).toBeFalsy()
  })
})
