/**
 * Submit-time translation (design §5.4–5.5,
 * docs/plans/2026-09-24-model-registry-design.md; planning decision 5): a
 * `family:<id>` request becomes the concrete `provider:slug` request of the
 * endpoint it runs on — provider field names, value-mapped and type-coerced
 * controls, raw fields merged last.
 *
 * It runs **before** `resolveForSubmission`, so every existing guard (slot
 * exists, capacity, kind, positions, params) checks the concrete request,
 * and before the `queued` row is written, so what SQLite records is exactly
 * what the runner sends. Replay reads that row and never translates again.
 *
 * ⛔ Reject, never drop. Anything that cannot be translated — no endpoint,
 * an input the endpoint does not take, a required input left empty, a raw
 * field over a mapped one — throws, and no row exists and nothing is paid
 * for. A `provider:slug` request is returned as the very same object.
 */
import {
  chooseEndpoint,
  endpointKey,
  parseFamilyKey,
  slotKeySchema,
  slotLabel,
  translateFamilyRequest,
  type GenerationRequest,
  type ModelDescriptor,
  type ProviderId,
  type RegistryFamilyEntry,
} from "@opendirect/contract"

export interface TranslateDeps {
  family(id: string): RegistryFamilyEntry | null
  configured(): ProviderId[]
  providerOrder(): ProviderId[]
  /** The annotated concrete descriptor. */
  getModel(key: string): Promise<ModelDescriptor>
}

/** "A", "A and B", "A, B and C". */
function listOf(words: readonly string[]): string {
  if (words.length <= 1) return words.join("")
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`
}

/** Family request → concrete request. Concrete requests pass through untouched. */
export async function translateSubmission(
  request: GenerationRequest,
  deps: TranslateDeps
): Promise<GenerationRequest> {
  const id = parseFamilyKey(request.modelKey)
  if (id === null) return request

  const entry = deps.family(id)
  if (entry === null) {
    throw new Error(
      `Unknown model family "${id}". It may have been removed from the registry. Pick another model.`
    )
  }
  const { family } = entry

  // A family node's edges carry slot keys. A provider field name here means
  // the caller built the request against the wrong descriptor; guessing
  // which slot it meant could send the asset somewhere the user did not.
  for (const reference of request.references) {
    if (!slotKeySchema.safeParse(reference.slotField).success) {
      throw new Error(
        `"${reference.slotField}" is not an input of ${family.name}. Reconnect the reference and try again.`
      )
    }
  }

  const filled = [...new Set(request.references.map((r) => r.slotField))]
  const choice = chooseEndpoint(family, {
    filled,
    providerOrder: deps.providerOrder(),
    configured: deps.configured(),
    override: request.providerOverride,
  })
  if (!choice.ok) throw new Error(choice.message)
  if (choice.missing.length > 0) {
    throw new Error(
      `Needs ${listOf(choice.missing.map((key) => slotLabel(family, key)))} before it can run`
    )
  }

  const key = endpointKey(choice.endpoint)
  const descriptor = await deps.getModel(key)
  const { params, references } = translateFamilyRequest({
    family,
    endpoint: choice.endpoint,
    endpointSchema: descriptor.inputSchema,
    params: request.params,
    references: request.references,
  })

  return { ...request, modelKey: key, params, references, familyId: id }
}
