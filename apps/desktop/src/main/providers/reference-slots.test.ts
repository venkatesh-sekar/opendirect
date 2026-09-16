import { describe, expect, it } from "vitest"

import { deriveReferenceSlots } from "./reference-slots"

const schema = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
})

const uri = (extra: Record<string, unknown> = {}) => ({
  type: "string",
  format: "uri",
  ...extra,
})

const uriArray = (extra: Record<string, unknown> = {}) => ({
  type: "array",
  items: { type: "string", format: "uri" },
  ...extra,
})

describe("deriveReferenceSlots", () => {
  it("returns no slots for a schema without URI fields", () => {
    expect(
      deriveReferenceSlots(
        schema({
          prompt: { type: "string", title: "Prompt" },
          seed: { type: "integer" },
        })
      )
    ).toEqual([])
  })

  it("treats a single URI string as a non-multiple slot", () => {
    const [slot] = deriveReferenceSlots(
      schema({ image: uri({ title: "Image" }) })
    )
    expect(slot).toMatchObject({
      field: "image",
      label: "Image",
      kind: "image",
      multiple: false,
      max: null,
      role: "reference",
    })
  })

  it("treats an array of URI strings as a multiple slot", () => {
    const [slot] = deriveReferenceSlots(
      schema({ reference_images: uriArray({ title: "Reference Images" }) })
    )
    expect(slot).toMatchObject({
      field: "reference_images",
      kind: "image",
      multiple: true,
      role: "reference",
    })
  })

  it.each([
    ["first_frame", "first_frame"],
    ["first_frame_image", "first_frame"],
    ["start_image", "first_frame"],
    ["start_frame", "first_frame"],
    ["last_frame", "last_frame"],
    ["last_frame_image", "last_frame"],
    ["end_image", "last_frame"],
    ["end_frame", "last_frame"],
    ["motion_reference", "motion"],
    ["camera_video", "motion"],
    ["video", "source"],
    ["input_video", "source"],
    ["source_video", "source"],
    ["subject_video", "source"],
    ["reference_images", "reference"],
    ["ref_image", "reference"],
    ["reference_videos", "reference"],
    ["reference_audios", "reference"],
    ["image", "reference"],
    ["images", "reference"],
    ["input_image", "reference"],
    ["image_input", "reference"],
    ["subject_image", "reference"],
  ])("maps %s to the %s role", (field, role) => {
    const [slot] = deriveReferenceSlots(schema({ [field]: uri() }))
    expect(slot?.role).toBe(role)
  })

  it("keeps an unrecognised URI field as a slot with an unknown role", () => {
    const [slot] = deriveReferenceSlots(schema({ weird_ref_thing: uri() }))
    expect(slot).toMatchObject({
      field: "weird_ref_thing",
      label: "Weird Ref Thing",
      kind: "any",
      role: "unknown",
    })
  })

  it("infers the asset kind from the field name", () => {
    const slots = deriveReferenceSlots(
      schema({
        reference_images: uriArray(),
        reference_videos: uriArray(),
        reference_audios: uriArray(),
        weird_ref_thing: uri(),
      })
    )
    expect(slots.map((slot) => slot.kind)).toEqual([
      "image",
      "video",
      "audio",
      "any",
    ])
  })

  it("infers the asset kind from the description when the name is silent", () => {
    const [slot] = deriveReferenceSlots(
      schema({
        backdrop: uri({
          description: "A reference video used as the backdrop.",
        }),
      })
    )
    expect(slot?.kind).toBe("video")
  })

  it("takes max from maxItems", () => {
    const [slot] = deriveReferenceSlots(
      schema({ reference_images: uriArray({ maxItems: 4 }) })
    )
    expect(slot?.max).toBe(4)
  })

  it("falls back to an 'up to N' count stated in the description", () => {
    const [slot] = deriveReferenceSlots(
      schema({
        reference_images: uriArray({
          description: "Reference images (up to 30) for character consistency.",
        }),
      })
    )
    expect(slot?.max).toBe(30)
  })

  it("leaves max null when nothing states a bound", () => {
    const [slot] = deriveReferenceSlots(
      schema({ reference_images: uriArray() })
    )
    expect(slot?.max).toBeNull()
  })

  it("ignores a URI field the schema marks as an output-only format", () => {
    expect(
      deriveReferenceSlots(schema({ prompt: { type: "string" } }))
    ).toEqual([])
  })

  it("survives a schema with no properties at all", () => {
    expect(deriveReferenceSlots({ type: "object" })).toEqual([])
    expect(deriveReferenceSlots(undefined)).toEqual([])
  })
})
