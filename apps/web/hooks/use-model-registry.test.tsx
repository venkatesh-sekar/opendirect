// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { queryKeys } from "./query-keys"
import {
  MappingValidationError,
  useDeleteOverride,
  useExportOverride,
  useImportOverrides,
  useRegistryFamilies,
  useRegistryOverrides,
  useRegistryStatus,
  useReloadRegistry,
  useSaveOverride,
} from "./use-model-registry"

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

const status = {
  format: 1,
  bundledVersion: 1,
  activeVersion: 4,
  activeSource: "remote",
  remote: {
    enabled: true,
    url: "https://example.test/registry",
    version: 4,
    fetchedAt: 1,
    error: null,
  },
  overrides: 0,
  families: 5,
  warnings: [],
}

const override = {
  key: "k1",
  id: "mine",
  raw: {},
  family: null,
  issues: [],
  updatedAt: 1,
}

function expectRegistryAndModelsInvalidated(
  invalidate: ReturnType<typeof setup>["invalidate"]
) {
  expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.registry.all })
  // A mapping change changes the descriptors.
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["models"] })
}

describe("registry queries", () => {
  it("reads status, families and overrides from their channels", async () => {
    invoke.mockImplementation(async (channel: string) =>
      channel === "registry:status" ? status : []
    )
    const { result } = setup(() => ({
      status: useRegistryStatus(),
      families: useRegistryFamilies(),
      overrides: useRegistryOverrides(),
    }))

    await waitFor(() => expect(result.current.status.data).toEqual(status))
    await waitFor(() => expect(result.current.families.data).toEqual([]))
    await waitFor(() => expect(result.current.overrides.data).toEqual([]))
    expect(invoke).toHaveBeenCalledWith("registry:status")
    expect(invoke).toHaveBeenCalledWith("registry:families")
    expect(invoke).toHaveBeenCalledWith("registry:overrides:list")
  })
})

describe("useReloadRegistry", () => {
  it("toasts the version and source in force, and invalidates", async () => {
    invoke.mockResolvedValue(status)
    const { result, invalidate } = setup(useReloadRegistry)

    await act(() => result.current.mutateAsync())

    expect(invoke).toHaveBeenCalledWith("registry:reload")
    expect(toast.success).toHaveBeenCalledWith(
      "Registry reloaded · v4 from remote"
    )
    expectRegistryAndModelsInvalidated(invalidate)
  })

  it("says so when the remote could not be fetched", async () => {
    invoke.mockResolvedValue({
      ...status,
      activeVersion: 1,
      activeSource: "bundled",
      remote: { ...status.remote, error: "HTTP 404" },
    })
    const { result } = setup(useReloadRegistry)

    await act(() => result.current.mutateAsync())

    expect(toast.error).toHaveBeenCalledWith(
      "Could not fetch the remote registry",
      { description: "HTTP 404 · Using v1 from bundled." }
    )
  })
})

describe("useSaveOverride", () => {
  it("saves and invalidates", async () => {
    invoke.mockResolvedValue({ ok: true, override })
    const { result, invalidate } = setup(useSaveOverride)

    const saved = await act(() =>
      result.current.mutateAsync({ family: { id: "mine" }, replaceId: null })
    )

    expect(saved).toEqual(override)
    expect(invoke).toHaveBeenCalledWith("registry:overrides:save", {
      family: { id: "mine" },
      replaceId: null,
    })
    expectRegistryAndModelsInvalidated(invalidate)
  })

  it("fails with the per-field issues when main refuses the mapping", async () => {
    const issues = [{ path: "endpoints.0.model", message: "Too small" }]
    invoke.mockResolvedValue({ ok: false, issues })
    const { result, invalidate } = setup(useSaveOverride)

    let error: unknown
    await act(async () => {
      try {
        await result.current.mutateAsync({ family: {}, replaceId: null })
      } catch (thrown) {
        error = thrown
      }
    })

    expect(error).toBeInstanceOf(MappingValidationError)
    expect((error as MappingValidationError).issues).toEqual(issues)
    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe("override mutations", () => {
  it("deletes by storage key and invalidates", async () => {
    invoke.mockResolvedValue({ ok: true })
    const { result, invalidate } = setup(useDeleteOverride)

    await act(() => result.current.mutateAsync("k1"))

    expect(invoke).toHaveBeenCalledWith("registry:overrides:delete", {
      key: "k1",
    })
    expectRegistryAndModelsInvalidated(invalidate)
  })

  it("imports candidates without saving them", async () => {
    invoke.mockResolvedValue({ candidates: [override] })
    const { result, invalidate } = setup(useImportOverrides)

    const imported = await act(() => result.current.mutateAsync())

    expect(invoke).toHaveBeenCalledWith("registry:overrides:import")
    expect(imported).toEqual([override])
    // Nothing is stored until the editor saves, so nothing is stale.
    expect(invalidate).not.toHaveBeenCalled()
  })

  it("exports by id and hands back the path", async () => {
    invoke.mockResolvedValue({ path: "/tmp/mine.json" })
    const { result, invalidate } = setup(useExportOverride)

    const path = await act(() => result.current.mutateAsync("mine"))
    expect(invalidate).not.toHaveBeenCalled()

    expect(invoke).toHaveBeenCalledWith("registry:overrides:export", {
      id: "mine",
    })
    expect(path).toBe("/tmp/mine.json")
  })
})
