"use client"

/**
 * The job runner, from the renderer's side.
 *
 * The list is *pushed*, not polled: main sends a `jobs:update` event on every
 * state change, and this patches the cached array with it. A renderer timer
 * asking "are we there yet" every second would be a second source of truth for
 * something SQLite already knows, and would keep the window busy while nothing
 * was happening.
 *
 * When a job reaches a terminal state the board's queries are invalidated too,
 * because that is the moment a finished run's outputs exist as assets.
 *
 * ⛔ Nothing here starts a run except `useRetryJob`, which is wired to an
 * explicit Retry button.
 */
import { useEffect } from "react"
import { toast } from "sonner"
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query"
import type { JobDto, JobState } from "@opendirect/contract"

import { invoke, isBridgeAvailable, subscribe } from "@/lib/ipc"
import { queryKeys } from "./query-keys"
import { invalidateContainerFacts } from "./use-containers"

/** States the runner will still move out of by itself. */
const ACTIVE: ReadonlySet<JobState> = new Set([
  "queued",
  "submitting",
  "running",
  "downloading",
])

export function isJobActive(job: JobDto): boolean {
  return ACTIVE.has(job.state)
}

/** The same order main sorts by: active first, then newest. */
function sortJobs(jobs: JobDto[]): JobDto[] {
  return [...jobs].sort((a, b) => {
    const active = Number(isJobActive(b)) - Number(isJobActive(a))
    return active !== 0 ? active : b.createdAt - a.createdAt
  })
}

function applyUpdate(current: JobDto[] | undefined, job: JobDto): JobDto[] {
  const rest = (current ?? []).filter((entry) => entry.id !== job.id)
  return sortJobs([...rest, job])
}

/**
 * A finished run has produced assets, a container link and a final cost, none
 * of which the pushed job payload carries — so the views that show them are
 * invalidated rather than patched. That includes the container cards, whose
 * counts, cover and last activity may all have just moved.
 */
function invalidateForTerminalJob(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: queryKeys.generations.all })
  void client.invalidateQueries({ queryKey: queryKeys.assets.all })
  invalidateContainerFacts(client)
}

/**
 * The toast for a run that has stopped.
 *
 * Only terminal states say anything: a toast per transition would fire four
 * times per run for news nobody asked for. A cancel is the user's own doing
 * and is therefore silent too — they are looking at the button they pressed.
 */
export function announceTerminalJob(job: JobDto): void {
  const model = job.generation.modelSlug
  if (job.state === "succeeded") {
    toast.success(`${model} finished`, {
      description: "The output is on the board.",
    })
    return
  }
  if (job.state === "failed") {
    toast.error(`${model} failed`, {
      description: job.error ?? job.generation.error ?? undefined,
    })
  }
}

// A canvas may have hundreds of query observers, but the event patches the
// shared cache once. Reference counting also supports isolated previews and
// Strict Mode's subscribe/unsubscribe cycle without a permanent global listener.
const jobSubscriptions = new WeakMap<
  QueryClient,
  { users: number; unsubscribe: () => void }
>()

export function subscribeToJobs(client: QueryClient): () => void {
  let subscription = jobSubscriptions.get(client)
  if (!subscription) {
    subscription = {
      users: 0,
      unsubscribe: subscribe("jobs:update", (job) => {
        const known = client.getQueryData<JobDto[]>(queryKeys.jobs.list)
        const previous = known?.find((entry) => entry.id === job.id)
        client.setQueryData<JobDto[]>(queryKeys.jobs.list, (current) =>
          applyUpdate(current, job)
        )
        if (isJobActive(job)) return
        invalidateForTerminalJob(client)
        if (!previous || isJobActive(previous)) announceTerminalJob(job)
      }),
    }
    jobSubscriptions.set(client, subscription)
  }
  subscription.users++
  let released = false
  return () => {
    if (released) return
    released = true
    if (--subscription.users === 0) {
      subscription.unsubscribe()
      jobSubscriptions.delete(client)
    }
  }
}

export function useJobs(
  select?: (jobs: JobDto[]) => JobDto[]
): UseQueryResult<JobDto[]> {
  const client = useQueryClient()

  useEffect(() => {
    if (!isBridgeAvailable()) return
    return subscribeToJobs(client)
  }, [client])

  return useQuery({
    queryKey: queryKeys.jobs.list,
    queryFn: () => invoke("jobs:list", {}),
    select,
    staleTime: Infinity,
    // The list is kept current by `jobs:update`; a refetch on every focus
    // would only duplicate what the push already delivered.
    refetchOnWindowFocus: false,
  })
}

/** How many runs the queue still owes an answer for — the status bar's count. */
export function useActiveJobCount(): number {
  const jobs = useJobs()
  return (jobs.data ?? []).filter(isJobActive).length
}

export function useCancelJob(): UseMutationResult<JobDto, Error, string> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => invoke("jobs:cancel", { id }),
    onSuccess: (job) => {
      client.setQueryData<JobDto[]>(queryKeys.jobs.list, (current) =>
        applyUpdate(current, job)
      )
      invalidateForTerminalJob(client)
    },
  })
}

/**
 * ⛔ Starts a run the app found queued at startup and refused to start by
 * itself — a paid call, from an explicit Resume click only.
 */
export function useResumeJob(): UseMutationResult<JobDto, Error, string> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => invoke("jobs:resume", { id }),
    onSuccess: (job) => {
      client.setQueryData<JobDto[]>(queryKeys.jobs.list, (current) =>
        applyUpdate(current, job)
      )
    },
  })
}

/** ⛔ Re-submits the run — a paid call, from an explicit click only. */
export function useRetryJob(): UseMutationResult<JobDto, Error, string> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => invoke("jobs:retry", { id }),
    onSuccess: (job) => {
      client.setQueryData<JobDto[]>(queryKeys.jobs.list, (current) =>
        applyUpdate(current, job)
      )
    },
  })
}
