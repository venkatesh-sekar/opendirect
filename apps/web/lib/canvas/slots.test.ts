import type { CanvasEdgeDto, CanvasNodeDto } from "@opendirect/contract"
import { describe, expect, it } from "vitest"

import {
  availableSlots,
  familyAvailability,
  filledSlotKeys,
  modelOptionsForNode,
} from "./slots"
import { seedanceFamilyDescriptor } from "./test-family"

function edge(over: Partial<CanvasEdgeDto> & { id: string }): CanvasEdgeDto {
  return {
    projectId: "p1",
    sourceNodeId: "src",
    targetNodeId: "target",
    slotField: null,
    createdAt: 1,
    ...over,
  }
}

const TARGET = {
  id: "target",
  providerOverride: "openrouter",
} as CanvasNodeDto

describe("filledSlotKeys / modelOptionsForNode", () => {
  const edges = [
    edge({ id: "e1", slotField: "reference" }),
    edge({ id: "e2", slotField: "first_frame" }),
    edge({ id: "e3", slotField: "reference" }),
    // A text edge carries no slot.
    edge({ id: "e4", slotField: null }),
    // Another node's edge.
    edge({ id: "e5", targetNodeId: "other", slotField: "mask" }),
  ]

  it("is the sorted distinct slots of the node's incoming edges", () => {
    expect(filledSlotKeys("target", edges)).toEqual([
      "first_frame",
      "reference",
    ])
  })

  it("adds slots filled another way, such as by a mention", () => {
    expect(filledSlotKeys("target", edges, ["character", "reference"])).toEqual(
      ["character", "first_frame", "reference"]
    )
  })

  it("carries the node's provider override", () => {
    expect(modelOptionsForNode(TARGET, edges)).toEqual({
      provider: "openrouter",
      filled: ["first_frame", "reference"],
    })
    expect(
      modelOptionsForNode({ ...TARGET, providerOverride: null }, [])
    ).toEqual({ provider: null, filled: [] })
  })
})

describe("familyAvailability", () => {
  it("is undefined for a concrete model", () => {
    const descriptor = { ...seedanceFamilyDescriptor(), family: null }
    expect(familyAvailability(descriptor, [])).toBeUndefined()
    expect(familyAvailability(undefined, [])).toBeUndefined()
  })

  it("rules out a slot the overridden provider has no field for", () => {
    const descriptor = seedanceFamilyDescriptor({ override: "openrouter" })
    const availability = familyAvailability(descriptor, [])!
    expect(availability.first_frame).toEqual({ available: true, reason: null })
    expect(availability.soundtrack).toEqual({
      available: false,
      reason: "Not available on OpenRouter",
    })
  })

  it("judges a filled slot against the other filled slots, not itself", () => {
    // Filled on Replicate, then moved to OpenRouter: the wire is still there
    // and it is the wire the run cannot take.
    const descriptor = seedanceFamilyDescriptor({
      override: "openrouter",
      filled: ["reference", "reference:2"],
    })
    const availability = familyAvailability(descriptor, [
      "reference",
      "reference:2",
    ])!
    expect(availability.reference).toEqual({ available: true, reason: null })
    expect(availability["reference:2"]).toEqual({
      available: false,
      reason: "Not available on OpenRouter",
    })
  })

  it("leaves only the available slots for a new edge", () => {
    const descriptor = seedanceFamilyDescriptor({ override: "openrouter" })
    expect(availableSlots(descriptor, []).map((slot) => slot.field)).toEqual([
      "first_frame",
      "last_frame",
      "reference",
    ])
    // A concrete model's slots are all offered.
    const concrete = { ...descriptor, family: null }
    expect(availableSlots(concrete, [])).toBe(concrete.referenceSlots)
  })
})
