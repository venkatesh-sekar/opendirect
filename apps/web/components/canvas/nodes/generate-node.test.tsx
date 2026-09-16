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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CanvasSurfaceProvider } from "../canvas-context"
import { DetailsAction, GenerateNodeBody } from "./generate-node"

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
    modelKey: null,
    text: null,
    color: null,
    createdAt: 1,
    updatedAt: 1,
    asset: null,
    generation: generation(),
    ...overrides,
  }
}

/** The surface a node sits on, with every action of it a spy. */
function surfaceStub(containerId: string | null) {
  return {
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
    spawn: vi.fn(),
    pick: vi.fn(),
    branch: vi.fn(),
    selectGeneration: vi.fn(),
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
        <CanvasSurfaceProvider value={surfaceStub(containerId)}>
          {body}
        </CanvasSurfaceProvider>
      )}
    </QueryClientProvider>
  )
}

/** The ⓘ button and its sheet, on a surface whose actions can be asserted. */
function renderDetails(row: CanvasNodeDto = node()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const surface = surfaceStub("container-1")
  render(
    <QueryClientProvider client={client}>
      <CanvasSurfaceProvider value={surface}>
        <DetailsAction generationId={row.generationId!} node={row} />
      </CanvasSurfaceProvider>
    </QueryClientProvider>
  )
  return surface
}

beforeEach(() => {
  invoke.mockReset()
  listeners.clear()
})

afterEach(cleanup)

describe("GenerateNodeBody", () => {
  it("goes from a pushed job's progress, to a hero and a strip, to a new pick", async () => {
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

    // The first output is the hero; the other is a thumbnail under it, and
    // the counter says how many there are to choose between.
    await waitFor(() =>
      expect(screen.getByTestId("canvas-tile-asset-1")).toBeVisible()
    )
    expect(screen.getByTestId("canvas-thumb-asset-1")).toBeVisible()
    expect(screen.getByTestId("canvas-thumb-asset-2")).toBeVisible()
    expect(screen.getByTestId("canvas-batch-counter")).toHaveTextContent(
      "1 of 2"
    )

    // 3. No pick yet, so the first successful output becomes the default one.
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("canvas:node:pick", {
        id: "node-1",
        assetId: "asset-1",
      })
    )

    // 4. And the user changes it, in one click on the thumbnail they want.
    await userEvent.click(screen.getByTestId("canvas-thumb-asset-2"))
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

    // Three of four succeeding is a usable node: the tile that worked is the
    // hero, and the one that did not is still in the strip with the
    // provider's own words and its own Retry.
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
    expect(screen.getByTestId("canvas-thumb-asset-2")).toBeVisible()
  })

  /**
   * The pick is what every downstream edge reads, so it is the one shown
   * large; the rest are there to say "there are others" and to be chosen.
   */
  it("shows the pick large and moves it with the arrow keys", async () => {
    invoke.mockImplementation((channel: IpcChannel) => {
      if (channel === "generations:list") {
        return Promise.resolve({
          items: [generation({ status: "succeeded" })],
          total: 1,
          nextOffset: null,
        })
      }
      if (channel === "assets:list") {
        return Promise.resolve({
          items: [
            asset(),
            asset({ id: "asset-2", createdAt: 2_001 }),
            asset({ id: "asset-3", createdAt: 2_002 }),
          ],
          total: 3,
          nextOffset: null,
        })
      }
      if (channel === "jobs:list") return Promise.resolve([])
      return Promise.resolve({ ok: true })
    })

    // No surface, so the pick goes straight down the `canvas:node:pick`
    // channel and can be asserted as the one call it is.
    renderNode(node({ pickAssetId: "asset-2" }))

    // The pick is the hero, not the first output, and the counter says so.
    expect(await screen.findByTestId("canvas-tile-asset-2")).toBeVisible()
    expect(screen.queryByTestId("canvas-tile-asset-1")).toBeNull()
    expect(screen.getByTestId("canvas-batch-counter")).toHaveTextContent(
      "2 of 3"
    )
    expect(screen.getByTestId("canvas-thumb-asset-2")).toHaveAttribute(
      "aria-pressed",
      "true"
    )

    // ⛔ An arrow key re-points the downstream edges. It runs nothing.
    fireEvent.keyDown(screen.getByRole("group", { name: /batch results/i }), {
      key: "ArrowRight",
    })
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("canvas:node:pick", {
        id: "node-1",
        assetId: "asset-3",
      })
    )
    expect(
      invoke.mock.calls.filter(
        ([channel]) => channel === "generations:submitBatch"
      )
    ).toHaveLength(0)
  })

  /**
   * The two callbacks `DetailsPanel` takes and the canvas used to drop on the
   * floor: without them the sheet renders neither "Branch from this run" nor a
   * clickable lineage, and the features simply vanish.
   */
  describe("the run details sheet", () => {
    it("branches from the run it is describing — and submits nothing", async () => {
      const user = userEvent.setup()
      const succeeded = generation({ status: "succeeded" })
      invoke.mockImplementation((channel: IpcChannel) => {
        if (channel === "generations:get") {
          return Promise.resolve({ generation: succeeded, inputs: [] })
        }
        if (channel === "generations:lineage") {
          return Promise.resolve({
            generation: succeeded,
            ancestors: [],
            descendants: [],
          })
        }
        return Promise.resolve({ ok: true })
      })

      const surface = renderDetails()
      await user.click(screen.getByRole("button", { name: "Run details" }))

      const branch = await screen.findByRole("button", {
        name: /branch from this run/i,
      })
      await user.click(branch)

      expect(surface.branch).toHaveBeenCalledTimes(1)
      expect(surface.branch.mock.calls[0]![1]).toMatchObject({ id: "gen-1" })
      // ⛔ A branch is a composition, never a submission.
      expect(
        invoke.mock.calls.filter(
          ([channel]) => channel === "generations:submitBatch"
        )
      ).toHaveLength(0)
    })

    it("follows the lineage by selecting the node that ran it", async () => {
      const user = userEvent.setup()
      const parent = generation({
        id: "gen-0",
        status: "succeeded",
        prompt: "the lift doors stay shut",
      })
      const child = generation({
        id: "gen-1",
        status: "succeeded",
        parentGenerationId: "gen-0",
      })
      invoke.mockImplementation((channel: IpcChannel) => {
        if (channel === "generations:get") {
          return Promise.resolve({ generation: child, inputs: [] })
        }
        if (channel === "generations:lineage") {
          return Promise.resolve({
            generation: child,
            ancestors: [parent],
            descendants: [],
          })
        }
        return Promise.resolve({ ok: true })
      })

      const surface = renderDetails()
      await user.click(screen.getByRole("button", { name: "Run details" }))
      await user.click(await screen.findByRole("tab", { name: /lineage/i }))

      await user.click(
        await screen.findByRole("button", { name: /the lift doors stay shut/i })
      )

      expect(surface.selectGeneration).toHaveBeenCalledWith("gen-0")
    })
  })

  it("offers the output's own actions on right-click", async () => {
    const user = userEvent.setup()
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

    renderNode(node({ pickAssetId: "asset-1" }), "container-1")

    const tile = await screen.findByTestId("canvas-tile-asset-1")
    fireEvent.contextMenu(tile)

    for (const label of [
      /add to/i,
      /compare/i,
      /^open$/i,
      /reveal in folder/i,
      /details/i,
      /remove from this board/i,
    ]) {
      expect(await screen.findByRole("menuitem", { name: label })).toBeVisible()
    }

    await user.click(
      screen.getByRole("menuitem", { name: /reveal in folder/i })
    )
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("shell:revealAsset", {
        assetId: "asset-1",
      })
    )
  })
})
