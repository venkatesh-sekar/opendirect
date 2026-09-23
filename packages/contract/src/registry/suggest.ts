/**
 * Drafting a mapping from a concrete descriptor — the mapping editor's
 * pre-fill. Every field of the endpoint's schema gets a suggestion and a
 * reason, and the editor shows how sure each one is:
 *
 * - `manifest`: the provider said so (OpenRouter's capability manifest lists
 *   `first_frame` in `supported_frame_images`).
 * - `schema`: the field's own description says what it is, or an existing
 *   mapping already maps it.
 * - `name`: only the field name hints at it.
 * - `none`: a guess (`reference`), or not an input or control at all — it
 *   stays under Advanced.
 *
 * A suggestion is a draft for a person to confirm, never a verified role.
 * Pure; reads only the descriptor.
 */
import { detectOutputCountField } from "../canvas-batch"
import type { ModelDescriptor, ReferenceRole, ReferenceSlot } from "../model"
import { PROVIDER_NAMES } from "./resolve"
import type {
  ControlName,
  MappingControl,
  MappingEndpoint,
  MappingInput,
} from "./schema"

export type SuggestionConfidence = "manifest" | "schema" | "name" | "none"

export interface FieldSuggestion {
  field: string
  as:
    | {
        input: string
        kind: MappingInput["kind"]
        max?: number
        label?: string
      }
    | { control: ControlName }
    | null
  confidence: SuggestionConfidence
  /** Shown in the editor, e.g. "OpenRouter lists first_frame in supported_frame_images". */
  why: string
}

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** The marker `openrouter-schema.ts` puts on schemas built from the manifest. */
const MANIFEST_SOURCE = "openrouter-capabilities"

/** OpenRouter's manifest-derived fields, and where the manifest states them. */
const MANIFEST_FIELDS: Record<string, { role: ReferenceRole; why: string }> = {
  first_frame: {
    role: "first_frame",
    why: "OpenRouter lists first_frame in supported_frame_images",
  },
  last_frame: {
    role: "last_frame",
    why: "OpenRouter lists last_frame in supported_frame_images",
  },
  input_references: {
    role: "reference",
    why: "OpenRouter takes input_references on every media model",
  },
}

/** Description phrases → role. The earliest match in the first sentence wins. */
const DESCRIPTION_HINTS: Array<[RegExp, ReferenceRole]> = [
  [/first[- ]frame/i, "first_frame"],
  [/last[- ]frame/i, "last_frame"],
  [/lip[- ]?sync|audio[- ]driven/i, "soundtrack"],
  [/\bmask\b/i, "mask"],
  [/\bpose|depth|canny|edge map/i, "structure"],
  [/\bstyle reference\b/i, "style"],
]

/**
 * What the description says the field IS. Only its first sentence counts:
 * later ones describe constraints ("Cannot be combined with first/last frame
 * images"), which name other roles.
 */
function describedRole(description: string | null): ReferenceRole | null {
  if (!description) return null
  const sentence = description.split(/\.\s/)[0] ?? ""
  let best: { index: number; role: ReferenceRole } | null = null
  for (const [pattern, role] of DESCRIPTION_HINTS) {
    const match = pattern.exec(sentence)
    if (match === null) continue
    // A style reference *for a character* is a character reference.
    if (role === "style" && /character/i.test(sentence)) continue
    if (best === null || match.index < best.index) {
      best = { index: match.index, role }
    }
  }
  return best?.role ?? null
}

function roleSuggestion(
  slot: ReferenceSlot,
  property: JsonObject,
  manifest: boolean
): { role: ReferenceRole; confidence: SuggestionConfidence; why: string } {
  const listed = manifest ? MANIFEST_FIELDS[slot.field] : undefined
  if (listed) return { ...listed, confidence: "manifest" }

  const description =
    typeof property.description === "string" ? property.description : null
  const described = describedRole(description)

  // A specific name hint stands; the description can only confirm it.
  if (slot.role !== "reference") {
    return described === slot.role
      ? {
          role: slot.role,
          confidence: "schema",
          why: `The description says ${slot.role.replace("_", " ")}`,
        }
      : {
          role: slot.role,
          confidence: "name",
          why: `The name "${slot.field}" reads as ${slot.role.replace("_", " ")}`,
        }
  }
  if (described !== null) {
    return {
      role: described,
      confidence: "schema",
      why: `The description says ${described.replace("_", " ")}`,
    }
  }
  return /ref/i.test(slot.field)
    ? {
        role: "reference",
        confidence: "name",
        why: `The name "${slot.field}" reads as a reference`,
      }
    : {
        role: "reference",
        confidence: "none",
        why: "Nothing says what it is, so reference (the default)",
      }
}

const COMMON_CONTROLS: Array<
  [keyof ModelDescriptor["commonControls"], ControlName]
> = [
  ["prompt", "prompt"],
  ["aspectRatio", "aspect_ratio"],
  ["duration", "duration"],
  ["resolution", "resolution"],
  ["seed", "seed"],
  ["audio", "generate_audio"],
]

/** Drafts one endpoint mapping from a concrete descriptor (the editor's pre-fill). */
export function suggestEndpointMapping(
  descriptor: ModelDescriptor,
  existing?: MappingEndpoint
): { endpoint: MappingEndpoint; fields: FieldSuggestion[] } {
  const schema = descriptor.inputSchema
  const properties = isObject(schema.properties) ? schema.properties : {}

  if (existing !== undefined) {
    return {
      endpoint: existing,
      fields: fromExisting(existing, properties, descriptor),
    }
  }

  const required = Array.isArray(schema.required) ? schema.required : []
  const manifest = schema["x-opendirect-source"] === MANIFEST_SOURCE
  const suggestions = new Map<string, FieldSuggestion>()
  const inputs: Record<string, MappingInput> = {}
  const taken = new Map<ReferenceRole, number>()

  for (const slot of descriptor.referenceSlots) {
    const property = properties[slot.field]
    if (!isObject(property)) continue
    const { role, confidence, why } = roleSuggestion(slot, property, manifest)
    const position = (taken.get(role) ?? 0) + 1
    // The slot-key format stops at :9; a tenth is left for Advanced.
    if (position > 9) continue
    taken.set(role, position)
    const key = position === 1 ? role : `${role}:${position}`

    const input: MappingInput = { field: slot.field, kind: slot.kind }
    if (required.includes(slot.field)) input.required = true
    if (slot.multiple && slot.max !== null && slot.max >= 1)
      input.max = slot.max
    if (slot.label) input.label = slot.label.slice(0, 80)
    inputs[key] = input
    suggestions.set(slot.field, {
      field: slot.field,
      as: {
        input: key,
        kind: input.kind,
        ...(input.max !== undefined ? { max: input.max } : {}),
        ...(input.label !== undefined ? { label: input.label } : {}),
      },
      confidence,
      why,
    })
  }

  const controls: Partial<Record<ControlName, MappingControl>> = {}
  const addControl = (name: ControlName, field: string, why: string) => {
    if (suggestions.has(field) || !(field in properties)) return
    controls[name] = { field }
    suggestions.set(field, {
      field,
      as: { control: name },
      confidence: "name",
      why,
    })
  }
  for (const [key, name] of COMMON_CONTROLS) {
    const field = descriptor.commonControls[key]
    if (field !== null) {
      addControl(
        name,
        field,
        `The name "${field}" reads as the ${name.replace("_", " ")} control`
      )
    }
  }
  addControl(
    "negative_prompt",
    "negative_prompt",
    'The name "negative_prompt" reads as the negative prompt control'
  )
  const count = detectOutputCountField(schema)
  if (count !== null) {
    addControl(
      "count",
      count.field,
      `"${count.field}" is an output count, so one run can return several results`
    )
  }

  const endpoint: MappingEndpoint = {
    provider: descriptor.provider,
    model: descriptor.slug,
    inputs,
    controls,
  }
  return {
    endpoint,
    fields: Object.keys(properties).map(
      (field) => suggestions.get(field) ?? advanced(field, descriptor)
    ),
  }
}

function advanced(field: string, descriptor: ModelDescriptor): FieldSuggestion {
  return {
    field,
    as: null,
    confidence: "none",
    why: `Not an input or a common control; stays under Advanced on ${PROVIDER_NAMES[descriptor.provider]}`,
  }
}

/** An existing mapping, described field by field, unchanged. */
function fromExisting(
  endpoint: MappingEndpoint,
  properties: JsonObject,
  descriptor: ModelDescriptor
): FieldSuggestion[] {
  const why = descriptor.mappedBy
    ? `Mapped by the ${descriptor.mappedBy.familyId} family`
    : "Mapped by the existing mapping"
  const byField = new Map<string, FieldSuggestion["as"]>()
  for (const [key, input] of Object.entries(endpoint.inputs)) {
    byField.set(input.field, {
      input: key,
      kind: input.kind,
      ...(input.max !== undefined ? { max: input.max } : {}),
      ...(input.label !== undefined ? { label: input.label } : {}),
    })
  }
  for (const [name, control] of Object.entries(endpoint.controls)) {
    if (control) byField.set(control.field, { control: name as ControlName })
  }
  return Object.keys(properties).map((field) => {
    const as = byField.get(field)
    return as === undefined
      ? advanced(field, descriptor)
      : { field, as, confidence: "schema", why }
  })
}
