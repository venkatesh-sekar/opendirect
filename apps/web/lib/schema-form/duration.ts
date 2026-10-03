/**
 * A video model's length control, read from its own schema.
 *
 * Every provider spells "how long" differently, and the shapes seen in the
 * catalogs (Replicate and OpenRouter, surveyed 2026-10-03) are:
 *
 * - `duration: integer, minimum 2, maximum 30, default 5` (Wan 3, Seedance —
 *   whose `-1` means "the model picks");
 * - `duration: integer, enum [5, 10]` (Kling, Veo, Hailuo, Luma, and every
 *   OpenRouter video model, whose `supported_durations` become an enum with
 *   no default);
 * - `seconds: integer, enum [4, 8, 12]` (Sora 2);
 * - `duration: string, enum ["5", "10"]` or `["5s", "10s"]`;
 * - frame counts: `num_frames` + `frames_per_second` (Wan 2.2),
 *   `video_length` + `fps` (Hunyuan), `length: enum [97, 129, …]` (LTX).
 *
 * This module turns any of those into one `DurationSpec`, so the settings
 * popover can offer a control and a request carries the value back in the
 * type and under the name the model declared. It never invents a value: a
 * model whose schema states no default starts unset.
 */
import type { ModelDescriptor } from "@opendirect/contract"

import { labelFor, propertiesOf, type JsonSchema } from "./split-schema"

/** Field names that are a length in seconds, in preference order. */
const SECONDS_FIELDS = [
  "duration",
  "duration_seconds",
  "seconds",
  "duration_sec",
  "video_duration",
] as const

/** Field names that may be a length in frames, in preference order. */
const FRAME_FIELDS = [
  "num_frames",
  "video_length",
  "length",
  "frames",
  "num_video_frames",
  "frame_count",
] as const

/** Field names that state the frame rate a frame count plays at. */
const FPS_FIELDS = ["fps", "frames_per_second", "frame_rate"] as const

/**
 * The most discrete values a bounded range is listed as. Wan 3's 2–30 and
 * Seedance's −1–30 fit; a range wider than this gets a number input.
 */
export const MAX_LISTED = 61

export type DurationValue = string | number

export interface DurationChoice {
  /** The schema's own value, sent verbatim (a number stays a number). */
  value: DurationValue
  /** What the choice reads: `5s`, `Auto`, `81 frames`. */
  label: string
}

export interface DurationSpec {
  /** The model's own field name — what the request is keyed by. */
  field: string
  label: string
  /** What the number counts. A frame count is never shown as seconds. */
  unit: "seconds" | "frames"
  /** The frame-rate field, for a frame count; null when the model has none. */
  fpsField: string | null
  /** That field's stated default, for when the draft has not set one. */
  fpsDefault: number | null
  /**
   * The values the model accepts, in schema order (or ascending, for a
   * listed range). Null when the range is too wide or unbounded to list.
   */
  choices: DurationChoice[] | null
  /** Bounds for a number input, when `choices` is null. */
  range: { min: number | null; max: number | null; integer: boolean } | null
  /** The schema's stated default, when it states a usable one. */
  default: DurationValue | null
  required: boolean
}

function isNumberType(schema: JsonSchema): boolean {
  return schema.type === "integer" || schema.type === "number"
}

/** `5`, `"5"`, `"5s"`, `"5 sec"`, `"5 seconds"` → 5. Anything else → null. */
export function parseSeconds(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string") return null
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*(?:s|secs?|seconds?)?\s*$/i.exec(value)
  return match ? Number(match[1]) : null
}

function enumValues(schema: JsonSchema): DurationValue[] | null {
  const values = schema.enum
  if (!Array.isArray(values) || values.length === 0) return null
  const out: DurationValue[] = []
  for (const value of values) {
    if (typeof value === "number" || typeof value === "string") out.push(value)
  }
  return out.length === values.length ? out : null
}

/** Whether a property can be a length at all: a number, or numbers in an enum. */
function isLengthLike(schema: JsonSchema): boolean {
  const values = enumValues(schema)
  if (values) return values.every((value) => parseSeconds(value) !== null)
  return isNumberType(schema)
}

/**
 * The field that sets a model's length, or null.
 *
 * The adapter's (or a registry mapping's) `commonControls.duration` wins when
 * it names a field the schema has. Otherwise — for a video model only, since
 * `length` on a text model is something else entirely — the schema's own
 * names are tried: seconds first, then frame counts.
 */
export function findDurationField(descriptor: ModelDescriptor): string | null {
  const properties = propertiesOf(descriptor.inputSchema as JsonSchema)
  const slotFields = new Set(descriptor.referenceSlots.map((s) => s.field))
  const usable = (field: string | null | undefined): field is string =>
    !!field &&
    !slotFields.has(field) &&
    properties[field] !== undefined &&
    isLengthLike(properties[field])

  const mapped = descriptor.commonControls.duration
  if (usable(mapped)) return mapped
  if (descriptor.kind !== "video") return null
  for (const field of [...SECONDS_FIELDS, ...FRAME_FIELDS]) {
    if (usable(field)) return field
  }
  return null
}

function fpsFieldOf(properties: Record<string, JsonSchema>): string | null {
  return (
    FPS_FIELDS.find(
      (field) => properties[field] && isNumberType(properties[field])
    ) ?? null
  )
}

function unitOf(
  field: string,
  values: number[],
  hasFps: boolean
): DurationSpec["unit"] {
  if ((SECONDS_FIELDS as readonly string[]).includes(field)) return "seconds"
  if (/frame/i.test(field)) return "frames"
  // `length` / `video_length`: frames when the model has a frame rate or the
  // numbers are far past any plausible clip length in seconds.
  if (hasFps || values.some((value) => value > 60)) return "frames"
  return "seconds"
}

/** `5s`, `2.5s`, `Auto` for Seedance's −1; `81 frames`. */
export function formatDuration(
  value: DurationValue,
  unit: DurationSpec["unit"]
): string {
  const parsed = parseSeconds(value)
  if (parsed === null) return String(value)
  if (unit === "frames") return `${parsed} frames`
  return parsed < 0 ? "Auto" : `${parsed}s`
}

/** The duration control for a model, or null when it has none. */
export function durationSpec(descriptor: ModelDescriptor): DurationSpec | null {
  const field = findDurationField(descriptor)
  if (field === null) return null
  const inputSchema = descriptor.inputSchema as JsonSchema
  const properties = propertiesOf(inputSchema)
  const schema = properties[field]!
  const required = Array.isArray(inputSchema.required)
    ? inputSchema.required.includes(field)
    : false

  const listed = enumValues(schema)
  const min = typeof schema.minimum === "number" ? schema.minimum : null
  const max = typeof schema.maximum === "number" ? schema.maximum : null
  const fpsField = fpsFieldOf(properties)
  const numbers = (listed ?? [min, max]).flatMap((value) => {
    const parsed = parseSeconds(value)
    return parsed === null ? [] : [parsed]
  })
  const unit = unitOf(field, numbers, fpsField !== null)

  let values: DurationValue[] | null = listed
  let range: DurationSpec["range"] = null
  if (!values) {
    if (min !== null && max !== null && max >= min) {
      const first = Math.ceil(min)
      const last = Math.floor(max)
      if (last - first + 1 <= MAX_LISTED) {
        values = Array.from({ length: last - first + 1 }, (_, i) => first + i)
      }
    }
    if (!values) range = { min, max, integer: schema.type === "integer" }
  }

  const choices = values
    ? values.map((value) => ({ value, label: formatDuration(value, unit) }))
    : null

  const stated = schema.default
  const usableDefault =
    (typeof stated === "number" || typeof stated === "string") &&
    (choices
      ? choices.some((choice) => choice.value === stated)
      : parseSeconds(stated) !== null)
      ? stated
      : null

  const framed = unit === "frames" && fpsField !== null
  const fpsDefault = framed ? parseSeconds(properties[fpsField]!.default) : null

  return {
    field,
    label: labelFor(field, schema),
    unit,
    fpsField: framed ? fpsField : null,
    fpsDefault,
    choices,
    range,
    default: usableDefault,
    required,
  }
}

/**
 * A value from a control (a Select's string, an input's text, a stored draft
 * value) → exactly what the model expects, or null when it is not one the
 * model accepts.
 *
 * A listed value is matched to its choice, so `"10"` from a Select goes out
 * as the integer `10` for an integer enum and as `"10s"` for a `"10s"` enum.
 * A free number is rounded for an integer field and clamped to its bounds.
 */
export function coerceDuration(
  spec: DurationSpec,
  raw: unknown
): DurationValue | null {
  if (spec.choices) {
    const exact = spec.choices.find(
      (choice) => String(choice.value) === String(raw)
    )
    if (exact) return exact.value
    const seconds = parseSeconds(raw)
    if (seconds === null) return null
    return (
      spec.choices.find((choice) => parseSeconds(choice.value) === seconds)
        ?.value ?? null
    )
  }
  const parsed = parseSeconds(raw)
  if (parsed === null || !spec.range) return null
  let value = spec.range.integer ? Math.round(parsed) : parsed
  if (spec.range.min !== null) value = Math.max(spec.range.min, value)
  if (spec.range.max !== null) value = Math.min(spec.range.max, value)
  return value
}

/** The value the control shows: the draft's, else the schema's default. */
export function currentDuration(
  spec: DurationSpec,
  values: Readonly<Record<string, unknown>>
): DurationValue | null {
  const raw = values[spec.field]
  if (raw === undefined || raw === null || raw === "") return spec.default
  return coerceDuration(spec, raw)
}

/**
 * The length in seconds a value means: itself for seconds, frames ÷ fps for a
 * frame count whose frame rate is known. Null when it cannot honestly be said.
 */
export function durationInSeconds(
  spec: DurationSpec,
  value: DurationValue | null,
  values: Readonly<Record<string, unknown>>
): number | null {
  const parsed = value === null ? null : parseSeconds(value)
  if (parsed === null || parsed < 0) return null
  if (spec.unit === "seconds") return parsed
  if (spec.fpsField === null) return null
  const fps = parseSeconds(values[spec.fpsField] ?? spec.fpsDefault)
  return fps !== null && fps > 0 ? parsed / fps : null
}
