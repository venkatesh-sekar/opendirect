"use client"

/**
 * The model registry, from the renderer's side: where it stands, the
 * families in force, and the user's own mappings (design §4).
 *
 * Every mutation that changes state invalidates `["registry"]` and
 * `["models"]`: a mapping decides a model's slots and controls, so a save, a
 * delete or a reload changes the descriptors the canvas is drawn from.
 * Import (validates, saves nothing) and export (writes a file) do not.
 *
 * ⛔ Nothing here can reach a provider. `registry:reload` (and the background
 * refresh `registry:families` may start in main) make free `GET`s of static
 * JSON; every other channel is local.
 */
import { toast } from "sonner"
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query"
import type {
  RegistryFamilyEntry,
  RegistryIssue,
  RegistryStatus,
  UserOverride,
} from "@opendirect/contract"

import { invoke } from "@/lib/ipc"

import { queryKeys } from "./query-keys"

/**
 * Main refused a mapping. `issues` carry dotted paths into the family
 * (`endpoints.0.inputs.character.field`), so the editor can show each one
 * under its row; the message joins them for a toast.
 */
export class MappingValidationError extends Error {
  readonly issues: RegistryIssue[]

  constructor(issues: RegistryIssue[]) {
    super(
      issues
        .map((issue) =>
          issue.path ? `${issue.path}: ${issue.message}` : issue.message
        )
        .join("\n")
    )
    this.name = "MappingValidationError"
    this.issues = issues
  }
}

function invalidateMappings(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: queryKeys.registry.all })
  void client.invalidateQueries({ queryKey: ["models"] })
}

export function useRegistryStatus(): UseQueryResult<RegistryStatus> {
  return useQuery({
    queryKey: queryKeys.registry.status,
    queryFn: () => invoke("registry:status"),
  })
}

/** The Reload registry button: re-fetches the remote copy, then rebuilds. */
export function useReloadRegistry(): UseMutationResult<
  RegistryStatus,
  Error,
  void
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => invoke("registry:reload"),
    onSuccess: (status) => {
      client.setQueryData(queryKeys.registry.status, status)
      invalidateMappings(client)
      const inForce = `v${status.activeVersion} from ${status.activeSource}`
      // A failed fetch still reloads — the lower layer stays in force — but
      // it must never read as a success.
      if (status.remote.error) {
        toast.error("Could not fetch the remote registry", {
          description: `${status.remote.error} · Using ${inForce}.`,
        })
        return
      }
      toast.success(`Registry reloaded · ${inForce}`)
    },
    onError: (error) =>
      toast.error("Could not reload the registry", {
        description: error.message,
      }),
  })
}

export function useRegistryFamilies(): UseQueryResult<RegistryFamilyEntry[]> {
  return useQuery({
    queryKey: queryKeys.registry.families,
    queryFn: () => invoke("registry:families"),
  })
}

/** The user's own mappings, including any that no longer validate. */
export function useRegistryOverrides(): UseQueryResult<UserOverride[]> {
  return useQuery({
    queryKey: queryKeys.registry.overrides,
    queryFn: () => invoke("registry:overrides:list"),
  })
}

export interface SaveOverrideInput {
  /** The draft family JSON; main validates it again. */
  family: unknown
  /** The id being edited, when the save may rename it. */
  replaceId: string | null
}

/**
 * Creates or updates a user mapping. A refused mapping rejects with a
 * `MappingValidationError` carrying per-field issues, and nothing is
 * invalidated because nothing changed.
 */
export function useSaveOverride(): UseMutationResult<
  UserOverride,
  Error,
  SaveOverrideInput
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: SaveOverrideInput) => {
      const result = await invoke("registry:overrides:save", input)
      if (!result.ok) throw new MappingValidationError(result.issues)
      return result.override
    },
    onSuccess: () => invalidateMappings(client),
  })
}

/**
 * Deletes one stored user mapping by its storage key (`UserOverride.key`),
 * which every entry has — even one without an id, or sharing one — so an
 * invalid entry can always be cleared. The lower layer takes over again.
 */
export function useDeleteOverride(): UseMutationResult<
  { ok: true },
  Error,
  string
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => invoke("registry:overrides:delete", { key }),
    onSuccess: () => invalidateMappings(client),
  })
}

/**
 * Opens a native dialog and returns the file's mappings, validated but not
 * saved — the editor opens on them first. Empty when cancelled.
 */
export function useImportOverrides(): UseMutationResult<
  UserOverride[],
  Error,
  void
> {
  return useMutation({
    mutationFn: async () =>
      (await invoke("registry:overrides:import")).candidates,
  })
}

/** Writes one family through a native save dialog; null when cancelled. */
export function useExportOverride(): UseMutationResult<
  string | null,
  Error,
  string
> {
  return useMutation({
    mutationFn: async (id: string) =>
      (await invoke("registry:overrides:export", { id })).path,
  })
}
