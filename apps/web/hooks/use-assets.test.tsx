// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { queryKeys } from "./query-keys"
import {
  useAddAssetToContainer,
  useDeleteAsset,
  useImportAssets,
  useMoveAsset,
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
      // A run from before mentions were recorded is cast by its inputs'
      // links, so a (un)link can change who is in a scene.
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: queryKeys.containers.relatedAll,
      })
    }
  })
})

describe("moving and deleting an asset", () => {
  it("refreshes both boards and the tree after a move", async () => {
    const { result, invalidate } = setup(useMoveAsset)
    await act(() =>
      result.current.mutateAsync({
        assetId: "a1",
        fromContainerId: "c1",
        toContainerId: "c2",
      })
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["assets", "c1"] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["assets", "c2"] })
    // The source can lose a reference or a shot's pick with the link.
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.containers.all,
    })
  })

  it("refreshes every surface the asset could have been on after a delete", async () => {
    const { result, invalidate } = setup(useDeleteAsset)
    await act(() => result.current.mutateAsync("a1"))
    for (const queryKey of [
      queryKeys.assets.all,
      queryKeys.containers.all,
      queryKeys.mentions.all,
      queryKeys.canvas.all,
      queryKeys.generations.all,
    ])
      expect(invalidate).toHaveBeenCalledWith({ queryKey })
  })
})
