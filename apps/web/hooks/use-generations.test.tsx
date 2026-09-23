// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import type { GenerationRequest } from "@opendirect/contract"
import { afterEach, describe, expect, it, vi } from "vitest"

import { queryKeys } from "./query-keys"
import {
  useCostEstimate,
  useSubmitBatch,
  useSubmitGeneration,
} from "./use-generations"

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(() => Promise.resolve({ batchId: "b1", generations: [] })),
}))

vi.mock("@/lib/ipc", () => ({ invoke }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function setup<T>(useHook: () => T) {
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, "invalidateQueries")
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { invalidate, ...renderHook(useHook, { wrapper }) }
}

const request = {} as GenerationRequest

describe("submitting and the container cards", () => {
  // A queued run is one more generation on its container's card.
  it("refreshes the summaries after a single submit", async () => {
    const { result, invalidate } = setup(useSubmitGeneration)
    await act(() => result.current.mutateAsync(request))
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.containers.summaries,
    })
    // The run's mentions may have just put someone in a scene.
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.containers.relatedAll,
    })
  })

  it("refreshes the summaries after a batch submit", async () => {
    const { result, invalidate } = setup(useSubmitBatch)
    await act(() => result.current.mutateAsync({ request, count: 2 }))
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.containers.summaries,
    })
    // The run's mentions may have just put someone in a scene.
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.containers.relatedAll,
    })
  })
})

describe("useCostEstimate", () => {
  it("prices a family run on the node's provider and filled slots", async () => {
    const { result } = setup(() =>
      useCostEstimate(
        "family:seedance-2-5",
        { duration: "5" },
        { provider: "openrouter", filled: ["reference", "first_frame"] }
      )
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invoke).toHaveBeenCalledWith("cost:estimate", {
      key: "family:seedance-2-5",
      params: { duration: "5" },
      provider: "openrouter",
      filled: ["first_frame", "reference"],
    })
  })

  it("prices a concrete key by key and params alone", async () => {
    const { result } = setup(() =>
      useCostEstimate(
        "replicate:a/b",
        { duration: 5 },
        { provider: "openrouter", filled: ["reference"] }
      )
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invoke).toHaveBeenCalledWith("cost:estimate", {
      key: "replicate:a/b",
      params: { duration: 5 },
    })
  })
})
