/**
 * The Replicate provider adapter.
 *
 * Replicate publishes each model's Cog-generated OpenAPI document at
 * `latest_version.openapi_schema`, which means the generation form is driven
 * by the model's own schema and OpenDirect never hardcodes a parameter. This
 * adapter's whole job is to turn that payload into a `ModelDescriptor`:
 *
 * - `components.schemas.Input` becomes `inputSchema`, with Cog's `$ref`/`allOf`
 *   enum indirection flattened so `@rjsf/shadcn` can render it directly.
 * - URI-typed inputs become reference slots (see `reference-slots.ts`).
 * - A handful of well-known fields are lifted into `commonControls`; nothing
 *   is removed from the schema in the process.
 * - Pricing comes from the hand-maintained table in `cost.ts`, because
 *   Replicate's API exposes no pricing field at all.
 *
 * ⛔ `submit` is the one paid call in this file. It is exercised only against
 * `msw` handlers backed by recorded fixtures — never the live API. Model and
 * collection reads are free `GET`s.
 */
import {
  modelKey,
  unknownPricing,
  type ModelDescriptor,
  type ModelKind,
  type ModelSummary,
  type Pricing,
  type CommonControls,
} from "@opendirect/contract"
import Replicate, { type Model, type Prediction } from "replicate"

import { REPLICATE_PRICING } from "./cost"
import { deriveReferenceSlots } from "./reference-slots"
import type {
  GenerationRequest,
  ListModelsOptions,
  ModelProvider,
  ProviderJobRef,
  ProviderJobState,
  ProviderJobStatus,
} from "./types"

type JsonObject = Record<string, unknown>

export interface ReplicateProviderDeps {
  /** Resolved Replicate token, or null when the vault and env are both empty. */
  getKey: () => string | null
  /** Injected for deterministic `fetchedAt` in tests. */
  now?: () => number
  /** Overridden only by tests and the read-only verification script. */
  baseUrl?: string
}

/**
 * Collections seeded into the catalog, and the kind each one implies.
 *
 * `official` carries no modality of its own — it is included because it is the
 * only collection listing some flagship models (verified 2026-09-16:
 * `bytedance/seedance-2.5` appears in `official` and in no typed collection),
 * and its members fall through to schema inference.
 */
const SEED_COLLECTIONS: Array<[slug: string, kind: ModelKind | null]> = [
  ["text-to-video", "video"],
  ["image-to-video", "video"],
  ["video-editing", "video"],
  ["text-to-image", "image"],
  ["image-editing", "image"],
  ["official", null],
]

const PRICING_NOTE =
  "Pricing is not exposed by the Replicate API, so this rate is transcribed by hand from the model's public page (2026-09-16) and is an unverified estimate."

const NO_PRICE_NOTE =
  "No published rate for this model in OpenDirect's Replicate pricing table, so no cost can be estimated."

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** `bytedance/seedance-2.5` → `["bytedance", "seedance-2.5"]`. */
export function splitSlug(slug: string): [owner: string, name: string] {
  const parts = slug.split("/")
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `"${slug}" is not a Replicate model slug; expected "owner/name".`
    )
  }
  return [parts[0], parts[1]]
}

/**
 * Flattens the indirection Cog emits for enums.
 *
 * Cog renders an enum input as `{ allOf: [{ $ref: "#/components/schemas/x" }],
 * default, description }`, which rjsf cannot render. This resolves internal
 * `$ref`s against `components.schemas`, merges `allOf` members left to right,
 * and lets the referring property's own keywords (`default`, `description`,
 * `x-order`) win over the referenced definition's.
 *
 * Anything it cannot resolve — an external `$ref`, a cycle — is returned
 * untouched rather than dropped: a schema we half-understand still renders.
 */
export function dereferenceCogSchema(
  schema: unknown,
  schemas: Record<string, unknown>,
  seen: ReadonlySet<string> = new Set()
): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => dereferenceCogSchema(item, schemas, seen))
  }
  if (!isObject(schema)) return schema

  const ref = schema.$ref
  if (typeof ref === "string") {
    const prefix = "#/components/schemas/"
    if (!ref.startsWith(prefix)) return schema
    const name = ref.slice(prefix.length)
    // A definition that (transitively) refers to itself is left as the raw
    // `$ref`; expanding it would never terminate.
    if (seen.has(name) || !(name in schemas)) return schema
    const rest = { ...schema }
    delete rest.$ref
    const resolved = dereferenceCogSchema(
      schemas[name],
      schemas,
      new Set([...seen, name])
    )
    return isObject(resolved)
      ? {
          ...resolved,
          ...(dereferenceCogSchema(rest, schemas, seen) as JsonObject),
        }
      : resolved
  }

  const out: JsonObject = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key === "allOf") continue
    out[key] = dereferenceCogSchema(value, schemas, seen)
  }

  if (Array.isArray(schema.allOf)) {
    let merged: JsonObject = {}
    for (const member of schema.allOf) {
      const resolved = dereferenceCogSchema(member, schemas, seen)
      if (isObject(resolved)) merged = { ...merged, ...resolved }
    }
    // Sibling keywords on the referring property win — that is where Cog puts
    // the real default and the model author's description.
    return { ...merged, ...out }
  }

  return out
}

/** The `components.schemas` map, or an empty map when the model has no schema. */
function schemasOf(model: Model): Record<string, unknown> {
  const openapi = model.latest_version?.openapi_schema
  if (!isObject(openapi) || !isObject(openapi.components)) return {}
  const schemas = openapi.components.schemas
  return isObject(schemas) ? schemas : {}
}

function inputSchemaOf(model: Model): JsonObject {
  const schemas = schemasOf(model)
  const input = dereferenceCogSchema(schemas.Input, schemas)
  return isObject(input) ? input : { type: "object", properties: {} }
}

function outputSchemaOf(model: Model): JsonObject | null {
  const schemas = schemasOf(model)
  const output = dereferenceCogSchema(schemas.Output, schemas)
  return isObject(output) ? output : null
}

function propertiesOf(inputSchema: JsonObject): Record<string, JsonObject> {
  const properties = inputSchema.properties
  if (!isObject(properties)) return {}
  const out: Record<string, JsonObject> = {}
  for (const [key, value] of Object.entries(properties)) {
    if (isObject(value)) out[key] = value
  }
  return out
}

/** The first field name present in `properties`, or null. */
function firstPresent(
  properties: Record<string, JsonObject>,
  candidates: string[]
): string | null {
  return candidates.find((field) => field in properties) ?? null
}

function commonControlsOf(inputSchema: JsonObject): CommonControls {
  const properties = propertiesOf(inputSchema)
  return {
    prompt: firstPresent(properties, ["prompt", "text", "text_prompt"]),
    aspectRatio: firstPresent(properties, ["aspect_ratio", "aspectRatio"]),
    duration: firstPresent(properties, ["duration", "duration_seconds"]),
    resolution: firstPresent(properties, ["resolution", "size"]),
    seed: firstPresent(properties, ["seed"]),
    audio: firstPresent(properties, ["generate_audio", "audio"]),
  }
}

function enumValues(schema: JsonObject | undefined): string[] {
  const values = schema?.enum
  return Array.isArray(values)
    ? values.filter((v): v is string => typeof v === "string")
    : []
}

/**
 * Modality from the model's own schema, used when no collection claims it.
 *
 * The plan's first-choice signal — a media type on the output schema — does
 * not exist in practice: every Cog model verified on 2026-09-16 declares its
 * output as a bare `{"type":"string","format":"uri"}`. So the modality is read
 * off the inputs instead: a duration/frame-count/audio control means video,
 * an image-only container format means image. Unrecognised stays `other`
 * rather than becoming a guess.
 */
export function inferKindFromSchema(
  inputSchema: JsonObject,
  outputSchema: JsonObject | null
): ModelKind {
  const properties = propertiesOf(inputSchema)
  const formats = enumValues(properties.output_format).map((v) =>
    v.toLowerCase()
  )

  if (formats.some((v) => ["mp4", "webm", "mov", "gif"].includes(v)))
    return "video"
  if (
    [
      "duration",
      "duration_seconds",
      "num_frames",
      "fps",
      "generate_audio",
    ].some((field) => field in properties)
  )
    return "video"
  if (formats.some((v) => ["png", "jpg", "jpeg", "webp"].includes(v)))
    return "image"

  const producesUri =
    outputSchema?.format === "uri" ||
    (isObject(outputSchema?.items) && outputSchema.items.format === "uri")
  if (producesUri && ("prompt" in properties || "image" in properties))
    return "image"

  return "other"
}

/** Pricing block for the descriptor: the local table, verbatim, never a guess. */
function pricingFor(slug: string): Pricing {
  const price = REPLICATE_PRICING[slug]
  if (!price) return { ...unknownPricing, note: NO_PRICE_NOTE }

  const skus: Record<string, string> = {}
  for (const [tier, usd] of Object.entries(price.tiers))
    skus[tier] = String(usd)

  return {
    basis: price.basis,
    currency: "USD",
    skus,
    // A pre-flight number needs the form values; the creation bar calls
    // `estimateCost` with them. The descriptor only carries the rates.
    estimate: null,
    source: "local_table",
    note: `${price.note} ${PRICING_NOTE}`,
  }
}

function summaryOf(model: Model, kind: ModelKind): ModelSummary {
  const slug = `${model.owner}/${model.name}`
  return {
    key: modelKey("replicate", slug),
    provider: "replicate",
    slug,
    name: model.name,
    description: model.description ?? null,
    kind,
    coverImageUrl: model.cover_image_url ?? null,
  }
}

const STATUS_MAP: Record<Prediction["status"], ProviderJobStatus> = {
  starting: "queued",
  processing: "running",
  succeeded: "succeeded",
  failed: "failed",
  canceled: "canceled",
  // Replicate reports a run it killed itself as `aborted`; for the job list
  // that is a failure, not a user cancellation.
  aborted: "failed",
}

function outputUrlsOf(output: unknown): string[] {
  const isUrl = (value: unknown): value is string =>
    typeof value === "string" && /^https?:\/\//.test(value)
  if (isUrl(output)) return [output]
  if (Array.isArray(output)) return output.filter(isUrl)
  return []
}

function errorMessageOf(error: unknown): string | null {
  if (typeof error === "string" && error) return error
  if (error instanceof Error) return error.message
  if (isObject(error) && typeof error.detail === "string") return error.detail
  return error == null ? null : String(error)
}

export function createReplicateProvider(
  deps: ReplicateProviderDeps
): ModelProvider {
  const now = deps.now ?? Date.now
  /** slug → kind, populated by `listModels` and reused by `getModel`. */
  const collectionKinds = new Map<string, ModelKind>()

  function key(): string | null {
    const value = deps.getKey()?.trim()
    return value ? value : null
  }

  function client(): Replicate {
    const auth = key()
    if (!auth) {
      throw new Error(
        "No Replicate API key is configured. Add one in Settings to use Replicate models."
      )
    }
    return new Replicate({
      auth,
      ...(deps.baseUrl ? { baseUrl: deps.baseUrl } : {}),
      // Outputs are downloaded to the project folder by the job runner, which
      // wants plain URLs rather than the SDK's lazy `FileOutput` streams.
      useFileOutput: false,
    })
  }

  async function collectionModels(slug: string): Promise<Model[]> {
    try {
      const collection = await client().collections.get(slug)
      return collection.models ?? []
    } catch {
      // A renamed or unavailable collection must not empty the catalog; the
      // remaining collections still seed it.
      return []
    }
  }

  function kindOfCollectionEntry(
    model: Model,
    hint: ModelKind | null
  ): ModelKind {
    if (hint) return hint
    return inferKindFromSchema(inputSchemaOf(model), outputSchemaOf(model))
  }

  return {
    id: "replicate",

    isConfigured() {
      return key() !== null
    },

    async listModels(opts: ListModelsOptions): Promise<ModelSummary[]> {
      const wanted = new Set(opts.kinds)
      const bySlug = new Map<string, ModelSummary>()

      for (const [slug, hint] of SEED_COLLECTIONS) {
        for (const model of await collectionModels(slug)) {
          const modelSlug = `${model.owner}/${model.name}`
          // First collection wins: the typed ones are visited before
          // `official`, so a model keeps its explicit modality.
          if (bySlug.has(modelSlug)) continue
          const kind = kindOfCollectionEntry(model, hint)
          collectionKinds.set(modelSlug, kind)
          bySlug.set(modelSlug, summaryOf(model, kind))
        }
      }

      return [...bySlug.values()].filter((summary) => wanted.has(summary.kind))
    },

    async getModel(slug: string): Promise<ModelDescriptor> {
      const [owner, name] = splitSlug(slug)
      const model = await client().models.get(owner, name)

      const inputSchema = inputSchemaOf(model)
      const outputSchema = outputSchemaOf(model)

      return {
        key: modelKey("replicate", slug),
        provider: "replicate",
        slug,
        name: model.name,
        description: model.description ?? null,
        kind:
          collectionKinds.get(slug) ??
          inferKindFromSchema(inputSchema, outputSchema),
        versionId: model.latest_version?.id ?? null,
        coverImageUrl: model.cover_image_url ?? null,
        inputSchema,
        outputSchema,
        referenceSlots: deriveReferenceSlots(inputSchema),
        commonControls: commonControlsOf(inputSchema),
        pricing: pricingFor(slug),
        raw: model,
        fetchedAt: now(),
      }
    },

    /**
     * ⛔ The paid call. Pins the version when the catalog recorded one, so a
     * model re-published mid-session cannot silently change behaviour.
     */
    async submit(req: GenerationRequest): Promise<ProviderJobRef> {
      splitSlug(req.slug)
      const prediction = await client().predictions.create(
        req.versionId
          ? { version: req.versionId, input: req.params }
          : { model: req.slug, input: req.params }
      )
      return {
        provider: "replicate",
        id: prediction.id,
        pollUrl: prediction.urls?.get ?? null,
      }
    },

    async poll(ref: ProviderJobRef): Promise<ProviderJobState> {
      const prediction = await client().predictions.get(ref.id)
      const status = STATUS_MAP[prediction.status] ?? "running"
      return {
        ref: { ...ref, pollUrl: prediction.urls?.get ?? ref.pollUrl ?? null },
        status,
        // Replicate reports no percentage; the job list shows an indeterminate
        // state rather than an invented number.
        progress: null,
        outputUrls:
          status === "succeeded" ? outputUrlsOf(prediction.output) : [],
        // Replicate bills by hardware-seconds and reports no cost on the
        // prediction, so the actual spend is never known here.
        costUsd: null,
        error: errorMessageOf(prediction.error),
        raw: prediction,
      }
    },

    async cancel(ref: ProviderJobRef): Promise<void> {
      await client().predictions.cancel(ref.id)
    },
  }
}
