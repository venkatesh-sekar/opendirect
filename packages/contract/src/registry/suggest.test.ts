import { describe, expect, it } from "vitest"

import replicateFixture from "../../../../test/fixtures/replicate/model-seedance-2.5.json"
import openrouterFixture from "../../../../test/fixtures/openrouter/videos-models.json"
import { buildVideoInputSchema } from "../../../../apps/desktop/src/main/providers/openrouter-schema"
import { dereferenceCogSchema } from "../../../../apps/desktop/src/main/providers/replicate"
import { deriveReferenceSlots } from "../../../../apps/desktop/src/main/providers/reference-slots"
import { unknownPricing, type ModelDescriptor } from "../model"
import { checkEndpointAgainstSchema } from "./check"
import { mappingEndpointSchema } from "./schema"
import { suggestEndpointMapping } from "./suggest"

type OpenRouterVideoModel = Parameters<typeof buildVideoInputSchema>[0]

function descriptor(
  provider: ModelDescriptor["provider"],
  slug: string,
  inputSchema: Record<string, unknown>
): ModelDescriptor {
  const properties = inputSchema.properties as Record<string, unknown>
  const present = (field: string) => (field in properties ? field : null)
  return {
    key: `${provider}:${slug}`,
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
      prompt: present("prompt"),
      aspectRatio: present("aspect_ratio"),
      duration: present("duration"),
      resolution: present("resolution"),
      seed: present("seed"),
      audio: present("generate_audio"),
    },
    pricing: unknownPricing,
    raw: null,
    fetchedAt: 0,
    family: null,
    mappedBy: null,
  }
}

const schemas = replicateFixture.latest_version.openapi_schema.components
  .schemas as Record<string, unknown>
const replicateSchema = dereferenceCogSchema(schemas.Input, schemas) as Record<
  string,
  unknown
>
const replicateSeedance = descriptor(
  "replicate",
  "bytedance/seedance-2.5",
  replicateSchema
)

const openrouterModel = openrouterFixture.data.find(
  (model) => model.id === "bytedance/seedance-2.5"
) as unknown as OpenRouterVideoModel
const openrouterSchema = buildVideoInputSchema(openrouterModel)
const openrouterSeedance = descriptor(
  "openrouter",
  "bytedance/seedance-2.5",
  openrouterSchema
)

describe("suggestEndpointMapping on OpenRouter's manifest", () => {
  const { endpoint, fields } = suggestEndpointMapping(openrouterSeedance)

  it("maps the manifest frame images and references with manifest confidence", () => {
    expect(endpoint.inputs.first_frame).toMatchObject({
      field: "first_frame",
      kind: "image",
    })
    expect(endpoint.inputs.last_frame).toMatchObject({ field: "last_frame" })
    expect(endpoint.inputs.reference).toMatchObject({
      field: "input_references",
      kind: "any",
    })
    const byField = Object.fromEntries(fields.map((f) => [f.field, f]))
    expect(byField.first_frame).toMatchObject({
      as: { input: "first_frame" },
      confidence: "manifest",
      why: "OpenRouter lists first_frame in supported_frame_images",
    })
    expect(byField.input_references!.confidence).toBe("manifest")
  })

  it("maps the common controls", () => {
    expect(endpoint.controls).toEqual({
      prompt: { field: "prompt" },
      aspect_ratio: { field: "aspect_ratio" },
      duration: { field: "duration" },
      resolution: { field: "resolution" },
      seed: { field: "seed" },
      generate_audio: { field: "generate_audio" },
    })
  })

  it("leaves everything else for Advanced", () => {
    const watermark = fields.find((f) => f.field === "watermark")!
    expect(watermark).toMatchObject({ as: null, confidence: "none" })
  })

  it("drafts a mapping that validates and fits the schema", () => {
    expect(mappingEndpointSchema.safeParse(endpoint).success).toBe(true)
    expect(checkEndpointAgainstSchema(endpoint, openrouterSchema)).toEqual([])
  })
})

describe("suggestEndpointMapping on Replicate's schema", () => {
  const { endpoint, fields } = suggestEndpointMapping(replicateSeedance)
  const byField = Object.fromEntries(fields.map((f) => [f.field, f]))

  it("reads first_frame from the description", () => {
    expect(endpoint.inputs.first_frame).toMatchObject({
      field: "image",
      kind: "image",
    })
    expect(byField.image).toMatchObject({
      as: { input: "first_frame" },
      confidence: "schema",
    })
  })

  it("keeps a name hint the description agrees with", () => {
    expect(endpoint.inputs.last_frame).toMatchObject({
      field: "last_frame_image",
    })
  })

  it("reads lip-sync audio as the soundtrack", () => {
    expect(endpoint.inputs.soundtrack).toMatchObject({
      field: "reference_audios",
      kind: "audio",
      max: 10,
    })
    expect(byField.reference_audios!.confidence).toBe("schema")
  })

  it("numbers repeated roles in schema order", () => {
    expect(endpoint.inputs.reference).toMatchObject({
      field: "reference_images",
      max: 30,
    })
    expect(byField.reference_images).toMatchObject({ confidence: "name" })
  })

  it("drafts a mapping that validates and fits the schema", () => {
    expect(mappingEndpointSchema.safeParse(endpoint).success).toBe(true)
    expect(checkEndpointAgainstSchema(endpoint, replicateSchema)).toEqual([])
  })
})

describe("suggestEndpointMapping rules", () => {
  function withSlots(properties: Record<string, unknown>) {
    return descriptor("replicate", "acme/x", { type: "object", properties })
  }

  it("gives a repeated role :2 in schema order", () => {
    const { endpoint } = suggestEndpointMapping(
      withSlots({
        ref_images: { type: "array", items: { type: "string", format: "uri" } },
        ref_videos: { type: "array", items: { type: "string", format: "uri" } },
      })
    )
    expect(endpoint.inputs.reference!.field).toBe("ref_images")
    expect(endpoint.inputs["reference:2"]!.field).toBe("ref_videos")
  })

  it("reads mask, structure and style from the description", () => {
    const { fields } = suggestEndpointMapping(
      withSlots({
        m: { type: "string", format: "uri", description: "Inpainting mask." },
        d: {
          type: "string",
          format: "uri",
          description: "A depth map to follow.",
        },
        s: {
          type: "string",
          format: "uri",
          description: "A style reference image.",
        },
        c: {
          type: "string",
          format: "uri",
          description: "A style reference for the character.",
        },
      })
    )
    const roles = fields.map((f) =>
      f.as && "input" in f.as ? f.as.input : null
    )
    expect(roles).toEqual(["mask", "structure", "style", "reference"])
    expect(fields[3]!.confidence).toBe("none")
  })

  it("marks a required field required", () => {
    const { endpoint } = suggestEndpointMapping(
      descriptor("replicate", "acme/x", {
        type: "object",
        required: ["start_image"],
        properties: { start_image: { type: "string", format: "uri" } },
      })
    )
    expect(endpoint.inputs.first_frame).toMatchObject({
      field: "start_image",
      required: true,
    })
  })

  it("maps negative_prompt and the output count", () => {
    const { endpoint } = suggestEndpointMapping(
      withSlots({
        negative_prompt: { type: "string" },
        num_outputs: { type: "integer", maximum: 4 },
      })
    )
    expect(endpoint.controls).toEqual({
      negative_prompt: { field: "negative_prompt" },
      count: { field: "num_outputs" },
    })
  })

  it("returns an existing mapping unchanged", () => {
    const existing = mappingEndpointSchema.parse({
      provider: "replicate",
      model: "bytedance/seedance-2.5",
      inputs: { character: { field: "reference_images", kind: "image" } },
      controls: { prompt: { field: "prompt" } },
    })
    const { endpoint, fields } = suggestEndpointMapping(
      { ...replicateSeedance, mappedBy: { familyId: "x", source: "bundled" } },
      existing
    )
    expect(endpoint).toBe(existing)
    const byField = Object.fromEntries(fields.map((f) => [f.field, f]))
    expect(byField.reference_images).toMatchObject({
      as: { input: "character" },
      confidence: "schema",
    })
    expect(byField.prompt).toMatchObject({ as: { control: "prompt" } })
    expect(byField.watermark).toMatchObject({ as: null })
  })
})
