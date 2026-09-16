"use client"

import { useQuery, type UseQueryResult } from "@tanstack/react-query"
import type {
  AssetDto,
  GenerationDto,
  GenerationPageDto,
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
 * Read-only on purpose: submitting a run belongs to the job runner (Task 16),
 * which owns the queue, the cost confirmation and the polling. Nothing a
 * renderer hook does can start a paid generation.
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
