/**
 * The heart of the mentions feature.
 *
 * Every model here is a **literal JSON Schema** run through the same
 * `deriveReferenceSlots` the providers use, so these are the slots a real
 * model would present — without a network, a provider or a key.
 *
 * ⛔ Nothing in this file reaches a provider, and nothing it produces is
 * submitted. `resolveMentions` is a pure function of its arguments.
 */
import type { MentionSubjectDto, ReferenceSlot } from "@opendirect/contract"
import { describe, expect, it } from "vitest"

import { deriveReferenceSlots } from "../../../desktop/src/main/providers/reference-slots"
import { countBySlot, resolveMentions } from "./resolve"

/** A model with a `reference_images` array, up to four. */
const MULTI_IMAGE: ReferenceSlot[] = deriveReferenceSlots({
  type: "object",
  properties: {
    prompt: { type: "string" },
    reference_images: {
      type: "array",
      items: { type: "string", format: "uri" },
      maxItems: 4,
      title: "Reference Images",
    },
  },
})

/** A model with exactly one image input. */
const SINGLE_IMAGE: ReferenceSlot[] = deriveReferenceSlots({
  type: "object",
  properties: {
    prompt: { type: "string" },
    image: { type: "string", format: "uri" },
  },
})

/** Text only — no asset-shaped input at all. */
const TEXT_ONLY: ReferenceSlot[] = deriveReferenceSlots({
  type: "object",
  properties: { prompt: { type: "string" }, seed: { type: "integer" } },
})

/** A video model whose only image input is the first frame. */
const FIRST_FRAME_ONLY: ReferenceSlot[] = deriveReferenceSlots({
  type: "object",
  properties: {
    prompt: { type: "string" },
    first_frame: { type: "string", format: "uri" },
    last_frame: { type: "string", format: "uri" },
    motion_reference: { type: "string", format: "uri" },
  },
})

/** Frames *and* a reference array, which is where the preference shows. */
const FRAMES_AND_REFERENCES: ReferenceSlot[] = deriveReferenceSlots({
  type: "object",
  properties: {
    prompt: { type: "string" },
    first_frame: { type: "string", format: "uri" },
    reference_images: {
      type: "array",
      items: { type: "string", format: "uri" },
      maxItems: 3,
    },
  },
})

function subject(
  over: Partial<MentionSubjectDto> & Pick<MentionSubjectDto, "handle">
): MentionSubjectDto {
  return {
    containerId: `c-${over.handle}`,
    kind: "character",
    name: "Venkz",
    description: null,
    images: [{ assetId: "a1", label: "Character Sheet", thumbnailUrl: null }],
    ...over,
  }
}

const VENKZ = subject({ handle: "venkz", name: "Venkz" })
const LOBBY = subject({
  handle: "lobby",
  kind: "scene",
  name: "The Hotel Lobby",
  description: "a marble lobby at night",
  images: [{ assetId: "a9", label: null, thumbnailUrl: null }],
})

describe("deriveReferenceSlots fixtures", () => {
  it("are the slots a real model would present", () => {
    expect(MULTI_IMAGE).toEqual([
      {
        field: "reference_images",
        label: "Reference Images",
        kind: "image",
        multiple: true,
        max: 4,
        role: "reference",
      },
    ])
    expect(TEXT_ONLY).toEqual([])
    expect(FIRST_FRAME_ONLY.map((slot) => slot.role)).toEqual([
      "first_frame",
      "last_frame",
      "motion",
    ])
  })
})

describe("resolveMentions — attaching an image", () => {
  it("attaches to a multi-image slot and names the position", () => {
    const result = resolveMentions({
      prompt: "a wide shot of @venkz, smiling",
      subjects: [VENKZ],
      slots: MULTI_IMAGE,
      occupied: {},
    })

    expect(result.references).toEqual([
      { slotField: "reference_images", assetId: "a1", position: 0 },
    ])
    // One image in the whole request, so the number is dropped.
    expect(result.prompt).toBe(
      "a wide shot of Venkz (the person in the reference image), smiling"
    )
    expect(result.outcomes).toEqual([
      {
        kind: "image",
        handle: "venkz",
        containerId: "c-venkz",
        slotField: "reference_images",
        assetIds: ["a1"],
        // The preview the tray shows, in the same order as `assetIds`.
        thumbnailUrls: [null],
        substitution: "Venkz (the person in the reference image)",
      },
    ])
  })

  it("attaches to a single-value image slot", () => {
    const result = resolveMentions({
      prompt: "@venkz on a balcony",
      subjects: [VENKZ],
      slots: SINGLE_IMAGE,
      occupied: {},
    })
    expect(result.references).toEqual([
      { slotField: "image", assetId: "a1", position: 0 },
    ])
    expect(result.prompt).toBe(
      "Venkz (the person in the reference image) on a balcony"
    )
  })

  it("numbers a scene and a character in the order they are sent", () => {
    const result = resolveMentions({
      prompt: "@venkz walks into @lobby",
      subjects: [VENKZ, LOBBY],
      slots: MULTI_IMAGE,
      occupied: {},
    })
    expect(result.references).toEqual([
      { slotField: "reference_images", assetId: "a1", position: 0 },
      { slotField: "reference_images", assetId: "a9", position: 1 },
    ])
    expect(result.prompt).toBe(
      "Venkz (the person in reference image 1) walks into " +
        "The Hotel Lobby (the location in reference image 2)"
    )
  })

  it("counts the edges' own images when it numbers its own", () => {
    const result = resolveMentions({
      prompt: "@venkz again",
      subjects: [VENKZ],
      slots: MULTI_IMAGE,
      // The user wired one image into the slot themselves.
      occupied: { reference_images: 1 },
    })
    expect(result.references).toEqual([
      { slotField: "reference_images", assetId: "a1", position: 1 },
    ])
    expect(result.prompt).toBe("Venkz (the person in reference image 2) again")
  })

  it("attaches once and substitutes twice for a repeated handle", () => {
    const result = resolveMentions({
      prompt: "@venkz looks at @venkz",
      subjects: [VENKZ],
      slots: MULTI_IMAGE,
      occupied: {},
    })
    expect(result.references).toHaveLength(1)
    expect(result.outcomes).toHaveLength(1)
    expect(result.prompt).toBe(
      "Venkz (the person in the reference image) looks at " +
        "Venkz (the person in the reference image)"
    )
  })

  it("takes several views of one character when asked and allowed", () => {
    const threeViews = subject({
      handle: "venkz",
      images: [
        { assetId: "a1", label: "Character Sheet", thumbnailUrl: null },
        { assetId: "a2", label: null, thumbnailUrl: null },
        { assetId: "a3", label: null, thumbnailUrl: null },
      ],
    })
    const result = resolveMentions({
      prompt: "@venkz",
      subjects: [threeViews],
      slots: MULTI_IMAGE,
      occupied: {},
      perSubject: 2,
    })
    expect(result.references.map((ref) => ref.assetId)).toEqual(["a1", "a2"])
    expect(result.prompt).toBe("Venkz (the person in reference images 1 and 2)")
  })

  it("never takes more than the model said it accepts", () => {
    const many = subject({
      handle: "venkz",
      images: [
        { assetId: "a1", label: null, thumbnailUrl: null },
        { assetId: "a2", label: null, thumbnailUrl: null },
        { assetId: "a3", label: null, thumbnailUrl: null },
      ],
    })
    const result = resolveMentions({
      prompt: "@venkz",
      subjects: [many],
      slots: SINGLE_IMAGE,
      occupied: {},
      perSubject: 3,
    })
    expect(result.references).toHaveLength(1)
  })
})

describe("resolveMentions — downgrading to prose", () => {
  it("writes the description when the model has no image input", () => {
    const described = subject({
      handle: "venkz",
      description: "a tall man in a grey suit",
    })
    const result = resolveMentions({
      prompt: "a wide shot of @venkz",
      subjects: [described],
      slots: TEXT_ONLY,
      occupied: {},
    })
    expect(result.references).toEqual([])
    expect(result.prompt).toBe("a wide shot of a tall man in a grey suit")
    expect(result.outcomes).toEqual([
      {
        kind: "text",
        handle: "venkz",
        containerId: "c-venkz",
        reason: "no-image-slot",
        substitution: "a tall man in a grey suit",
      },
    ])
  })

  it("falls back to the bare name when there is no description", () => {
    const result = resolveMentions({
      prompt: "@venkz on a balcony",
      subjects: [subject({ handle: "venkz", images: [] })],
      slots: MULTI_IMAGE,
      occupied: {},
    })
    expect(result.prompt).toBe("Venkz on a balcony")
    expect(result.outcomes[0]).toMatchObject({
      kind: "text",
      reason: "no-images",
    })
  })

  it("says so when the edges have already filled the slots", () => {
    const result = resolveMentions({
      prompt: "@venkz",
      subjects: [VENKZ],
      slots: SINGLE_IMAGE,
      // ⛔ The edge the user drew wins: it is an explicit gesture.
      occupied: { image: 1 },
    })
    expect(result.references).toEqual([])
    expect(result.outcomes[0]).toMatchObject({
      kind: "text",
      reason: "slots-full",
      substitution: "Venkz",
    })
  })

  it("downgrades the second mention when only one slot is free", () => {
    const result = resolveMentions({
      prompt: "@venkz meets @lobby",
      subjects: [VENKZ, LOBBY],
      slots: SINGLE_IMAGE,
      occupied: {},
    })
    expect(result.references).toEqual([
      { slotField: "image", assetId: "a1", position: 0 },
    ])
    expect(result.outcomes.map((o) => o.kind)).toEqual(["image", "text"])
    expect(result.prompt).toBe(
      "Venkz (the person in the reference image) meets a marble lobby at night"
    )
  })

  it("never hijacks a frame or motion slot", () => {
    // ⛔ Quietly making a character sheet the first frame of a video would be
    // a paid surprise. It downgrades instead.
    const result = resolveMentions({
      prompt: "@venkz running",
      subjects: [VENKZ],
      slots: FIRST_FRAME_ONLY,
      occupied: {},
    })
    expect(result.references).toEqual([])
    expect(result.outcomes[0]).toMatchObject({
      kind: "text",
      reason: "no-image-slot",
    })
  })

  it("takes the reference slot and leaves the first frame alone", () => {
    const result = resolveMentions({
      prompt: "@venkz running",
      subjects: [VENKZ],
      slots: FRAMES_AND_REFERENCES,
      occupied: {},
    })
    expect(result.references).toEqual([
      { slotField: "reference_images", assetId: "a1", position: 0 },
    ])
  })

  it("numbers around an image an edge put in a frame slot", () => {
    const result = resolveMentions({
      prompt: "@venkz running",
      subjects: [VENKZ],
      slots: FRAMES_AND_REFERENCES,
      occupied: { first_frame: 1 },
    })
    // The frame image is sent first, so the mention is image 2.
    expect(result.prompt).toBe(
      "Venkz (the person in reference image 2) running"
    )
  })
})

describe("resolveMentions — an unknown handle", () => {
  it("leaves it in the prompt, character for character", () => {
    const result = resolveMentions({
      prompt: "a shot of @nobody, smiling",
      subjects: [VENKZ],
      slots: MULTI_IMAGE,
      occupied: {},
    })
    // ⛔ Never deleted and never fuzzy-matched to a near neighbour.
    expect(result.prompt).toBe("a shot of @nobody, smiling")
    expect(result.references).toEqual([])
    expect(result.outcomes).toEqual([{ kind: "unresolved", handle: "nobody" }])
  })

  it("does not stop the mentions around it from resolving", () => {
    const result = resolveMentions({
      prompt: "@nobody and @venkz",
      subjects: [VENKZ],
      slots: MULTI_IMAGE,
      occupied: {},
    })
    expect(result.prompt).toBe(
      "@nobody and Venkz (the person in the reference image)"
    )
    expect(result.outcomes.map((o) => o.kind)).toEqual(["unresolved", "image"])
  })
})

describe("resolveMentions — the prompt it hands back", () => {
  it("is the prompt itself when there is no mention in it", () => {
    const result = resolveMentions({
      prompt: "a wide shot of a lobby",
      subjects: [VENKZ],
      slots: MULTI_IMAGE,
      occupied: {},
    })
    expect(result).toEqual({
      prompt: "a wide shot of a lobby",
      references: [],
      outcomes: [],
    })
  })

  it("touches nothing but the mention itself", () => {
    const result = resolveMentions({
      prompt: "  line one\n\n(@venkz)  ",
      subjects: [subject({ handle: "venkz", images: [] })],
      slots: TEXT_ONLY,
      occupied: {},
    })
    expect(result.prompt).toBe("  line one\n\n(Venkz)  ")
  })

  it("does not read an email address as a mention", () => {
    const result = resolveMentions({
      prompt: "credit venkz@example.com",
      subjects: [VENKZ],
      slots: MULTI_IMAGE,
      occupied: {},
    })
    expect(result.prompt).toBe("credit venkz@example.com")
    expect(result.outcomes).toEqual([])
  })

  it("is a pure function — the same input twice gives the same answer", () => {
    const input = {
      prompt: "@venkz and @lobby",
      subjects: [VENKZ, LOBBY],
      slots: MULTI_IMAGE,
      occupied: {},
    }
    expect(resolveMentions(input)).toEqual(resolveMentions(input))
  })
})

describe("countBySlot", () => {
  it("counts the edge-derived references per slot", () => {
    expect(
      countBySlot([
        { slotField: "reference_images", assetId: "a1", position: 0 },
        { slotField: "reference_images", assetId: "a2", position: 1 },
        { slotField: "first_frame", assetId: "a3", position: 0 },
      ])
    ).toEqual({ reference_images: 2, first_frame: 1 })
  })

  it("is an empty tally for no references at all", () => {
    expect(countBySlot([])).toEqual({})
  })
})
