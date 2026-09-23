"use client"

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
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
import { invalidateContainerFacts } from "./use-containers"

export interface GenerationsPageOptions {
  limit?: number
  offset?: number
}

/**
 * A container's runs, newest first.
 *
 * Submitting queues a row (`useSubmitGeneration`); running it belongs to the
 * job runner in main, which owns the queue, the polling and the download. A
 * renderer hook can ask for a run, and watch it in `useJobs`, but it never
 * talks to a provider itself.
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

/**
 * Every run in the open project, newest first, whatever container it was
 * filed under — Home's Continue strip and the generations page.
 */
export function useProjectGenerations(
  options: GenerationsPageOptions = {}
): UseQueryResult<GenerationPageDto> {
  return useQuery({
    queryKey: queryKeys.generations.project({
      limit: options.limit,
      offset: options.offset,
    }),
    queryFn: () =>
      invoke("generations:list", {
        limit: options.limit,
        offset: options.offset,
      }),
  })
}

/**
 * Every run in the open project, a page at a time, for `/generations/`.
 *
 * Paged by `offset` rather than by a growing `limit`: one call returns at
 * most 500 runs, and a project's history does not stop there. The list is
 * newest first, so a run submitted while you scroll shifts later pages by
 * one — the page flattens with a de-duplication for that reason.
 */
export function useProjectGenerationPages(
  pageSize: number
): UseInfiniteQueryResult<InfiniteData<GenerationPageDto>> {
  return useInfiniteQuery({
    queryKey: queryKeys.generations.projectPages(pageSize),
    queryFn: ({ pageParam }) =>
      invoke("generations:list", { limit: pageSize, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
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
 * ⛔ The one renderer call that leads to a paid generation, and only because
 * the user pressed Generate. `generations:submit` writes a `queued` row in the
 * main process and hands it to the job runner; the job list is where its
 * progress and its cost show up.
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
      // …and on its container's card, as one more run and fresh activity,
      // and its mentions may have just put someone in a scene.
      invalidateContainerFacts(client)
    },
  })
}

export interface BatchSubmissionInput {
  request: GenerationRequest
  /** How many results the node was asked for — not how many jobs that costs. */
  count: number
}

export interface BatchSubmissionResult {
  batchId: string
  generations: GenerationDto[]
}

/**
 * Queues a canvas node's batch.
 *
 * The count is what the user asked for. Whether that becomes one prediction
 * with the model's own `num_outputs` set or N siblings is main's decision,
 * taken from the model's schema (`planBatch`), so the renderer cannot hold a
 * second opinion about what is being spent.
 *
 * ⛔ Paid, and only from a click on Generate. Every sibling is a `queued` row
 * in SQLite before the runner hears about any of them; the batch id comes back
 * so the node can find its own tiles.
 */
export function useSubmitBatch(): UseMutationResult<
  BatchSubmissionResult,
  Error,
  BatchSubmissionInput
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ request, count }: BatchSubmissionInput) =>
      invoke("generations:submitBatch", { request, count }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.generations.all })
      invalidateContainerFacts(client)
      // The node that asked stores the ids it got back, so the surface is
      // re-read rather than patched in place.
      client.invalidateQueries({ queryKey: queryKeys.canvas.all })
    },
  })
}
