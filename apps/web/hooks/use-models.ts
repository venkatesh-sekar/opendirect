"use client"

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query"
import type {
  ModelDescriptor,
  ModelKind,
  ModelSummary,
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
export function useModels(kinds?: ModelKind[]): UseQueryResult<ModelSummary[]> {
  return useQuery({
    queryKey: modelsQueryKey(kinds),
    queryFn: () => invoke("models:list", { kinds }),
    // The catalog only changes on a refresh, which invalidates this key.
    staleTime: Infinity,
  })
}

/** Re-fetches every configured provider, then repopulates every models query. */
export function useRefreshModels(): UseMutationResult<
  ModelSummary[],
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
 * One full descriptor — the model's own input schema included — fetched on
 * demand. `enabled` keeps it from firing until a model is actually picked.
 */
export function useModel(key: string | null): UseQueryResult<ModelDescriptor> {
  return useQuery({
    queryKey: modelQueryKey(key ?? ""),
    queryFn: () => invoke("models:get", { key: key! }),
    enabled: key !== null,
  })
}
