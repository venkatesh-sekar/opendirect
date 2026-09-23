/**
 * Does a mapping fit the endpoint it maps? Checks one endpoint's mapping
 * against that endpoint's input JSON Schema (a descriptor's `inputSchema`).
 *
 * Shared by the bundled-registry fixture test, `verify:providers` and the
 * mapping editor, so a typo is caught the same way everywhere. Pure; never
 * fetches.
 */
import type { MappingEndpoint } from "./schema"

export interface SchemaIssue {
  /** Dotted path into the endpoint, e.g. `inputs.first_frame.max`. */
  path: string
  message: string
}

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** `{ type: "string", format: "uri" }` — the same test as `reference-slots.ts`. */
function isUriString(schema: unknown): boolean {
  return isObject(schema) && schema.type === "string" && schema.format === "uri"
}

function isArray(schema: unknown): boolean {
  return isObject(schema) && schema.type === "array"
}

function isUriArray(schema: unknown): boolean {
  return isArray(schema) && isUriString((schema as JsonObject).items)
}

/**
 * The value translation actually sends: a string is coerced to the
 * property's JSON-Schema type (`"5"` → 5 for integer/number when numeric,
 * `"true"`/`"false"` → boolean); anything else is left untouched. The check
 * compares after this, so `"5"` fits an enum of `[5]` exactly when
 * translation would send 5.
 */
function coerceToSchemaType(value: unknown, property: JsonObject): unknown {
  if (typeof value !== "string") return value
  const type = property.type
  if ((type === "integer" || type === "number") && value.trim() !== "") {
    const number = Number(value)
    if (Number.isFinite(number)) return number
  }
  if (type === "boolean" && (value === "true" || value === "false")) {
    return value === "true"
  }
  return value
}

export function checkEndpointAgainstSchema(
  endpoint: MappingEndpoint,
  inputSchema: unknown
): SchemaIssue[] {
  const issues: SchemaIssue[] = []
  const root = isObject(inputSchema) ? inputSchema : {}
  const properties = isObject(root.properties) ? root.properties : {}
  const required = Array.isArray(root.required) ? root.required : []
  const where = `${endpoint.provider}:${endpoint.model}`

  for (const [key, input] of Object.entries(endpoint.inputs)) {
    const path = `inputs.${key}`
    const property = properties[input.field]
    if (property === undefined) {
      issues.push({
        path,
        message: `Field "${input.field}" is not an input of ${where}.`,
      })
      continue
    }

    const uriString = isUriString(property)
    if (input.shape !== undefined) {
      // A shape produces structure, so it only belongs on a list or a
      // non-URL field.
      if (uriString) {
        issues.push({
          path: `${path}.shape`,
          message: `Field "${input.field}" takes one URL, so it cannot have a shape.`,
        })
      }
    } else if (!uriString && !isUriArray(property)) {
      issues.push({
        path,
        message: `Field "${input.field}" does not take a URL or a list of URLs, so it cannot be an input.`,
      })
    }

    if (input.max !== undefined && input.max > 1 && !isArray(property)) {
      issues.push({
        path: `${path}.max`,
        message: `Field "${input.field}" takes one item, so "max" cannot be ${input.max}.`,
      })
    }

    if (required.includes(input.field) && input.required !== true) {
      issues.push({
        path: `${path}.required`,
        message: `Field "${input.field}" is required by the provider; mark it required.`,
      })
    }
  }

  for (const [name, control] of Object.entries(endpoint.controls)) {
    if (control === undefined) continue
    const path = `controls.${name}`
    const property = properties[control.field]
    if (property === undefined) {
      issues.push({
        path,
        message: `Field "${control.field}" is not an input of ${where}.`,
      })
      continue
    }
    if (!isObject(property)) continue
    const allowed = property.enum
    if (!Array.isArray(allowed) || control.values === undefined) continue
    for (const [canonical, value] of Object.entries(control.values)) {
      if (!allowed.includes(coerceToSchemaType(value, property))) {
        issues.push({
          path: `${path}.values.${canonical}`,
          message: `${JSON.stringify(value)} is not a value "${control.field}" accepts. It accepts: ${allowed.map((v) => JSON.stringify(v)).join(", ")}.`,
        })
      }
    }
  }

  return issues
}
