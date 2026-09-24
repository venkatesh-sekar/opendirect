"use client"

import { useEffect } from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query"
import {
  parseFamilyKey,
  type CatalogListing,
  type ModelDescriptor,
  type ModelKind,
  type ProviderId,
  type RecommendedModel,
} from "@opendirect/contract"

import { invoke, isBridgeAvailable, subscribe } from "@/lib/ipc"

/**
 * Drops every cached descriptor and every quote.
 *
 * A family's descriptor and its price are functions of the provider order,
 * the keys held and the merged registry — exactly what main reads again at
 * submit. Both caches live forever (`staleTime: Infinity`), so anything that
 * changes one of those inputs must call this, or the price on screen stops
 * being the price of the run.
 */
export function invalidateModelQueries(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: ["models"] })
  void client.invalidateQueries({ queryKey: ["cost"] })
}

/**
 * Listens for main's `registry:changed` push — a background refresh that
 * changed the merged registry, which nothing in the renderer asked for —
 * and re-reads the registry, the descriptors and the quotes. Mounted once,
 * on the shell.
 */
export function useRegistryChanges(): void {
  const client = useQueryClient()
  useEffect(() => {
    if (!isBridgeAvailable()) return
    return subscribe("registry:changed", () => {
      void client.invalidateQueries({ queryKey: ["registry"] })
      invalidateModelQueries(client)
    })
  }, [client])
}

/**
 * `["models", kinds]` — the kinds are part of the key so the video-only and
 * image-only views are separate cache entries rather than one that thrashes.
 */
export function modelsQueryKey(kinds?: ModelKind[]) {
  return ["models", kinds ?? null] as const
}

export const recommendedQueryKey = ["models", "recommended"] as const

/**
 * What a family node adds to its descriptor request: its provider override
 * and the slot keys it has filled, which choose the endpoint. Ignored for a
 * `provider:slug` key.
 */
export interface ModelQueryOptions {
  provider?: ProviderId | null
  filled?: readonly string[]
}

/**
 * The provider and slots a family key's request carries — filled slots
 * distinct and sorted, so the same slots in another order share a cache
 * entry. Null for a `provider:slug` key, whose descriptor and price never
 * depend on them.
 */
export function familyChoice(
  key: string,
  options: ModelQueryOptions = {}
): { provider: ProviderId | null; filled: string[] } | null {
  if (parseFamilyKey(key) === null) return null
  return {
    provider: options.provider ?? null,
    filled: [...new Set(options.filled ?? [])].sort(),
  }
}

/**
 * `["models", "descriptor", key]`, plus the provider and sorted filled slots
 * **only for a family key**: those change which endpoint a family runs on,
 * while a concrete key keeps one cache entry however its node is wired.
 */
export function modelQueryKey(key: string, options: ModelQueryOptions = {}) {
  const choice = familyChoice(key, options)
  if (choice === null) return ["models", "descriptor", key] as const
  return ["models", "descriptor", key, choice.provider, choice.filled] as const
}

/**
 * The catalog, served from the main process's on-disk cache. Refreshing is a
 * separate, explicit action (`useRefreshModels`) rather than something a
 * re-render can trigger — listing a provider is a dozen HTTP round-trips.
 */
export function useModels(kinds?: ModelKind[]): UseQueryResult<CatalogListing> {
  return useQuery({
    queryKey: modelsQueryKey(kinds),
    queryFn: () => invoke("models:list", { kinds }),
    // The catalog only changes on a refresh, which invalidates this key.
    staleTime: Infinity,
  })
}

/** Re-fetches every configured provider, then repopulates every models query. */
export function useRefreshModels(): UseMutationResult<
  CatalogListing,
  Error,
  ModelKind[] | undefined
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (kinds?: ModelKind[]) =>
      invoke("models:list", { kinds, refresh: true }),
    onSuccess: () => invalidateModelQueries(client),
  })
}

export function useRecommendedModels(): UseQueryResult<{
  video: RecommendedModel[]
  image: RecommendedModel[]
}> {
  return useQuery({
    queryKey: recommendedQueryKey,
    queryFn: () => invoke("models:recommended"),
    staleTime: Infinity,
  })
}

/**
 * The descriptor query, as an options object.
 *
 * Split out because the canvas needs the *same* query outside a render: when
 * an edge is drawn, the slot it lands in comes from the target model's own
 * schema, and that decision is taken inside an event handler where a hook
 * cannot go. One definition, whether it is read through `useModel` or through
 * `queryClient.fetchQuery`, so the two can never drift into fetching the same
 * model under two keys.
 */
export function modelDescriptorQuery(
  key: string,
  options: ModelQueryOptions = {}
) {
  const choice = familyChoice(key, options)
  return {
    queryKey: modelQueryKey(key, options),
    queryFn: () => invoke("models:get", { key, ...choice }),
    staleTime: Infinity,
  } as const
}

/**
 * One full descriptor — the model's own input schema included — fetched on
 * demand. `enabled` keeps it from firing until a model is actually picked.
 * A family key's descriptor follows `options` (see `ModelQueryOptions`).
 */
export function useModel(
  key: string | null,
  options: ModelQueryOptions = {}
): UseQueryResult<ModelDescriptor> {
  return useQuery({
    ...modelDescriptorQuery(key ?? "", options),
    enabled: key !== null,
    // A family node re-asks whenever a wire or its override changes the
    // endpoint. Its last descriptor stays meanwhile — marked
    // `isPlaceholderData` — so its slots and form do not blink out; another
    // model's descriptor is never shown in its place.
    placeholderData: (previous, previousQuery) =>
      previous !== undefined && previousQuery?.queryKey[2] === key
        ? previous
        : undefined,
  })
}
