/**
 * The canonical text of a registry family file: fixed key order, 2-space
 * indent, trailing newline. Bundled files, the editor's export and the guard
 * test all go through this, so a diff only ever shows a real change.
 */
import { REFERENCE_ROLES } from "../roles"
import {
  CONTROL_NAMES,
  slotKeyPosition,
  slotKeyRole,
  type MappingControl,
  type MappingEndpoint,
  type MappingInput,
  type ModelFamily,
} from "./schema"

/** Copies `source` keeping only `keys`, in that order, and skipping unset ones. */
function pick<T extends object>(source: T, keys: readonly (keyof T)[]) {
  const out: Partial<T> = {}
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key]
  }
  return out
}

/** Slot keys in `REFERENCE_ROLES` order, then by position. */
function compareSlotKeys(a: string, b: string): number {
  return (
    REFERENCE_ROLES.indexOf(slotKeyRole(a)) -
      REFERENCE_ROLES.indexOf(slotKeyRole(b)) ||
    slotKeyPosition(a) - slotKeyPosition(b)
  )
}

function formatEndpoint(endpoint: MappingEndpoint) {
  const inputs: Record<string, Partial<MappingInput>> = {}
  for (const key of Object.keys(endpoint.inputs).sort(compareSlotKeys)) {
    inputs[key] = pick(endpoint.inputs[key]!, [
      "field",
      "kind",
      "required",
      "max",
      "label",
      "shape",
    ])
  }
  const controls: Record<string, Partial<MappingControl>> = {}
  for (const name of CONTROL_NAMES) {
    const control = endpoint.controls[name]
    if (control) controls[name] = pick(control, ["field", "values"])
  }
  return {
    provider: endpoint.provider,
    model: endpoint.model,
    inputs,
    controls,
  }
}

export function formatFamilyJson(family: ModelFamily): string {
  const out = {
    ...pick(family, ["$schema", "id", "name", "kind", "description"]),
    endpoints: family.endpoints.map(formatEndpoint),
  }
  return `${JSON.stringify(out, null, 2)}\n`
}
