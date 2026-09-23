// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { queryKeys } from "./query-keys"
import {
  useAddAssetToContainer,
  useImportAssets,
  useRemoveAssetFromContainer,
} from "./use-assets"

vi.mock("@/lib/ipc", () => ({
  invoke: () =>
    Promise.resolve({ assets: [], imported: 0, deduped: 0, failures: [] }),
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

describe("asset mutations and the container cards", () => {
  // An import or a (un)link changes a card's asset count and possibly its
  // cover, so each one refreshes the summaries alongside the board.
  it("refreshes the summaries after an import", async () => {
    const { result, invalidate } = setup(useImportAssets)
    await act(() =>
      result.current.mutateAsync({ paths: ["/tmp/a.png"], containerId: "c1" })
    )
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.containers.summaries,
    })
  })

  it("refreshes the summaries after linking and unlinking", async () => {
    for (const useHook of [
      useAddAssetToContainer,
      useRemoveAssetFromContainer,
    ]) {
      const { result, invalidate } = setup(useHook)
      await act(() =>
        result.current.mutateAsync({ containerId: "c1", assetId: "a1" })
      )
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: queryKeys.containers.summaries,
      })
    }
  })
})
