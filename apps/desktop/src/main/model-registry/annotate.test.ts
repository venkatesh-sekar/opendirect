/**
 * ⛔ No network: the descriptors are built from the recorded schema fixtures
 * exactly as the adapters derive their slots, and the mappings are the
 * bundled files.
 */
import {
  mergeRegistry,
  modelDescriptorSchema,
  modelKey,
  unknownPricing,
  type ModelDescriptor,
  type ProviderId,
  type RegistryFamilyEntry,
} from "@opendirect/contract"
import { describe, expect, it } from "vitest"

import { deriveReferenceSlots } from "../providers/reference-slots"
import { annotateDescriptor } from "./annotate"
import { BUNDLED_FAMILIES } from "./bundled"
import { fixtureInputSchema } from "./fixture-schemas"

function fixtureDescriptor(
  provider: ProviderId,
  slug: string
): ModelDescriptor {
  const inputSchema = fixtureInputSchema(provider, slug)!
  return modelDescriptorSchema.parse({
    key: modelKey(provider, slug),
    provider,
    slug,
    name: slug,
    description: null,
    kind: "video",
    versionId: null,
    coverImageUrl: null,
    inputSchema,
    outputSchema: null,
    referenceSlots: deriveReferenceSlots(inputSchema),
    commonControls: {
      prompt: "prompt",
      aspectRatio: null,
      duration: null,
      resolution: null,
      seed: null,
      audio: null,
    },
    pricing: unknownPricing,
    raw: null,
    fetchedAt: 1,
  })
}

const bundled = mergeRegistry([
  { source: "bundled", entries: BUNDLED_FAMILIES },
])

function entry(id: string): RegistryFamilyEntry {
  return bundled.families.find((candidate) => candidate.family.id === id)!
}

describe("annotateDescriptor", () => {
  const seedance = () =>
    fixtureDescriptor("replicate", "bytedance/seedance-2.5")

  it("returns the descriptor unchanged when no family maps it", () => {
    const descriptor = seedance()

    const result = annotateDescriptor(descriptor, null)

    expect(result).toBe(descriptor)
    expect(result.referenceSlots.every((slot) => !slot.verified)).toBe(true)
    expect(result.mappedBy).toBeNull()
  })

  it("gives mapped slots their verified role, label, kind and bounds", () => {
    const result = annotateDescriptor(seedance(), entry("seedance-2-5"))
    const slot = (field: string) =>
      result.referenceSlots.find((candidate) => candidate.field === field)!

    expect(slot("image")).toMatchObject({
      role: "first_frame",
      verified: true,
      label: "First frame (not with reference images, videos or audio)",
      kind: "image",
      required: false,
      shape: null,
    })
    expect(slot("reference_audios")).toMatchObject({
      role: "soundtrack",
      verified: true,
      label: "Reference audio (lip-sync; needs a reference image or video)",
      kind: "audio",
      max: 10,
    })
    // `reference:2` is still the `reference` role.
    expect(slot("reference_videos")).toMatchObject({
      role: "reference",
      verified: true,
      kind: "video",
    })
    expect(result.mappedBy).toEqual({
      familyId: "seedance-2-5",
      source: "bundled",
    })
    expect(modelDescriptorSchema.parse(result)).toEqual(result)
  })

  it("never mutates the descriptor it is given", () => {
    const descriptor = seedance()
    const before = structuredClone(descriptor)

    annotateDescriptor(descriptor, entry("seedance-2-5"))

    expect(descriptor).toEqual(before)
  })

  it("points the common controls at the mapped fields", () => {
    const result = annotateDescriptor(seedance(), entry("seedance-2-5"))

    expect(result.commonControls).toEqual({
      prompt: "prompt",
      aspectRatio: "aspect_ratio",
      duration: "duration",
      resolution: "resolution",
      seed: "seed",
      audio: "generate_audio",
    })
  })

  it("keeps unmapped slots as unverified guesses", () => {
    const descriptor = seedance()
    const family: RegistryFamilyEntry = {
      ...entry("seedance-2-5"),
      family: {
        ...entry("seedance-2-5").family,
        endpoints: [
          {
            provider: "replicate",
            model: "bytedance/seedance-2.5",
            inputs: { first_frame: { field: "image", kind: "image" } },
            controls: {},
          },
        ],
      },
    }

    const result = annotateDescriptor(descriptor, family)

    const audio = result.referenceSlots.find(
      (slot) => slot.field === "reference_audios"
    )!
    expect(audio).toEqual(
      descriptor.referenceSlots.find(
        (slot) => slot.field === "reference_audios"
      )
    )
    expect(audio.verified).toBe(false)
    // An unmapped control keeps what the adapter found.
    expect(result.commonControls.prompt).toBe("prompt")
    expect(result.commonControls.duration).toBeNull()
  })

  it("carries the mapping's required flag and shape", () => {
    const family: RegistryFamilyEntry = {
      ...entry("seedance-2-5"),
      family: {
        ...entry("seedance-2-5").family,
        endpoints: [
          {
            provider: "replicate",
            model: "bytedance/seedance-2.5",
            inputs: {
              character: {
                field: "reference_images",
                kind: "image",
                required: true,
                shape: "kling-elements",
              },
            },
            controls: {},
          },
        ],
      },
    }

    const result = annotateDescriptor(seedance(), family)

    expect(
      result.referenceSlots.find((slot) => slot.field === "reference_images")
    ).toMatchObject({
      role: "character",
      verified: true,
      required: true,
      shape: "kling-elements",
      // No mapped label or max: the adapter's stay.
      label: "Reference Images",
      max: 30,
    })
  })

  it("adds a slot for a mapped field the name guess did not recognise", () => {
    const descriptor = seedance()
    const family: RegistryFamilyEntry = {
      ...entry("seedance-2-5"),
      family: {
        ...entry("seedance-2-5").family,
        endpoints: [
          {
            provider: "replicate",
            model: "bytedance/seedance-2.5",
            // A plain string field in the schema, not a URI.
            inputs: { style: { field: "output_format", kind: "image" } },
            controls: {},
          },
        ],
      },
    }

    const result = annotateDescriptor(descriptor, family)

    expect(result.referenceSlots).toHaveLength(
      descriptor.referenceSlots.length + 1
    )
    expect(result.referenceSlots.at(-1)).toEqual({
      field: "output_format",
      label: "Style",
      kind: "image",
      multiple: false,
      max: null,
      role: "style",
      verified: true,
      required: false,
      shape: null,
    })
  })

  it("leaves a descriptor alone when the family has no endpoint for it", () => {
    const descriptor = fixtureDescriptor("openrouter", "bytedance/seedance-2.5")

    expect(annotateDescriptor(descriptor, entry("seedance-2-0"))).toBe(
      descriptor
    )
  })

  it("annotates the OpenRouter endpoint of the same family", () => {
    const result = annotateDescriptor(
      fixtureDescriptor("openrouter", "bytedance/seedance-2.5"),
      entry("seedance-2-5")
    )

    expect(
      result.referenceSlots.map((slot) => [
        slot.field,
        slot.role,
        slot.verified,
      ])
    ).toEqual([
      ["first_frame", "first_frame", true],
      ["last_frame", "last_frame", true],
      ["input_references", "reference", true],
    ])
  })
})
