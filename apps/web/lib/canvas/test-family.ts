/**
 * Test-only: a family descriptor built the way main builds one
 * (`apps/desktop/src/main/model-registry/family-descriptor.ts`), from the
 * bundled Seedance 2.5 mapping and the same pure contract rules, so canvas
 * tests exercise a real family node without the main process.
 *
 * Imported only by `*.test.ts(x)` files.
 */
import {
  chooseEndpoint,
  familyInputSchema,
  familyKey,
  familySlots,
  modelFamilySchema,
  type ModelDescriptor,
  type ModelFamily,
  type ProviderId,
} from "@opendirect/contract"

import seedance from "../../../../registry/models/seedance-2-5.json"

export const SEEDANCE_FAMILY: ModelFamily = modelFamilySchema.parse(seedance)

/** The Replicate endpoint's own fields, trimmed to what the mapping names. */
const ENDPOINT_SCHEMA = {
  type: "object",
  required: ["prompt"],
  properties: {
    prompt: { type: "string", title: "Prompt" },
    image: { type: "string", format: "uri" },
    last_frame_image: { type: "string", format: "uri" },
    reference_images: { type: "array", items: { type: "string" } },
    reference_videos: { type: "array", items: { type: "string" } },
    reference_audios: { type: "array", items: { type: "string" } },
    duration: { type: "integer", minimum: 1, maximum: 30, default: 5 },
    resolution: { type: "string", enum: ["480p", "720p"], default: "720p" },
    aspect_ratio: { type: "string", enum: ["16:9", "9:16"], default: "16:9" },
    seed: { type: "integer" },
    generate_audio: { type: "boolean", default: true },
  },
}

export interface FamilyDescriptorOptions {
  filled?: readonly string[]
  override?: ProviderId | null
  configured?: ProviderId[]
  providerOrder?: ProviderId[]
}

export function seedanceFamilyDescriptor(
  options: FamilyDescriptorOptions = {}
): ModelDescriptor {
  const family = SEEDANCE_FAMILY
  const configured = options.configured ?? ["replicate", "openrouter"]
  const providerOrder = options.providerOrder ?? ["replicate", "openrouter"]
  const override = options.override ?? null
  const choice = chooseEndpoint(family, {
    filled: options.filled ?? [],
    providerOrder,
    configured,
    override,
  })
  const index = choice.index ?? 0
  const endpoint = family.endpoints[index]!
  const { inputSchema, commonControls } = familyInputSchema(
    endpoint,
    ENDPOINT_SCHEMA
  )
  return {
    key: familyKey(family.id),
    provider: endpoint.provider,
    slug: endpoint.model,
    name: family.name,
    description: null,
    kind: family.kind,
    versionId: null,
    coverImageUrl: null,
    inputSchema,
    outputSchema: null,
    referenceSlots: familySlots(family).map((slot) => ({
      ...slot,
      required: endpoint.inputs[slot.field]?.required === true,
    })),
    commonControls,
    pricing: {
      basis: "per_second",
      currency: "USD",
      skus: {},
      estimate: null,
      source: "local_table",
      note: null,
    },
    raw: null,
    fetchedAt: 0,
    family: {
      family,
      source: "bundled",
      configured,
      providerOrder,
      override,
      choice: choice.ok
        ? {
            index: choice.index,
            missing: choice.missing,
            unsupported: [],
            message: null,
          }
        : {
            index: choice.index,
            missing: [],
            unsupported: choice.unsupported,
            message: choice.message,
          },
    },
    mappedBy: null,
  } as ModelDescriptor
}
