/**
 * Gives a concrete descriptor the roles its registry mapping states (planning
 * decision 3, docs/plans/2026-09-24-model-registry-plan.md).
 *
 * The adapters guess a slot's role from its field name; a mapping *knows*
 * it. So every descriptor that leaves main goes through here: a mapped slot
 * takes the mapping's role, label, kind and bounds and is marked verified,
 * and the common controls point at the mapped fields. Everything unmapped
 * stays exactly as the adapter derived it — an unverified guess.
 *
 * Applied on read and never persisted (the catalog caches the raw
 * descriptor), so a registry reload or a saved user mapping takes effect on
 * the next `models:get` without re-fetching anything.
 */
import {
  ROLE_LABELS,
  slotKeyPosition,
  slotKeyRole,
  type CommonControls,
  type ControlName,
  type ModelDescriptor,
  type ReferenceSlot,
  type RegistryFamilyEntry,
} from "@opendirect/contract"

/** Canonical control → the `commonControls` key it fills, where there is one. */
const COMMON_CONTROL: Partial<Record<ControlName, keyof CommonControls>> = {
  prompt: "prompt",
  aspect_ratio: "aspectRatio",
  duration: "duration",
  resolution: "resolution",
  seed: "seed",
  generate_audio: "audio",
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** `reference:2` → "Reference 2", for a mapped input with no label. */
function roleLabel(key: string): string {
  const base = ROLE_LABELS[slotKeyRole(key)]
  const position = slotKeyPosition(key)
  return position > 1 ? `${base} ${position}` : base
}

/** Applies a registry mapping to a concrete descriptor. Pure; never mutates. */
export function annotateDescriptor(
  descriptor: ModelDescriptor,
  entry: RegistryFamilyEntry | null
): ModelDescriptor {
  if (entry === null) return descriptor
  const endpoint = entry.family.endpoints.find(
    (candidate) =>
      candidate.provider === descriptor.provider &&
      candidate.model === descriptor.slug
  )
  if (endpoint === undefined) return descriptor

  const inputs = Object.entries(endpoint.inputs)
  const keyOfField = new Map(inputs.map(([key, input]) => [input.field, key]))

  const referenceSlots: ReferenceSlot[] = descriptor.referenceSlots.map(
    (slot) => {
      const key = keyOfField.get(slot.field)
      if (key === undefined) return slot
      const input = endpoint.inputs[key]!
      return {
        ...slot,
        role: slotKeyRole(key),
        verified: true,
        label: input.label ?? slot.label,
        kind: input.kind,
        max: input.max ?? slot.max,
        required: input.required ?? false,
        shape: input.shape ?? null,
      }
    }
  )

  // A mapped field the adapter did not see as an asset (its schema does not
  // say "URI") is still an input the mapping says the model takes: without a
  // slot, nothing could ever be connected to it.
  const properties = isObject(descriptor.inputSchema.properties)
    ? descriptor.inputSchema.properties
    : {}
  const present = new Set(descriptor.referenceSlots.map((slot) => slot.field))
  for (const [key, input] of inputs) {
    if (present.has(input.field)) continue
    const property = properties[input.field]
    const multiple = isObject(property) && property.type === "array"
    referenceSlots.push({
      field: input.field,
      label: input.label ?? roleLabel(key),
      kind: input.kind,
      multiple,
      max: multiple ? (input.max ?? null) : null,
      role: slotKeyRole(key),
      verified: true,
      required: input.required ?? false,
      shape: input.shape ?? null,
    })
  }

  const commonControls = { ...descriptor.commonControls }
  for (const [name, control] of Object.entries(endpoint.controls)) {
    const common = COMMON_CONTROL[name as ControlName]
    if (control === undefined || common === undefined) continue
    commonControls[common] = control.field
  }

  return {
    ...descriptor,
    referenceSlots,
    commonControls,
    mappedBy: { familyId: entry.family.id, source: entry.source },
  }
}
