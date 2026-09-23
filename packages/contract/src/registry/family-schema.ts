/**
 * The input schema a family descriptor shows (planning decision 3,
 * docs/plans/2026-09-24-model-registry-plan.md).
 *
 * A family descriptor is shaped like any `ModelDescriptor`, so the canvas
 * (slots, the Advanced form, `planBatch`) runs on it unchanged. This derives
 * its `inputSchema` from the chosen endpoint's: mapped inputs leave (they are
 * slots now), mapped controls take their canonical names, and everything
 * unmapped stays under its own name for Advanced — never dropped. An
 * unmapped field that would collide with a canonical name becomes
 * `raw:<name>`, which `translateFamilyRequest` turns back.
 *
 * `count` keeps its provider field name, because that is where `planBatch`
 * looks for an output-count field.
 */
import type { CommonControls } from "../model"
import type { ControlName, MappingEndpoint } from "./schema"

export interface FamilySchemaResult {
  inputSchema: Record<string, unknown>
  commonControls: CommonControls
}

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** The keys a renamed-with-values property carries over as they are. */
const CARRIED = ["title", "description", "x-order"] as const

export function familyInputSchema(
  endpoint: MappingEndpoint,
  endpointSchema: unknown
): FamilySchemaResult {
  const root = isObject(endpointSchema) ? endpointSchema : {}
  const properties = isObject(root.properties) ? root.properties : {}

  const inputFields = new Set(
    Object.values(endpoint.inputs).map((i) => i.field)
  )
  /** provider field → canonical name, for every control except count. */
  const renamed = new Map<string, ControlName>()
  for (const [name, control] of Object.entries(endpoint.controls)) {
    if (control === undefined || name === "count") continue
    renamed.set(control.field, name as ControlName)
  }
  const canonicalTaken = new Set(renamed.values())

  /** Provider field → its family-schema name; null when it leaves. */
  const nameOf = (field: string): string | null => {
    if (inputFields.has(field)) return null
    const canonical = renamed.get(field)
    if (canonical !== undefined) return canonical
    if ((canonicalTaken as Set<string>).has(field)) return `raw:${field}`
    return field
  }

  const out: JsonObject = {}
  for (const [field, property] of Object.entries(properties)) {
    const name = nameOf(field)
    if (name === null) continue
    const canonical = renamed.get(field)
    const control = canonical ? endpoint.controls[canonical] : undefined
    out[name] =
      control?.values !== undefined && isObject(property)
        ? withValues(property, control.values)
        : property
  }

  const inputSchema: JsonObject = { ...root, properties: out }
  if (Array.isArray(root.required)) {
    inputSchema.required = root.required.flatMap((field) => {
      if (typeof field !== "string") return []
      const name = nameOf(field)
      return name === null ? [] : [name]
    })
  }

  const mapped = (name: ControlName) =>
    endpoint.controls[name] !== undefined ? name : null
  return {
    inputSchema,
    commonControls: {
      prompt: mapped("prompt"),
      aspectRatio: mapped("aspect_ratio"),
      duration: mapped("duration"),
      resolution: mapped("resolution"),
      seed: mapped("seed"),
      audio: mapped("generate_audio"),
    },
  }
}

/**
 * A control with `values` offers the canonical vocabulary: the keys whose
 * provider value the provider's enum accepts (all keys when it has none),
 * as strings, with the default reverse-mapped when one maps to it.
 */
function withValues(
  property: JsonObject,
  values: Record<string, string | number | boolean>
): JsonObject {
  const allowed = Array.isArray(property.enum) ? property.enum : null
  const keys = Object.entries(values)
    .filter(([, value]) => allowed === null || allowed.includes(value))
    .map(([key]) => key)

  const out: JsonObject = { type: "string" }
  for (const key of CARRIED) {
    if (property[key] !== undefined) out[key] = property[key]
  }
  out.enum = keys
  const fallback = keys.find((key) => values[key] === property.default)
  if (fallback !== undefined) out.default = fallback
  return out
}
