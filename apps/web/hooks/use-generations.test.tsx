// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import type { GenerationRequest } from "@opendirect/contract"
import { afterEach, describe, expect, it, vi } from "vitest"

import { queryKeys } from "./query-keys"
import { useSubmitBatch, useSubmitGeneration } from "./use-generations"

vi.mock("@/lib/ipc", () => ({
  invoke: () => Promise.resolve({ batchId: "b1", generations: [] }),
}))

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
  })

  it("refreshes the summaries after a batch submit", async () => {
    const { result, invalidate } = setup(useSubmitBatch)
    await act(() => result.current.mutateAsync({ request, count: 2 }))
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.containers.summaries,
    })
  })
})
