"use client"

import { toast } from "sonner"
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

export function useUpdateSettings(
  options: {
    /**
     * No success toast. For a toggle whose new state is its own feedback
     * (the picker's "Include unverified" switch); failures still toast.
     */
    silent?: boolean
  } = {}
): UseMutationResult<Settings, Error, Partial<Settings>> {
  const client = useQueryClient()
  const { silent = false } = options
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => invoke("settings:set", patch),
    onSuccess: (next) => {
      client.setQueryData(settingsQueryKey, next)
      // The General tab commits on blur with no Save button, so the toast is
      // the only thing that says a write happened at all.
      if (!silent) toast.success("Preferences saved")
    },
    onError: (error) =>
      toast.error("Could not save that", { description: error.message }),
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
    onSuccess: (_result, { provider }) => {
      void client.invalidateQueries({ queryKey: keysQueryKey })
      // The catalog is a function of which providers hold a key, so a key
      // change makes every cached model list obsolete.
      void client.invalidateQueries({ queryKey: ["models"] })
      // The field clears itself on success, which on its own reads as "it lost
      // my key". This is the sentence that says otherwise.
      toast.success(`${PROVIDER_LABELS[provider]} key saved`)
    },
    onError: (error, { provider }) =>
      toast.error(`Could not save the ${PROVIDER_LABELS[provider]} key`, {
        description: error.message,
      }),
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
    onSuccess: (_result, provider) => {
      void client.invalidateQueries({ queryKey: keysQueryKey })
      void client.invalidateQueries({ queryKey: ["models"] })
      toast.success(`${PROVIDER_LABELS[provider]} key cleared`)
    },
    onError: (error, provider) =>
      toast.error(`Could not clear the ${PROVIDER_LABELS[provider]} key`, {
        description: error.message,
      }),
  })
}

/**
 * Verifies a key against the provider's listing endpoint — the one the user
 * has typed, if they have typed one, otherwise the stored key.
 * The main process picks the endpoint; nothing here can trigger a generation.
 */
export function useVerifyKey(): UseMutationResult<
  { valid: boolean; message?: string },
  Error,
  { provider: ProviderId; key?: string }
> {
  return useMutation({
    mutationFn: ({ provider, key }: { provider: ProviderId; key?: string }) =>
      invoke("settings:keys:verify", key ? { provider, key } : { provider }),
    onSuccess: (result, { provider }) => {
      const label = PROVIDER_LABELS[provider]
      if (result.valid) {
        toast.success(`${label} key works`, {
          description: "Verified against the provider's model listing.",
        })
        return
      }
      toast.error(`${label} rejected that key`, {
        description: result.message ?? "The provider rejected this key.",
      })
    },
    onError: (error, { provider }) =>
      toast.error(`Could not reach ${PROVIDER_LABELS[provider]}`, {
        description: error.message,
      }),
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
