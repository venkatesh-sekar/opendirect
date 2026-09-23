import { describe, expect, it } from "vitest"

import {
  ROLE_LABELS,
  candidateProviders,
  chooseEndpoint,
  endpointKey,
  familySlots,
  slotAvailability,
  type ChoiceInput,
} from "./resolve"
import { modelFamilySchema, type ModelFamily } from "./schema"

/** The bundled seedance-2-5 family, copied in as a literal. */
const seedance: ModelFamily = modelFamilySchema.parse({
  id: "seedance-2-5",
  name: "Seedance 2.5",
  kind: "video",
  endpoints: [
    {
      provider: "replicate",
      model: "bytedance/seedance-2.5",
      inputs: {
        first_frame: { field: "image", kind: "image", label: "First frame" },
        last_frame: { field: "last_frame_image", kind: "image" },
        reference: {
          field: "reference_images",
          kind: "image",
          max: 30,
          label: "Reference images",
        },
        "reference:2": {
          field: "reference_videos",
          kind: "video",
          max: 10,
          label: "Reference videos",
        },
        soundtrack: { field: "reference_audios", kind: "audio", max: 10 },
      },
      controls: {
        prompt: { field: "prompt" },
        aspect_ratio: { field: "aspect_ratio" },
        duration: { field: "duration" },
        resolution: { field: "resolution" },
        seed: { field: "seed" },
        generate_audio: { field: "generate_audio" },
      },
    },
    {
      provider: "openrouter",
      model: "bytedance/seedance-2.5",
      inputs: {
        first_frame: { field: "first_frame", kind: "image" },
        last_frame: { field: "last_frame", kind: "image" },
        reference: { field: "input_references", kind: "any" },
      },
      controls: {
        prompt: { field: "prompt" },
        duration: { field: "duration" },
      },
    },
  ],
})

function input(patch: Partial<ChoiceInput> = {}): ChoiceInput {
  return {
    filled: [],
    providerOrder: ["replicate", "openrouter"],
    configured: ["replicate", "openrouter"],
    override: null,
    ...patch,
  }
}

/** Two Replicate endpoints: only A has last_frame, only B has character. */
const twoEndpoints: ModelFamily = modelFamilySchema.parse({
  id: "two",
  name: "Two",
  kind: "video",
  endpoints: [
    {
      provider: "replicate",
      model: "acme/a",
      inputs: {
        first_frame: { field: "start", kind: "image", required: true },
        last_frame: { field: "end", kind: "image" },
      },
    },
    {
      provider: "replicate",
      model: "acme/b",
      inputs: {
        first_frame: { field: "image", kind: "image" },
        character: { field: "subject", kind: "image", max: 4 },
      },
    },
  ],
})

describe("endpointKey", () => {
  it("joins provider and model like a catalog key", () => {
    expect(endpointKey(seedance.endpoints[1]!)).toBe(
      "openrouter:bytedance/seedance-2.5"
    )
  })
})

describe("candidateProviders", () => {
  it("follows the order, filtered to configured providers", () => {
    expect(candidateProviders(seedance, input())).toEqual([
      "replicate",
      "openrouter",
    ])
    expect(
      candidateProviders(seedance, input({ providerOrder: ["openrouter"] }))
    ).toEqual(["openrouter", "replicate"])
    expect(
      candidateProviders(seedance, input({ configured: ["openrouter"] }))
    ).toEqual(["openrouter"])
  })

  it("appends configured providers missing from the order, in enum order", () => {
    expect(candidateProviders(seedance, input({ providerOrder: [] }))).toEqual([
      "replicate",
      "openrouter",
    ])
  })

  it("keeps only providers the family has an endpoint on", () => {
    expect(candidateProviders(twoEndpoints, input())).toEqual(["replicate"])
  })

  it("uses the override alone, even when it is not configured", () => {
    expect(
      candidateProviders(
        seedance,
        input({ override: "openrouter", configured: ["replicate"] })
      )
    ).toEqual(["openrouter"])
  })
})

describe("chooseEndpoint", () => {
  it("picks the first endpoint of the first provider when nothing is filled", () => {
    const choice = chooseEndpoint(seedance, input())
    expect(choice).toMatchObject({ ok: true, index: 0, missing: [] })
  })

  it("follows the provider order", () => {
    const choice = chooseEndpoint(
      seedance,
      input({ providerOrder: ["openrouter", "replicate"] })
    )
    expect(choice).toMatchObject({ ok: true, index: 1 })
  })

  it("moves to the next provider when the first cannot take the filled keys", () => {
    const choice = chooseEndpoint(
      seedance,
      input({ providerOrder: ["openrouter"], filled: ["soundtrack"] })
    )
    expect(choice).toMatchObject({ ok: true, index: 0 })
  })

  it("names the unsupported input when no configured provider takes it", () => {
    const choice = chooseEndpoint(
      seedance,
      input({ configured: ["openrouter"], filled: ["reference:2"] })
    )
    expect(choice.ok).toBe(false)
    if (choice.ok) return
    expect(choice.index).toBe(1)
    expect(choice.unsupported).toEqual(["reference:2"])
    expect(choice.message).toBe(
      "Seedance 2.5 has no endpoint on OpenRouter that takes Reference videos."
    )
  })

  it("names every filled input when the combination is what fails", () => {
    const choice = chooseEndpoint(
      twoEndpoints,
      input({ filled: ["last_frame", "character"] })
    )
    expect(choice.ok).toBe(false)
    if (choice.ok) return
    expect(choice.index).toBe(0)
    expect(choice.unsupported).toEqual(["last_frame", "character"])
    expect(choice.message).toBe(
      "Two has no endpoint on Replicate that takes Last frame and Character together."
    )
  })

  it("does not read an inherited property as an input", () => {
    const choice = chooseEndpoint(seedance, input({ filled: ["constructor"] }))
    expect(choice.ok).toBe(false)
    if (!choice.ok) expect(choice.unsupported).toEqual(["constructor"])
  })

  it("prefers an endpoint whose required inputs are filled", () => {
    // A requires first_frame; B requires nothing — with nothing filled, B.
    const choice = chooseEndpoint(twoEndpoints, input())
    expect(choice).toMatchObject({ ok: true, index: 1, missing: [] })
  })

  it("falls back to an endpoint that covers the filled keys, reporting what is missing", () => {
    const choice = chooseEndpoint(
      twoEndpoints,
      input({ filled: ["last_frame"] })
    )
    expect(choice).toMatchObject({
      ok: true,
      index: 0,
      missing: ["first_frame"],
    })
  })

  it("tells the user to add a key when the override is not configured", () => {
    const choice = chooseEndpoint(
      seedance,
      input({ override: "openrouter", configured: ["replicate"] })
    )
    expect(choice.ok).toBe(false)
    if (choice.ok) return
    expect(choice.message).toBe(
      "Add an OpenRouter key in Settings to run Seedance 2.5 on OpenRouter."
    )
    // The form can still render against that provider's endpoint.
    expect(choice.index).toBe(1)
  })

  it("says so when the override provider has no endpoint", () => {
    const choice = chooseEndpoint(
      twoEndpoints,
      input({ override: "openrouter" })
    )
    expect(choice).toMatchObject({ ok: false, index: null })
    if (choice.ok) return
    expect(choice.message).toBe("Two has no endpoint on OpenRouter.")
  })

  it("asks for a key when no configured provider can run the family", () => {
    const choice = chooseEndpoint(seedance, input({ configured: [] }))
    expect(choice).toMatchObject({ ok: false, index: null, unsupported: [] })
    if (choice.ok) return
    expect(choice.message).toBe(
      "No configured provider can run Seedance 2.5. Add a key for Replicate or OpenRouter in Settings."
    )
  })
})

describe("familySlots", () => {
  it("unions every endpoint's inputs in role order, then position", () => {
    const slots = familySlots(seedance)
    expect(slots.map((s) => s.field)).toEqual([
      "first_frame",
      "last_frame",
      "soundtrack",
      "reference",
      "reference:2",
    ])
    for (const slot of slots) {
      expect(slot).toMatchObject({
        verified: true,
        required: false,
        shape: null,
      })
    }
  })

  it("takes the first endpoint's label, else the role's default", () => {
    const slots = familySlots(seedance)
    const byField = Object.fromEntries(slots.map((s) => [s.field, s]))
    expect(byField.first_frame!.label).toBe("First frame")
    expect(byField.reference!.label).toBe("Reference images")
    expect(byField.last_frame!.label).toBe(ROLE_LABELS.last_frame)
    expect(byField.soundtrack!.label).toBe("Soundtrack")
    expect(byField["reference:2"]!.role).toBe("reference")
  })

  it("widens the kind and the bound across endpoints", () => {
    const slots = familySlots(seedance)
    const reference = slots.find((s) => s.field === "reference")!
    // image (Replicate) + any (OpenRouter), and OpenRouter states no bound.
    expect(reference.kind).toBe("any")
    expect(reference.max).toBeNull()
    expect(reference.multiple).toBe(true)
    const soundtrack = slots.find((s) => s.field === "soundtrack")!
    expect(soundtrack).toMatchObject({ kind: "audio", max: 10, multiple: true })
  })

  it("reads multiple from the endpoint schemas when given", () => {
    const schemas = {
      0: {
        properties: {
          image: { type: "string", format: "uri" },
          reference_images: {
            type: "array",
            items: { type: "string", format: "uri" },
          },
        },
      },
      1: {
        properties: {
          first_frame: { type: "string", format: "uri" },
          input_references: {
            type: "array",
            items: { type: "string", format: "uri" },
          },
        },
      },
    }
    const slots = familySlots(seedance, schemas)
    const first = slots.find((s) => s.field === "first_frame")!
    expect(first).toMatchObject({ multiple: false, max: null })
    expect(slots.find((s) => s.field === "reference")!.multiple).toBe(true)
  })
})

describe("slotAvailability", () => {
  it("leaves every slot available when nothing is filled", () => {
    const availability = slotAvailability(twoEndpoints, input())
    expect(Object.keys(availability)).toEqual([
      "first_frame",
      "last_frame",
      "character",
    ])
    expect(Object.values(availability).every((a) => a.available)).toBe(true)
  })

  it("dims a slot no endpoint takes together with what is filled", () => {
    const availability = slotAvailability(
      twoEndpoints,
      input({ filled: ["character"] })
    )
    expect(availability.character).toEqual({ available: true, reason: null })
    expect(availability.first_frame).toEqual({ available: true, reason: null })
    expect(availability.last_frame).toEqual({
      available: false,
      reason: "Not with Character on Replicate — no endpoint takes both",
    })
  })

  it("dims a slot the candidate providers do not offer at all", () => {
    const availability = slotAvailability(
      seedance,
      input({ configured: ["openrouter"] })
    )
    expect(availability["reference:2"]).toEqual({
      available: false,
      reason: "Not available on OpenRouter",
    })
    expect(availability.first_frame!.available).toBe(true)
  })

  it("keeps a filled slot available even when it conflicts", () => {
    const availability = slotAvailability(
      twoEndpoints,
      input({ filled: ["character", "last_frame"] })
    )
    expect(availability.character!.available).toBe(true)
    expect(availability.last_frame!.available).toBe(true)
    expect(availability.first_frame).toEqual({
      available: false,
      reason:
        "Not with Last frame and Character on Replicate — no endpoint takes them together",
    })
  })
})
