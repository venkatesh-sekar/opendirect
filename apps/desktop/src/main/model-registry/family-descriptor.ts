/**
 * Family descriptors (planning decision 3,
 * docs/plans/2026-09-24-model-registry-plan.md): a `family:<id>` key served
 * as an ordinary `ModelDescriptor`, so slots, edges, mentions, the Advanced
 * form and `planBatch` all run on a family node without knowing about
 * families.
 *
 * Its slots are the union of every endpoint's, keyed by slot key. Its schema
 * is the chosen endpoint's with mapped inputs removed and mapped controls
 * under their canonical names. Where it runs and what it costs — provider,
 * slug, pricing — are the chosen endpoint's, so a quote is a real quote.
 *
 * Also here, because they resolve a key the same way: the annotated
 * descriptor for any key (`describeModel`), the price of a family run
 * (`estimateFor`) and the picker's capability data (`registryCapabilities`).
 * Plain Node with injected deps; `registry-service.ts` wires Electron's.
 *
 * ⛔ Read-only. The only network is the catalog's `getModel` — a provider's
 * free listing endpoint — for the one chosen endpoint. The other endpoints'
 * schemas are used only when already cached.
 */
import {
  chooseEndpoint,
  endpointKey,
  familyInputSchema,
  familyKey,
  familySlots,
  parseFamilyKey,
  REFERENCE_ROLES,
  RegistryTranslationError,
  translateFamilyParams,
  unknownPricing,
  type CostQuote,
  type EndpointChoice,
  type FamilyInfo,
  type MappingEndpoint,
  type ModelDescriptor,
  type ProviderId,
  type ReferenceRole,
  type RegistryFamilyEntry,
  type Settings,
} from "@opendirect/contract"

import type { ModelCatalog } from "../catalog"
import { estimateCost } from "../providers/cost"
import { annotateDescriptor } from "./annotate"
import type { ModelRegistry } from "./registry"

export interface FamilyDescriptorInput {
  entry: RegistryFamilyEntry
  /** From `chooseEndpoint`; its `index` must not be null. */
  choice: EndpointChoice
  /** The annotated concrete descriptor of `choice.index`. */
  endpointDescriptor: ModelDescriptor
  configured: ProviderId[]
  providerOrder: ProviderId[]
  override: ProviderId | null
  /**
   * Other endpoints' input schemas by index, when already cached: they say
   * which fields are lists. The chosen endpoint's is always used.
   */
  schemas?: Record<number, unknown>
}

function choiceInfo(choice: EndpointChoice): FamilyInfo["choice"] {
  return choice.ok
    ? {
        index: choice.index,
        missing: choice.missing,
        unsupported: [],
        message: null,
      }
    : {
        index: choice.index,
        missing: [],
        unsupported: choice.unsupported,
        message: choice.message,
      }
}

export function buildFamilyDescriptor(
  input: FamilyDescriptorInput
): ModelDescriptor {
  const { entry, choice, endpointDescriptor: concrete } = input
  const { family } = entry
  if (choice.index === null) {
    throw new Error(choice.ok ? "No endpoint was chosen." : choice.message)
  }
  const endpoint = family.endpoints[choice.index]!

  const { inputSchema, commonControls } = familyInputSchema(
    endpoint,
    concrete.inputSchema
  )
  const referenceSlots = familySlots(family, {
    ...input.schemas,
    [choice.index]: concrete.inputSchema,
  }).map((slot) => ({
    ...slot,
    required: endpoint.inputs[slot.field]?.required === true,
  }))

  return {
    key: familyKey(family.id),
    provider: concrete.provider,
    slug: concrete.slug,
    name: family.name,
    description: family.description ?? concrete.description,
    kind: family.kind,
    versionId: concrete.versionId,
    coverImageUrl: concrete.coverImageUrl,
    inputSchema,
    outputSchema: concrete.outputSchema,
    referenceSlots,
    commonControls,
    pricing: concrete.pricing,
    raw: { family, endpoint: concrete.key },
    fetchedAt: concrete.fetchedAt,
    family: {
      family,
      source: entry.source,
      configured: input.configured,
      providerOrder: input.providerOrder,
      override: input.override,
      choice: choiceInfo(choice),
    },
    mappedBy: null,
  }
}

/** What resolving a key needs, each read per call so a change applies at once. */
export interface ModelSource {
  catalog: () => Pick<
    ModelCatalog,
    "getModel" | "configuredProviders" | "cachedDescriptors"
  >
  registry: () => Pick<ModelRegistry, "family" | "familyForEndpoint" | "merged">
  settings: () => Pick<Settings, "providerOrder">
}

export interface DescribeOptions {
  /** A family node's provider override; null or absent = settings order. */
  provider?: ProviderId | null
  /** The slot keys a family node has filled. */
  filled?: readonly string[]
  /** Re-fetch the concrete descriptor (as a submit does). */
  refresh?: boolean
}

interface ResolvedFamily {
  entry: RegistryFamilyEntry
  choice: EndpointChoice
  /** The chosen endpoint's descriptor, annotated. */
  endpointDescriptor: ModelDescriptor
  descriptor: ModelDescriptor
}

/**
 * A stand-in for an endpoint whose descriptor cannot be fetched: no schema,
 * no price, nothing but what the mapping states. Used only for a choice that
 * already carries an error, so it is never run or priced.
 */
function mappingOnlyDescriptor(
  entry: RegistryFamilyEntry,
  endpoint: MappingEndpoint
): ModelDescriptor {
  return {
    key: endpointKey(endpoint),
    provider: endpoint.provider,
    slug: endpoint.model,
    name: entry.family.name,
    description: null,
    kind: entry.family.kind,
    versionId: null,
    coverImageUrl: null,
    inputSchema: { type: "object", properties: {} },
    outputSchema: null,
    referenceSlots: [],
    commonControls: {
      prompt: null,
      aspectRatio: null,
      duration: null,
      resolution: null,
      seed: null,
      audio: null,
    },
    pricing: unknownPricing,
    raw: null,
    fetchedAt: 0,
    family: null,
    mappedBy: null,
  }
}

/** Thrown when no endpoint can be chosen, so a quote can answer it. */
class NoEndpointError extends Error {}

async function resolveFamily(
  source: ModelSource,
  id: string,
  options: DescribeOptions
): Promise<ResolvedFamily> {
  const entry = source.registry().family(id)
  if (entry === null) {
    throw new Error(
      `Unknown model family "${id}". It may have been removed from the registry. Pick another model.`
    )
  }
  const catalog = source.catalog()
  const configured = catalog.configuredProviders()
  const providerOrder = source.settings().providerOrder
  const override = options.provider ?? null
  const choice = chooseEndpoint(entry.family, {
    filled: options.filled ?? [],
    providerOrder,
    configured,
    override,
  })
  if (choice.index === null) {
    throw new NoEndpointError(
      choice.ok ? "No endpoint was chosen." : choice.message
    )
  }

  const endpoints = entry.family.endpoints
  const endpoint = endpoints[choice.index]!
  let concrete: ModelDescriptor
  try {
    concrete = await catalog.getModel(endpointKey(endpoint), {
      refresh: options.refresh ?? false,
    })
  } catch (error) {
    if (choice.ok) throw error
    // The choice already cannot run (an override to a provider with no key,
    // say), and its message says what to do. The node keeps its slots from
    // the mapping alone rather than losing them to a fetch error.
    concrete = mappingOnlyDescriptor(entry, endpoint)
  }
  const endpointDescriptor = annotateDescriptor(concrete, entry)

  const cached = catalog.cachedDescriptors()
  const schemas: Record<number, unknown> = {}
  endpoints.forEach((endpoint, index) => {
    const descriptor = cached[endpointKey(endpoint)]
    if (descriptor !== undefined) schemas[index] = descriptor.inputSchema
  })

  return {
    entry,
    choice,
    endpointDescriptor,
    descriptor: buildFamilyDescriptor({
      entry,
      choice,
      endpointDescriptor,
      configured,
      providerOrder,
      override,
      schemas,
    }),
  }
}

/**
 * The descriptor callers see for any runnable key: a family descriptor for
 * `family:<id>`, else the concrete descriptor annotated with its family's
 * roles (unchanged when no family maps it).
 */
export async function describeModel(
  source: ModelSource,
  key: string,
  options: DescribeOptions = {}
): Promise<ModelDescriptor> {
  const id = parseFamilyKey(key)
  if (id !== null) return (await resolveFamily(source, id, options)).descriptor

  const descriptor = await source
    .catalog()
    .getModel(key, options.refresh ? { refresh: true } : undefined)
  return annotateDescriptor(
    descriptor,
    source.registry().familyForEndpoint(descriptor.provider, descriptor.slug)
  )
}

function unknownQuote(note: string): CostQuote {
  return {
    amount: 0,
    currency: "USD",
    basis: "unknown",
    confidence: "unknown",
    source: "none",
    note,
    sku: null,
  }
}

function quote(descriptor: ModelDescriptor, params: Record<string, unknown>) {
  return estimateCost({
    provider: descriptor.provider,
    kind: descriptor.kind,
    slug: descriptor.slug,
    pricingSkus: descriptor.pricing.skus,
    params,
    inputSchema: descriptor.inputSchema,
  })
}

/**
 * The pre-flight price. A family run is priced on the endpoint it would run
 * on, with its params translated into that endpoint's fields — the same
 * translation a submit makes. A run that cannot be translated, or that no
 * endpoint can take, is an honest "unknown" that says why, never a throw.
 */
export async function estimateFor(
  source: ModelSource,
  key: string,
  params: Record<string, unknown>,
  options: Pick<DescribeOptions, "provider" | "filled">
): Promise<CostQuote> {
  const id = parseFamilyKey(key)
  if (id === null) return quote(await describeModel(source, key), params)

  let resolved: ResolvedFamily
  try {
    resolved = await resolveFamily(source, id, options)
  } catch (error) {
    if (error instanceof NoEndpointError) return unknownQuote(error.message)
    throw error
  }
  const { entry, choice, endpointDescriptor } = resolved
  // An endpoint was picked, but the run could not be made (filled slots no
  // endpoint takes together, an override to a provider with no key): its
  // price would be a number for a run that will not happen.
  if (!choice.ok) return unknownQuote(choice.message)
  try {
    const translated = translateFamilyParams({
      family: entry.family,
      endpoint: entry.family.endpoints[choice.index!]!,
      endpointSchema: endpointDescriptor.inputSchema,
      params,
    })
    return quote(endpointDescriptor, translated)
  } catch (error) {
    if (error instanceof RegistryTranslationError) {
      return unknownQuote(error.message)
    }
    throw error
  }
}

/**
 * Model key → the distinct roles its slots take, for every **unmapped**
 * model whose descriptor is already cached (a mapped one is described by
 * its family). Roles in `REFERENCE_ROLES` order; an empty list means the
 * model was inspected and takes no asset. ⛔ Reads the cache only.
 */
export function registryCapabilities(
  source: ModelSource
): Record<string, ReferenceRole[]> {
  // One merge for the whole list: every registry call re-reads settings.
  const { endpointIndex } = source.registry().merged()
  const result: Record<string, ReferenceRole[]> = {}
  for (const [key, descriptor] of Object.entries(
    source.catalog().cachedDescriptors()
  )) {
    if (endpointIndex.has(key)) continue
    const roles = new Set(descriptor.referenceSlots.map((slot) => slot.role))
    result[key] = REFERENCE_ROLES.filter((role) => roles.has(role))
  }
  return result
}
