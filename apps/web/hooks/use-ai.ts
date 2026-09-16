"use client"

/**
 * The AI helpers, from the renderer's side.
 *
 * Two things live here. `useAiTools` answers the only question the UI asks
 * before drawing anything — is there a local CLI at all? — and every AI entry
 * point is hidden when the answer is no. `useAiHelper` owns one run at a time:
 * it mints the run id, listens for the progress main pushes, and holds the
 * result until the user accepts or discards it.
 *
 * ⛔ A helper never applies its own answer. `run` resolves with text; putting
 * that text anywhere is something the user does in `<HelperResultDialog/>`.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query"
import type {
  AiHelperId,
  AiResult,
  AiRunRequest,
  AiToolId,
  AiTools,
} from "@opendirect/contract"

import { invoke, isBridgeAvailable, subscribe } from "@/lib/ipc"

export const aiToolsQueryKey = ["ai", "tools"] as const

/** How many lines of the CLI's own output the dialog keeps. */
const MAX_LOG_LINES = 40

export function useAiTools(): UseQueryResult<AiTools> {
  return useQuery({
    queryKey: aiToolsQueryKey,
    queryFn: () => invoke("ai:tools"),
    enabled: isBridgeAvailable(),
    // Detection is cached in main and only changes when a binary is installed,
    // which the Re-detect button in Settings is for.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}

/** The "Re-detect" action in Settings, for a CLI installed while we were open. */
export function useRedetectAiTools(): UseMutationResult<AiTools, Error, void> {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => invoke("ai:detect"),
    onSuccess: (tools) => client.setQueryData(aiToolsQueryKey, tools),
  })
}

export type AiRunState = "idle" | "running" | "done" | "error" | "canceled"

export interface AiHelperController {
  state: AiRunState
  helper: AiHelperId | null
  result: AiResult | null
  error: string | null
  /** The CLI's own output as it arrives, for the dialog's live log. */
  log: string[]
  run: (request: AiRunRequest["request"], tool?: AiToolId | null) => void
  cancel: () => void
  reset: () => void
}

/** A run id that is unique per window without needing a crypto polyfill. */
function newRunId(): string {
  return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function useAiHelper(): AiHelperController {
  const [state, setState] = useState<AiRunState>("idle")
  const [helper, setHelper] = useState<AiHelperId | null>(null)
  const [result, setResult] = useState<AiResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const runIdRef = useRef<string | null>(null)

  // Progress is pushed per run id, so a stale run's chunks cannot bleed into
  // the dialog of the one the user is watching.
  useEffect(() => {
    if (!isBridgeAvailable()) return
    return subscribe("ai:progress", (progress) => {
      if (progress.runId !== runIdRef.current) return
      if (progress.state === "output" && progress.chunk) {
        setLog((current) =>
          [...current, progress.chunk as string].slice(-MAX_LOG_LINES)
        )
      }
    })
  }, [])

  const run = useCallback(
    (request: AiRunRequest["request"], tool?: AiToolId | null) => {
      const runId = newRunId()
      runIdRef.current = runId
      setState("running")
      setHelper(request.helper)
      setResult(null)
      setError(null)
      setLog([])

      invoke("ai:run", { runId, tool: tool ?? null, request })
        .then((answer) => {
          if (runIdRef.current !== runId) return
          setResult(answer)
          setState("done")
        })
        .catch((failure: unknown) => {
          if (runIdRef.current !== runId) return
          const message =
            failure instanceof Error ? failure.message : "The AI helper failed."
          setError(message)
          setState(/cancel/i.test(message) ? "canceled" : "error")
        })
    },
    []
  )

  const cancel = useCallback(() => {
    const runId = runIdRef.current
    if (!runId) return
    void invoke("ai:cancel", { runId }).catch(() => {
      // The run is finishing either way; a failed cancel is not worth an alert.
    })
  }, [])

  const reset = useCallback(() => {
    runIdRef.current = null
    setState("idle")
    setHelper(null)
    setResult(null)
    setError(null)
    setLog([])
  }, [])

  return { state, helper, result, error, log, run, cancel, reset }
}
