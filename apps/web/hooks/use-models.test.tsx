// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { modelDescriptorQuery, modelQueryKey, useModel } from "./use-models"

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock("@/lib/ipc", () => ({ invoke }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("modelQueryKey", () => {
  it("keeps a concrete key's cache whatever the node's slots", () => {
    const key = "replicate:bytedance/seedance-2.5"

    expect(modelQueryKey(key)).toEqual(["models", "descriptor", key])
    expect(
      modelQueryKey(key, { provider: "openrouter", filled: ["reference"] })
    ).toEqual(["models", "descriptor", key])
  })

  it("keys a family descriptor by its provider and sorted filled slots", () => {
    const key = "family:seedance-2-5"

    expect(modelQueryKey(key)).toEqual(["models", "descriptor", key, null, []])
    expect(
      modelQueryKey(key, {
        provider: "openrouter",
        filled: ["reference", "first_frame", "reference"],
      })
    ).toEqual([
      "models",
      "descriptor",
      key,
      "openrouter",
      ["first_frame", "reference"],
    ])
    // Same slots in another order are the same descriptor.
    expect(modelQueryKey(key, { filled: ["b", "a"] })).toEqual(
      modelQueryKey(key, { filled: ["a", "b"] })
    )
  })
})

describe("modelDescriptorQuery", () => {
  it("asks main for a family descriptor with the provider and slots", async () => {
    invoke.mockResolvedValue({})

    await modelDescriptorQuery("family:seedance-2-5", {
      provider: null,
      filled: ["reference", "first_frame"],
    }).queryFn()

    expect(invoke).toHaveBeenCalledWith("models:get", {
      key: "family:seedance-2-5",
      provider: null,
      filled: ["first_frame", "reference"],
    })
  })

  it("asks for a concrete descriptor by key alone", async () => {
    invoke.mockResolvedValue({})

    await modelDescriptorQuery("replicate:a/b", {
      provider: "openrouter",
      filled: ["reference"],
    }).queryFn()

    expect(invoke).toHaveBeenCalledWith("models:get", { key: "replicate:a/b" })
  })
})

describe("useModel", () => {
  it("passes the options through to the descriptor query", async () => {
    invoke.mockResolvedValue({ key: "family:x" })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(
      () => useModel("family:x", { provider: "replicate", filled: ["mask"] }),
      { wrapper }
    )

    await waitFor(() =>
      expect(result.current.data).toEqual({ key: "family:x" })
    )
    expect(invoke).toHaveBeenCalledWith("models:get", {
      key: "family:x",
      provider: "replicate",
      filled: ["mask"],
    })
  })

  it("keeps a family's descriptor on screen while its wiring re-chooses the endpoint", async () => {
    let release: (value: unknown) => void = () => {}
    invoke.mockImplementation(
      async (_channel: string, payload: { key: string; filled?: string[] }) =>
        payload.filled?.length
          ? new Promise((resolve) => {
              release = resolve
            })
          : { key: payload.key, filled: [] }
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    const { result, rerender } = renderHook(
      ({ key, filled }: { key: string; filled: string[] }) =>
        useModel(key, { filled }),
      { wrapper, initialProps: { key: "family:x", filled: [] as string[] } }
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    rerender({ key: "family:x", filled: ["mask"] })
    // The same family, re-asked: the last answer stays, marked as such.
    expect(result.current.data).toEqual({ key: "family:x", filled: [] })
    expect(result.current.isPlaceholderData).toBe(true)
    release({ key: "family:x", filled: ["mask"] })
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false))

    // Another model is never shown in its place.
    rerender({ key: "family:y", filled: ["mask"] })
    expect(result.current.data).toBeUndefined()
  })
})
