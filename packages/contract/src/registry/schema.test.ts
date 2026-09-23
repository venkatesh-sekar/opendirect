import { describe, expect, it } from "vitest"

import { modelDescriptorSchema, parseFamilyKey } from "../model"
import {
  familyIdSchema,
  modelFamilySchema,
  registryIndexSchema,
  slotKeyRole,
  slotKeySchema,
  validateFamily,
} from "./schema"

/**
 * The design doc's worked example (§3). The doc's first endpoint is on fal,
 * which OpenDirect has no adapter for, so it runs on Replicate here.
 */
const klingV3Pro = {
  id: "kling-v3-pro",
  name: "Kling 3 Pro",
  kind: "video",
  endpoints: [
    {
      provider: "replicate",
      model: "kwaivgi/kling-v3-pro",
      inputs: {
        first_frame: {
          field: "start_image_url",
          kind: "image",
          required: true,
        },
        last_frame: { field: "end_image_url", kind: "image" },
        character: {
          field: "elements",
          kind: "image",
          shape: "kling-elements",
          max: 4,
          label: "Characters (frontal photo + references)",
        },
      },
      controls: {
        prompt: { field: "prompt" },
        duration: { field: "duration", values: { "5": "5", "10": "10" } },
        generate_audio: { field: "generate_audio" },
      },
    },
  ],
}

type Endpoint = (typeof klingV3Pro.endpoints)[number]

function withEndpoint(patch: (endpoint: Endpoint) => unknown) {
  const endpoint = JSON.parse(
    JSON.stringify(klingV3Pro.endpoints[0])
  ) as Endpoint
  return { ...klingV3Pro, endpoints: [patch(endpoint)] }
}

function messagesOf(input: unknown): string[] {
  const result = modelFamilySchema.safeParse(input)
  if (result.success) return []
  return result.error.issues.map((issue) => issue.message)
}

describe("modelFamilySchema", () => {
  it("parses the design's kling-v3-pro example", () => {
    const family = modelFamilySchema.parse(klingV3Pro)
    expect(family.endpoints[0]?.inputs.character?.shape).toBe("kling-elements")
  })

  it("defaults inputs and controls to empty maps", () => {
    const family = modelFamilySchema.parse({
      ...klingV3Pro,
      endpoints: [{ provider: "openrouter", model: "kling/v3" }],
    })
    expect(family.endpoints[0]).toMatchObject({ inputs: {}, controls: {} })
  })

  it("rejects an unknown top-level key", () => {
    expect(
      modelFamilySchema.safeParse({ ...klingV3Pro, vendor: "kuaishou" }).success
    ).toBe(false)
  })

  it("rejects two inputs mapping the same field", () => {
    const messages = messagesOf(
      withEndpoint((endpoint) => ({
        ...endpoint,
        inputs: {
          ...endpoint.inputs,
          style: { field: "elements", kind: "image" },
        },
      }))
    )
    expect(messages).toEqual([
      expect.stringContaining(
        `"elements" is mapped by both "character" and "style"`
      ),
    ])
  })

  it("rejects a control that maps an input's field", () => {
    const messages = messagesOf(
      withEndpoint((endpoint) => ({
        ...endpoint,
        controls: { ...endpoint.controls, seed: { field: "end_image_url" } },
      }))
    )
    expect(messages).toEqual([
      expect.stringContaining(
        `Control "seed" maps "end_image_url", which input "last_frame" already maps`
      ),
    ])
  })

  it("rejects a shape the app does not ship", () => {
    const messages = messagesOf(
      withEndpoint((endpoint) => ({
        ...endpoint,
        inputs: {
          ...endpoint.inputs,
          character: { ...endpoint.inputs.character, shape: "x" },
        },
      }))
    )
    expect(messages).toEqual([
      `Unknown shape "x". A mapping can only name a shape the app ships: kling-elements.`,
    ])
  })

  it("rejects a numbered slot key without its predecessor", () => {
    const messages = messagesOf(
      withEndpoint((endpoint) => ({
        ...endpoint,
        inputs: {
          ...endpoint.inputs,
          reference: { field: "ref_a", kind: "image" },
          "reference:3": { field: "ref_c", kind: "image" },
        },
      }))
    )
    expect(messages).toEqual([
      expect.stringContaining(`"reference:3" needs "reference:2"`),
    ])
  })

  it("rejects a numbered slot key without its bare role", () => {
    const messages = messagesOf(
      withEndpoint((endpoint) => ({
        ...endpoint,
        inputs: {
          ...endpoint.inputs,
          "style:2": { field: "style_b", kind: "image" },
        },
      }))
    )
    expect(messages).toEqual([
      expect.stringContaining(`"style:2" needs "style"`),
    ])
  })

  it("rejects values on the count control", () => {
    const messages = messagesOf(
      withEndpoint((endpoint) => ({
        ...endpoint,
        controls: {
          ...endpoint.controls,
          count: { field: "num_outputs", values: { "1": 1 } },
        },
      }))
    )
    expect(messages).toEqual([
      expect.stringContaining(`The "count" control cannot map values`),
    ])
  })

  it("rejects the same provider and model twice", () => {
    const endpoint = klingV3Pro.endpoints[0]!
    const messages = messagesOf({
      ...klingV3Pro,
      endpoints: [endpoint, endpoint],
    })
    expect(messages).toEqual([
      expect.stringContaining(`replicate:kwaivgi/kling-v3-pro is listed twice`),
    ])
  })
})

describe("slotKeySchema", () => {
  it.each(["character", "reference:2", "first_frame", "reference:9"])(
    "accepts %s",
    (key) => {
      expect(slotKeySchema.safeParse(key).success).toBe(true)
    }
  )

  it.each(["face", "reference:1", "reference:10", "unknown"])(
    "rejects %s",
    (key) => {
      expect(slotKeySchema.safeParse(key).success).toBe(false)
    }
  )

  it("strips the position suffix to get the role", () => {
    expect(slotKeyRole("reference:2")).toBe("reference")
    expect(slotKeyRole("character")).toBe("character")
  })
})

describe("familyIdSchema", () => {
  it("accepts lowercase, digits and dashes", () => {
    expect(familyIdSchema.safeParse("seedance-2-5").success).toBe(true)
  })

  it.each(["", "Seedance", "-lead", "a b", "a/b"])("rejects %j", (id) => {
    expect(familyIdSchema.safeParse(id).success).toBe(false)
  })

  it("is what parseFamilyKey enforces", () => {
    expect(parseFamilyKey("family:seedance-2-5")).toBe("seedance-2-5")
    expect(parseFamilyKey("family:a b")).toBeNull()
    expect(parseFamilyKey("family:a/b")).toBeNull()
  })
})

describe("registryIndexSchema", () => {
  it("accepts a newer format, since the version decision is the caller's", () => {
    expect(
      registryIndexSchema.parse({
        format: 2,
        registryVersion: 7,
        families: ["seedance-2-5"],
      }).format
    ).toBe(2)
  })
})

describe("modelDescriptorSchema registry fields", () => {
  it("parses a cached descriptor without family or mappedBy", () => {
    const descriptor = modelDescriptorSchema.parse({
      key: "replicate:a/b",
      provider: "replicate",
      slug: "a/b",
      name: "B",
      description: null,
      kind: "video",
      versionId: null,
      coverImageUrl: null,
      inputSchema: {},
      outputSchema: null,
      referenceSlots: [],
      commonControls: {
        prompt: null,
        aspectRatio: null,
        duration: null,
        resolution: null,
        seed: null,
        audio: null,
      },
      pricing: {
        basis: "unknown",
        currency: "USD",
        skus: {},
        estimate: null,
        source: "none",
        note: null,
      },
      raw: null,
      fetchedAt: 0,
    })
    expect(descriptor.family).toBeNull()
    expect(descriptor.mappedBy).toBeNull()
  })
})

describe("validateFamily", () => {
  it("returns the family and no issues when it validates", () => {
    const result = validateFamily(klingV3Pro)
    expect(result.issues).toEqual([])
    expect(result.family?.id).toBe("kling-v3-pro")
  })

  it("returns every issue with the dotted path a form row can match", () => {
    const result = validateFamily(
      withEndpoint((endpoint) => ({
        ...endpoint,
        inputs: {
          ...endpoint.inputs,
          last_frame: { field: "start_image_url", kind: "image" },
        },
      }))
    )
    expect(result.family).toBeNull()
    expect(result.issues).toContainEqual({
      path: "endpoints.0.inputs.last_frame.field",
      message: expect.stringContaining('"start_image_url" is mapped by both'),
    })
  })

  it("reports a root-level problem with an empty path", () => {
    expect(validateFamily("not a family").issues).toEqual([
      { path: "", message: expect.any(String) },
    ])
  })
})
