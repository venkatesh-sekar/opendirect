"use client"

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query"
import type {
  CatalogListing,
  ModelDescriptor,
  ModelKind,
  RecommendedModel,
} from "@opendirect/contract"

import { invoke } from "@/lib/ipc"

/**
 * `["models", kinds]` — the kinds are part of the key so the video-only and
 * image-only views are separate cache entries rather than one that thrashes.
 */
export function modelsQueryKey(kinds?: ModelKind[]) {
  return ["models", kinds ?? null] as const
}

export const recommendedQueryKey = ["models", "recommended"] as const

export function modelQueryKey(key: string) {
  return ["models", "descriptor", key] as const
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
    onSuccess: () => client.invalidateQueries({ queryKey: ["models"] }),
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
export function modelDescriptorQuery(key: string) {
  return {
    queryKey: modelQueryKey(key),
    queryFn: () => invoke("models:get", { key }),
    staleTime: Infinity,
  } as const
}

/**
 * One full descriptor — the model's own input schema included — fetched on
 * demand. `enabled` keeps it from firing until a model is actually picked.
 */
export function useModel(key: string | null): UseQueryResult<ModelDescriptor> {
  return useQuery({
    ...modelDescriptorQuery(key ?? ""),
    enabled: key !== null,
  })
}
