/**
 * The OpenRouter provider adapter.
 *
 * OpenRouter publishes no per-model JSON Schema. Its media catalogs describe a
 * model as a *capability descriptor* instead, so this adapter reads both
 * catalogs and synthesises the schema (see `openrouter-schema.ts`) that drives
 * the creation form. What it never does is normalize away the provider's own
 * words: `pricing_skus` are carried verbatim, unknown capability keys survive,
 * and the whole payload is kept in `raw`.
 *
 * Transport: plain `fetch`. `@openrouter/sdk` (1.2.128) does now expose
 * `videoGeneration.listVideosModels()` and `images.listModels()`, but it
 * validates responses against generated zod models that drop anything the
 * generator did not know about — exactly the fields OpenDirect promises to
 * carry through untouched. The SDK remains the reference for the request and
 * response *shapes* used below (frame images, input references, job statuses),
 * and stays the right tool for the text endpoints.
 *
 * ⛔ `submit` is the paid call. Everything in this file is exercised against
 * `msw` handlers backed by fixtures recorded from the two free `GET` catalog
 * endpoints — never the live generation API.
 */
import {
  modelKey,
  unknownPricing,
  type CommonControls,
  type ModelDescriptor,
  type ModelKind,
  type ModelSummary,
  type Pricing,
  type PricingBasis,
} from "@opendirect/contract"

import {
  INPUT_REFERENCES,
  buildImageInputSchema,
  buildVideoInputSchema,
  type OpenRouterImageModel,
  type OpenRouterVideoModel,
} from "./openrouter-schema"
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

const API_BASE = "https://openrouter.ai/api/v1"

/** Attribution headers OpenRouter uses to label traffic in its dashboard. */
const APP_HEADERS = {
  "HTTP-Referer": "https://github.com/opendirect/opendirect",
  "X-Title": "OpenDirect",
}

const PRICING_NOTE =
  "Rates published by OpenRouter for this model. The exact cost is reported by the API when the job completes."

const NO_PRICING_NOTE =
  "OpenRouter publishes no pricing SKUs for this model; it reports the actual cost when the job completes."

const CANCEL_NOTE =
  "An OpenRouter video job cannot be cancelled once submitted — the API exposes no cancel endpoint — so it will run to completion and be billed."

/** Locally issued job ids for image generations, which have no job id. */
const LOCAL_IMAGE_PREFIX = "openrouter-image:"

/** A model the catalogs do not (or no longer) list. The picker shows it as unavailable. */
export class ModelUnavailableError extends Error {
  constructor(readonly slug: string) {
    super(
      `OpenRouter model "${slug}" is unavailable — it is not listed in the video or image catalog.`
    )
    this.name = "ModelUnavailableError"
  }
}

export interface OpenRouterProviderDeps {
  /** Resolved OpenRouter key, or null when the vault and env are both empty. */
  getKey: () => string | null
  /** Injected for deterministic `fetchedAt` in tests. */
  now?: () => number
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null
}

/** An endpoint OpenRouter does not serve. Tolerated for catalogs, fatal for jobs. */
class NotFoundError extends Error {}

/** The one place a provider error message is composed. */
async function httpError(response: Response): Promise<Error> {
  if (response.status === 401 || response.status === 403) {
    return new Error(
      `OpenRouter rejected the OpenRouter API key (HTTP ${response.status}). Check the key in Settings.`
    )
  }

  let detail = ""
  try {
    const body: unknown = await response.json()
    const error = isObject(body) ? body.error : null
    detail =
      asString(error) ??
      (isObject(error) ? (asString(error.message) ?? "") : "") ??
      ""
  } catch {
    detail = ""
  }
  const message = `OpenRouter request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}.`
  return response.status === 404
    ? new NotFoundError(message)
    : new Error(message)
}

/** Pricing basis inferred from the SKU key names, which vary per model. */
function basisOf(skus: Record<string, string>): PricingBasis {
  const keys = Object.keys(skus)
  if (keys.some((key) => key.startsWith("duration_seconds")))
    return "per_second"
  if (keys.some((key) => key.includes("token"))) return "per_token"
  if (keys.length > 0) return "per_output"
  return "unknown"
}

/** `pricing_skus`, verbatim — the keys differ per model and are never rewritten. */
function pricingFor(skus: unknown): Pricing {
  const entries: Record<string, string> = {}
  if (isObject(skus)) {
    for (const [key, value] of Object.entries(skus)) {
      if (typeof value === "string") entries[key] = value
      else if (typeof value === "number") entries[key] = String(value)
    }
  }
  if (Object.keys(entries).length === 0)
    return { ...unknownPricing, note: NO_PRICING_NOTE }

  return {
    basis: basisOf(entries),
    currency: "USD",
    skus: entries,
    // A pre-flight number needs the form values; the creation bar calls
    // `estimateCost` with them. The descriptor only carries the rates.
    estimate: null,
    source: "provider_api",
    note: PRICING_NOTE,
  }
}

function commonControlsOf(inputSchema: JsonObject): CommonControls {
  const properties = isObject(inputSchema.properties)
    ? inputSchema.properties
    : {}
  const present = (field: string): string | null =>
    field in properties ? field : null

  return {
    prompt: present("prompt"),
    aspectRatio: present("aspect_ratio"),
    duration: present("duration"),
    resolution: present("resolution") ?? present("size"),
    seed: present("seed"),
    audio: present("generate_audio"),
  }
}

function summaryOf(
  model: { id: string; name?: string | null; description?: string | null },
  kind: ModelKind
): ModelSummary {
  return {
    key: modelKey("openrouter", model.id),
    provider: "openrouter",
    slug: model.id,
    name: asString(model.name) ?? model.id,
    description: asString(model.description),
    kind,
    // The media catalogs carry no imagery.
    coverImageUrl: null,
  }
}

/** `pending` … → the normalized job status. */
const STATUS_MAP: Record<string, ProviderJobStatus> = {
  pending: "queued",
  in_progress: "running",
  completed: "succeeded",
  failed: "failed",
  cancelled: "canceled",
  canceled: "canceled",
  // An expired job never produced an output and never will.
  expired: "failed",
}

/**
 * The fields `POST /api/v1/images` names itself (per `@openrouter/sdk`'s
 * `ImageGenerationRequest`). Anything else in a form submission is a
 * passthrough parameter and is nested under `provider.options`.
 */
const IMAGE_REQUEST_FIELDS = [
  "prompt",
  "n",
  "aspect_ratio",
  "background",
  "quality",
  "resolution",
  "size",
  "seed",
  "output_format",
  "output_compression",
]

const VIDEO_EXTENSIONS = /\.(mp4|mov|webm|mkv|m4v)(\?|#|$)/i
const AUDIO_EXTENSIONS = /\.(mp3|wav|m4a|aac|flac|ogg|opus)(\?|#|$)/i

/**
 * A reference URL → the content part OpenRouter expects. The API discriminates
 * on the part type, and the only signal an asset URL carries is its extension;
 * anything unrecognised is sent as an image, which is what every video model
 * accepts.
 */
function inputReferencePart(url: string): JsonObject {
  if (VIDEO_EXTENSIONS.test(url))
    return { type: "video_url", video_url: { url } }
  if (AUDIO_EXTENSIONS.test(url))
    return { type: "audio_url", audio_url: { url } }
  return { type: "image_url", image_url: { url } }
}

/**
 * The provider slug an endpoints document names, or null.
 *
 * The two documents disagree in shape: the image one
 * (`GET /api/v1/images/models/{id}/endpoints`) states `provider_slug`, while
 * the generic one (`GET /api/v1/models/{canonical_slug}/endpoints`, the only
 * per-endpoint view of a video model) states a `tag` instead — for
 * `bytedance/seedance-2.5` that tag is `seed`, not `bytedance`. Both are read,
 * first endpoint wins, because `provider.options` is keyed by exactly this
 * slug and OpenRouter silently drops options under an unrecognised key.
 */
export function providerSlugOf(document: unknown): string | null {
  const root = isObject(document) ? document : {}
  const body = isObject(root.data) ? root.data : root
  const endpoints = Array.isArray(body.endpoints) ? body.endpoints : []
  for (const endpoint of endpoints) {
    if (!isObject(endpoint)) continue
    const slug =
      asString(endpoint.provider_slug) ??
      asString(endpoint.provider_tag) ??
      asString(endpoint.tag)
    if (slug) return slug
  }
  return null
}

/**
 * The fallback slug when no endpoints document can be read: the owner segment
 * of the model id. It is a guess — `bytedance/seedance-2.5` is served by
 * `seed` — but sending a passthrough parameter under a slug OpenRouter may
 * ignore beats dropping the user's value on the floor.
 */
function ownerSlug(slug: string): string {
  const owner = slug.split("/")[0]
  return owner && owner.length > 0 ? owner : slug
}

function urlList(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : []
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === "string")
  return []
}

export function createOpenRouterProvider(
  deps: OpenRouterProviderDeps
): ModelProvider {
  const now = deps.now ?? Date.now
  /** Cached catalog fetches; a rejection is dropped so the next call retries. */
  let videoCatalog: Promise<Map<string, OpenRouterVideoModel>> | null = null
  let imageCatalog: Promise<Map<string, OpenRouterImageModel>> | null = null
  /** model id → provider slug, resolved lazily from its endpoints document. */
  const providerSlugs = new Map<string, string>()
  /** Image generations complete in one call, so their result is held here. */
  const imageJobs = new Map<string, ProviderJobState>()
  let imageJobCounter = 0

  function key(): string | null {
    const value = deps.getKey()?.trim()
    return value ? value : null
  }

  function headers(): Record<string, string> {
    const auth = key()
    if (!auth) {
      throw new Error(
        "No OpenRouter API key is configured. Add one in Settings to use OpenRouter models."
      )
    }
    return {
      Authorization: `Bearer ${auth}`,
      "Content-Type": "application/json",
      ...APP_HEADERS,
    }
  }

  async function request(
    path: string,
    init: RequestInit = {}
  ): Promise<unknown> {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: headers(),
    })
    if (!response.ok) throw await httpError(response)
    return response.json()
  }

  /**
   * One catalog, indexed by slug. A catalog endpoint that 404s yields an empty
   * index rather than an error: a retired endpoint means "no models of this
   * modality", and must not take the other modality down with it. An auth
   * failure or a 500 still propagates.
   */
  async function fetchCatalog<T extends { id: string }>(
    path: string
  ): Promise<Map<string, T>> {
    const models = new Map<string, T>()
    let body: unknown
    try {
      body = await request(path)
    } catch (error) {
      if (error instanceof NotFoundError) return models
      throw error
    }
    const data = isObject(body) && Array.isArray(body.data) ? body.data : []
    for (const model of data) {
      if (isObject(model) && typeof model.id === "string")
        models.set(model.id, model as T)
    }
    return models
  }

  function videoModels(): Promise<Map<string, OpenRouterVideoModel>> {
    videoCatalog ??= fetchCatalog<OpenRouterVideoModel>("/videos/models").catch(
      (error: unknown) => {
        videoCatalog = null
        throw error
      }
    )
    return videoCatalog
  }

  function imageModels(): Promise<Map<string, OpenRouterImageModel>> {
    imageCatalog ??= fetchCatalog<OpenRouterImageModel>("/images/models").catch(
      (error: unknown) => {
        imageCatalog = null
        throw error
      }
    )
    return imageCatalog
  }

  /** The capability descriptor for a slug, from whichever catalog lists it. */
  async function findModel(
    slug: string
  ): Promise<
    | { kind: "video"; model: OpenRouterVideoModel }
    | { kind: "image"; model: OpenRouterImageModel }
  > {
    const videoModel = (await videoModels()).get(slug)
    if (videoModel) return { kind: "video", model: videoModel }

    const imageModel = (await imageModels()).get(slug)
    if (imageModel) return { kind: "image", model: imageModel }

    throw new ModelUnavailableError(slug)
  }

  function descriptorOf(
    slug: string,
    found:
      | { kind: "video"; model: OpenRouterVideoModel }
      | { kind: "image"; model: OpenRouterImageModel }
  ): ModelDescriptor {
    const inputSchema =
      found.kind === "video"
        ? buildVideoInputSchema(found.model)
        : buildImageInputSchema(found.model)

    return {
      key: modelKey("openrouter", slug),
      provider: "openrouter",
      slug,
      name: asString(found.model.name) ?? slug,
      description: asString(found.model.description),
      kind: found.kind,
      // OpenRouter pins no version; `canonical_slug` records the dated build.
      versionId: null,
      coverImageUrl: null,
      inputSchema,
      // OpenRouter publishes no output schema; we never invent one.
      outputSchema: null,
      referenceSlots: deriveReferenceSlots(inputSchema),
      commonControls: commonControlsOf(inputSchema),
      pricing:
        found.kind === "video"
          ? pricingFor(found.model.pricing_skus)
          : pricingFor(null),
      raw: found.model,
      fetchedAt: now(),
    }
  }

  /**
   * The provider slug to key `provider.options` by, for a model that has
   * passthrough parameters to send. Fetched only when there is something to
   * pass through, cached per model, and never fatal: an unreadable endpoints
   * document falls back to the owner segment rather than failing the job.
   */
  async function providerSlugFor(
    slug: string,
    found:
      | { kind: "video"; model: OpenRouterVideoModel }
      | { kind: "image"; model: OpenRouterImageModel }
  ): Promise<string> {
    const cached = providerSlugs.get(slug)
    if (cached) return cached

    const path =
      found.kind === "video"
        ? `/models/${asString(found.model.canonical_slug) ?? slug}/endpoints`
        : `/images/models/${slug}/endpoints`

    let resolved: string | null = null
    try {
      resolved = providerSlugOf(await request(path))
    } catch {
      resolved = null
    }

    const result = resolved ?? ownerSlug(slug)
    providerSlugs.set(slug, result)
    return result
  }

  /**
   * `provider.options.<provider_slug>` for the leftover form values.
   *
   * Everything the request body does not name itself is a passthrough
   * parameter — the synthesized schema only ever emits documented fields plus
   * the model's own `allowed_passthrough_parameters` — and OpenRouter takes
   * those nested under the serving provider's slug, not at the top level.
   */
  async function providerOptions(
    slug: string,
    found:
      | { kind: "video"; model: OpenRouterVideoModel }
      | { kind: "image"; model: OpenRouterImageModel },
    passthrough: JsonObject
  ): Promise<JsonObject> {
    if (Object.keys(passthrough).length === 0) return {}
    const providerSlug = await providerSlugFor(slug, found)
    return { provider: { options: { [providerSlug]: passthrough } } }
  }

  /** Splits form values into the request's own fields and the passthrough rest. */
  function take(
    params: JsonObject,
    fields: string[]
  ): [JsonObject, JsonObject] {
    const taken: JsonObject = {}
    const rest: JsonObject = { ...params }
    for (const field of fields) {
      if (field in rest) {
        taken[field] = rest[field]
        delete rest[field]
      }
    }
    return [taken, rest]
  }

  async function submitVideo(
    req: GenerationRequest,
    found: { kind: "video"; model: OpenRouterVideoModel }
  ): Promise<ProviderJobRef> {
    const frames = found.model.supported_frame_images ?? []
    const [known, passthrough] = take(req.params as JsonObject, [
      "prompt",
      "duration",
      "resolution",
      "aspect_ratio",
      "size",
      "generate_audio",
      "seed",
      "upscale_factor",
      "creativity",
      INPUT_REFERENCES,
      ...frames,
    ])

    const frameImages = frames.flatMap((frame) =>
      urlList(known[frame]).map((url) => ({
        type: "image_url",
        frame_type: frame,
        image_url: { url },
      }))
    )
    const references = urlList(known[INPUT_REFERENCES]).map(inputReferencePart)
    for (const frame of frames) delete known[frame]
    delete known[INPUT_REFERENCES]

    const body: JsonObject = {
      model: req.slug,
      ...known,
      ...(frameImages.length > 0 ? { frame_images: frameImages } : {}),
      ...(references.length > 0 ? { [INPUT_REFERENCES]: references } : {}),
      ...(await providerOptions(req.slug, found, passthrough)),
    }

    const response = await request("/videos", {
      method: "POST",
      body: JSON.stringify(body),
    })
    const job = isObject(response) ? response : {}
    const id = asString(job.id)
    if (!id) throw new Error("OpenRouter returned a video job with no id.")

    return {
      provider: "openrouter",
      id,
      pollUrl: asString(job.polling_url),
    }
  }

  /**
   * Image generation is synchronous: one POST returns the images. The job
   * runner still speaks submit/poll, so the finished state is parked under a
   * locally issued id and handed back on the first poll.
   */
  async function submitImage(
    req: GenerationRequest,
    found: { kind: "image"; model: OpenRouterImageModel }
  ): Promise<ProviderJobRef> {
    const [known, passthrough] = take(req.params as JsonObject, [
      ...IMAGE_REQUEST_FIELDS,
      INPUT_REFERENCES,
    ])
    const references = urlList(known[INPUT_REFERENCES]).map((url) => ({
      type: "image_url",
      image_url: { url },
    }))
    delete known[INPUT_REFERENCES]

    // The image router is `POST /api/v1/images`; `/images/generations` is the
    // OpenAI-compatible spelling, which OpenRouter does not serve.
    const response = await request("/images", {
      method: "POST",
      body: JSON.stringify({
        model: req.slug,
        ...known,
        ...(references.length > 0 ? { [INPUT_REFERENCES]: references } : {}),
        ...(await providerOptions(req.slug, found, passthrough)),
      }),
    })

    const id = `${LOCAL_IMAGE_PREFIX}${(imageJobCounter += 1)}`
    const ref: ProviderJobRef = { provider: "openrouter", id, pollUrl: null }
    const body = isObject(response) ? response : {}
    const images = Array.isArray(body.data) ? body.data : []
    const usage = isObject(body.usage) ? body.usage : null

    imageJobs.set(id, {
      ref,
      status: "succeeded",
      progress: null,
      // OpenRouter returns image bytes, not URLs; a data URL is the honest
      // way to hand the job runner something it can download.
      outputUrls: images.flatMap((image) => {
        if (!isObject(image)) return []
        const b64 = asString(image.b64_json)
        if (!b64) return []
        return [
          `data:${asString(image.media_type) ?? "image/png"};base64,${b64}`,
        ]
      }),
      costUsd: typeof usage?.cost === "number" ? usage.cost : null,
      error: null,
      raw: body,
    })
    return ref
  }

  return {
    id: "openrouter",

    isConfigured() {
      return key() !== null
    },

    async listModels(opts: ListModelsOptions): Promise<ModelSummary[]> {
      const wanted = new Set(opts.kinds)
      const summaries: ModelSummary[] = []

      if (wanted.has("video")) {
        for (const model of (await videoModels()).values())
          summaries.push(summaryOf(model, "video"))
      }
      if (wanted.has("image")) {
        for (const model of (await imageModels()).values())
          summaries.push(summaryOf(model, "image"))
      }

      return summaries
    },

    async getModel(slug: string): Promise<ModelDescriptor> {
      return descriptorOf(slug, await findModel(slug))
    },

    /** ⛔ The paid call. */
    async submit(req: GenerationRequest): Promise<ProviderJobRef> {
      const found = await findModel(req.slug)
      return found.kind === "video"
        ? submitVideo(req, found)
        : submitImage(req, found)
    },

    async poll(ref: ProviderJobRef): Promise<ProviderJobState> {
      if (ref.id.startsWith(LOCAL_IMAGE_PREFIX)) {
        const state = imageJobs.get(ref.id)
        if (state) return state
        // Cancelled (or collected by an earlier run) — there is nothing left
        // to poll, and inventing a "running" job would hang the job list.
        return {
          ref,
          status: "canceled",
          progress: null,
          outputUrls: [],
          costUsd: null,
          error: null,
          raw: null,
        }
      }

      const response = await request(`/videos/${encodeURIComponent(ref.id)}`)
      const job = isObject(response) ? response : {}
      const status = STATUS_MAP[String(job.status)] ?? "running"
      const usage = isObject(job.usage) ? job.usage : null

      return {
        ref: {
          ...ref,
          pollUrl: asString(job.polling_url) ?? ref.pollUrl ?? null,
        },
        status,
        // OpenRouter reports no percentage; the job list shows an
        // indeterminate state rather than an invented number.
        progress: null,
        outputUrls: status === "succeeded" ? urlList(job.unsigned_urls) : [],
        costUsd: typeof usage?.cost === "number" ? usage.cost : null,
        error: asString(job.error),
        raw: job,
      }
    },

    async cancel(ref: ProviderJobRef): Promise<void> {
      if (ref.id.startsWith(LOCAL_IMAGE_PREFIX)) {
        imageJobs.delete(ref.id)
        return
      }
      throw new Error(CANCEL_NOTE)
    },
  }
}
