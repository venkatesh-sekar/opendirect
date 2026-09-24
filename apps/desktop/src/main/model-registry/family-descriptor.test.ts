/**
 * ⛔ No network: descriptors are built from the recorded schema fixtures, the
 * mappings are the bundled files, and the catalog is a stub that counts what
 * it is asked for.
 */
import {
  chooseEndpoint,
  familyKey,
  mergeRegistry,
  modelDescriptorSchema,
  modelKey,
  parseModelKey,
  planBatch,
  unknownPricing,
  type ModelDescriptor,
  type ProviderId,
  type RegistryFamilyEntry,
} from "@opendirect/contract"
import { describe, expect, it, vi } from "vitest"

import { deriveReferenceSlots } from "../providers/reference-slots"
import { annotateDescriptor } from "./annotate"
import { BUNDLED_FAMILIES } from "./bundled"
import {
  buildFamilyDescriptor,
  describeModel,
  estimateFor,
  registryCapabilities,
  type ModelSource,
} from "./family-descriptor"
import { fixtureInputSchema } from "./fixture-schemas"

function fixtureDescriptor(
  provider: ProviderId,
  slug: string,
  overrides: Partial<ModelDescriptor> = {}
): ModelDescriptor {
  const inputSchema = fixtureInputSchema(provider, slug) ?? {
    type: "object",
    properties: {},
  }
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
    ...overrides,
  })
}

const bundled = mergeRegistry([
  { source: "bundled", entries: BUNDLED_FAMILIES },
])

function entry(id: string): RegistryFamilyEntry {
  return bundled.families.find((candidate) => candidate.family.id === id)!
}

function build(
  id: string,
  options: {
    configured?: ProviderId[]
    filled?: string[]
    schemas?: Record<number, unknown>
  } = {}
) {
  const family = entry(id)
  const configured = options.configured ?? ["replicate", "openrouter"]
  const providerOrder: ProviderId[] = ["replicate", "openrouter"]
  const choice = chooseEndpoint(family.family, {
    filled: options.filled ?? [],
    providerOrder,
    configured,
    override: null,
  })
  const endpoint = family.family.endpoints[choice.index!]!
  const endpointDescriptor = annotateDescriptor(
    fixtureDescriptor(endpoint.provider, endpoint.model),
    family
  )
  return buildFamilyDescriptor({
    entry: family,
    choice,
    endpointDescriptor,
    configured,
    providerOrder,
    override: null,
    schemas: options.schemas,
  })
}

describe("buildFamilyDescriptor", () => {
  it("is a valid descriptor keyed by the family", () => {
    const result = build("seedance-2-5")

    expect(modelDescriptorSchema.parse(result)).toEqual(result)
    expect(result).toMatchObject({
      key: familyKey("seedance-2-5"),
      name: "Seedance 2.5",
      kind: "video",
      // Where it runs and what it costs are the chosen endpoint's.
      provider: "replicate",
      slug: "bytedance/seedance-2.5",
      raw: {
        family: entry("seedance-2-5").family,
        endpoint: "replicate:bytedance/seedance-2.5",
      },
      mappedBy: null,
    })
  })

  it("offers the union of every endpoint's slots, keyed by slot key", () => {
    const result = build("seedance-2-5")

    expect(result.referenceSlots.map((slot) => slot.field)).toEqual([
      "first_frame",
      "last_frame",
      "soundtrack",
      "reference",
      "reference:2",
    ])
    expect(result.referenceSlots.every((slot) => slot.verified)).toBe(true)
  })

  it("drops mapped inputs from the schema and renames the controls", () => {
    const result = build("seedance-2-5")
    const properties = Object.keys(
      result.inputSchema.properties as Record<string, unknown>
    )

    for (const field of [
      "image",
      "last_frame_image",
      "reference_images",
      "reference_videos",
      "reference_audios",
    ]) {
      expect(properties).not.toContain(field)
    }
    expect(properties).toContain("generate_audio")
    expect(result.commonControls.duration).toBe("duration")
    expect(result.commonControls.audio).toBe("generate_audio")
  })

  it("keeps the count under its own field, where planBatch finds it", () => {
    const result = build("flux-schnell")

    expect(result.inputSchema.properties).toHaveProperty("num_outputs")
    expect(
      planBatch({
        request: {
          modelKey: result.key,
          prompt: "a cat",
          params: {},
          references: [],
        } as never,
        count: 3,
        inputSchema: result.inputSchema,
      }).countField
    ).toBe("num_outputs")
  })

  it("marks a slot required only when the chosen endpoint requires it", () => {
    const family = entry("seedance-2-5")
    const withRequired: RegistryFamilyEntry = {
      ...family,
      family: {
        ...family.family,
        endpoints: family.family.endpoints.map((endpoint, index) =>
          index === 0
            ? {
                ...endpoint,
                inputs: {
                  ...endpoint.inputs,
                  first_frame: {
                    ...endpoint.inputs.first_frame!,
                    required: true,
                  },
                },
              }
            : endpoint
        ),
      },
    }
    const choice = chooseEndpoint(withRequired.family, {
      filled: [],
      providerOrder: ["replicate"],
      configured: ["replicate"],
      override: null,
    })

    const result = buildFamilyDescriptor({
      entry: withRequired,
      choice,
      endpointDescriptor: annotateDescriptor(
        fixtureDescriptor("replicate", "bytedance/seedance-2.5"),
        withRequired
      ),
      configured: ["replicate"],
      providerOrder: ["replicate"],
      override: null,
    })

    const required = result.referenceSlots
      .filter((slot) => slot.required)
      .map((slot) => slot.field)
    expect(required).toEqual(["first_frame"])
    expect(result.family?.choice).toEqual({
      index: 0,
      missing: ["first_frame"],
      unsupported: [],
      message: null,
    })
  })

  it("carries the family, where it came from and the endpoint choice", () => {
    const result = build("seedance-2-5", { configured: ["openrouter"] })

    expect(result.provider).toBe("openrouter")
    expect(result.family).toEqual({
      family: entry("seedance-2-5").family,
      source: "bundled",
      configured: ["openrouter"],
      providerOrder: ["replicate", "openrouter"],
      override: null,
      choice: { index: 1, missing: [], unsupported: [], message: null },
    })
  })

  it("reads list-ness from the schemas it is given", () => {
    // OpenRouter's `first_frame` is a single URL, whatever `max` says.
    const openrouter = fixtureInputSchema(
      "openrouter",
      "bytedance/seedance-2.5"
    )
    const firstFrame = (schemas?: Record<number, unknown>) =>
      build("seedance-2-5", { schemas }).referenceSlots.find(
        (slot) => slot.field === "first_frame"
      )

    // Unknown for OpenRouter, so it might be a list…
    expect(firstFrame()).toMatchObject({ multiple: true })
    // …until its schema says it is one URL, as the chosen endpoint's does.
    expect(firstFrame({ 1: openrouter })).toMatchObject({
      multiple: false,
      max: null,
    })
  })
})

/** A catalog stub serving fixture descriptors, counting fetches. */
function fakeSource(
  options: {
    configured?: ProviderId[]
    cached?: Record<string, ModelDescriptor>
    providerOrder?: ProviderId[]
    families?: RegistryFamilyEntry[]
    pricing?: ModelDescriptor["pricing"]
  } = {}
) {
  const families = options.families ?? bundled.families
  const merged = mergeRegistry([
    {
      source: "bundled",
      entries: families.map((e) => ({ origin: e.family.id, raw: e.family })),
    },
  ])
  const getModel = vi.fn(async (key: string) => {
    const parsed = parseModelKey(key)
    if (!parsed) throw new Error(`"${key}" is not a model key.`)
    return fixtureDescriptor(parsed.provider, parsed.slug, {
      pricing: options.pricing ?? unknownPricing,
    })
  })
  const source: ModelSource = {
    catalog: () => ({
      getModel,
      configuredProviders: () => options.configured ?? ["replicate"],
      cachedDescriptors: () => options.cached ?? {},
    }),
    registry: () => ({
      merged: () => merged,
      family: (id) =>
        merged.families.find((candidate) => candidate.family.id === id) ?? null,
      familyForEndpoint: (provider, model) => {
        const id = merged.endpointIndex.get(modelKey(provider, model))
        return merged.families.find((c) => c.family.id === id) ?? null
      },
    }),
    settings: () => ({
      providerOrder: options.providerOrder ?? ["replicate", "openrouter"],
    }),
  }
  return { source, getModel }
}

describe("describeModel", () => {
  it("annotates a concrete descriptor with its family's roles", async () => {
    const { source } = fakeSource()

    const result = await describeModel(
      source,
      "replicate:bytedance/seedance-2.5"
    )

    expect(result.key).toBe("replicate:bytedance/seedance-2.5")
    expect(result.mappedBy).toEqual({
      familyId: "seedance-2-5",
      source: "bundled",
    })
  })

  it("annotates with the requested family when two families map the endpoint", async () => {
    const seedance = entry("seedance-2-5")
    const [replicate] = seedance.family.endpoints
    // A second family on the very same endpoint, mapping only its first
    // frame — under its own label. Listed later, it wins the endpoint index.
    const mine: RegistryFamilyEntry = {
      ...seedance,
      family: {
        ...seedance.family,
        id: "my-seedance",
        name: "My Seedance",
        endpoints: [
          {
            ...replicate!,
            inputs: {
              first_frame: {
                ...replicate!.inputs.first_frame!,
                label: "Opening shot",
              },
            },
          },
        ],
      },
    }
    const { source } = fakeSource({ families: [seedance, mine] })
    const key = "replicate:bytedance/seedance-2.5"
    const imageLabel = (descriptor: ModelDescriptor) =>
      descriptor.referenceSlots.find((slot) => slot.field === "image")?.label

    const winner = await describeModel(source, key)
    const loser = await describeModel(source, key, { family: "seedance-2-5" })

    expect(winner.mappedBy?.familyId).toBe("my-seedance")
    expect(imageLabel(winner)).toBe("Opening shot")
    // The losing family is checked against its own mapping, not the winner's.
    expect(loser.mappedBy?.familyId).toBe("seedance-2-5")
    expect(imageLabel(loser)).toBe(
      "First frame (not with reference images, videos or audio)"
    )
  })

  it("falls back to the endpoint's own family when the requested one does not map it", async () => {
    const { source } = fakeSource()

    const result = await describeModel(
      source,
      "replicate:bytedance/seedance-2.5",
      { family: "flux-schnell" }
    )

    expect(result.mappedBy?.familyId).toBe("seedance-2-5")
  })

  it("passes refresh through to the catalog", async () => {
    const { source, getModel } = fakeSource()

    await describeModel(source, "replicate:bytedance/seedance-2.5", {
      refresh: true,
    })

    expect(getModel).toHaveBeenCalledWith("replicate:bytedance/seedance-2.5", {
      refresh: true,
    })
  })

  it("builds a family descriptor on the endpoint the choice picks", async () => {
    const { source, getModel } = fakeSource({ configured: ["openrouter"] })

    const result = await describeModel(source, familyKey("seedance-2-5"))

    expect(result.key).toBe("family:seedance-2-5")
    expect(result.provider).toBe("openrouter")
    // Only the chosen endpoint is fetched; no other network.
    expect(getModel).toHaveBeenCalledTimes(1)
    expect(getModel).toHaveBeenCalledWith("openrouter:bytedance/seedance-2.5", {
      refresh: false,
    })
  })

  it("honours the per-node override and what is filled", async () => {
    const { source } = fakeSource({ configured: ["replicate", "openrouter"] })

    const onOpenRouter = await describeModel(
      source,
      familyKey("seedance-2-5"),
      { provider: "openrouter" }
    )
    const withSoundtrack = await describeModel(
      source,
      familyKey("seedance-2-5"),
      { filled: ["soundtrack"], provider: null }
    )

    expect(onOpenRouter.provider).toBe("openrouter")
    expect(onOpenRouter.family?.override).toBe("openrouter")
    expect(withSoundtrack.provider).toBe("replicate")
  })

  it("uses the other endpoints' cached schemas, and fetches none", async () => {
    const openrouter = fixtureDescriptor("openrouter", "bytedance/seedance-2.5")
    const { source, getModel } = fakeSource({
      cached: { [openrouter.key]: openrouter },
    })

    const result = await describeModel(source, familyKey("seedance-2-5"))

    expect(getModel).toHaveBeenCalledTimes(1)
    expect(
      result.referenceSlots.find((slot) => slot.field === "first_frame")
    ).toMatchObject({ multiple: false })
  })

  it("says so when the family is not in the registry", async () => {
    const { source } = fakeSource()

    await expect(describeModel(source, familyKey("gone"))).rejects.toThrow(
      'Unknown model family "gone". It may have been removed from the registry. Pick another model.'
    )
  })

  it("throws the choice's message when no endpoint can run", async () => {
    const { source, getModel } = fakeSource({ configured: [] })

    await expect(
      describeModel(source, familyKey("seedance-2-5"))
    ).rejects.toThrow(/No configured provider can run Seedance 2\.5/)
    expect(getModel).not.toHaveBeenCalled()
  })

  it("keeps the mapping's slots and the choice's message when the chosen endpoint cannot be fetched", async () => {
    const { source, getModel } = fakeSource({ configured: ["replicate"] })
    getModel.mockRejectedValueOnce(new Error("No API key is configured"))

    const result = await describeModel(source, familyKey("seedance-2-5"), {
      provider: "openrouter",
    })

    expect(modelDescriptorSchema.parse(result)).toEqual(result)
    expect(result).toMatchObject({
      key: "family:seedance-2-5",
      provider: "openrouter",
      slug: "bytedance/seedance-2.5",
      pricing: { basis: "unknown" },
    })
    // The node still shows its slots, from the mapping alone.
    expect(result.referenceSlots.map((slot) => slot.field)).toEqual([
      "first_frame",
      "last_frame",
      "soundtrack",
      "reference",
      "reference:2",
    ])
    expect(result.commonControls.duration).toBe("duration")
    expect(result.family?.choice.message).toMatch(
      /Add an OpenRouter key in Settings/
    )
  })

  it("still throws a fetch error when the choice itself was fine", async () => {
    const { source, getModel } = fakeSource({ configured: ["replicate"] })
    getModel.mockRejectedValueOnce(new Error("Replicate is down"))

    await expect(
      describeModel(source, familyKey("seedance-2-5"))
    ).rejects.toThrow("Replicate is down")
  })

  it("rejects a key that is neither a model nor a family key", async () => {
    const { source } = fakeSource()

    await expect(describeModel(source, "family:Not Valid")).rejects.toThrow(
      /not a model key/i
    )
  })
})

describe("estimateFor", () => {
  const perSecond = {
    basis: "per_second" as const,
    currency: "USD" as const,
    skus: { duration_seconds: "0.1" },
    estimate: null,
    source: "provider_api" as const,
    note: null,
  }

  it("prices a family run on the chosen endpoint, in its own field names", async () => {
    const { source } = fakeSource({
      configured: ["openrouter"],
      pricing: perSecond,
    })

    const quote = await estimateFor(
      source,
      familyKey("seedance-2-5"),
      { prompt: "a cat", duration: "5" },
      {}
    )

    expect(quote).toMatchObject({ confidence: "estimated", amount: 0.5 })
  })

  it("quotes the video-input tier when a video slot is filled", async () => {
    const { source } = fakeSource({ configured: ["replicate"] })
    const params = { duration: "5", resolution: "720p" }

    const plain = await estimateFor(
      source,
      familyKey("seedance-2-5"),
      params,
      {}
    )
    const withVideo = await estimateFor(
      source,
      familyKey("seedance-2-5"),
      params,
      { filled: ["reference:2"] }
    )

    expect(plain.sku).toBe("720p")
    expect(withVideo.sku).toBe("720p:video_in")
    expect(withVideo.amount).toBeGreaterThan(plain.amount)
  })

  it("answers a translation error as an unknown quote with its message", async () => {
    const { source } = fakeSource({ configured: ["openrouter"] })

    const quote = await estimateFor(
      source,
      familyKey("seedance-2-5"),
      { duration: "5", "raw:duration": 3 },
      {}
    )

    expect(quote).toMatchObject({
      amount: 0,
      confidence: "unknown",
      source: "none",
      note: expect.stringMatching(/duration/),
    })
  })

  it("answers filled slots no endpoint takes together as an unknown quote", async () => {
    const { source } = fakeSource({
      configured: ["openrouter"],
      pricing: perSecond,
    })

    const quote = await estimateFor(
      source,
      familyKey("seedance-2-5"),
      { duration: "5" },
      { filled: ["soundtrack"] }
    )

    expect(quote).toMatchObject({
      amount: 0,
      confidence: "unknown",
      note: expect.stringMatching(/has no endpoint on OpenRouter/),
    })
  })

  it("answers an override to a provider with no key as an unknown quote", async () => {
    // The descriptor is fetchable (cached), but the run could not be made.
    const { source } = fakeSource({
      configured: ["replicate"],
      pricing: perSecond,
    })

    const quote = await estimateFor(
      source,
      familyKey("seedance-2-5"),
      { duration: "5" },
      { provider: "openrouter" }
    )

    expect(quote).toMatchObject({
      amount: 0,
      confidence: "unknown",
      note: expect.stringMatching(/Add an OpenRouter key in Settings/),
    })
  })

  it("answers a family no provider can run as an unknown quote", async () => {
    const { source } = fakeSource({ configured: [] })

    const quote = await estimateFor(source, familyKey("seedance-2-5"), {}, {})

    expect(quote).toMatchObject({
      confidence: "unknown",
      note: expect.stringMatching(/No configured provider/),
    })
  })

  it("prices a concrete key as before", async () => {
    const { source } = fakeSource({
      configured: ["openrouter"],
      pricing: perSecond,
    })

    const quote = await estimateFor(
      source,
      "openrouter:bytedance/seedance-2.5",
      { duration: 4 },
      {}
    )

    expect(quote).toMatchObject({ confidence: "estimated", amount: 0.4 })
  })
})

describe("registryCapabilities", () => {
  it("lists the roles of every cached, unmapped descriptor", () => {
    const unmapped = fixtureDescriptor("replicate", "someone/else", {
      referenceSlots: [
        ...deriveReferenceSlots(
          fixtureInputSchema("replicate", "bytedance/seedance-2.5")
        ),
      ],
    })
    const mapped = fixtureDescriptor("replicate", "bytedance/seedance-2.5")
    const bare = fixtureDescriptor("replicate", "black-forest-labs/flux-dev", {
      referenceSlots: [],
    })
    const { source, getModel } = fakeSource({
      cached: {
        [unmapped.key]: unmapped,
        [mapped.key]: mapped,
        [bare.key]: bare,
      },
    })

    expect(registryCapabilities(source)).toEqual({
      "replicate:someone/else": ["last_frame", "reference"],
      // Inspected and takes nothing: that is data too.
      "replicate:black-forest-labs/flux-dev": [],
    })
    expect(getModel).not.toHaveBeenCalled()
  })
})
