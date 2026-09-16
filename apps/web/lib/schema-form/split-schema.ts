/**
 * Splitting a model's own input schema into the three places the creation bar
 * renders it: the inline **common** controls, the **reference slots** the
 * board drops assets onto, and everything else under **Advanced**.
 *
 * The one rule this module exists to enforce: **nothing is ever dropped.**
 * A model we have never seen can name its inputs anything at all, and an
 * unrecognised field is exactly the one a user needs most — so the partition
 * is total. Common ∪ slots ∪ advanced reconstructs the model's property set
 * exactly, and `split-schema.test.ts` asserts it property by property.
 *
 * Nothing here guesses a value. A control is promoted only because the
 * provider adapter already identified it in `commonControls`, and a field's
 * shape, bounds and default come from the schema verbatim.
 */
import type {
  CommonControls,
  ModelDescriptor,
  ReferenceSlot,
} from "@opendirect/contract"

export type JsonSchema = Record<string, unknown>

/** Which promoted control a field is, i.e. which widget renders it. */
export type CommonControl = keyof CommonControls

/**
 * Render order for the inline controls. Prompt leads because it is the one
 * field every model has; the rest read left to right as "how long, how big,
 * how repeatable".
 */
export const COMMON_ORDER: readonly CommonControl[] = [
  "prompt",
  "aspectRatio",
  "duration",
  "resolution",
  "seed",
  "audio",
] as const

export interface CommonField {
  control: CommonControl
  /** The model's own field name — what the request is keyed by. */
  field: string
  label: string
  schema: JsonSchema
  required: boolean
}

/** An object schema with its properties narrowed, ready for `@rjsf/shadcn`. */
export interface AdvancedSchema extends JsonSchema {
  type: "object"
  properties: Record<string, JsonSchema>
  required: string[]
}

export interface SchemaSplit {
  common: CommonField[]
  slots: ReferenceSlot[]
  advanced: AdvancedSchema
}

function isObject(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** The model's properties, or an empty map for a schema that declares none. */
export function propertiesOf(
  inputSchema: JsonSchema | undefined
): Record<string, JsonSchema> {
  const properties = inputSchema?.properties
  if (!isObject(properties)) return {}
  const out: Record<string, JsonSchema> = {}
  for (const [field, schema] of Object.entries(properties)) {
    if (isObject(schema)) out[field] = schema
  }
  return out
}

function requiredOf(inputSchema: JsonSchema | undefined): Set<string> {
  const required = inputSchema?.required
  return new Set(
    Array.isArray(required)
      ? required.filter((name): name is string => typeof name === "string")
      : []
  )
}

/** `aspect_ratio` → `Aspect Ratio`, used when the schema states no title. */
export function humanizeField(field: string): string {
  return field
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

export function labelFor(field: string, schema: JsonSchema): string {
  const title = schema.title
  return typeof title === "string" && title.trim() !== ""
    ? title
    : humanizeField(field)
}

/**
 * Partitions a descriptor's input schema.
 *
 * Slots win over common controls when a model manages to be both (a `image`
 * field that is also the "reference" control), because a slot takes an asset
 * and no inline widget can offer one.
 */
export function splitSchema(descriptor: ModelDescriptor): SchemaSplit {
  const inputSchema = descriptor.inputSchema as JsonSchema | undefined
  const properties = propertiesOf(inputSchema)
  const required = requiredOf(inputSchema)

  const slots = descriptor.referenceSlots
  const slotFields = new Set(slots.map((slot) => slot.field))

  const common: CommonField[] = []
  const promoted = new Set<string>()
  for (const control of COMMON_ORDER) {
    const field = descriptor.commonControls[control]
    // A control the model does not have, or that names a field its schema
    // never declared, is simply not rendered — never invented.
    if (!field || slotFields.has(field) || promoted.has(field)) continue
    const schema = properties[field]
    if (!schema) continue
    promoted.add(field)
    common.push({
      control,
      field,
      label: labelFor(field, schema),
      schema,
      required: required.has(field),
    })
  }

  const advancedProperties: Record<string, JsonSchema> = {}
  for (const [field, schema] of Object.entries(properties)) {
    if (promoted.has(field) || slotFields.has(field)) continue
    advancedProperties[field] = schema
  }

  return {
    common,
    slots,
    advanced: {
      type: "object",
      properties: advancedProperties,
      required: [...required].filter((field) => field in advancedProperties),
    },
  }
}

/**
 * The values the model's own schema states as defaults.
 *
 * A `null` default is Cog's way of spelling "unset", so it is skipped rather
 * than submitted — sending an explicit null is not the same as leaving a field
 * out, and some models reject it.
 */
export function schemaDefaults(
  descriptor: ModelDescriptor
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [field, schema] of Object.entries(
    propertiesOf(descriptor.inputSchema as JsonSchema | undefined)
  )) {
    if (!("default" in schema)) continue
    if (schema.default === null || schema.default === undefined) continue
    out[field] = schema.default
  }
  return out
}

/** Enum values a schema offers, for the Select widget. Empty when it is not one. */
export function enumOptions(schema: JsonSchema): string[] {
  const values = schema.enum
  if (!Array.isArray(values)) return []
  return values.filter((value): value is string => typeof value === "string")
}

export function isBooleanSchema(schema: JsonSchema): boolean {
  return schema.type === "boolean"
}

export function isNumberSchema(schema: JsonSchema): boolean {
  return schema.type === "integer" || schema.type === "number"
}

/** `{ min, max, step }` when the schema bounds a number on both sides. */
export function numericRange(
  schema: JsonSchema
): { min: number; max: number; step: number } | null {
  const min = schema.minimum
  const max = schema.maximum
  if (typeof min !== "number" || typeof max !== "number" || max <= min) {
    return null
  }
  return { min, max, step: schema.type === "integer" ? 1 : 0.01 }
}
