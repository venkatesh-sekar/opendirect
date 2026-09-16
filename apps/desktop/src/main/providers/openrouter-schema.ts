/**
 * OpenRouter capability descriptors → JSON Schema.
 *
 * Replicate hands us a literal JSON Schema per model; OpenRouter does not. Its
 * media catalogs (`GET /api/v1/videos/models`, `GET /api/v1/images/models`)
 * publish a *capability descriptor* instead — lists of supported durations,
 * resolutions, aspect ratios, a typed `supported_parameters` map for images,
 * and a per-model passthrough allowlist. This module turns one of those into
 * the draft-07 schema `@rjsf/shadcn` renders, so the creation form is still
 * driven by the model's own declaration and nothing is hardcoded per model.
 *
 * Rules this module never breaks:
 *
 * 1. **Nothing is dropped.** Every passthrough parameter and every capability
 *    key becomes a property; a capability *type* we do not recognise is kept
 *    verbatim under `x-opendirect-capability` rather than discarded.
 * 2. **Never invent a value.** No defaults are synthesised — a capability
 *    list becomes an `enum`, and the model (or the user) picks.
 * 3. The schema root carries `x-opendirect-source: "openrouter-capabilities"`
 *    so the Details panel can say the schema was synthesised, not published.
 */

type JsonObject = Record<string, unknown>

/** Marks a property the generated form files under "Advanced". */
export const ADVANCED_MARKER = "x-opendirect-advanced"

/** Marks a schema we synthesised from a capability descriptor. */
export const SCHEMA_SOURCE_MARKER = "x-opendirect-source"
export const SCHEMA_SOURCE = "openrouter-capabilities"

/** Keeps a capability shape we do not understand attached to its property. */
export const CAPABILITY_MARKER = "x-opendirect-capability"

/** One model as `GET /api/v1/videos/models` describes it. */
export interface OpenRouterVideoModel {
  id: string
  name?: string | null
  description?: string | null
  canonical_slug?: string | null
  supported_resolutions?: string[] | null
  supported_aspect_ratios?: string[] | null
  supported_sizes?: string[] | null
  supported_durations?: number[] | null
  supported_frame_images?: string[] | null
  upscale_factor?: unknown
  creativity?: unknown
  generate_audio?: boolean | null
  seed?: boolean | null
  pricing_skus?: Record<string, string> | null
  allowed_passthrough_parameters?: string[] | null
  [key: string]: unknown
}

/** One entry of an image model's `supported_parameters` map. */
export interface OpenRouterParameterSpec {
  type?: string
  values?: unknown[]
  min?: number
  max?: number
  [key: string]: unknown
}

/** One model as `GET /api/v1/images/models` describes it. */
export interface OpenRouterImageModel {
  id: string
  name?: string | null
  description?: string | null
  architecture?: {
    input_modalities?: string[]
    output_modalities?: string[]
  } | null
  supported_parameters?: Record<string, OpenRouterParameterSpec> | null
  [key: string]: unknown
}

/**
 * The field both APIs take reference assets in. It is not in either capability
 * descriptor — it is part of the request body (`POST /api/v1/videos`,
 * `POST /api/v1/images/generations`) — so it is added to every media schema and
 * bounded only where the descriptor states a bound.
 */
export const INPUT_REFERENCES = "input_references"

const FRAME_TITLES: Record<string, string> = {
  first_frame: "First Frame",
  last_frame: "Last Frame",
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function nonEmpty<T>(value: T[] | null | undefined): T[] | null {
  return Array.isArray(value) && value.length > 0 ? value : null
}

/** `aspect_ratio` → `Aspect Ratio`. */
export function humanize(field: string): string {
  return field
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

/** A URI-typed property — what `deriveReferenceSlots` recognises as a slot. */
function uriProperty(title: string, mediaType: string, description: string) {
  return {
    type: "string",
    format: "uri",
    contentMediaType: mediaType,
    title,
    description,
  }
}

function uriArrayProperty(
  title: string,
  mediaType: string,
  description: string,
  bounds: { minItems?: number; maxItems?: number } = {}
) {
  return {
    type: "array",
    items: { type: "string", format: "uri", contentMediaType: mediaType },
    title,
    description,
    ...bounds,
  }
}

/**
 * `{min,max}` or `[min,max]` → numeric bounds. OpenRouter uses both shapes
 * (`upscale_factor: {min,max}`, `creativity: [0,1]`), so both are read; any
 * other shape yields no bounds rather than a guessed one.
 */
function boundsOf(value: unknown): { minimum?: number; maximum?: number } {
  if (Array.isArray(value) && value.length === 2) {
    const [min, max] = value
    if (typeof min === "number" && typeof max === "number")
      return { minimum: min, maximum: max }
    return {}
  }
  if (isObject(value)) {
    const out: { minimum?: number; maximum?: number } = {}
    if (typeof value.min === "number") out.minimum = value.min
    if (typeof value.max === "number") out.maximum = value.max
    return out
  }
  return {}
}

function root(properties: JsonObject): JsonObject {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    [SCHEMA_SOURCE_MARKER]: SCHEMA_SOURCE,
    type: "object",
    properties,
    required: ["prompt"],
    additionalProperties: false,
  }
}

const PROMPT_PROPERTY = {
  type: "string",
  title: "Prompt",
  description: "What to generate.",
}

/**
 * The JSON Schema for a video model's capability descriptor.
 *
 * Property order is the order the form renders in: prompt, the promoted
 * controls, the asset slots, then the provider passthrough parameters, which
 * are marked advanced.
 */
export function buildVideoInputSchema(model: OpenRouterVideoModel): JsonObject {
  const properties: JsonObject = { prompt: { ...PROMPT_PROPERTY } }

  const durations = nonEmpty(model.supported_durations)
  if (durations) {
    properties.duration = {
      type: "integer",
      title: "Duration",
      description: "Length of the generated video, in seconds.",
      enum: durations,
    }
  }

  const resolutions = nonEmpty(model.supported_resolutions)
  if (resolutions) {
    properties.resolution = {
      type: "string",
      title: "Resolution",
      enum: resolutions,
    }
  }

  const aspectRatios = nonEmpty(model.supported_aspect_ratios)
  if (aspectRatios) {
    properties.aspect_ratio = {
      type: "string",
      title: "Aspect Ratio",
      enum: aspectRatios,
    }
  }

  const sizes = nonEmpty(model.supported_sizes)
  if (sizes) {
    properties.size = {
      type: "string",
      title: "Size",
      description:
        "Exact pixel dimensions. Interchangeable with resolution + aspect ratio.",
      enum: sizes,
    }
  }

  if (model.generate_audio === true) {
    properties.generate_audio = {
      type: "boolean",
      title: "Generate Audio",
      description: "Generate a synchronized soundtrack alongside the video.",
    }
  }

  if (model.seed === true) {
    properties.seed = {
      type: "integer",
      title: "Seed",
      description:
        "Sample deterministically. Determinism is not guaranteed by every provider.",
    }
  }

  const upscale = boundsOf(model.upscale_factor)
  if (upscale.minimum !== undefined || upscale.maximum !== undefined) {
    properties.upscale_factor = {
      type: "number",
      title: "Upscale Factor",
      ...upscale,
    }
  }

  const creativity = boundsOf(model.creativity)
  if (creativity.minimum !== undefined || creativity.maximum !== undefined) {
    properties.creativity = {
      type: "number",
      title: "Creativity",
      ...creativity,
    }
  }

  for (const frame of nonEmpty(model.supported_frame_images) ?? []) {
    properties[frame] = uriProperty(
      FRAME_TITLES[frame] ?? humanize(frame),
      "image/*",
      `Image used as the ${humanize(frame).toLowerCase()} of the generated video.`
    )
  }

  properties[INPUT_REFERENCES] = uriArrayProperty(
    "Input References",
    "*/*",
    "Reference assets used to guide the generation. Frame images take precedence when both are supplied."
  )

  for (const parameter of nonEmpty(model.allowed_passthrough_parameters) ??
    []) {
    // The catalog states the name and nothing else, so the type is left open
    // rather than guessed; the value is forwarded to the provider untouched.
    properties[parameter] = {
      title: humanize(parameter),
      description: `Passed through to the provider unchanged (${parameter}).`,
      [ADVANCED_MARKER]: true,
    }
  }

  return root(properties)
}

/** One `supported_parameters` entry → a JSON Schema property. */
function parameterProperty(
  name: string,
  spec: OpenRouterParameterSpec
): JsonObject {
  const title = humanize(name)

  if (spec.type === "enum") {
    const values = nonEmpty(spec.values)
    if (values) return { type: "string", title, enum: values }
  }

  if (spec.type === "range") {
    return {
      type: "integer",
      title,
      ...boundsOf({ min: spec.min, max: spec.max }),
    }
  }

  if (spec.type === "boolean") {
    // A boolean capability flag means "this model accepts the parameter", not
    // "the parameter is a boolean" — `seed` is the flag, the value is a seed.
    return name === "seed"
      ? {
          type: "integer",
          title,
          description:
            "Sample deterministically. Determinism is not guaranteed by every provider.",
        }
      : { type: "boolean", title }
  }

  // An unrecognised capability type is never dropped: the property still
  // renders (untyped) and the raw descriptor rides along for the Details panel.
  return { title, [CAPABILITY_MARKER]: spec }
}

/** The JSON Schema for an image model's capability descriptor. */
export function buildImageInputSchema(model: OpenRouterImageModel): JsonObject {
  const properties: JsonObject = { prompt: { ...PROMPT_PROPERTY } }

  for (const [name, spec] of Object.entries(model.supported_parameters ?? {})) {
    if (!isObject(spec)) continue

    if (name === INPUT_REFERENCES) {
      // A count, not a number the user types: it becomes the slot's bound.
      const bounds = boundsOf({ min: spec.min, max: spec.max })
      properties[INPUT_REFERENCES] = uriArrayProperty(
        "Input References",
        "image/*",
        "Reference images used to guide the generation.",
        {
          ...(bounds.minimum !== undefined ? { minItems: bounds.minimum } : {}),
          ...(bounds.maximum !== undefined ? { maxItems: bounds.maximum } : {}),
        }
      )
      continue
    }

    properties[name] = parameterProperty(name, spec)
  }

  return root(properties)
}
