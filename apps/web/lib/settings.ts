"use client"

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query"
import type { KeysSummary, ProviderId, Settings } from "@opendirect/contract"

import { invoke } from "@/lib/ipc"

export const settingsQueryKey = ["settings"] as const
export const keysQueryKey = ["settings", "keys"] as const

/** Human label for a provider, used by the Settings screen. */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  replicate: "Replicate",
  openrouter: "OpenRouter",
}

/** The env var each provider falls back to in development. */
export const PROVIDER_ENV_VARS: Record<ProviderId, string> = {
  replicate: "REPLICATE_API_TOKEN",
  openrouter: "OPENROUTER_API_KEY",
}

export function useSettings(): UseQueryResult<Settings> {
  return useQuery({
    queryKey: settingsQueryKey,
    queryFn: () => invoke("settings:get"),
  })
}

export function useUpdateSettings(): UseMutationResult<
  Settings,
  Error,
  Partial<Settings>
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => invoke("settings:set", patch),
    onSuccess: (next) => client.setQueryData(settingsQueryKey, next),
  })
}

export function useKeysSummary(): UseQueryResult<KeysSummary> {
  return useQuery({
    queryKey: keysQueryKey,
    queryFn: () => invoke("settings:keys:summary"),
  })
}

export function useSaveKey(): UseMutationResult<
  { ok: true },
  Error,
  { provider: ProviderId; key: string }
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { provider: ProviderId; key: string }) =>
      invoke("settings:keys:set", input),
    onSuccess: () => client.invalidateQueries({ queryKey: keysQueryKey }),
  })
}

export function useClearKey(): UseMutationResult<
  { ok: true },
  Error,
  ProviderId
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (provider: ProviderId) =>
      invoke("settings:keys:clear", { provider }),
    onSuccess: () => client.invalidateQueries({ queryKey: keysQueryKey }),
  })
}

/**
 * Verifies a stored key against the provider's listing endpoint.
 * The main process picks the endpoint; nothing here can trigger a generation.
 */
export function useVerifyKey(): UseMutationResult<
  { valid: boolean; message?: string },
  Error,
  ProviderId
> {
  return useMutation({
    mutationFn: (provider: ProviderId) =>
      invoke("settings:keys:verify", { provider }),
  })
}

export function useChooseProjectRoot(): UseMutationResult<
  { path: string | null },
  Error,
  void
> {
  return useMutation({
    mutationFn: () => invoke("settings:projectRoot:choose"),
  })
}
