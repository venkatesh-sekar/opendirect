/**
 * ⛔ No network: the endpoints' descriptors are built from the recorded schema
 * fixtures and the mappings are the bundled files.
 */
import {
  familyKey,
  mergeRegistry,
  modelDescriptorSchema,
  modelKey,
  parseModelKey,
  unknownPricing,
  type GenerationRequest,
  type ModelDescriptor,
  type ProviderId,
  type RegistryFamilyEntry,
} from "@opendirect/contract"
import { describe, expect, it, vi } from "vitest"

import { deriveReferenceSlots } from "../providers/reference-slots"
import { annotateDescriptor } from "./annotate"
import { BUNDLED_FAMILIES } from "./bundled"
import { fixtureInputSchema } from "./fixture-schemas"
import { translateSubmission, type TranslateDeps } from "./translate-submit"

const bundled = mergeRegistry([
  { source: "bundled", entries: BUNDLED_FAMILIES },
])

function entry(id: string): RegistryFamilyEntry | null {
  return (
    bundled.families.find((candidate) => candidate.family.id === id) ?? null
  )
}

/** The annotated concrete descriptor, as `annotatedModel` serves it. */
function fixtureDescriptor(key: string): ModelDescriptor {
  const { provider, slug } = parseModelKey(key)!
  const inputSchema = fixtureInputSchema(provider, slug) ?? {
    type: "object",
    properties: {},
  }
  const descriptor = modelDescriptorSchema.parse({
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
  const family =
    bundled.families.find((candidate) =>
      candidate.family.endpoints.some(
        (endpoint) => endpoint.provider === provider && endpoint.model === slug
      )
    ) ?? null
  return annotateDescriptor(descriptor, family)
}

function deps(
  options: {
    configured?: ProviderId[]
    providerOrder?: ProviderId[]
    family?: (id: string) => RegistryFamilyEntry | null
  } = {}
) {
  return {
    family: vi.fn(options.family ?? entry),
    configured: () => options.configured ?? ["replicate", "openrouter"],
    providerOrder: () => options.providerOrder ?? ["replicate", "openrouter"],
    getModel: vi.fn(async (key: string) => fixtureDescriptor(key)),
  } satisfies TranslateDeps
}

function request(
  overrides: Partial<GenerationRequest> = {}
): GenerationRequest {
  return {
    modelKey: familyKey("seedance-2-5"),
    containerId: "c1",
    prompt: "a bellhop opens the lift",
    params: { prompt: "a bellhop opens the lift", duration: "5" },
    references: [{ slotField: "first_frame", assetId: "a1", position: 0 }],
    estimatedCostUsd: null,
    costConfidence: null,
    parentGenerationId: null,
    batchId: null,
    mentionedContainerIds: null,
    providerOverride: null,
    familyId: null,
    shapes: null,
    ...overrides,
  }
}

describe("translateSubmission", () => {
  it("rewrites a family request into the chosen endpoint's own request", async () => {
    const translated = await translateSubmission(request(), deps())

    expect(translated.modelKey).toBe("replicate:bytedance/seedance-2.5")
    expect(translated.references).toEqual([
      { slotField: "image", assetId: "a1", position: 0 },
    ])
    // Type-coerced to the schema's integer, under the provider's field.
    expect(translated.params).toEqual({
      prompt: "a bellhop opens the lift",
      duration: 5,
    })
    expect(translated.familyId).toBe("seedance-2-5")
    // Everything else rides along untouched.
    expect(translated.prompt).toBe("a bellhop opens the lift")
    expect(translated.containerId).toBe("c1")
  })

  it("records each mapped field's shape, so the runner never has to look it up", async () => {
    const seedance = entry("seedance-2-5")!
    const [replicate, openrouter] = seedance.family.endpoints
    const shaped: RegistryFamilyEntry = {
      ...seedance,
      family: {
        ...seedance.family,
        endpoints: [
          {
            ...replicate!,
            inputs: {
              ...replicate!.inputs,
              reference: {
                ...replicate!.inputs.reference!,
                shape: "kling-elements",
              },
            },
          },
          openrouter!,
        ],
      },
    }

    const translated = await translateSubmission(
      request({
        references: [{ slotField: "reference", assetId: "a1", position: 0 }],
      }),
      deps({ family: () => shaped })
    )

    expect(translated.shapes).toEqual({
      image: null,
      last_frame_image: null,
      reference_audios: null,
      reference_images: "kling-elements",
      reference_videos: null,
    })
  })

  it("asks for the chosen endpoint's descriptor only", async () => {
    const d = deps()
    await translateSubmission(request(), d)

    expect(d.getModel.mock.calls).toEqual([
      ["replicate:bytedance/seedance-2.5"],
    ])
  })

  it("runs on OpenRouter when that is the only configured provider", async () => {
    const translated = await translateSubmission(
      request({
        references: [{ slotField: "reference", assetId: "a1", position: 0 }],
      }),
      deps({ configured: ["openrouter"] })
    )

    expect(translated.modelKey).toBe("openrouter:bytedance/seedance-2.5")
    expect(translated.references).toEqual([
      { slotField: "input_references", assetId: "a1", position: 0 },
    ])
  })

  it("honours the node's provider override over the settings order", async () => {
    const translated = await translateSubmission(
      request({ providerOverride: "openrouter" }),
      deps()
    )

    expect(translated.modelKey).toBe("openrouter:bytedance/seedance-2.5")
    expect(translated.references[0]!.slotField).toBe("first_frame")
  })

  it("rejects an input no endpoint of the family can take", async () => {
    const d = deps()
    await expect(
      translateSubmission(
        request({
          references: [{ slotField: "character", assetId: "a1", position: 0 }],
        }),
        d
      )
    ).rejects.toThrow(/takes Character/)
    expect(d.getModel).not.toHaveBeenCalled()
  })

  it("rejects a raw field that would overwrite a mapped one", async () => {
    await expect(
      translateSubmission(
        request({ params: { "raw:image": "https://example.com/x.png" } }),
        deps()
      )
    ).rejects.toThrow(/may not overwrite the mapped field image/)
  })

  it("rejects a slot field that is not a slot key rather than guessing", async () => {
    await expect(
      translateSubmission(
        request({
          references: [{ slotField: "image", assetId: "a1", position: 0 }],
        }),
        deps()
      )
    ).rejects.toThrow(/"image" is not an input of Seedance 2.5/)
  })

  it("names the required inputs a run still needs", async () => {
    const seedance = entry("seedance-2-5")!
    const [replicate] = seedance.family.endpoints
    const strict: RegistryFamilyEntry = {
      ...seedance,
      family: {
        ...seedance.family,
        endpoints: [
          {
            ...replicate!,
            inputs: {
              ...replicate!.inputs,
              first_frame: {
                ...replicate!.inputs.first_frame!,
                required: true,
              },
            },
          },
        ],
      },
    }

    await expect(
      translateSubmission(
        request({ references: [] }),
        deps({ family: () => strict })
      )
    ).rejects.toThrow(
      "Needs First frame (not with reference images, videos or audio) before it can run"
    )
  })

  it("rejects a family the registry no longer has", async () => {
    await expect(
      translateSubmission(
        request({ modelKey: familyKey("gone") }),
        deps({ family: () => null })
      )
    ).rejects.toThrow(/Unknown model family "gone"/)
  })

  it("says what to do when no configured provider runs the family", async () => {
    await expect(
      translateSubmission(request(), deps({ configured: [] }))
    ).rejects.toThrow(/No configured provider can run Seedance 2.5/)
  })

  it("returns a concrete request exactly as it came", async () => {
    const concrete = request({
      modelKey: "replicate:bytedance/seedance-2.5",
      params: { duration: 5 },
      references: [{ slotField: "image", assetId: "a1", position: 0 }],
    })
    const d = deps()

    expect(await translateSubmission(concrete, d)).toBe(concrete)
    expect(d.family).not.toHaveBeenCalled()
    expect(d.getModel).not.toHaveBeenCalled()
  })

  it("does not let a concrete request claim a family or shapes", async () => {
    // Only main sets these, on a request it translated itself; a concrete
    // run's shapes come from its own descriptor.
    const claimed = request({
      modelKey: "replicate:bytedance/seedance-2.5",
      params: { duration: 5 },
      references: [{ slotField: "image", assetId: "a1", position: 0 }],
      familyId: "seedance-2-5",
      shapes: { image: "kling-elements" },
    })

    expect(await translateSubmission(claimed, deps())).toEqual({
      ...claimed,
      familyId: null,
      shapes: null,
    })
  })
})
