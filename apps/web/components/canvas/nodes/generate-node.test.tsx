// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AssetDto,
  CanvasNodeDto,
  GenerationDto,
  IpcChannel,
  JobDto,
} from "@opendirect/contract"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CanvasSurfaceProvider } from "../canvas-context"
import { GenerateNodeBody } from "./generate-node"

/**
 * The bridge is mocked rather than served: every channel here is a contract
 * call into the main process, and the point of the test is what the node
 * paints from the rows, not how they travelled.
 *
 * ⛔ No handler in this file submits anything. Retry is asserted as one
 * `jobs:retry` call and stops there.
 */
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
    modelSlug: "black-forest-labs/flux-schnell",
    modelVersion: null,
    kind: "image",
    prompt: "a bellhop opens the lift",
    paramsJson: "{}",
    requestJson: null,
    responseJson: null,
    status: "running",
    error: null,
    providerJobId: "pred-1",
    estimatedCostUsd: 0.01,
    actualCostUsd: null,
    predictTimeSeconds: null,
    costConfidence: "estimated",
    parentGenerationId: null,
    batchId: "batch-1",
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

function asset(overrides: Partial<AssetDto> = {}): AssetDto {
  return {
    id: "asset-1",
    projectId: "proj-1",
    kind: "image",
    relPath: "media/asset-1.png",
    text: null,
    mimeType: "image/png",
    width: 1024,
    height: 1024,
    durationMs: null,
    bytes: 1024,
    sha256: "abc",
    thumbnailRelPath: null,
    label: null,
    originalName: null,
    pinned: false,
    generationId: "gen-1",
    createdAt: 2_000,
    url: "asset://media/asset-1.png",
    thumbnailUrl: null,
    ...overrides,
  }
}

function node(overrides: Partial<CanvasNodeDto> = {}): CanvasNodeDto {
  return {
    id: "node-1",
    projectId: "proj-1",
    type: "image_gen",
    x: 0,
    y: 0,
    width: 360,
    height: 360,
    assetId: null,
    generationId: "gen-1",
    batchId: "batch-1",
    pickAssetId: null,
    text: null,
    color: null,
    createdAt: 1,
    updatedAt: 1,
    asset: null,
    generation: generation(),
    ...overrides,
  }
}

function renderNode(row: CanvasNodeDto, containerId: string | null = null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const body = <GenerateNodeBody node={row} />
  return render(
    <QueryClientProvider client={client}>
      {containerId === null ? (
        body
      ) : (
        <CanvasSurfaceProvider
          value={{
            canvas: { nodes: [], edges: [] },
            containerId,
            history: {
              push: () => {},
              undo: async () => {},
              redo: async () => {},
              clear: () => {},
              canUndo: false,
              canRedo: false,
              undoLabel: null,
              redoLabel: null,
              busy: false,
              depth: 0,
            },
            spawn: () => {},
            pick: () => {},
          }}
        >
          {body}
        </CanvasSurfaceProvider>
      )}
    </QueryClientProvider>
  )
}

beforeEach(() => {
  invoke.mockReset()
  listeners.clear()
})

afterEach(cleanup)

describe("GenerateNodeBody", () => {
  it("goes from a pushed job's progress, to a grid of outputs, to a new pick", async () => {
    let outputs: AssetDto[] = []
    invoke.mockImplementation((channel: IpcChannel) => {
      if (channel === "generations:list") {
        return Promise.resolve({
          items: [generation()],
          total: 1,
          nextOffset: null,
        })
      }
      if (channel === "assets:list") {
        return Promise.resolve({
          items: outputs,
          total: outputs.length,
          nextOffset: null,
        })
      }
      if (channel === "jobs:list") {
        return Promise.resolve([job({ progress: 0.5 })])
      }
      return Promise.resolve({ ok: true })
    })

    renderNode(node())

    // 1. Running: the ring reads the percentage the provider reported. Until
    // the job rows arrive there is no number to show, and it shows none.
    await waitFor(() =>
      expect(screen.getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        "50"
      )
    )
    expect(screen.getByText("50%")).toBeVisible()

    // 2. The run lands. `jobs:update` is pushed, which is what invalidates the
    // asset query — the outputs are attached to the generation by then.
    outputs = [asset(), asset({ id: "asset-2", createdAt: 2_001 })]
    listeners.get("jobs:update")?.(
      job({
        state: "succeeded",
        progress: 1,
        generation: generation({ status: "succeeded" }),
      })
    )

    await waitFor(() =>
      expect(screen.getByTestId("canvas-tile-asset-1")).toBeVisible()
    )
    expect(screen.getByTestId("canvas-tile-asset-2")).toBeVisible()

    // 3. No pick yet, so the first successful output becomes the default one.
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("canvas:node:pick", {
        id: "node-1",
        assetId: "asset-1",
      })
    )

    // 4. And the user changes it, in one click, to the tile they want.
    await userEvent.click(screen.getByTestId("canvas-tile-asset-2"))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("canvas:node:pick", {
        id: "node-1",
        assetId: "asset-2",
      })
    )
  })

  it("says so when outputs have landed and none of them is the pick", async () => {
    invoke.mockImplementation((channel: IpcChannel) => {
      if (channel === "generations:list") {
        return Promise.resolve({
          items: [generation({ status: "succeeded" })],
          total: 1,
          nextOffset: null,
        })
      }
      if (channel === "assets:list") {
        return Promise.resolve({ items: [asset()], total: 1, nextOffset: null })
      }
      if (channel === "jobs:list") return Promise.resolve([])
      return Promise.resolve({ ok: true })
    })

    // The pick was nulled — the asset it pointed at is gone — and the node does
    // not silently fall back to another tile, because picking is the user's.
    renderNode(node({ pickAssetId: "asset-gone" }))

    expect(await screen.findByText(/No pick selected/i)).toBeVisible()
  })

  it("gives a failed sibling its own message and its own Retry", async () => {
    invoke.mockImplementation((channel: IpcChannel) => {
      if (channel === "generations:list") {
        return Promise.resolve({
          items: [
            generation({ status: "succeeded" }),
            generation({
              id: "gen-2",
              status: "failed",
              createdAt: 1_001,
              error: "NSFW content detected",
            }),
          ],
          total: 2,
          nextOffset: null,
        })
      }
      if (channel === "assets:list") {
        return Promise.resolve({ items: [asset()], total: 1, nextOffset: null })
      }
      if (channel === "jobs:list") {
        return Promise.resolve([
          job({ state: "succeeded" }),
          job({
            id: "job-2",
            generationId: "gen-2",
            state: "failed",
            error: "NSFW content detected",
            generation: generation({ id: "gen-2", status: "failed" }),
          }),
        ])
      }
      return Promise.resolve({ ok: true })
    })

    renderNode(node({ pickAssetId: "asset-1" }))

    // Three of four succeeding is a usable node: the tile that worked is still
    // there, and the one that did not carries the provider's own words.
    expect(await screen.findByTestId("canvas-tile-asset-1")).toBeVisible()
    const failed = screen.getByTestId("canvas-tile-failed-gen-2")
    expect(failed).toHaveTextContent("NSFW content detected")

    await userEvent.click(await screen.findByRole("button", { name: /retry/i }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("jobs:retry", { id: "job-2" })
    )
  })

  /**
   * A batch of siblings has no single run to point at once one of them is
   * pruned — `generation_id` is nulled by the foreign key and the node is left
   * with only its batch id. It must still paint the siblings it has.
   */
  it("still shows its batch siblings when its own generation is gone", async () => {
    invoke.mockImplementation((channel: IpcChannel) => {
      if (channel === "generations:list") {
        return Promise.resolve({
          items: [
            generation({ id: "gen-1", status: "succeeded" }),
            generation({ id: "gen-2", status: "succeeded", createdAt: 1_001 }),
          ],
          total: 2,
          nextOffset: null,
        })
      }
      if (channel === "assets:list") {
        return Promise.resolve({
          items: [
            asset(),
            asset({ id: "asset-2", generationId: "gen-2", createdAt: 2_001 }),
          ],
          total: 2,
          nextOffset: null,
        })
      }
      if (channel === "jobs:list") return Promise.resolve([])
      return Promise.resolve({ ok: true })
    })

    renderNode(
      node({
        generationId: null,
        generation: null,
        batchId: "batch-1",
        pickAssetId: "asset-1",
      }),
      "container-1"
    )

    expect(await screen.findByTestId("canvas-tile-asset-1")).toBeVisible()
    expect(screen.getByTestId("canvas-tile-asset-2")).toBeVisible()
  })
})
