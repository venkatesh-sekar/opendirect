"use client"

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query"
import type { AssetDto, AssetPage, ImportResult } from "@opendirect/contract"

import { invoke } from "@/lib/ipc"
import { queryKeys } from "./query-keys"
import { invalidateContainerFacts } from "./use-containers"

export interface AssetsPageOptions {
  limit?: number
  offset?: number
}

/**
 * One container's board.
 *
 * `containerId` may be null while nothing is selected, which disables the
 * query rather than fetching a container that does not exist.
 */
export function useAssets(
  containerId: string | null,
  options: AssetsPageOptions = {}
): UseQueryResult<AssetPage> {
  return useQuery({
    queryKey: queryKeys.assets.byContainer(containerId ?? "", {
      limit: options.limit,
      offset: options.offset,
    }),
    queryFn: () =>
      invoke("assets:list", {
        containerId: containerId!,
        limit: options.limit,
        offset: options.offset,
      }),
    enabled: containerId !== null,
  })
}

export function useAsset(id: string | null): UseQueryResult<AssetDto> {
  return useQuery({
    queryKey: queryKeys.assets.detail(id ?? ""),
    queryFn: () => invoke("assets:get", { id: id! }),
    enabled: id !== null,
  })
}

/** Opens the native file picker. Returns an empty list when cancelled. */
export function useChooseFiles(): UseMutationResult<string[], Error, void> {
  return useMutation({
    mutationFn: async () => (await invoke("assets:choose")).paths,
  })
}

export interface ImportVariables {
  paths: string[]
  containerId?: string | null
  label?: string | null
}

/**
 * Copies files into the project. Invalidates the *target* container's board
 * (`["assets", containerId]`) rather than every board, so importing into one
 * container does not refetch the rest.
 */
export function useImportAssets(): UseMutationResult<
  ImportResult,
  Error,
  ImportVariables
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (variables: ImportVariables) =>
      invoke("assets:import", variables),
    onSuccess: (_result, variables) => {
      void client.invalidateQueries({
        queryKey: variables.containerId
          ? ["assets", variables.containerId]
          : queryKeys.assets.all,
      })
      // An import can give a character its first reference image, which is
      // the difference between `@venkz` attaching a picture and not.
      void client.invalidateQueries({ queryKey: queryKeys.mentions.all })
      // A card's asset count and cover follow the container's library.
      invalidateContainerFacts(client)
    },
  })
}

export interface CropVariables {
  assetId: string
  containerId?: string | null
  /** Fractions (0–1) of the image as displayed. */
  rect: { x: number; y: number; width: number; height: number }
}

/**
 * Crops an image into a new asset in `containerId`. The source is untouched,
 * so only the board the crop lands on needs refetching.
 */
export function useCropAsset(): UseMutationResult<
  AssetDto,
  Error,
  CropVariables
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (variables: CropVariables) => invoke("assets:crop", variables),
    onSuccess: (_result, variables) => {
      void client.invalidateQueries({
        queryKey: variables.containerId
          ? ["assets", variables.containerId]
          : queryKeys.assets.all,
      })
      void client.invalidateQueries({ queryKey: queryKeys.mentions.all })
      invalidateContainerFacts(client)
    },
  })
}

export interface LinkVariables {
  containerId: string
  assetId: string
}

export function useAddAssetToContainer(): UseMutationResult<
  { ok: true },
  Error,
  LinkVariables
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (variables: LinkVariables) =>
      invoke("assets:addToContainer", variables),
    onSuccess: (_result, variables) => {
      void client.invalidateQueries({
        queryKey: ["assets", variables.containerId],
      })
      void client.invalidateQueries({ queryKey: queryKeys.mentions.all })
      invalidateContainerFacts(client)
    },
  })
}

/**
 * Unlinks an asset from one board; the file and every other link survive. A
 * shot whose pick it was loses the pick, and the tree carries picks.
 */
export function useRemoveAssetFromContainer(): UseMutationResult<
  { ok: true },
  Error,
  LinkVariables
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (variables: LinkVariables) =>
      invoke("assets:removeFromContainer", variables),
    onSuccess: (_result, variables) => {
      void client.invalidateQueries({
        queryKey: ["assets", variables.containerId],
      })
      void client.invalidateQueries({ queryKey: queryKeys.mentions.all })
      void client.invalidateQueries({ queryKey: queryKeys.containers.tree })
      invalidateContainerFacts(client)
    },
  })
}

export interface MoveVariables {
  assetId: string
  fromContainerId: string
  toContainerId: string
}

/**
 * Re-files an asset from one board to another, atomically in main. Both
 * boards refetch; the tree does too, because the source may lose a reference
 * or a shot's pick with the link.
 */
export function useMoveAsset(): UseMutationResult<
  { ok: true },
  Error,
  MoveVariables
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (variables: MoveVariables) => invoke("assets:move", variables),
    onSuccess: (_result, variables) => {
      for (const containerId of [
        variables.fromContainerId,
        variables.toContainerId,
      ])
        void client.invalidateQueries({ queryKey: ["assets", containerId] })
      void client.invalidateQueries({ queryKey: queryKeys.mentions.all })
      // `containers.all` covers the tree (references, picks) and the cards.
      void client.invalidateQueries({ queryKey: queryKeys.containers.all })
    },
  })
}

/**
 * Deletes an asset from the project, file and all. It can have been on any
 * board, any canvas node and any run's outputs, so every one of those is
 * refetched rather than guessed at.
 */
export function useDeleteAsset(): UseMutationResult<
  { ok: true },
  Error,
  string
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => invoke("assets:delete", { id }),
    onSuccess: (_result, id) => {
      client.removeQueries({ queryKey: queryKeys.assets.detail(id) })
      void client.invalidateQueries({ queryKey: queryKeys.assets.all })
      void client.invalidateQueries({ queryKey: queryKeys.mentions.all })
      void client.invalidateQueries({ queryKey: queryKeys.containers.all })
      void client.invalidateQueries({ queryKey: queryKeys.canvas.all })
      void client.invalidateQueries({ queryKey: queryKeys.generations.all })
    },
  })
}

/**
 * Hands a file to the operating system — Open, and Reveal in folder.
 *
 * The renderer sends an asset id, never a path: main is the only process that
 * knows where the project folder is, and `shell-open.ts` re-checks the stored
 * path against it before Electron is allowed near the file.
 */
export function useOpenAsset(): UseMutationResult<{ ok: true }, Error, string> {
  return useMutation({
    mutationFn: (assetId: string) => invoke("shell:openAsset", { assetId }),
  })
}

export function useRevealAsset(): UseMutationResult<
  { ok: true },
  Error,
  string
> {
  return useMutation({
    mutationFn: (assetId: string) => invoke("shell:revealAsset", { assetId }),
  })
}
