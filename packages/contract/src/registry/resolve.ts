/**
 * Which endpoint runs a family, and which slots can still be filled (design
 * §5.1–5.3, docs/plans/2026-09-24-model-registry-design.md; planning
 * decision 4).
 *
 * A family's slots are the union of its endpoints' inputs, but not every
 * combination exists on one endpoint. These rules pick the endpoint for what
 * the user has filled, and say — in words the UI shows as they are — why a
 * slot is dimmed or why nothing fits, instead of failing at submit.
 *
 * Pure and shared: main runs it to build family descriptors and at submit,
 * the renderer runs the same code to dim slots.
 */
import { modelKey, type ReferenceSlot } from "../model"
import { providerIdSchema, type ProviderId } from "../provider"
import { REFERENCE_ROLES, type ReferenceRole } from "../roles"
import {
  slotKeyPosition,
  slotKeyRole,
  type MappingEndpoint,
  type MappingInput,
  type ModelFamily,
} from "./schema"

/** The default label for each role, used when no mapping names the slot. */
export const ROLE_LABELS: Record<ReferenceRole, string> = {
  source: "Source",
  mask: "Mask",
  first_frame: "First frame",
  last_frame: "Last frame",
  character: "Character",
  style: "Style",
  structure: "Structure",
  motion: "Motion",
  soundtrack: "Soundtrack",
  reference: "Reference",
}

/** How a provider is named in messages. */
export const PROVIDER_NAMES: Record<ProviderId, string> = {
  replicate: "Replicate",
  openrouter: "OpenRouter",
}

export interface ChoiceInput {
  /** Slot keys with at least one asset. */
  filled: readonly string[]
  providerOrder: readonly ProviderId[]
  configured: readonly ProviderId[]
  /** The per-node provider override. */
  override: ProviderId | null
}

export type EndpointChoice =
  | { ok: true; index: number; endpoint: MappingEndpoint; missing: string[] }
  | { ok: false; index: number | null; unsupported: string[]; message: string }

export interface SlotAvailability {
  available: boolean
  reason: string | null
}

export function endpointKey(endpoint: MappingEndpoint): string {
  return modelKey(endpoint.provider, endpoint.model)
}

/** `reference:2` sorts after `reference`, and roles follow REFERENCE_ROLES. */
function compareSlotKeys(a: string, b: string): number {
  return (
    REFERENCE_ROLES.indexOf(slotKeyRole(a)) -
      REFERENCE_ROLES.indexOf(slotKeyRole(b)) ||
    slotKeyPosition(a) - slotKeyPosition(b)
  )
}

function sortedKeys(keys: Iterable<string>): string[] {
  return [...new Set(keys)].sort(compareSlotKeys)
}

/** "A", "A and B", "A, B and C". */
function listOf(words: readonly string[], conjunction = "and"): string {
  if (words.length <= 1) return words.join("")
  return `${words.slice(0, -1).join(", ")} ${conjunction} ${words.at(-1)}`
}

function providersOf(family: ModelFamily): ProviderId[] {
  return providerIdSchema.options.filter((provider) =>
    family.endpoints.some((endpoint) => endpoint.provider === provider)
  )
}

/**
 * The override when set (even unconfigured — the choice then says to add a
 * key). Otherwise the order ∩ configured, then any configured provider the
 * order leaves out, in enum order; only providers the family runs on.
 */
export function candidateProviders(
  family: ModelFamily,
  input: ChoiceInput
): ProviderId[] {
  if (input.override !== null) return [input.override]
  const ordered = [
    ...input.providerOrder.filter((p) => input.configured.includes(p)),
    ...providerIdSchema.options.filter((p) => input.configured.includes(p)),
  ]
  const onFamily = providersOf(family)
  return [...new Set(ordered)].filter((p) => onFamily.includes(p))
}

/** Candidate endpoints with their manifest index, provider by provider. */
function candidateEndpoints(
  family: ModelFamily,
  providers: readonly ProviderId[]
): Array<{ index: number; endpoint: MappingEndpoint }> {
  return providers.flatMap((provider) =>
    family.endpoints.flatMap((endpoint, index) =>
      endpoint.provider === provider ? [{ index, endpoint }] : []
    )
  )
}

function covers(endpoint: MappingEndpoint, keys: readonly string[]): boolean {
  return keys.every((key) => key in endpoint.inputs)
}

function missingRequired(
  endpoint: MappingEndpoint,
  filled: readonly string[]
): string[] {
  return sortedKeys(
    Object.entries(endpoint.inputs)
      .filter(
        ([key, input]) => input.required === true && !filled.includes(key)
      )
      .map(([key]) => key)
  )
}

/** The union label: the first endpoint that names the slot, else the role's. */
export function slotLabel(family: ModelFamily, key: string): string {
  for (const endpoint of family.endpoints) {
    const label = endpoint.inputs[key]?.label
    if (label !== undefined) return label
  }
  const role = slotKeyRole(key)
  const base = ROLE_LABELS[role] ?? key
  const position = slotKeyPosition(key)
  return position > 1 ? `${base} ${position}` : base
}

function providerList(providers: readonly ProviderId[]): string {
  return listOf(
    providers.map((p) => PROVIDER_NAMES[p]),
    "or"
  )
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a"
}

/**
 * Planning decision 4: per candidate provider, endpoints in manifest order.
 * The first that takes every filled key with its required inputs filled
 * wins; else the first that takes the filled keys (reporting what is
 * missing); else an error naming what does not fit.
 */
export function chooseEndpoint(
  family: ModelFamily,
  input: ChoiceInput
): EndpointChoice {
  const providers = candidateProviders(family, input)
  const candidates = candidateEndpoints(family, providers)
  const filled = sortedKeys(input.filled)

  if (input.override !== null) {
    const name = PROVIDER_NAMES[input.override]
    if (candidates.length === 0) {
      return {
        ok: false,
        index: null,
        unsupported: [],
        message: `${family.name} has no endpoint on ${name}.`,
      }
    }
    if (!input.configured.includes(input.override)) {
      return {
        ok: false,
        index: candidates[0]!.index,
        unsupported: [],
        message: `Add ${article(name)} ${name} key in Settings to run ${family.name} on ${name}.`,
      }
    }
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      index: null,
      unsupported: [],
      message: `No configured provider can run ${family.name}. Add a key for ${providerList(providersOf(family))} in Settings.`,
    }
  }

  const covering = candidates.filter(({ endpoint }) => covers(endpoint, filled))
  const complete = covering.find(
    ({ endpoint }) => missingRequired(endpoint, filled).length === 0
  )
  const chosen = complete ?? covering[0]
  if (chosen !== undefined) {
    return {
      ok: true,
      index: chosen.index,
      endpoint: chosen.endpoint,
      missing: missingRequired(chosen.endpoint, filled),
    }
  }

  // No endpoint takes them together. Name the keys none takes at all, or —
  // when each fits somewhere but not together — every filled key.
  const alone = filled.filter(
    (key) => !candidates.some(({ endpoint }) => key in endpoint.inputs)
  )
  const unsupported = alone.length > 0 ? alone : filled
  const labels = listOf(unsupported.map((key) => slotLabel(family, key)))
  return {
    ok: false,
    index: candidates[0]!.index,
    unsupported,
    message: `${family.name} has no endpoint on ${providerList(providers)} that takes ${labels}${unsupported.length > 1 ? " together" : ""}.`,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Is the endpoint's field for this input a list? Null when the schema does not say. */
function fieldIsArray(schema: unknown, input: MappingInput): boolean | null {
  if (!isObject(schema) || !isObject(schema.properties)) return null
  const property = schema.properties[input.field]
  if (!isObject(property)) return null
  return property.type === "array"
}

/**
 * The union of every endpoint's inputs as slots: `field` is the slot key,
 * roles are verified (a mapping set them). `required` is per endpoint, so
 * the family descriptor sets it from the chosen one.
 *
 * `schemas` (endpoint index → input schema) says which fields are lists;
 * without it an input with no `max`, or a `max` over 1, reads as multiple.
 */
export function familySlots(
  family: ModelFamily,
  schemas?: Record<number, unknown>
): ReferenceSlot[] {
  const seen = new Map<string, Array<{ input: MappingInput; array: boolean }>>()
  family.endpoints.forEach((endpoint, index) => {
    for (const [key, input] of Object.entries(endpoint.inputs)) {
      const array =
        (schemas ? fieldIsArray(schemas[index], input) : null) ??
        (input.max ?? 2) > 1
      seen.set(key, [...(seen.get(key) ?? []), { input, array }])
    }
  })

  return sortedKeys(seen.keys()).map((key) => {
    const inputs = seen.get(key)!
    const kinds = new Set(inputs.map(({ input }) => input.kind))
    const multiple = inputs.some(({ array }) => array)
    // A single-URL field holds one item; a list with no max is unbounded.
    const bounds = inputs.map(({ input, array }) =>
      array ? (input.max ?? null) : 1
    )
    const max =
      !multiple || bounds.includes(null)
        ? null
        : Math.max(...(bounds as number[]))
    return {
      field: key,
      label: slotLabel(family, key),
      kind: kinds.size === 1 ? [...kinds][0]! : "any",
      multiple,
      max,
      role: slotKeyRole(key),
      verified: true,
      required: false,
      shape: null,
    }
  })
}

/**
 * Design §5.3: for each union slot key, can some candidate endpoint take it
 * together with everything already filled? A filled key is always
 * available — the user put it there, and the choice error says what to do.
 * With no candidate provider at all, every endpoint is considered, so the
 * slots still describe the family while the choice asks for a key.
 */
export function slotAvailability(
  family: ModelFamily,
  input: ChoiceInput
): Record<string, SlotAvailability> {
  let providers = candidateProviders(family, input)
  let candidates = candidateEndpoints(family, providers)
  if (candidates.length === 0) {
    providers = providersOf(family)
    candidates = candidateEndpoints(family, providers)
  }
  const filled = sortedKeys(input.filled)
  const where = providerList(providers)

  const result: Record<string, SlotAvailability> = {}
  for (const slot of familySlots(family)) {
    const key = slot.field
    if (filled.includes(key)) {
      result[key] = { available: true, reason: null }
      continue
    }
    if (!candidates.some(({ endpoint }) => key in endpoint.inputs)) {
      result[key] = { available: false, reason: `Not available on ${where}` }
      continue
    }
    if (candidates.some(({ endpoint }) => covers(endpoint, [...filled, key]))) {
      result[key] = { available: true, reason: null }
      continue
    }
    const labels = listOf(filled.map((k) => slotLabel(family, k)))
    result[key] = {
      available: false,
      reason: `Not with ${labels} on ${where} — no endpoint takes ${filled.length > 1 ? "them together" : "both"}`,
    }
  }
  return result
}
