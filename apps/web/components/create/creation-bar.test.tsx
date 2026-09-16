// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { DndContext } from "@dnd-kit/core"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AssetDto,
  CostQuote,
  IpcChannel,
  ModelDescriptor,
} from "@opendirect/contract"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useCreation } from "@/hooks/use-creation"

import { CreationBar } from "./creation-bar"

const invoke = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ipc", () => ({
  invoke,
  isBridgeAvailable: () => true,
  pathsForFiles: () => [],
  // The AI helpers subscribe to `ai:progress`; nothing here ever pushes one.
  subscribe: () => () => {},
}))

const MODEL_KEY = "replicate:bytedance/seedance-2.5"

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
      generate_audio: { type: "boolean", default: true },
      watermark: { type: "boolean", title: "Watermark", default: false },
      neural_dithering_curve: { type: "string", title: "Neural Dithering" },
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
    audio: "generate_audio",
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
}

const estimated: CostQuote = {
  amount: 1.156,
  currency: "USD",
  basis: "per_second",
  confidence: "estimated",
  source: "local_table",
  note: "Per second of output video.",
  sku: "720p",
}

let quote: CostQuote = estimated

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
  }
}

const CONTAINER_ASSETS = Array.from({ length: 100 }, (_, index) =>
  asset(`a${index}`)
)

/**
 * A container dropped on the tray, as dnd-kit would report it. Simulating the
 * pointer would test dnd-kit; this tests what the bar does with the drop.
 */
const CONTAINER_DROP = {
  active: {
    id: "container-drag:c9",
    data: {
      current: { type: "container", containerId: "c9", name: "Venkatesh" },
    },
  },
  over: {
    id: "references-tray",
    data: { current: { type: "references" } },
  },
}

/** A run coming back from `generations:get`, already mapped for the bar. */
const BRANCH_PREFILL = {
  modelKey: MODEL_KEY,
  prompt: "a bellhop opens the lift",
  params: { prompt: "a bellhop opens the lift", duration: 9, watermark: true },
  references: { reference_images: ["a0"] },
  assets: [asset("a0")],
  parentGenerationId: "gen-42",
}

function Harness() {
  const creation = useCreation({
    containerId: "c1",
    defaultModelKey: MODEL_KEY,
  })
  return (
    <DndContext onDragEnd={creation.onDragEnd}>
      <button
        type="button"
        onClick={() =>
          creation.onDragEnd(
            CONTAINER_DROP as unknown as Parameters<
              typeof creation.onDragEnd
            >[0]
          )
        }
      >
        Simulate container drop
      </button>
      <button type="button" onClick={() => creation.branchFrom(BRANCH_PREFILL)}>
        Branch from a run
      </button>
      <button
        type="button"
        onClick={() => creation.notify("That run could not be loaded.")}
      >
        Report a failure
      </button>
      <CreationBar creation={creation} />
    </DndContext>
  )
}

function renderBar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <Harness />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  quote = estimated
  invoke.mockReset()
  invoke.mockImplementation(async (channel: IpcChannel, payload: unknown) => {
    switch (channel) {
      case "models:get":
        return descriptor
      case "models:list":
        return { models: [], failures: [] }
      case "models:recommended":
        return { video: [], image: [] }
      case "assets:list":
        return {
          items: CONTAINER_ASSETS,
          total: CONTAINER_ASSETS.length,
          nextOffset: null,
        }
      case "cost:estimate":
        return quote
      case "generations:submit":
        return { id: "g1", status: "queued", payload }
      default:
        throw new Error(`Unexpected channel ${String(channel)}`)
    }
  })
})

afterEach(cleanup)

describe("CreationBar", () => {
  it("shows the model's promoted settings and hides the rest behind Advanced", async () => {
    const user = userEvent.setup()
    renderBar()

    await user.click(await screen.findByRole("button", { name: /Settings/ }))

    expect(await screen.findByLabelText("Duration")).toBeInTheDocument()
    expect(screen.getAllByLabelText("Generate Audio").length).toBeGreaterThan(0)
    // An advanced field is not in the bar itself.
    expect(screen.queryByLabelText("Watermark")).not.toBeInTheDocument()
    // Two fields land in Advanced: watermark and the one nobody has heard of.
    expect(screen.getByRole("button", { name: /Advanced/ })).toHaveTextContent(
      "2"
    )
  })

  it("renders every unpromoted field, including one it has never seen", async () => {
    const user = userEvent.setup()
    renderBar()

    await user.click(await screen.findByRole("button", { name: /Advanced/ }))

    expect(await screen.findByLabelText(/Watermark/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Neural Dithering/)).toBeInTheDocument()
  })

  it("previews the exact request the run will be recorded with", async () => {
    const user = userEvent.setup()
    renderBar()

    await user.type(await screen.findByLabelText("Prompt"), "a bellhop")
    await user.click(screen.getByRole("button", { name: /Advanced/ }))

    const preview = await screen.findByTestId("request-preview")
    const request = JSON.parse(preview.textContent ?? "{}")
    expect(request).toMatchObject({
      modelKey: MODEL_KEY,
      containerId: "c1",
      prompt: "a bellhop",
      params: { duration: 5, resolution: "720p", generate_audio: true },
      references: [],
    })
  })

  it("marks an estimate with a tilde", async () => {
    renderBar()
    await waitFor(() =>
      expect(screen.getByTestId("cost-badge")).toHaveTextContent("~$1.16")
    )
  })

  it("says the cost is unknown rather than showing zero", async () => {
    quote = { ...estimated, amount: 0, confidence: "unknown", note: null }
    renderBar()
    await waitFor(() =>
      expect(screen.getByTestId("cost-badge")).toHaveTextContent("Cost unknown")
    )
  })

  it("queues the run, and calls no provider channel", async () => {
    const user = userEvent.setup()
    renderBar()

    await user.type(await screen.findByLabelText("Prompt"), "a bellhop")
    await user.click(screen.getByRole("button", { name: "Generate" }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "generations:submit",
        expect.objectContaining({
          modelKey: MODEL_KEY,
          prompt: "a bellhop",
          estimatedCostUsd: 1.156,
          costConfidence: "estimated",
        })
      )
    )

    const channels = invoke.mock.calls.map(([channel]) => channel)
    expect(channels).not.toContain("generations:run")
    expect(channels.every((channel) => channel !== "providers:submit")).toBe(
      true
    )
  })

  /**
   * The product rule, end to end: a container bigger than the slot opens the
   * dialog with nothing chosen, and only what the user picks is used.
   */
  it("asks which references to use when a container is over the limit", async () => {
    const user = userEvent.setup()
    renderBar()

    await screen.findByTestId("references-tray")
    await user.click(screen.getByRole("button", { name: /Simulate/ }))

    expect(
      await screen.findByText(
        /Venkatesh — 100 assets\. This model supports 12 references\./
      )
    ).toBeVisible()

    const options = screen.getAllByRole("option")
    expect(options).toHaveLength(100)
    expect(
      options.filter(
        (option) => option.getAttribute("aria-selected") === "true"
      )
    ).toHaveLength(0)
    expect(screen.getByTestId("reference-selection-count")).toHaveTextContent(
      "0 of 12 selected"
    )

    await user.click(options[3]!)
    await user.click(options[7]!)
    await user.click(screen.getByRole("button", { name: "Use 2 references" }))

    await waitFor(() =>
      expect(screen.getAllByTestId("reference-chip")).toHaveLength(2)
    )
    expect(
      screen
        .getAllByTestId("reference-chip")
        .map((chip) => chip.getAttribute("data-asset-id"))
    ).toEqual(["a3", "a7"])
  })

  it("offers no suggestion button that could pick for the user", async () => {
    const user = userEvent.setup()
    renderBar()

    await screen.findByTestId("references-tray")
    await user.click(screen.getByRole("button", { name: /Simulate/ }))

    expect(await screen.findByText(/Suggest 12/)).toBeDisabled()
  })

  it("will not generate while a required field is blank, and says which", async () => {
    const user = userEvent.setup()
    renderBar()

    const generate = await screen.findByRole("button", { name: "Generate" })
    expect(generate).toBeDisabled()

    await user.hover(screen.getByTestId("generate-wrapper"))
    expect(await screen.findByText(/Prompt is still needed/)).toBeVisible()
  })
})

describe("branching", () => {
  it("fills the bar from the parent run without submitting anything", async () => {
    const user = userEvent.setup()
    renderBar()

    await user.click(
      await screen.findByRole("button", { name: "Branch from a run" })
    )

    const prompt = await screen.findByLabelText("Prompt")
    await waitFor(() =>
      expect(prompt).toHaveValue("a bellhop opens the lift")
    )
    expect(screen.getByText(/Branching from an earlier run/)).toBeInTheDocument()
    // ⛔ The whole point: a branch is a filled-in bar, not a run.
    expect(
      invoke.mock.calls.some(([channel]) => channel === "generations:submit")
    ).toBe(false)
  })

  it("adds a quick-branch preset to the prompt and nowhere else", async () => {
    const user = userEvent.setup()
    renderBar()

    await user.click(
      await screen.findByRole("button", { name: "Branch from a run" })
    )
    await user.click(
      await screen.findByRole("button", { name: "Slower camera" })
    )

    await waitFor(() =>
      expect(screen.getByLabelText("Prompt")).toHaveValue(
        "a bellhop opens the lift, slower camera move"
      )
    )
  })

  it("records the branch's parent when the user does press Generate", async () => {
    const user = userEvent.setup()
    renderBar()

    await user.click(
      await screen.findByRole("button", { name: "Branch from a run" })
    )
    await screen.findByText(/Branching from an earlier run/)
    await user.click(await screen.findByRole("button", { name: "Generate" }))

    await waitFor(() => {
      const submitted = invoke.mock.calls.find(
        ([channel]) => channel === "generations:submit"
      )
      expect(submitted?.[1]).toMatchObject({
        modelKey: MODEL_KEY,
        parentGenerationId: "gen-42",
        params: { duration: 9, watermark: true },
        references: [
          { slotField: "reference_images", assetId: "a0", position: 0 },
        ],
      })
    })
  })

  it("shows a failure the shell reports rather than doing nothing", async () => {
    const user = userEvent.setup()
    renderBar()

    await user.click(
      await screen.findByRole("button", { name: "Report a failure" })
    )

    expect(
      await screen.findByText("That run could not be loaded.")
    ).toBeInTheDocument()
  })
})
