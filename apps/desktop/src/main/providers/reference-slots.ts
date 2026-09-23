/**
 * Deriving reference slots from a model's own input schema.
 *
 * A "reference slot" is an input field that takes an Asset rather than a
 * scalar — the drop target the board drags assets onto. Neither Replicate nor
 * OpenRouter labels these fields, so they are derived structurally: anything
 * typed as a URI string (or an array of them) is a slot, and its *role* is
 * guessed from its name with the hint table below.
 *
 * Two rules this module never breaks:
 *
 * 1. **No property is ever discarded.** A slot that matches no hint is
 *    `reference`, unverified; everything that is neither a slot nor a
 *    common control is rendered under "Advanced" by the generated form.
 * 2. **Never guess a value, only a role.** Bounds come from `maxItems`, or
 *    from an explicit "up to N" the model itself states in its description.
 *
 * Shared by both provider adapters, so a slot behaves identically whether the
 * schema came from Replicate's Cog OpenAPI or was synthesized from
 * OpenRouter's capability map.
 */
import type { ReferenceRole, ReferenceSlot } from "@opendirect/contract"

type JsonObject = Record<string, unknown>

/**
 * Field-name → role, in priority order. First match wins, so the specific
 * frame hints are listed ahead of the generic image/video ones.
 */
const ROLE_HINTS: Array<[RegExp, ReferenceRole]> = [
  [/^(first_frame|first_frame_image|start_image|start_frame)$/i, "first_frame"],
  [/^(last_frame|last_frame_image|end_image|end_frame)$/i, "last_frame"],
  [/(motion|camera)_?(reference|video)/i, "motion"],
  [/^(video|input_video|source_video|subject_video)$/i, "source"],
  [/^(input_references|references|reference)$/i, "reference"],
  [/(reference|ref)_?(image|images|video|videos|audio|audios)/i, "reference"],
  [
    /^(image|images|input_image|input_images|image_input|subject_image)$/i,
    "reference",
  ],
]

/**
 * Media types, checked before the name/description guess. OpenRouter's schemas
 * are synthesized by us and state `contentMediaType` outright, so there the
 * kind is read rather than guessed.
 */
const MEDIA_TYPE_KINDS: Array<[RegExp, ReferenceSlot["kind"]]> = [
  [/^image\//i, "image"],
  [/^video\//i, "video"],
  [/^audio\//i, "audio"],
]

/** Media hints, checked against the field name first and its description second. */
const KIND_HINTS: Array<[RegExp, ReferenceSlot["kind"]]> = [
  [/video|footage|clip/i, "video"],
  [/audio|voice|speech|sound|music/i, "audio"],
  [/image|photo|picture|frame|plate/i, "image"],
]

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

/** True for `{ type: "string", format: "uri" }` — Cog's file/URL input shape. */
function isUriString(schema: unknown): boolean {
  return isObject(schema) && schema.type === "string" && schema.format === "uri"
}

/** True for an array whose items are URI strings. */
function isUriArray(schema: unknown): boolean {
  return (
    isObject(schema) && schema.type === "array" && isUriString(schema.items)
  )
}

function roleOf(field: string): ReferenceRole {
  for (const [pattern, role] of ROLE_HINTS) {
    if (pattern.test(field)) return role
  }
  return "reference"
}

/** `contentMediaType` on the property, or on an array's items. */
function mediaTypeOf(schema: JsonObject): string | null {
  const own = asString(schema.contentMediaType)
  if (own) return own
  return isObject(schema.items) ? asString(schema.items.contentMediaType) : null
}

function kindOf(
  field: string,
  description: string | null,
  mediaType: string | null
): ReferenceSlot["kind"] {
  if (mediaType) {
    for (const [pattern, kind] of MEDIA_TYPE_KINDS) {
      if (pattern.test(mediaType)) return kind
    }
    // An explicit wildcard (`*/*`) is a statement, not a silence: the model
    // takes any asset, so the name must not narrow it.
    return "any"
  }
  for (const source of [field, description ?? ""]) {
    if (!source) continue
    for (const [pattern, kind] of KIND_HINTS) {
      if (pattern.test(source)) return kind
    }
  }
  return "any"
}

/** `reference_images` → `Reference Images`, used when the schema has no title. */
function humanize(field: string): string {
  return field
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

/**
 * Upper bound on items: `maxItems` when the schema states one, otherwise an
 * explicit "up to N" from the model's own description (Cog schemas routinely
 * put the real limit there and nowhere else). Never invented.
 */
function maxOf(schema: JsonObject, description: string | null): number | null {
  const maxItems = schema.maxItems
  if (typeof maxItems === "number" && Number.isFinite(maxItems)) return maxItems
  if (description) {
    const stated = /\bup to (\d+)\b/i.exec(description)
    if (stated) return Number.parseInt(stated[1]!, 10)
  }
  return null
}

/**
 * Every asset-shaped input in `inputSchema`, in schema order. Non-URI
 * properties (prompt, seed, enums…) are simply not slots — they are still
 * rendered by the generated form.
 */
export function deriveReferenceSlots(inputSchema: unknown): ReferenceSlot[] {
  if (!isObject(inputSchema) || !isObject(inputSchema.properties)) return []

  const slots: ReferenceSlot[] = []
  for (const [field, raw] of Object.entries(inputSchema.properties)) {
    if (!isObject(raw)) continue
    const multiple = isUriArray(raw)
    if (!multiple && !isUriString(raw)) continue

    const description = asString(raw.description)
    slots.push({
      field,
      label: asString(raw.title) ?? humanize(field),
      kind: kindOf(field, description, mediaTypeOf(raw)),
      multiple,
      max: multiple ? maxOf(raw, description) : null,
      role: roleOf(field),
      // A name guess is never a verified role; only a registry mapping is.
      verified: false,
      required: false,
      shape: null,
    })
  }
  return slots
}
