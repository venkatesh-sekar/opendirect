// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useClearKey, useSaveKey, useUpdateSettings } from "./settings"

const { invoke, toast } = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/ipc", () => ({ invoke }))
vi.mock("sonner", () => ({ toast }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function setup<T>(useHook: () => T) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(client, "invalidateQueries")
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { invalidate, ...renderHook(useHook, { wrapper }) }
}

/**
 * A family's descriptor and its quote both follow the provider order, the
 * keys held and the registry — the same inputs main reads at submit — so a
 * change to any of them must drop both, or the price shown is not the run.
 */
function expectModelsAndCostInvalidated(
  invalidate: ReturnType<typeof setup>["invalidate"]
) {
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["models"] })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["cost"] })
}

describe("settings mutations drop descriptors and quotes", () => {
  it("on a provider-order change", async () => {
    invoke.mockResolvedValue({ providerOrder: ["openrouter", "replicate"] })
    const { result, invalidate } = setup(() => useUpdateSettings())

    await act(() =>
      result.current.mutateAsync({ providerOrder: ["openrouter", "replicate"] })
    )

    await waitFor(() => expectModelsAndCostInvalidated(invalidate))
  })

  it("on a key save", async () => {
    invoke.mockResolvedValue({ ok: true })
    const { result, invalidate } = setup(() => useSaveKey())

    await act(() =>
      result.current.mutateAsync({ provider: "replicate", key: "r8_x" })
    )

    await waitFor(() => expectModelsAndCostInvalidated(invalidate))
  })

  it("on a key clear", async () => {
    invoke.mockResolvedValue({ ok: true })
    const { result, invalidate } = setup(() => useClearKey())

    await act(() => result.current.mutateAsync("replicate"))

    await waitFor(() => expectModelsAndCostInvalidated(invalidate))
  })
})
