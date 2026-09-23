/**
 * The one coercion translation applies to a control value, and the check
 * compares against — so a mapping the check passes is exactly what
 * translation sends.
 *
 * Canonical values travel as the UI holds them (`"5"`, `"true"`); the
 * provider wants its schema's type. Only clean conversions happen: a strict
 * decimal integer or number, `"true"`/`"false"`, or a number/boolean for a
 * string field. Anything else is left as it is, for the provider to reject.
 */

const INTEGER = /^-?\d+$/
const DECIMAL = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

function typesOf(property: unknown): string[] {
  if (typeof property !== "object" || property === null) return []
  const type = (property as { type?: unknown }).type
  if (typeof type === "string") return [type]
  return Array.isArray(type)
    ? type.filter((t): t is string => typeof t === "string")
    : []
}

export function coerceToSchemaType(value: unknown, property: unknown): unknown {
  const types = typesOf(property)
  if (types.length === 0) return value
  if (typeof value === "string") {
    if (types.includes("string")) return value
    const trimmed = value.trim()
    if (types.includes("integer") && INTEGER.test(trimmed)) {
      return Number(trimmed)
    }
    if (types.includes("number") && DECIMAL.test(trimmed)) {
      const number = Number(trimmed)
      if (Number.isFinite(number)) return number
    }
    if (
      types.includes("boolean") &&
      (trimmed === "true" || trimmed === "false")
    ) {
      return trimmed === "true"
    }
    return value
  }
  if (typeof value === "number" || typeof value === "boolean") {
    const native =
      types.includes(typeof value) ||
      (typeof value === "number" &&
        Number.isInteger(value) &&
        types.includes("integer"))
    if (!native && types.includes("string")) return String(value)
  }
  return value
}
