// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

/**
 * The bar, from a selected node with a text edge and a media edge to the one
 * call that spends money.
 *
 * Every IPC channel is stubbed, so nothing reaches a provider and nothing
 * reaches SQLite: the assertions are about the *shape* of what
 * `generations:submitBatch` is handed, and about the fact that it is handed it
 * exactly once per click. msw's `onUnhandledRequest: "error"` guards the rest.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AssetDto,
  CanvasDto,
  CanvasEdgeDto,
  CanvasNodeDto,
  ContainerNodeDto,
  CostQuote,
  IpcChannel,
  ModelDescriptor,
} from "@opendirect/contract"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { clearPromptDrafts, PromptBar } from "./prompt-bar"

const invoke = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ipc", () => ({
  invoke,
  isBridgeAvailable: () => true,
  pathsForFiles: () => [],
  subscribe: () => () => {},
}))

const MODEL_KEY = "replicate:bytedance/seedance-2.5"

/** A model with a reference slot and — deliberately — no output-count field. */
const descriptor: ModelDescriptor = {
  key: MODEL_KEY,
  provider: "replicate",
  slug: "bytedance/seedance-2.5",
  name: "Seedance 2.5",
  description: null,
  kind: "video",
  versionId: "v1",
  coverImageUrl: null,
  inputSchema: {
    type: "object",
    required: ["prompt"],
    properties: {
      prompt: { type: "string", title: "Prompt" },
      resolution: { type: "string", enum: ["480p", "720p"], default: "720p" },
      duration: { type: "integer", minimum: 1, maximum: 30, default: 5 },
      watermark: { type: "boolean", title: "Watermark", default: false },
      reference_images: {
        type: "array",
        items: { type: "string", format: "uri" },
      },
    },
  },
  outputSchema: null,
  referenceSlots: [
    {
      field: "reference_images",
      label: "Reference Images",
      kind: "image",
      multiple: true,
      max: 12,
      role: "reference",
    },
  ],
  commonControls: {
    prompt: "prompt",
    aspectRatio: null,
    duration: "duration",
    resolution: "resolution",
    seed: null,
    audio: null,
  },
  pricing: {
    basis: "per_second",
    currency: "USD",
    skus: {},
    estimate: null,
    source: "local_table",
    note: null,
  },
  raw: null,
  fetchedAt: 0,
} as unknown as ModelDescriptor

const estimated: CostQuote = {
  amount: 1.156,
  currency: "USD",
  basis: "per_second",
  confidence: "estimated",
  source: "local_table",
  note: "Per second of output video.",
  sku: "720p",
} as unknown as CostQuote

/**
 * The same model, but one that counts its own outputs and caps a single
 * prediction at four. Asking for six is two jobs, not six — and not a stepper
 * that refuses to go past four.
 */
const counting: ModelDescriptor = {
  ...descriptor,
  inputSchema: {
    ...(descriptor.inputSchema as Record<string, unknown>),
    properties: {
      ...((descriptor.inputSchema as { properties: Record<string, unknown> })
        .properties ?? {}),
      num_outputs: { type: "integer", minimum: 1, maximum: 4, default: 1 },
    },
  },
} as unknown as ModelDescriptor

/** A model that declares an aspect ratio, which is what sizes the frame. */
const framed: ModelDescriptor = {
  ...descriptor,
  inputSchema: {
    ...(descriptor.inputSchema as Record<string, unknown>),
    properties: {
      ...((descriptor.inputSchema as { properties: Record<string, unknown> })
        .properties ?? {}),
      aspect_ratio: {
        type: "string",
        enum: ["16:9", "9:16", "auto"],
        default: "16:9",
      },
    },
  },
  commonControls: {
    ...(descriptor.commonControls as Record<string, unknown>),
    aspectRatio: "aspect_ratio",
  },
} as unknown as ModelDescriptor

let quote: CostQuote = estimated
let served: ModelDescriptor = descriptor

const container: ContainerNodeDto = {
  id: "c1",
  projectId: "p1",
  parentId: null,
  kind: "folder",
  name: "Assets",
  position: 0,
  createdAt: 1,
  children: [],
}

function asset(id: string): AssetDto {
  return {
    id,
    projectId: "p1",
    kind: "image",
    relPath: `assets/${id}.png`,
    text: null,
    mimeType: "image/png",
    width: 64,
    height: 64,
    durationMs: null,
    bytes: 128,
    sha256: id,
    thumbnailRelPath: null,
    label: id,
    originalName: `${id}.png`,
    pinned: false,
    generationId: null,
    createdAt: 1,
    url: `asset://p1/assets/${id}.png`,
    thumbnailUrl: null,
  } as unknown as AssetDto
}

function node(over: Partial<CanvasNodeDto> & { id: string }): CanvasNodeDto {
  return {
    projectId: "p1",
    type: "media",
    x: 0,
    y: 0,
    width: 360,
    height: 200,
    assetId: null,
    generationId: null,
    batchId: null,
    pickAssetId: null,
    text: null,
    color: null,
    createdAt: 1,
    updatedAt: 1,
    asset: null,
    generation: null,
    ...over,
  } as CanvasNodeDto
}

function edge(over: Partial<CanvasEdgeDto> & { id: string }): CanvasEdgeDto {
  return {
    projectId: "p1",
    sourceNodeId: "",
    targetNodeId: "target",
    slotField: null,
    createdAt: 1,
    ...over,
  } as CanvasEdgeDto
}

const TARGET = node({
  id: "target",
  type: "video_gen",
  x: 600,
  y: 0,
})

/** A note and a picture feeding one run — the two edge kinds that matter. */
function canvasWith(media: CanvasNodeDto): CanvasDto {
  return {
    nodes: [
      TARGET,
      node({
        id: "note",
        type: "text",
        text: "a bellhop opens the lift",
        x: 0,
        y: 0,
      }),
      media,
    ],
    edges: [
      edge({ id: "e-text", sourceNodeId: "note", createdAt: 1 }),
      edge({
        id: "e-media",
        sourceNodeId: media.id,
        slotField: "reference_images",
        createdAt: 2,
      }),
    ],
  }
}

const WIRED = canvasWith(
  node({ id: "still", type: "media", assetId: "a0", asset: asset("a0") })
)

/** The same graph with the media node's asset row gone — a blocked run. */
const BROKEN = canvasWith(node({ id: "still", type: "media", assetId: null }))

function renderBar(canvas: CanvasDto = WIRED) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <PromptBar node={TARGET} canvas={canvas} defaultModelKey={MODEL_KEY} />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

function submissions() {
  return invoke.mock.calls.filter(
    ([channel]) => channel === "generations:submitBatch"
  )
}

beforeEach(() => {
  quote = estimated
  served = descriptor
  clearPromptDrafts()
  invoke.mockReset()
  invoke.mockImplementation(async (channel: IpcChannel, payload: unknown) => {
    switch (channel) {
      case "models:get":
        return served
      case "models:list":
        return { models: [], failures: [] }
      case "models:recommended":
        return { video: [], image: [] }
      case "containers:tree":
        return [container]
      case "assets:list":
        return { items: [asset("a1")], total: 1, nextOffset: null }
      case "cost:estimate":
        return quote
      case "generations:submitBatch":
        return {
          batchId: "batch-1",
          generations: [{ id: "g1", status: "queued" }],
        }
      case "canvas:node:update":
        return { ...TARGET, ...(payload as { patch: object }).patch }
      default:
        throw new Error(`Unexpected channel ${String(channel)}`)
    }
  })
})

afterEach(cleanup)

describe("PromptBar", () => {
  it("shows one thumbnail per incoming edge, labelled with its slot", async () => {
    renderBar()

    const thumbs = await screen.findAllByTestId("reference-thumb")
    expect(thumbs.map((thumb) => thumb.dataset.slot)).toEqual([
      "",
      "reference_images",
    ])
  })

  it("builds the request from the node's edges and submits it once", async () => {
    const user = userEvent.setup()
    renderBar()

    const run = await screen.findByRole("button", { name: "Run" })
    await waitFor(() => expect(run).toBeEnabled())

    await user.type(await screen.findByLabelText("Prompt"), "slowly")
    await user.click(screen.getByRole("button", { name: "One more result" }))
    await user.click(screen.getByRole("button", { name: "One more result" }))
    expect(screen.getByTestId("count-value")).toHaveTextContent("3")

    await user.click(run)

    await waitFor(() => expect(submissions()).toHaveLength(1))
    expect(submissions()[0]![1]).toMatchObject({
      count: 3,
      request: {
        modelKey: MODEL_KEY,
        containerId: "c1",
        // The note is prepended to what the user typed.
        prompt: "a bellhop opens the lift\n\nslowly",
        params: {
          prompt: "a bellhop opens the lift\n\nslowly",
          resolution: "720p",
          duration: 5,
        },
        references: [
          { slotField: "reference_images", assetId: "a0", position: 0 },
        ],
        // ⛔ Main mints the batch id; the renderer never claims one.
        batchId: null,
        estimatedCostUsd: 1.156,
        costConfidence: "estimated",
      },
    })
  })

  it("records the batch and the single run on the node", async () => {
    const user = userEvent.setup()
    renderBar()

    const run = await screen.findByRole("button", { name: "Run" })
    await waitFor(() => expect(run).toBeEnabled())
    await user.click(run)

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("canvas:node:update", {
        id: "target",
        patch: { batchId: "batch-1", generationId: "g1" },
      })
    )
  })

  it("⛔ submits nothing a second time while the first is in flight", async () => {
    const user = userEvent.setup()
    const held: { release: (() => void) | null } = { release: null }
    invoke.mockImplementation(async (channel: IpcChannel) => {
      if (channel === "generations:submitBatch") {
        await new Promise<void>((resolve) => {
          held.release = resolve
        })
        return { batchId: "batch-1", generations: [{ id: "g1" }] }
      }
      if (channel === "models:get") return descriptor
      if (channel === "containers:tree") return [container]
      if (channel === "cost:estimate") return quote
      if (channel === "models:list") return { models: [], failures: [] }
      if (channel === "models:recommended") return { video: [], image: [] }
      throw new Error(`Unexpected channel ${String(channel)}`)
    })

    renderBar()
    const run = await screen.findByRole("button", { name: "Run" })
    await waitFor(() => expect(run).toBeEnabled())

    await user.click(run)
    await waitFor(() => expect(run).toBeDisabled())
    await user.click(run)

    expect(submissions()).toHaveLength(1)
    held.release?.()
  })

  it("blocks the run with the reason when a reference cannot be resolved", async () => {
    renderBar(BROKEN)

    expect(await screen.findByTestId("run-blocked")).toHaveTextContent(
      /has no asset any more/
    )
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled()
    expect(submissions()).toHaveLength(0)
  })

  it("multiplies the per-run quote by the count, and says how many runs", async () => {
    const user = userEvent.setup()
    renderBar()

    await waitFor(() =>
      expect(screen.getByTestId("cost-badge")).toHaveTextContent("~$1.16")
    )
    expect(screen.queryByTestId("run-count")).toBeNull()

    await user.click(screen.getByRole("button", { name: "One more result" }))
    await user.click(screen.getByRole("button", { name: "One more result" }))

    await waitFor(() =>
      expect(screen.getByTestId("cost-badge")).toHaveTextContent("~$3.47")
    )
    // No count field on this model, so three results are three jobs.
    expect(screen.getByTestId("run-count")).toHaveTextContent("3 runs")
  })

  it("says the cost is unknown rather than showing zero, however many runs", async () => {
    const user = userEvent.setup()
    quote = { ...estimated, amount: 0, confidence: "unknown", note: null }
    renderBar()

    await waitFor(() =>
      expect(screen.getByTestId("cost-badge")).toHaveTextContent("Cost unknown")
    )
    await user.click(screen.getByRole("button", { name: "One more result" }))
    expect(screen.getByTestId("cost-badge")).toHaveTextContent("Cost unknown")
  })

  it("⛔ reaches no provider channel on any of it", async () => {
    const user = userEvent.setup()
    renderBar()

    const run = await screen.findByRole("button", { name: "Run" })
    await waitFor(() => expect(run).toBeEnabled())
    await user.click(run)
    await waitFor(() => expect(submissions()).toHaveLength(1))

    const channels = invoke.mock.calls.map(([channel]) => String(channel))
    expect(channels).not.toContain("generations:run")
    expect(channels).not.toContain("generations:submit")
    expect(channels.every((channel) => !channel.startsWith("providers:"))).toBe(
      true
    )
  })

  it("lets the count go past the model's own per-prediction maximum", async () => {
    const user = userEvent.setup()
    served = counting
    renderBar()

    const run = await screen.findByRole("button", { name: "Run" })
    await waitFor(() => expect(run).toBeEnabled())

    const more = screen.getByRole("button", { name: "One more result" })
    for (let index = 0; index < 5; index += 1) await user.click(more)
    expect(screen.getByTestId("count-value")).toHaveTextContent("6")
    expect(more).toBeEnabled()

    // Six outputs from a model that holds four per prediction is two jobs,
    // which is what `planBatch` splits it into on both sides of the bridge.
    expect(screen.getByTestId("run-count")).toHaveTextContent("2 runs")

    await user.click(run)
    await waitFor(() => expect(submissions()).toHaveLength(1))
    expect(submissions()[0]![1]).toMatchObject({ count: 6 })
  })

  it("resizes the node's frame to the aspect ratio the user chose", async () => {
    const user = userEvent.setup()
    served = framed
    renderBar()

    await user.click(await screen.findByTestId("settings-chip"))
    const portrait = await screen.findByRole("radio", { name: /9:16/ })
    await user.click(portrait)

    // The width is whatever the node is; only the height follows the ratio, so
    // a node the user has resized keeps the size they gave it.
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("canvas:node:update", {
        id: "target",
        patch: { height: 640 },
      })
    )
  })

  it("leaves the frame alone for a value that is not a ratio at all", async () => {
    const user = userEvent.setup()
    served = framed
    renderBar()

    await user.click(await screen.findByTestId("settings-chip"))
    await user.click(await screen.findByRole("radio", { name: /auto/i }))

    await waitFor(() =>
      expect(screen.getByTestId("settings-chip")).toBeVisible()
    )
    expect(
      invoke.mock.calls.filter(([channel]) => channel === "canvas:node:update")
    ).toHaveLength(0)
  })
})
