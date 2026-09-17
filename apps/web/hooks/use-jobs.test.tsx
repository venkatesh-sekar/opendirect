// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import type { JobDto } from "@opendirect/contract"
import { afterEach, describe, expect, it, vi } from "vitest"
import { queryKeys } from "./query-keys"
import { subscribeToJobs, useJobs } from "./use-jobs"

const bridge = vi.hoisted(() => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  listener: null as null | ((job: JobDto) => void),
}))
vi.mock("@/lib/ipc", () => ({
  isBridgeAvailable: () => true,
  invoke: () => Promise.resolve([]),
  subscribe: (_channel: string, callback: (job: JobDto) => void) => {
    bridge.subscribe()
    bridge.listener = callback
    return bridge.unsubscribe
  },
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function job(id: string): JobDto {
  return {
    id,
    generationId: id,
    state: "running",
    progress: 0,
    createdAt: 1,
    generation: { modelSlug: "test" },
  } as JobDto
}

describe("shared job subscription", () => {
  it("patches and invalidates once for a screenful of consumers, and releases the listener", () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, "invalidateQueries")
    const patch = vi.spyOn(client, "setQueryData")
    const releases = Array.from({ length: 120 }, () => subscribeToJobs(client))
    expect(bridge.subscribe).toHaveBeenCalledTimes(1)
    bridge.listener!({ ...job("a"), state: "succeeded" })
    expect(patch).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledTimes(2)
    releases.slice(1).forEach((release) => release())
    expect(bridge.unsubscribe).not.toHaveBeenCalled()
    releases[0]!()
    expect(bridge.unsubscribe).toHaveBeenCalledTimes(1)
    const release = subscribeToJobs(client)
    expect(bridge.subscribe).toHaveBeenCalledTimes(2)
    release()
    client.clear()
  })

  it("keeps separate query clients independent", () => {
    const a = new QueryClient(),
      b = new QueryClient()
    const releaseA = subscribeToJobs(a),
      releaseB = subscribeToJobs(b)
    expect(bridge.subscribe).toHaveBeenCalledTimes(2)
    releaseA()
    releaseA()
    expect(bridge.unsubscribe).toHaveBeenCalledTimes(1)
    releaseB()
    expect(bridge.unsubscribe).toHaveBeenCalledTimes(2)
    a.clear()
    b.clear()
  })

  it("does not rerender a node for another run's progress", async () => {
    const client = new QueryClient()
    client.setQueryData(queryKeys.jobs.list, [job("a"), job("b")])
    let renders = 0
    const select = (jobs: JobDto[]) => jobs.filter((one) => one.id === "a")
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result, unmount } = renderHook(
      () => {
        renders++
        return useJobs(select).data
      },
      { wrapper }
    )
    const before = renders
    await act(async () => {
      bridge.listener!({ ...job("b"), progress: 0.5 })
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(renders).toBe(before)
    act(() => bridge.listener!({ ...job("a"), progress: 0.5 }))
    await waitFor(() => expect(result.current?.[0]?.progress).toBe(0.5))
    unmount()
    client.clear()
  })
})
