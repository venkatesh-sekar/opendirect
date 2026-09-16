"use client"

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query"
import type {
  ContainerDto,
  ContainerKind,
  ContainerNodeDto,
  ProjectRefDto,
  RecentProjectDto,
} from "@opendirect/contract"

import { invoke } from "@/lib/ipc"
import { queryKeys } from "./query-keys"

/**
 * The open project and its container tree.
 *
 * Everything under a project is scoped to whichever one main has open, so
 * opening a different project invalidates *everything*: the tree, the boards
 * and the generation lists all belong to the project that was open when they
 * were fetched.
 */
export function useCurrentProject(): UseQueryResult<ProjectRefDto | null> {
  return useQuery({
    queryKey: queryKeys.project.current,
    queryFn: async () => (await invoke("project:current")).project,
    staleTime: Infinity,
  })
}

export function useRecentProjects(): UseQueryResult<RecentProjectDto[]> {
  return useQuery({
    queryKey: queryKeys.project.recent,
    queryFn: () => invoke("project:recent"),
  })
}

function useProjectSwitch() {
  const client = useQueryClient()
  // `resetQueries` rather than `invalidate`: the previous project's assets must
  // not flash on the new project's board while the refetch is in flight.
  return () => client.resetQueries()
}

export function useOpenProject(): UseMutationResult<
  ProjectRefDto,
  Error,
  string
> {
  const onSwitched = useProjectSwitch()
  return useMutation({
    mutationFn: (path: string) => invoke("project:open", { path }),
    onSuccess: onSwitched,
  })
}

export function useCreateProject(): UseMutationResult<
  ProjectRefDto,
  Error,
  string
> {
  const onSwitched = useProjectSwitch()
  return useMutation({
    mutationFn: (name: string) => invoke("project:create", { name }),
    onSuccess: onSwitched,
  })
}

export function useContainerTree(
  enabled = true
): UseQueryResult<ContainerNodeDto[]> {
  return useQuery({
    queryKey: queryKeys.containers.tree,
    queryFn: () => invoke("containers:tree"),
    enabled,
  })
}

/**
 * Every tree mutation refetches the tree; it is one small query. The mention
 * index goes with it: a rename can re-derive a handle, and a new character is
 * a new `@`-able subject.
 */
function useInvalidateTree(): () => void {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: queryKeys.containers.all })
    void client.invalidateQueries({ queryKey: queryKeys.mentions.all })
  }
}

export interface CreateContainerVariables {
  name: string
  kind: ContainerKind
  parentId?: string | null
}

export function useCreateContainer(): UseMutationResult<
  ContainerDto,
  Error,
  CreateContainerVariables
> {
  const onSuccess = useInvalidateTree()
  return useMutation({
    mutationFn: (variables: CreateContainerVariables) =>
      invoke("containers:create", variables),
    onSuccess,
  })
}

export interface CreateContainerFromAssetVariables {
  assetId: string
  kind: "character" | "scene"
  name: string
}

/**
 * "Save as character" — the container, the link and the reference image in one
 * round trip.
 *
 * The asset queries go with the tree because the asset it was made from comes
 * back pinned, and pinned is what ranks it first among `@venkz`'s images.
 */
export function useCreateContainerFromAsset(): UseMutationResult<
  ContainerDto,
  Error,
  CreateContainerFromAssetVariables
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (variables: CreateContainerFromAssetVariables) =>
      invoke("containers:createFromAsset", variables),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.containers.all })
      void client.invalidateQueries({ queryKey: queryKeys.assets.all })
      void client.invalidateQueries({ queryKey: queryKeys.mentions.all })
    },
  })
}

export function useRenameContainer(): UseMutationResult<
  ContainerDto,
  Error,
  { id: string; name: string }
> {
  const onSuccess = useInvalidateTree()
  return useMutation({
    mutationFn: (variables: { id: string; name: string }) =>
      invoke("containers:rename", variables),
    onSuccess,
  })
}

export function useReparentContainer(): UseMutationResult<
  ContainerDto,
  Error,
  { id: string; parentId: string | null }
> {
  const onSuccess = useInvalidateTree()
  return useMutation({
    mutationFn: (variables: { id: string; parentId: string | null }) =>
      invoke("containers:reparent", variables),
    onSuccess,
  })
}

/**
 * Sets or clears the `@handle` a character or scene answers to.
 *
 * Main validates the shape *and* the uniqueness and throws a sentence the
 * dialog shows as-is, so nothing here second-guesses it.
 */
export function useSetContainerHandle(): UseMutationResult<
  ContainerDto,
  Error,
  { id: string; handle: string | null }
> {
  const onSuccess = useInvalidateTree()
  return useMutation({
    mutationFn: (variables: { id: string; handle: string | null }) =>
      invoke("containers:setHandle", variables),
    onSuccess,
  })
}

/** The prose a mention becomes on a model that takes no image. */
export function useSetContainerDescription(): UseMutationResult<
  ContainerDto,
  Error,
  { id: string; description: string | null }
> {
  const onSuccess = useInvalidateTree()
  return useMutation({
    mutationFn: (variables: { id: string; description: string | null }) =>
      invoke("containers:setDescription", variables),
    onSuccess,
  })
}

/**
 * Deleting a container unlinks its assets but never deletes them, so the asset
 * queries are invalidated too — a board the user was looking at may have been
 * a child of the container that just went away.
 */
export function useDeleteContainer(): UseMutationResult<
  { ok: true },
  Error,
  string
> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => invoke("containers:delete", { id }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.containers.all })
      void client.invalidateQueries({ queryKey: queryKeys.assets.all })
      void client.invalidateQueries({ queryKey: queryKeys.generations.all })
      void client.invalidateQueries({ queryKey: queryKeys.mentions.all })
    },
  })
}
