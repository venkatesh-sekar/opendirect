// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { GenerationDto, IpcChannel, JobDto } from "@opendirect/contract"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { JobList } from "./job-list"
import { costLabel, formatElapsed } from "./job-row"

const invoke = vi.hoisted(() => vi.fn())
const listeners = vi.hoisted(
  () => new Map<string, (payload: unknown) => void>()
)

vi.mock("@/lib/ipc", () => ({
  invoke,
  isBridgeAvailable: () => true,
  subscribe: (channel: string, callback: (payload: unknown) => void) => {
    listeners.set(channel, callback)
    return () => listeners.delete(channel)
  },
}))

function generation(overrides: Partial<GenerationDto> = {}): GenerationDto {
  return {
    id: "gen-1",
    projectId: "proj-1",
    containerId: "container-1",
    provider: "replicate",
    modelSlug: "bytedance/seedance-2.5",
    modelVersion: "v1",
    kind: "video",
    prompt: "a bellhop opens the lift",
    paramsJson: "{}",
    requestJson: null,
    responseJson: null,
    status: "running",
    error: null,
    providerJobId: "pred-1",
    estimatedCostUsd: 0.64,
    actualCostUsd: null,
    predictTimeSeconds: null,
    costConfidence: "estimated",
    parentGenerationId: null,
    branchNote: null,
    createdAt: 1_000,
    startedAt: 1_000,
    completedAt: null,
    ...overrides,
  }
}

function job(overrides: Partial<JobDto> = {}): JobDto {
  return {
    id: "job-1",
    generationId: "gen-1",
    state: "running",
    attempts: 1,
    error: null,
    createdAt: 1_000,
    lastPolledAt: null,
    nextPollAt: null,
    awaitingResume: false,
    progress: null,
    generation: generation(),
    ...overrides,
  }
}

function renderList() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <JobList />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  invoke.mockReset()
  listeners.clear()
})

afterEach(cleanup)

describe("JobList", () => {
  it("counts the active runs on the trigger", async () => {
    invoke.mockImplementation((channel: IpcChannel) =>
      channel === "jobs:list"
        ? Promise.resolve([
            job(),
            job({ id: "job-2", state: "succeeded", generationId: "gen-2" }),
          ])
        : Promise.resolve(undefined)
    )

    renderList()

    await waitFor(() =>
      expect(screen.getByTestId("active-job-count")).toHaveTextContent("1")
    )
  })

  it("shows the model, the state, the elapsed time and the cost", async () => {
    invoke.mockResolvedValue([job()])
    renderList()

    await userEvent.click(screen.getByRole("button", { name: /jobs/i }))

    expect(await screen.findByText("bytedance/seedance-2.5")).toBeVisible()
    expect(screen.getByText("Running")).toBeVisible()
    // The estimate keeps its `~` until the provider reports what it really cost.
    expect(screen.getByText("~$0.64")).toBeVisible()
    expect(screen.getByRole("progressbar")).toBeVisible()
  })

  it("cancels a running job", async () => {
    invoke.mockImplementation((channel: IpcChannel) =>
      channel === "jobs:list"
        ? Promise.resolve([job()])
        : Promise.resolve(job({ state: "canceled" }))
    )
    renderList()

    await userEvent.click(screen.getByRole("button", { name: /jobs/i }))
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("jobs:cancel", { id: "job-1" })
    )
  })

  it("surfaces a failed run's error inline and offers Retry", async () => {
    invoke.mockImplementation((channel: IpcChannel) =>
      channel === "jobs:list"
        ? Promise.resolve([
            job({
              state: "failed",
              generation: generation({
                status: "failed",
                error: "NSFW content detected",
                completedAt: 5_000,
              }),
            }),
          ])
        : Promise.resolve(job())
    )
    renderList()

    await userEvent.click(screen.getByRole("button", { name: /jobs/i }))

    expect(await screen.findByText("NSFW content detected")).toBeVisible()
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("jobs:retry", { id: "job-1" })
    )
  })

  it("patches the list from a pushed jobs:update rather than refetching", async () => {
    invoke.mockResolvedValue([job()])
    renderList()

    await waitFor(() =>
      expect(screen.getByTestId("active-job-count")).toHaveTextContent("1")
    )
    invoke.mockClear()

    listeners.get("jobs:update")?.(
      job({
        state: "succeeded",
        generation: generation({ status: "succeeded", actualCostUsd: 0.42 }),
      })
    )

    await waitFor(() =>
      expect(screen.getByTestId("active-job-count")).toHaveTextContent("0")
    )
    expect(invoke).not.toHaveBeenCalledWith("jobs:list", expect.anything())
  })
})

describe("row formatting", () => {
  it("shows a provider-reported cost without the estimate marker", () => {
    expect(costLabel(generation({ actualCostUsd: 0.42 }))).toBe("$0.42")
  })

  it("says so rather than showing $0.00 when no price is known", () => {
    expect(
      costLabel(generation({ estimatedCostUsd: null, actualCostUsd: null }))
    ).toBe("Cost unknown")
  })

  it("formats elapsed time as m:ss and h:mm:ss", () => {
    expect(formatElapsed(65_000)).toBe("1:05")
    expect(formatElapsed(3_725_000)).toBe("1:02:05")
  })
})
