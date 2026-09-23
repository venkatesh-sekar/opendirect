/**
 * Translating a family request into one endpoint's request (design §5.4–5.5,
 * docs/plans/2026-09-24-model-registry-design.md; planning decision 5).
 *
 * The canvas speaks canonical names — slot keys for references, `prompt`,
 * `duration`, … for controls, and `raw:<name>` for an unmapped field whose
 * name collides with a canonical one. This turns that into the endpoint's
 * own field names, value-maps and type-coerces the controls, and merges the
 * raw fields last.
 *
 * ⛔ Reject, never drop. An input the endpoint cannot take, a control it does
 * not have, a value it does not list, or a raw field that would overwrite a
 * mapped one is an error. The UI should have prevented it; this is the
 * safety net, and a silently dropped input is a paid run that ignored what
 * the user asked for. (The one exception: an empty prompt means "unset".)
 *
 * Main runs it at submit, before the `queued` row is written, so what SQLite
 * records is exactly what is sent. The renderer runs `translateFamilyParams`
 * only to price a run.
 */
import type { GenerationReference } from "../generation"
import { coerceToSchemaType } from "./coerce"
import { PROVIDER_NAMES, slotLabel } from "./resolve"
import {
  CONTROL_NAMES,
  slotKeySchema,
  type ControlName,
  type MappingEndpoint,
  type ModelFamily,
} from "./schema"

export class RegistryTranslationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RegistryTranslationError"
  }
}

export interface TranslateInput {
  family: ModelFamily
  endpoint: MappingEndpoint
  /** The concrete descriptor's `inputSchema`. */
  endpointSchema: unknown
  /** Canonical names, raw names, and `raw:<name>`. */
  params: Record<string, unknown>
  /** `slotField` is the slot key. */
  references: readonly GenerationReference[]
}

export interface TranslateOutput {
  /** Provider field names. */
  params: Record<string, unknown>
  /** `slotField` is the provider field. */
  references: GenerationReference[]
}

const RAW_PREFIX = "raw:"

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function propertiesOf(schema: unknown): JsonObject {
  return isObject(schema) && isObject(schema.properties)
    ? schema.properties
    : {}
}

function isControlName(key: string): key is ControlName {
  return (CONTROL_NAMES as readonly string[]).includes(key)
}

function controlLabel(name: string): string {
  return name.replaceAll("_", " ")
}

function translateParams(
  input: Omit<TranslateInput, "references">
): Record<string, unknown> {
  const { family, endpoint } = input
  const where = `${family.name} on ${PROVIDER_NAMES[endpoint.provider]}`
  const properties = propertiesOf(input.endpointSchema)

  const mappedFields = new Set([
    ...Object.values(endpoint.inputs).map((i) => i.field),
    ...Object.values(endpoint.controls).flatMap((c) => (c ? [c.field] : [])),
  ])
  // The family schema keeps `count` under its provider field name, so
  // `planBatch` sets it there; that name is the count control, not a raw
  // overwrite.
  const countField = endpoint.controls.count?.field

  const out: Record<string, unknown> = {}
  // Unmapped canonical controls sent under their own field name; a raw
  // field may not overwrite one either.
  const passedThrough = new Set<string>()
  const raw: Array<[string, unknown]> = []

  for (const [key, value] of Object.entries(input.params)) {
    if (value === undefined) continue

    if (key.startsWith(RAW_PREFIX)) {
      raw.push([key.slice(RAW_PREFIX.length), value])
      continue
    }

    const name: ControlName | null =
      key === countField ? "count" : isControlName(key) ? key : null
    if (name === null) {
      raw.push([key, value])
      continue
    }

    const control = endpoint.controls[name]
    if (control === undefined) {
      if (name === "prompt" && (value === "" || value === null)) continue
      // Unmapped here, but the endpoint has a field of that very name: the
      // family schema showed it under Advanced as itself.
      if (Object.hasOwn(properties, key) && !mappedFields.has(key)) {
        out[key] = coerceToSchemaType(value, properties[key])
        passedThrough.add(key)
        continue
      }
      throw new RegistryTranslationError(
        `${where} has no ${controlLabel(name)} control`
      )
    }

    if (control.values !== undefined) {
      const canonical = String(value)
      if (!Object.hasOwn(control.values, canonical)) {
        throw new RegistryTranslationError(
          `${where}: ${canonical} is not a ${controlLabel(name)} this endpoint takes (${Object.keys(control.values).join(", ")})`
        )
      }
      out[control.field] = coerceToSchemaType(
        control.values[canonical],
        properties[control.field]
      )
    } else {
      out[control.field] = coerceToSchemaType(value, properties[control.field])
    }
  }

  // Raw fields merge last, and may only add what nothing mapped.
  for (const [field, value] of raw) {
    if (mappedFields.has(field)) {
      throw new RegistryTranslationError(
        `${where} may not overwrite the mapped field ${field}`
      )
    }
    if (passedThrough.has(field)) {
      throw new RegistryTranslationError(
        `${where} may not overwrite the field ${field}`
      )
    }
    if (!Object.hasOwn(properties, field)) {
      throw new RegistryTranslationError(`${where} has no ${field} field`)
    }
    out[field] = value
  }

  return out
}

function isArrayField(schema: unknown, field: string): boolean {
  const property = propertiesOf(schema)[field]
  return isObject(property) && property.type === "array"
}

export function translateFamilyRequest(input: TranslateInput): TranslateOutput {
  const { family, endpoint } = input
  const where = `${family.name} on ${PROVIDER_NAMES[endpoint.provider]}`
  const params = translateParams(input)

  const label = (key: string) =>
    slotKeySchema.safeParse(key).success ? slotLabel(family, key) : `"${key}"`

  const counts = new Map<string, number>()
  const references = input.references.map((reference) => {
    const key = reference.slotField
    const mapped = Object.hasOwn(endpoint.inputs, key)
      ? endpoint.inputs[key]
      : undefined
    if (mapped === undefined) {
      throw new RegistryTranslationError(
        `${where} cannot take ${/^[aeiou]/i.test(label(key)) ? "an" : "a"} ${label(key)} input`
      )
    }
    counts.set(key, (counts.get(key) ?? 0) + 1)
    return { ...reference, slotField: mapped.field }
  })

  for (const [key, count] of counts) {
    const mapped = endpoint.inputs[key]!
    const max =
      mapped.max ??
      (isArrayField(input.endpointSchema, mapped.field) ? Infinity : 1)
    if (count > max) {
      throw new RegistryTranslationError(
        `${where} takes at most ${max} ${label(key)} input${max === 1 ? "" : "s"}`
      )
    }
  }

  for (const [key, mapped] of Object.entries(endpoint.inputs)) {
    if (mapped.required === true && !counts.has(key)) {
      throw new RegistryTranslationError(
        `${where} needs ${/^[aeiou]/i.test(label(key)) ? "an" : "a"} ${label(key)} input`
      )
    }
  }

  return { params, references }
}

/** Controls + raw only (no references) — for cost quotes. */
export function translateFamilyParams(
  input: Omit<TranslateInput, "references">
): Record<string, unknown> {
  return translateParams(input)
}
