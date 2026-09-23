import type { ReferenceSlot } from "@opendirect/contract"
import { describe, expect, it } from "vitest"

import {
  acceptsKind,
  candidateSlots,
  planReferenceDrop,
  referenceLimitMessage,
  remainingCapacity,
  slotCapacity,
  type IncomingReference,
} from "./references"

function slot(overrides: Partial<ReferenceSlot> = {}): ReferenceSlot {
  return {
    field: "reference_images",
    label: "Reference Images",
    kind: "image",
    multiple: true,
    max: 3,
    role: "reference",
    verified: false,
    required: false,
    shape: null,
    ...overrides,
  }
}

function incoming(...ids: string[]): IncomingReference[] {
  return ids.map((assetId) => ({ assetId, kind: "image" as const }))
}

describe("slotCapacity", () => {
  it("is one for a single-value slot, whatever max says", () => {
    expect(slotCapacity(slot({ multiple: false, max: 9 }))).toBe(1)
  })

  it("is the stated max for a list slot", () => {
    expect(slotCapacity(slot({ max: 12 }))).toBe(12)
  })

  it("is unbounded when the model states no maximum", () => {
    expect(slotCapacity(slot({ max: null }))).toBeNull()
  })
})

describe("remainingCapacity", () => {
  it("counts down from the slot's limit", () => {
    expect(remainingCapacity(slot({ max: 3 }), ["a"])).toBe(2)
  })

  it("never goes below zero", () => {
    expect(remainingCapacity(slot({ max: 1 }), ["a", "b"])).toBe(0)
  })

  it("is null when the slot is unbounded", () => {
    expect(remainingCapacity(slot({ max: null }), ["a"])).toBeNull()
  })
})

describe("acceptsKind", () => {
  it("matches a slot to its own media kind", () => {
    expect(acceptsKind(slot({ kind: "image" }), "image")).toBe(true)
    expect(acceptsKind(slot({ kind: "image" }), "video")).toBe(false)
  })

  it("lets an 'any' slot take anything", () => {
    expect(acceptsKind(slot({ kind: "any" }), "audio")).toBe(true)
  })

  it("never offers a text asset to a media slot", () => {
    expect(acceptsKind(slot({ kind: "any" }), "text")).toBe(false)
  })
})

describe("candidateSlots", () => {
  const slots = [
    slot(),
    slot({
      field: "reference_videos",
      kind: "video",
      label: "Reference Videos",
    }),
    slot({
      field: "last_frame_image",
      kind: "image",
      multiple: false,
      max: null,
      label: "Last Frame Image",
    }),
  ]

  it("keeps the slots that accept every incoming asset, in schema order", () => {
    expect(
      candidateSlots(slots, incoming("a", "b")).map((s) => s.field)
    ).toEqual(["reference_images", "last_frame_image"])
  })

  it("is empty when nothing accepts the assets", () => {
    expect(
      candidateSlots(slots, [{ assetId: "a", kind: "audio" }])
    ).toHaveLength(0)
  })
})

describe("planReferenceDrop", () => {
  const slots = [slot()]

  it("accepts a drop that fits", () => {
    expect(
      planReferenceDrop({ slots, current: {}, incoming: incoming("a", "b") })
    ).toEqual({
      outcome: "accept",
      slotField: "reference_images",
      assetIds: ["a", "b"],
    })
  })

  it("appends to what the slot already holds", () => {
    expect(
      planReferenceDrop({
        slots,
        current: { reference_images: ["a"] },
        incoming: incoming("b"),
      })
    ).toEqual({
      outcome: "accept",
      slotField: "reference_images",
      assetIds: ["a", "b"],
    })
  })

  it("ignores an asset the slot already holds", () => {
    expect(
      planReferenceDrop({
        slots,
        current: { reference_images: ["a"] },
        incoming: incoming("a"),
      })
    ).toEqual({
      outcome: "accept",
      slotField: "reference_images",
      assetIds: ["a"],
    })
  })

  /** The product rule: over the limit is a question, never an auto-pick. */
  it("asks rather than choosing when a container is larger than the limit", () => {
    const plan = planReferenceDrop({
      slots: [slot({ max: 12 })],
      current: {},
      incoming: incoming(...Array.from({ length: 100 }, (_, i) => `a${i}`)),
      sourceLabel: "Venkatesh",
    })

    expect(plan).toMatchObject({
      outcome: "choose",
      slotField: "reference_images",
      capacity: 12,
      sourceLabel: "Venkatesh",
    })
    expect(plan.outcome === "choose" && plan.candidateIds).toHaveLength(100)
    expect(plan.outcome === "choose" && plan.preselectedIds).toEqual([])
  })

  it("asks when the drop only just overflows an already-filled slot", () => {
    const plan = planReferenceDrop({
      slots: [slot({ max: 3 })],
      current: { reference_images: ["a", "b"] },
      incoming: incoming("c", "d"),
    })

    expect(plan.outcome).toBe("choose")
    expect(plan.outcome === "choose" && plan.candidateIds).toEqual([
      "a",
      "b",
      "c",
      "d",
    ])
    expect(plan.outcome === "choose" && plan.preselectedIds).toEqual(["a", "b"])
  })

  it("replaces the value of a single-asset slot", () => {
    expect(
      planReferenceDrop({
        slots: [slot({ field: "image", multiple: false, max: null })],
        current: { image: ["a"] },
        incoming: incoming("b"),
      })
    ).toEqual({ outcome: "accept", slotField: "image", assetIds: ["b"] })
  })

  it("asks when several assets are dropped on a single-asset slot", () => {
    const plan = planReferenceDrop({
      slots: [slot({ field: "image", multiple: false, max: null })],
      current: {},
      incoming: incoming("a", "b"),
    })
    expect(plan).toMatchObject({ outcome: "choose", capacity: 1 })
  })

  it("takes everything when the model states no maximum", () => {
    const plan = planReferenceDrop({
      slots: [slot({ max: null })],
      current: {},
      incoming: incoming("a", "b", "c", "d", "e"),
    })
    expect(plan).toEqual({
      outcome: "accept",
      slotField: "reference_images",
      assetIds: ["a", "b", "c", "d", "e"],
    })
  })

  it("routes a video onto the video slot rather than the first one", () => {
    const plan = planReferenceDrop({
      slots: [
        slot(),
        slot({ field: "reference_videos", kind: "video", max: 2 }),
      ],
      current: {},
      incoming: [{ assetId: "v", kind: "video" }],
    })
    expect(plan).toMatchObject({ slotField: "reference_videos" })
  })

  it("honours an explicitly chosen slot over the kind match", () => {
    const plan = planReferenceDrop({
      slots: [slot({ kind: "any" }), slot({ field: "image", kind: "any" })],
      current: {},
      incoming: incoming("a"),
      slotField: "image",
    })
    expect(plan).toMatchObject({ slotField: "image" })
  })

  it("refuses a drop the model has no slot for", () => {
    expect(
      planReferenceDrop({
        slots: [slot({ kind: "image" })],
        current: {},
        incoming: [{ assetId: "v", kind: "video" }],
      })
    ).toEqual({ outcome: "unsupported" })
  })

  it("refuses a drop on a model with no reference slots at all", () => {
    expect(
      planReferenceDrop({ slots: [], current: {}, incoming: incoming("a") })
    ).toEqual({ outcome: "unsupported" })
  })

  it("refuses an empty drop", () => {
    expect(planReferenceDrop({ slots, current: {}, incoming: [] })).toEqual({
      outcome: "unsupported",
    })
  })
})

describe("referenceLimitMessage", () => {
  it("names the source, the count and the model's limit", () => {
    expect(
      referenceLimitMessage({
        sourceLabel: "Venkatesh",
        total: 100,
        capacity: 12,
      })
    ).toBe("Venkatesh — 100 assets. This model supports 12 references.")
  })

  it("drops the source when the drop did not come from one", () => {
    expect(
      referenceLimitMessage({ sourceLabel: null, total: 4, capacity: 1 })
    ).toBe("4 assets. This model supports 1 reference.")
  })
})
