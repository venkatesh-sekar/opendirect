"use client"

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query"
import type {
  AssetDto,
  CostQuote,
  GenerationDto,
  GenerationPageDto,
  GenerationRequest,
  Lineage,
} from "@opendirect/contract"

import { invoke } from "@/lib/ipc"
import { queryKeys } from "./query-keys"

export interface GenerationsPageOptions {
  limit?: number
  offset?: number
}

/**
 * A container's runs, newest first.
 *
 * Submitting only queues a row (`useSubmitGeneration`); running it belongs to
 * the job runner (Task 16), which owns the queue, the cost confirmation and
 * the polling. Nothing a renderer hook does can start a paid generation.
 */
export function useGenerations(
  containerId: string | null,
  options: GenerationsPageOptions = {}
): UseQueryResult<GenerationPageDto> {
  return useQuery({
    queryKey: queryKeys.generations.byContainer(containerId ?? "", {
      limit: options.limit,
      offset: options.offset,
    }),
    queryFn: () =>
      invoke("generations:list", {
        containerId: containerId!,
        limit: options.limit,
        offset: options.offset,
      }),
    enabled: containerId !== null,
  })
}

export interface GenerationDetail {
  generation: GenerationDto
  inputs: { slotField: string; position: number; asset: AssetDto }[]
}

/** One run with the assets that were fed into its input slots. */
export function useGeneration(
  id: string | null
): UseQueryResult<GenerationDetail> {
  return useQuery({
    queryKey: queryKeys.generations.detail(id ?? ""),
    queryFn: () => invoke("generations:get", { id: id! }),
    enabled: id !== null,
  })
}

/** Ancestors and descendants, for the branch/compare view. */
export function useLineage(id: string | null): UseQueryResult<Lineage> {
  return useQuery({
    queryKey: queryKeys.generations.lineage(id ?? ""),
    queryFn: () => invoke("generations:lineage", { id: id! }),
    enabled: id !== null,
  })
}

/**
 * The live price for the current form values.
 *
 * Computed in the main process (`providers/cost.ts`), because the pricing
 * table and the provider SKUs live there and the renderer should never carry a
 * second copy that can drift. It re-runs whenever `params` changes, which is
 * why the params are part of the query key.
 *
 * An error is not a failure state worth shouting about: the badge falls back
 * to "Cost unknown", which is the honest answer either way.
 */
export function useCostEstimate(
  modelKey: string | null,
  params: Record<string, unknown>
): UseQueryResult<CostQuote> {
  return useQuery({
    queryKey: queryKeys.cost.estimate(modelKey ?? "", params),
    queryFn: () => invoke("cost:estimate", { key: modelKey!, params }),
    enabled: modelKey !== null,
    // A quote for one set of values never changes; a new set is a new key.
    staleTime: Infinity,
    retry: false,
  })
}

/**
 * Queues a generation.
 *
 * ⛔ This starts nothing. `generations:submit` writes a `queued` row in the
 * main process and returns it; the job runner that calls a provider arrives in
 * Task 16. Until then the board shows the queued tile and nothing is spent.
 */
export function useSubmitGeneration(): UseMutationResult<
  GenerationDto,
  Error,
  GenerationRequest
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (request: GenerationRequest) =>
      invoke("generations:submit", request),
    onSuccess: () => {
      // The queued run appears on the board immediately, ahead of any output.
      client.invalidateQueries({ queryKey: queryKeys.generations.all })
    },
  })
}
