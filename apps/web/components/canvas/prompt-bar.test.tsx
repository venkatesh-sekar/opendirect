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
  MentionSubjectDto,
  ModelDescriptor,
  ProviderId,
} from "@opendirect/contract"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  seedanceFamilyDescriptor,
  type FamilyDescriptorOptions,
} from "@/lib/canvas/test-family"

import { clearPromptDrafts, PromptBar } from "./prompt-bar"

const invoke = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ipc", () => ({
  invoke,
  isBridgeAvailable: () => true,
  pathsForFiles: () => [],
  subscribe: () => () => {},
}))

/**
 * `useIsMobile`, forced when a test sets `mobile.forced`. Left null it is the
 * real hook, which the first-paint test below depends on reading the window.
 */
const mobile = vi.hoisted(() => ({ forced: null as boolean | null }))

vi.mock("@workspace/ui/hooks/use-mobile", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@workspace/ui/hooks/use-mobile")>()
  return {
    ...actual,
    useIsMobile: () => {
      const real = actual.useIsMobile()
      return mobile.forced ?? real
    },
  }
})

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
  family: null,
  mappedBy: null,
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

/** A model that takes no image at all — where a mention has to be prose. */
const textOnly: ModelDescriptor = {
  ...descriptor,
  inputSchema: {
    type: "object",
    required: ["prompt"],
    properties: { prompt: { type: "string", title: "Prompt" } },
  },
  referenceSlots: [],
} as unknown as ModelDescriptor

/** One `@`-able character, with one reference image and a description. */
const VENKZ: MentionSubjectDto = {
  containerId: "c-venkz",
  kind: "character",
  handle: "venkz",
  name: "Venkz",
  description: "a tired bellhop in a green coat",
  images: [
    { assetId: "a-venkz", label: "Character Sheet", thumbnailUrl: null },
  ],
}

let quote: CostQuote = estimated
let served: ModelDescriptor = descriptor
let subjects: MentionSubjectDto[] = []

/** Detection, as `ai:tools` answers it. `null` preferred = no CLI, no menu. */
function tools(preferred: "claude" | null) {
  return {
    claude: {
      id: "claude",
      available: preferred === "claude",
      path: preferred === "claude" ? "/usr/bin/claude" : null,
      version: preferred === "claude" ? "1.0.0" : null,
    },
    codex: { id: "codex", available: false, path: null, version: null },
    preferred,
    detectedAt: 0,
  }
}

let aiTools = tools("claude")

const container: ContainerNodeDto = {
  id: "c1",
  projectId: "p1",
  parentId: null,
  kind: "folder",
  name: "Assets",
  position: 0,
  handle: null,
  description: null,
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
    modelKey: null,
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

/** The same node with nothing wired into it — no edge, no prefix, no block. */
const BARE: CanvasDto = { nodes: [TARGET], edges: [] }

function renderBar(canvas: CanvasDto = WIRED, target: CanvasNodeDto = TARGET) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <PromptBar node={target} canvas={canvas} defaultModelKey={MODEL_KEY} />
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
  mobile.forced = null
  quote = estimated
  served = descriptor
  aiTools = tools("claude")
  subjects = [VENKZ]
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
      case "mentions:subjects":
        return subjects
      case "cost:estimate":
        return quote
      case "ai:tools":
        return aiTools
      case "ai:run":
        return {
          text: "a bellhop opens the lift, slowly",
          shots: [],
          tool: "claude",
        }
      case "generations:submitBatch":
        return {
          batchId: "batch-1",
          generations: [{ id: "g1", status: "queued" }],
        }
      case "canvas:node:update":
        return { ...TARGET, ...(payload as { patch: object }).patch }
      case "canvas:edge:update":
        return { ...edge({ id: "e-media" }), ...(payload as object) }
      case "canvas:edge:delete":
        return { ok: true }
      default:
        throw new Error(`Unexpected channel ${String(channel)}`)
    }
  })
})

afterEach(cleanup)

/** What a concrete-key node submitted on `main`, before model families. */
const CAPTURED = {
  count: 1,
  request: {
    acceptUnknownCost: false,
    batchId: null,
    containerId: "c1",
    costConfidence: "estimated",
    estimatedCostUsd: 1.156,
    familyId: null,
    mentionedContainerIds: [],
    modelKey: "replicate:bytedance/seedance-2.5",
    params: {
      duration: 5,
      prompt: "a bellhop opens the lift",
      resolution: "720p",
      watermark: false,
    },
    parentGenerationId: null,
    prompt: "a bellhop opens the lift",
    providerOverride: null,
    references: [{ assetId: "a0", position: 0, slotField: "reference_images" }],
    shapes: null,
  },
}

describe("PromptBar", () => {
  it("shows the picture as a thumbnail and the note only as a block", async () => {
    renderBar()

    const strip = await screen.findByTestId("canvas-reference-strip")
    await waitFor(() =>
      expect(
        within(strip)
          .getAllByTestId("reference-thumb")
          .map((thumb) => thumb.dataset.edgeId)
      ).toEqual(["e-media"])
    )
    expect(
      within(strip)
        .getAllByTestId("reference-thumb")
        .map((thumb) => thumb.dataset.slot)
    ).toEqual(["reference_images"])
    // The note is in the prompt, not in the strip.
    expect(
      await screen.findByRole("button", {
        name: /note 1, a bellhop opens the lift/i,
      })
    ).toBeInTheDocument()
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
        patch: {
          batchId: "batch-1",
          generationId: "g1",
          containerId: container.id,
        },
      })
    )
  })

  /**
   * The draft is this window's memory. The *row* is what `modelKeyOfNode`
   * reads when a new edge needs a slot and when the edge label lists the
   * slots to choose from, so the choice has to reach it.
   *
   * ⛔ Recording the model queues nothing.
   */
  it("writes the model it is set to onto the node", async () => {
    renderBar()

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("canvas:node:update", {
        id: "target",
        patch: { modelKey: MODEL_KEY },
      })
    )
    expect(submissions()).toHaveLength(0)
  })

  /**
   * The user's scenario: a headshot wired into a node that had no model yet,
   * so the edge was written with no slot and the run was blocked on an error
   * whose only remedy was to re-label the wire by hand.
   */
  it("gives an edge drawn before the model a slot once there is one", async () => {
    const unresolved: CanvasDto = {
      ...WIRED,
      edges: WIRED.edges.map((one) =>
        one.id === "e-media" ? { ...one, slotField: null } : one
      ),
    }
    renderBar(unresolved)

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("canvas:edge:update", {
        id: "e-media",
        slotField: "reference_images",
      })
    )
    // The text edge keeps its absence of a slot: it prepends to the prompt.
    expect(
      invoke.mock.calls.filter(
        ([channel, payload]) =>
          channel === "canvas:edge:update" &&
          (payload as { id: string }).id === "e-text"
      )
    ).toHaveLength(0)
    expect(submissions()).toHaveLength(0)
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

  /**
   * The bar is anchored to a node, so it cannot overflow in either direction:
   * wrapping pushes Run below the viewport and not wrapping pushes it off the
   * side. Below the sidebar's own breakpoint the two controls that read just
   * as well from a popover go into one.
   */
  it("collapses the count stepper and the cost badge at narrow widths", async () => {
    const user = userEvent.setup()
    const wide = window.innerWidth
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 500,
    })
    try {
      renderBar()

      // Run is never given away, whatever the width.
      const run = await screen.findByRole("button", { name: "Run" })
      await waitFor(() => expect(run).toBeEnabled())
      expect(screen.getByLabelText("Prompt")).toBeVisible()

      await waitFor(() =>
        expect(screen.queryByTestId("count-stepper")).toBeNull()
      )

      await user.click(screen.getByTestId("settings-chip"))
      const footer = await screen.findByTestId("settings-popover-footer")
      expect(footer).toContainElement(screen.getByTestId("count-stepper"))

      // And it is the same stepper, still writing the same draft.
      await user.click(screen.getByRole("button", { name: "One more result" }))
      expect(screen.getByTestId("count-value")).toHaveTextContent("2")
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: wide,
      })
    }
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
    // The model the bar is set to is written to the node either way; what
    // must not happen is a resize for a value that is not a ratio.
    expect(
      invoke.mock.calls
        .filter(([channel]) => channel === "canvas:node:update")
        .map(([, payload]) => (payload as { patch: object }).patch)
    ).toEqual([{ modelKey: MODEL_KEY }])
  })

  it("offers the AI helpers next to Advanced and applies nothing on its own", async () => {
    const user = userEvent.setup()
    renderBar()

    await user.type(await screen.findByLabelText("Prompt"), "a lift opens")

    await user.click(await screen.findByRole("button", { name: "AI helpers" }))
    await user.click(
      await screen.findByRole("button", { name: /improve prompt/i })
    )

    await waitFor(() =>
      expect(
        invoke.mock.calls.filter(([channel]) => channel === "ai:run")
      ).toHaveLength(1)
    )
    expect(invoke.mock.calls.find(([c]) => c === "ai:run")![1]).toMatchObject({
      tool: "claude",
      request: { helper: "improve-prompt", prompt: "a lift opens" },
    })

    // ⛔ The answer is text until the user presses Apply.
    expect(await screen.findByTestId("ai-result-text")).toBeVisible()
    expect(await screen.findByLabelText("Prompt")).toHaveValue("a lift opens")

    await user.click(screen.getByRole("button", { name: "Use this prompt" }))
    expect(await screen.findByLabelText("Prompt")).toHaveValue(
      "a bellhop opens the lift, slowly"
    )
  })

  it("says so rather than running the prompt helper on an empty prompt", async () => {
    const user = userEvent.setup()
    renderBar()

    await user.click(await screen.findByRole("button", { name: "AI helpers" }))
    await user.click(
      await screen.findByRole("button", { name: /improve prompt/i })
    )

    // The block list's drag announcer is a status region too; this is the
    // bar's own notice.
    expect(await screen.findByText(/rough prompt/i)).toHaveAttribute(
      "role",
      "status"
    )
    expect(invoke.mock.calls.filter(([c]) => c === "ai:run")).toHaveLength(0)
  })

  it("shows no AI menu at all when no local CLI was found", async () => {
    aiTools = tools(null)
    renderBar()

    await screen.findByLabelText("Prompt")
    await waitFor(() =>
      expect(
        invoke.mock.calls.some(([channel]) => channel === "ai:tools")
      ).toBe(true)
    )
    expect(screen.queryByRole("button", { name: "AI helpers" })).toBeNull()
  })
  /**
   * The bar is anchored to a node through React Flow's toolbar, so its own
   * width is its position: a chip that grows when a model name arrives slides
   * every control under the pointer. The width is therefore stated, not
   * inherited from the content.
   */
  it("keeps one stated width whatever the content is", async () => {
    renderBar()

    const bar = await screen.findByTestId("canvas-prompt-bar")
    expect(bar.className).toContain("w-[min(52rem,calc(100vw-4rem))]")
    expect(bar.className).not.toContain("max-w-[52rem]")
  })

  /**
   * One toolbar row that never wraps: a wrapped row moves Run to a line of its
   * own under a pointer that was travelling to it. jsdom lays nothing out, so
   * the contract is the class and the DOM order — Run is always last.
   */
  describe.each([
    ["wide", false],
    ["narrow", true],
  ])("the toolbar at a %s width", (_, narrow) => {
    beforeEach(() => {
      mobile.forced = narrow
    })

    it("stays one row and ends with Run", async () => {
      renderBar()

      const run = await screen.findByRole("button", { name: "Run" })
      const controls = screen.getByTestId("prompt-bar-controls")
      expect(controls).toHaveClass("flex-nowrap")
      expect(controls).not.toHaveClass("flex-wrap")
      const picker = screen
        .getAllByRole("combobox")
        .find((element) => element.textContent === MODEL_KEY)
      expect(controls).toContainElement(picker!)
      // A truncated name is still readable on hover.
      expect(picker).toHaveAttribute("title", MODEL_KEY)
      const fullPrompt = screen.getByRole("button", { name: "Full prompt" })
      expect(controls).toContainElement(fullPrompt)
      // Narrow, the toggle is its icon: the word does not fit beside Run.
      expect(fullPrompt).toHaveTextContent(narrow ? /^$/ : "Full prompt")
      const chip = screen.getByTestId("settings-chip")
      if (narrow) {
        // The settings chip too: its summary is its name and its title.
        expect(chip).toHaveTextContent(/^$/)
        expect(chip).toHaveAccessibleName("Settings: 720p")
      } else {
        expect(chip).toHaveTextContent("720p")
      }
      expect(controls).toContainElement(
        screen.getByRole("button", { name: "Save prompt" })
      )
      expect(controls.lastElementChild).toContainElement(run)
      // Every child keeps its width; the model's name is the one thing that
      // may truncate, down to a floor, so the row gives there and not at Run.
      for (const child of controls.children) {
        if (child === picker) {
          expect(child).toHaveClass("shrink", narrow ? "min-w-12" : "min-w-24")
        } else {
          expect(child).toHaveClass("shrink-0")
        }
      }
      expect(Boolean(screen.queryByTestId("count-stepper"))).toBe(!narrow)
    })
  })

  it("names Advanced with its count, and says why it is off", async () => {
    const user = userEvent.setup()
    const first = renderBar()

    const advanced = await screen.findByRole("button", {
      name: "Advanced parameters, 1",
    })
    expect(advanced).toBeEnabled()
    first.unmount()

    served = textOnly
    renderBar(BARE)
    await user.type(await screen.findByLabelText("Prompt"), "a lift")
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Run" })).toBeEnabled()
    )
    const off = screen.getByRole("button", { name: "Advanced parameters" })
    expect(off).toBeDisabled()
    expect(off).toHaveAccessibleDescription(
      "This model has no advanced parameters."
    )
    // A disabled button takes no pointer or focus, so its wrapper does.
    const wrapper = screen.getByTestId("advanced-off-wrapper")
    expect(wrapper).toHaveAttribute("tabindex", "0")
    await user.hover(wrapper)
    // Once for the screen reader, once in the tooltip now showing.
    await waitFor(() =>
      expect(
        screen.getAllByText("This model has no advanced parameters.")
      ).toHaveLength(2)
    )
  })

  it("has no header line above the prompt", async () => {
    renderBar()

    await screen.findByLabelText("Prompt")
    expect(screen.queryByText(/Compose · select references/)).toBeNull()
  })

  it("keeps Space on its controls away from the canvas behind it", async () => {
    renderBar()

    const run = await screen.findByRole("button", { name: "Run" })
    const picker = screen
      .getAllByRole("combobox")
      .find((element) => element.textContent === MODEL_KEY)!
    // React Flow ignores keys whose target sits inside `.nokey`.
    for (const control of [
      run,
      picker,
      screen.getByRole("button", { name: "One more result" }),
      screen.getByRole("button", { name: "One fewer result" }),
      screen.getByTestId("settings-chip"),
    ]) {
      expect(control.closest(".nokey")).not.toBeNull()
    }
  })

  it("saves from an icon button with a name and a tooltip", async () => {
    const user = userEvent.setup()
    renderBar()

    const save = await screen.findByRole("button", { name: "Save prompt" })
    // An icon, not a word: the name is its label, not its text.
    expect(save).toHaveTextContent(/^$/)
    expect(save).toHaveClass("nokey")
    await user.hover(save)
    expect(
      await screen.findByText("Save prompt and settings to this node")
    ).toBeInTheDocument()
  })

  it("hides the strip when the node has no inputs and nothing wired", async () => {
    const user = userEvent.setup()
    served = textOnly
    renderBar(BARE)

    await user.type(await screen.findByLabelText("Prompt"), "a lift")
    // Run needs the model, so the model — with no image input — has loaded.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Run" })).toBeEnabled()
    )
    expect(screen.queryByTestId("canvas-reference-strip")).toBeNull()
  })

  /**
   * The messages sit *after* the control row in the flow. The toolbar anchors
   * the bar by its top edge, so anything above the row pushes Run downward the
   * moment an error arrives — under a pointer that was already on its way.
   */
  it("puts a blocked-run message below the controls, never above them", async () => {
    renderBar(BROKEN)

    const blocked = await screen.findByTestId("run-blocked")
    const controls = screen.getByTestId("prompt-bar-controls")
    expect(controls).not.toContainElement(blocked)
    expect(
      controls.compareDocumentPosition(blocked) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  /**
   * Intelligent substitution, on a model that takes images.
   *
   * ⛔ The assertion is the payload handed to the *mocked*
   * `generations:submitBatch`. Nothing is sent anywhere and nothing is paid.
   */
  it("attaches a mentioned character and names its position in the prompt", async () => {
    const user = userEvent.setup()
    renderBar()

    const run = await screen.findByRole("button", { name: "Run" })
    await waitFor(() => expect(run).toBeEnabled())
    await user.type(await screen.findByLabelText("Prompt"), "a shot of @venkz")

    // The plan is visible before the run, which is the point of resolving here.
    const thumb = await screen.findByTestId("mention-thumb")
    expect(thumb.dataset.handle).toBe("venkz")

    await user.click(run)

    await waitFor(() => expect(submissions()).toHaveLength(1))
    expect(submissions()[0]![1]).toMatchObject({
      request: {
        prompt:
          "a bellhop opens the lift\n\na shot of Venkz (the person in reference image 2)",
        references: [
          // The edge the user drew keeps position 0; the mention follows it.
          { slotField: "reference_images", assetId: "a0", position: 0 },
          { slotField: "reference_images", assetId: "a-venkz", position: 1 },
        ],
        // Who the run was about, since the prompt no longer says `@venkz`.
        mentionedContainerIds: ["c-venkz"],
      },
    })
    // ⛔ The raw text is still the user's to edit.
    expect(screen.getByLabelText("Prompt")).toHaveValue("a shot of @venkz")
  })

  it("downgrades a mention to its description on a model with no image input", async () => {
    const user = userEvent.setup()
    served = textOnly
    renderBar(BARE)

    await user.type(await screen.findByLabelText("Prompt"), "a shot of @venkz")
    const run = await screen.findByRole("button", { name: "Run" })
    await waitFor(() => expect(run).toBeEnabled())

    expect(await screen.findByTestId("mention-note")).toHaveTextContent(
      "@venkz → text only (this model has no image input)"
    )

    await user.click(run)

    await waitFor(() => expect(submissions()).toHaveLength(1))
    const request = submissions()[0]![1] as {
      request: { prompt: string; references: unknown[] }
    }
    expect(request.request.prompt).toBe(
      "a shot of a tired bellhop in a green coat"
    )
    expect(request.request.references).toEqual([])
    // Text only, and still a mention: Venkz is in this run.
    expect(submissions()[0]![1]).toMatchObject({
      request: { mentionedContainerIds: ["c-venkz"] },
    })
  })

  it("⛔ leaves a handle nobody claims in the prompt and still runs", async () => {
    const user = userEvent.setup()
    renderBar()

    const run = await screen.findByRole("button", { name: "Run" })
    await waitFor(() => expect(run).toBeEnabled())
    await user.type(await screen.findByLabelText("Prompt"), "@nobody waits")

    expect(await screen.findByTestId("mention-note")).toHaveTextContent(
      "@nobody → no character or scene with that handle"
    )
    // It is not a reason to refuse: the user may want a literal `@`.
    expect(run).toBeEnabled()

    await user.click(run)
    await waitFor(() => expect(submissions()).toHaveLength(1))
    expect(submissions()[0]![1]).toMatchObject({
      request: {
        prompt: "a bellhop opens the lift\n\n@nobody waits",
      },
    })
  })

  /**
   * The picker is a portal anchored to the caret. The bar is anchored to a
   * node, so its width is its position — a list that lived inside it would
   * move Run under a pointer already travelling towards it.
   */
  it("opens the `@` picker without changing the bar's own size", async () => {
    const user = userEvent.setup()
    renderBar()

    const bar = await screen.findByTestId("canvas-prompt-bar")
    const prompt = await screen.findByLabelText("Prompt")
    const controls = screen.getByTestId("prompt-bar-controls")

    await user.click(prompt)
    await user.type(prompt, "@ven")

    const picker = await screen.findByTestId("mention-picker")
    expect(controls).not.toContainElement(picker)
    expect(bar).not.toContainElement(picker)
    expect(picker.parentElement).toBe(document.body)
  })

  /**
   * `useIsMobile` used to start `false` and flip in an effect, so a narrow
   * window reflowed the bar one frame after every selection change. The
   * breakpoint is read synchronously now: the first paint is already right.
   */
  it("collapses on the first paint at a narrow width, with no reflow", async () => {
    const wide = window.innerWidth
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 500,
    })
    try {
      renderBar()
      // No `waitFor`: the very first render must already be the narrow one.
      expect(screen.queryByTestId("count-stepper")).toBeNull()
      await screen.findByLabelText("Prompt")
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: wide,
      })
    }
  })
})

describe("family nodes", () => {
  const FAMILY_KEY = "family:seedance-2-5"

  /**
   * `models:get` answers a family key the way main does: the descriptor for
   * the endpoint the node's override and filled slots choose.
   */
  function serveFamily(options: FamilyDescriptorOptions = {}) {
    const base = invoke.getMockImplementation()!
    invoke.mockImplementation(async (channel: IpcChannel, payload: unknown) => {
      if (channel === "models:get") {
        const asked = payload as {
          key: string
          provider?: ProviderId | null
          filled?: string[]
        }
        if (asked.key !== FAMILY_KEY) return base(channel, payload)
        return seedanceFamilyDescriptor({
          ...options,
          filled: asked.filled ?? [],
          override: asked.provider ?? null,
        })
      }
      return base(channel, payload)
    })
  }

  const still = node({
    id: "still",
    type: "media",
    assetId: "a0",
    asset: asset("a0"),
  })

  function familyCanvas(
    slotField: string | null,
    target: CanvasNodeDto = { ...TARGET, modelKey: FAMILY_KEY }
  ): CanvasDto {
    return {
      nodes: [target, still],
      edges: [edge({ id: "e-media", sourceNodeId: "still", slotField })],
    }
  }

  it("gives a wired image the family's first frame", async () => {
    serveFamily()
    const canvas = familyCanvas(null)
    renderBar(canvas, canvas.nodes[0])

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("canvas:edge:update", {
        id: "e-media",
        slotField: "first_frame",
      })
    )
    expect(submissions()).toHaveLength(0)
  })

  it("submits the family key, its slot keys and no override", async () => {
    serveFamily()
    const user = userEvent.setup()
    const canvas = familyCanvas("first_frame")
    renderBar(canvas, canvas.nodes[0])

    // Nothing is wired in as a note, so the prompt is the user's alone.
    await user.type(await screen.findByLabelText("Prompt"), "slowly")
    const run = await screen.findByRole("button", { name: "Run" })
    await waitFor(() => expect(run).toBeEnabled())
    await user.click(run)

    await waitFor(() => expect(submissions()).toHaveLength(1))
    expect(submissions()[0]![1]).toMatchObject({
      count: 1,
      request: {
        modelKey: FAMILY_KEY,
        prompt: "slowly",
        params: { prompt: "slowly", duration: 5, resolution: "720p" },
        references: [{ slotField: "first_frame", assetId: "a0", position: 0 }],
        providerOverride: null,
        familyId: null,
      },
    })
    // The descriptor and the price follow the node's wiring.
    expect(invoke).toHaveBeenCalledWith("models:get", {
      key: FAMILY_KEY,
      provider: null,
      filled: ["first_frame"],
    })
    expect(
      invoke.mock.calls
        .filter(([channel]) => channel === "cost:estimate")
        .at(-1)
    ).toEqual([
      "cost:estimate",
      expect.objectContaining({
        key: FAMILY_KEY,
        provider: null,
        filled: ["first_frame"],
      }),
    ])
  })

  it("chooses the endpoint with the slots a mention fills, as main will", async () => {
    serveFamily()
    const user = userEvent.setup()
    const canvas = familyCanvas("first_frame")
    renderBar(canvas, canvas.nodes[0])

    await user.type(await screen.findByLabelText("Prompt"), "a shot of @venkz")
    const run = await screen.findByRole("button", { name: "Run" })
    await waitFor(() => expect(run).toBeEnabled())
    await user.click(run)

    await waitFor(() => expect(submissions()).toHaveLength(1))
    const references = (
      submissions()[0]![1] as {
        request: { references: Array<{ slotField: string }> }
      }
    ).request.references
    const slots = [...new Set(references.map((one) => one.slotField))].sort()
    expect(slots).toEqual(["first_frame", "reference"])
    expect(invoke).toHaveBeenCalledWith("models:get", {
      key: FAMILY_KEY,
      provider: null,
      filled: slots,
    })
  })

  it("writes a provider override onto the node", async () => {
    serveFamily()
    const user = userEvent.setup()
    const canvas = familyCanvas("first_frame")
    renderBar(canvas, canvas.nodes[0])

    const picker = await screen.findByRole("combobox", { name: /^Provider/ })
    await waitFor(() => expect(picker).toHaveTextContent("Auto · Replicate"))
    await user.click(picker)
    await user.click(await screen.findByRole("option", { name: "OpenRouter" }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("canvas:node:update", {
        id: "target",
        patch: { providerOverride: "openrouter" },
      })
    )
    expect(submissions()).toHaveLength(0)
  })

  it("clears the override when the node leaves the family for a concrete model", async () => {
    const target = {
      ...TARGET,
      modelKey: FAMILY_KEY,
      providerOverride: "openrouter" as const,
      // The user has since picked a concrete model in this node's recipe.
      text: JSON.stringify({
        prompt: "",
        modelKey: MODEL_KEY,
        common: {},
        advanced: {},
        count: 1,
      }),
    }
    renderBar({ nodes: [target], edges: [] }, target)

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("canvas:node:update", {
        id: "target",
        patch: { modelKey: MODEL_KEY, providerOverride: null },
      })
    )
  })

  it("has no provider control on a concrete-key node", async () => {
    renderBar()
    await screen.findByRole("button", { name: "Run" })
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("models:get", { key: MODEL_KEY })
    )
    expect(
      screen.queryByRole("combobox", { name: /^Provider/ })
    ).not.toBeInTheDocument()
  })

  it("blocks a wire the overridden provider cannot take, with the reason", async () => {
    serveFamily()
    const canvas = familyCanvas("reference:2", {
      ...TARGET,
      modelKey: FAMILY_KEY,
      providerOverride: "openrouter",
    })
    renderBar(canvas, canvas.nodes[0])

    await waitFor(() =>
      expect(screen.getByTestId("run-blocked")).toHaveTextContent(
        "Not available on OpenRouter"
      )
    )
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled()
    expect(submissions()).toHaveLength(0)
    // The strip rings the group holding that wire and says why beside it,
    // and dims the slots the provider has no field for.
    const groups = screen.getAllByTestId("strip-group")
    const videos = groups.find((one) => one.dataset.slot === "reference:2")!
    expect(videos).toHaveAttribute("data-unavailable", "filled")
    expect(videos).toHaveTextContent("Not available on OpenRouter")
    const audio = groups.find((one) => one.dataset.slot === "soundtrack")!
    expect(audio).toHaveAttribute("data-unavailable", "empty")
    expect(within(audio).getByTestId("slot-chip")).toHaveAttribute(
      "aria-disabled",
      "true"
    )
  })

  it("blocks a run no endpoint can take, in the choice's words", async () => {
    serveFamily({ configured: ["replicate"] })
    const canvas = familyCanvas("first_frame", {
      ...TARGET,
      modelKey: FAMILY_KEY,
      providerOverride: "openrouter",
    })
    renderBar(canvas, canvas.nodes[0])

    await waitFor(() =>
      expect(screen.getByTestId("run-blocked")).toHaveTextContent(
        "Add an OpenRouter key in Settings"
      )
    )
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled()
  })

  /**
   * ⛔ Regression: a board from before the registry — a concrete key and an
   * edge holding the provider's own field — submits byte for byte what it
   * did before families existed. Captured against the code on `main`.
   */
  it("submits exactly what it always did for a concrete-key node", async () => {
    const user = userEvent.setup()
    renderBar(WIRED, { ...TARGET, modelKey: MODEL_KEY })

    const run = await screen.findByRole("button", { name: "Run" })
    await waitFor(() => expect(run).toBeEnabled())
    await user.click(run)

    await waitFor(() => expect(submissions()).toHaveLength(1))
    expect(submissions()[0]![1]).toEqual(CAPTURED)
    // The descriptor and the price are asked for by key alone, as before.
    expect(invoke).toHaveBeenCalledWith("models:get", { key: MODEL_KEY })
    const quotes = invoke.mock.calls.filter(
      ([channel]) => channel === "cost:estimate"
    )
    expect(quotes.map(([, payload]) => Object.keys(payload).sort())).toEqual(
      quotes.map(() => ["key", "params"])
    )
    expect(quotes.at(-1)).toEqual([
      "cost:estimate",
      {
        key: MODEL_KEY,
        params: {
          duration: 5,
          resolution: "720p",
          watermark: false,
          reference_images: ["a0"],
        },
      },
    ])
  })
})

describe("the prompt's blocks", () => {
  /** jsdom lays nothing out; stack the listed blocks 40px apart. */
  function stackBlocks() {
    return vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const item = this.closest("li[data-block-id]")
        const index = item
          ? [...item.parentElement!.children].indexOf(item)
          : -1
        const top = index < 0 ? 0 : index * 40
        return {
          x: 0,
          y: top,
          left: 0,
          top,
          width: 400,
          height: 32,
          right: 400,
          bottom: top + 32,
          toJSON: () => ({}),
        } as DOMRect
      })
  }

  it("sends notes and text in block order", async () => {
    const user = userEvent.setup()
    renderBar()

    const run = await screen.findByRole("button", { name: "Run" })
    await waitFor(() => expect(run).toBeEnabled())
    await user.type(await screen.findByLabelText("Prompt"), "slowly")

    const rect = stackBlocks()
    try {
      screen.getByRole("button", { name: "Move note 1" }).focus()
      await user.keyboard(" ")
      await user.keyboard("{ArrowDown}")
      await user.keyboard(" ")
    } finally {
      rect.mockRestore()
    }
    const list = screen.getByRole("list", { name: "Prompt blocks" })
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole("listitem")
          .map((item) => item.dataset.kind)
      ).toEqual(["text", "note", "text"])
    )

    await user.click(run)
    await waitFor(() => expect(submissions()).toHaveLength(1))
    expect(submissions()[0]![1]).toMatchObject({
      request: { prompt: "slowly\n\na bellhop opens the lift" },
    })
  })

  it("saves a dragged order as blocks, without their ids", async () => {
    const user = userEvent.setup()
    renderBar()

    await user.type(await screen.findByLabelText("Prompt"), "slowly")
    const rect = stackBlocks()
    try {
      screen.getByRole("button", { name: "Move note 1" }).focus()
      await user.keyboard(" ")
      await user.keyboard("{ArrowDown}")
      await user.keyboard(" ")
    } finally {
      rect.mockRestore()
    }
    const list = screen.getByRole("list", { name: "Prompt blocks" })
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole("listitem")
          .map((item) => item.dataset.kind)
      ).toEqual(["text", "note", "text"])
    )

    await user.click(screen.getByRole("button", { name: "Save prompt" }))
    await waitFor(() =>
      expect(
        invoke.mock.calls.some(
          ([channel, payload]) =>
            channel === "canvas:node:update" &&
            (payload as { patch: { text?: string } }).patch.text
        )
      ).toBe(true)
    )
    const saved = invoke.mock.calls.find(
      ([channel, payload]) =>
        channel === "canvas:node:update" &&
        (payload as { patch: { text?: string } }).patch.text
    )!
    const recipe = JSON.parse(
      (saved[1] as { patch: { text: string } }).patch.text
    )
    // Ids are the draft's, for React and dnd-kit; the recipe never holds one.
    expect(recipe.blocks).toEqual([
      { kind: "text", text: "slowly" },
      { kind: "note", nodeId: "note" },
      { kind: "text", text: "" },
    ])
    expect(submissions()).toHaveLength(0)
  })

  it("keeps the trailing block typable after a note moves past it and another goes", async () => {
    const user = userEvent.setup()
    const notes = (edges: CanvasDto["edges"]): CanvasDto => ({
      nodes: [
        TARGET,
        node({ id: "a", type: "text", text: "a lift", x: 0, y: 0 }),
        node({ id: "b", type: "text", text: "a lobby", x: 0, y: 100 }),
      ],
      edges,
    })
    const edgeA = edge({ id: "e-a", sourceNodeId: "a", createdAt: 1 })
    const edgeB = edge({ id: "e-b", sourceNodeId: "b", createdAt: 2 })
    const view = renderBar(notes([edgeA, edgeB]))

    // Note a goes to the end: note b, the text, note a, a new empty text.
    await screen.findByRole("button", { name: "Move note 1" })
    const rect = stackBlocks()
    try {
      screen.getByRole("button", { name: "Move note 1" }).focus()
      await user.keyboard(" ")
      await user.keyboard("{ArrowDown}")
      await user.keyboard("{ArrowDown}")
      await user.keyboard(" ")
    } finally {
      rect.mockRestore()
    }
    const list = screen.getByRole("list", { name: "Prompt blocks" })
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole("listitem")
          .map((item) => item.dataset.kind)
      ).toEqual(["note", "text", "note", "text"])
    )

    // Note b's edge goes: the new trailing block's default id is now taken.
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <PromptBar
            node={TARGET}
            canvas={notes([edgeA])}
            defaultModelKey={MODEL_KEY}
          />
        </TooltipProvider>
      </QueryClientProvider>
    )
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole("listitem")
          .map((item) => item.dataset.kind)
      ).toEqual(["text", "note", "text"])
    )

    await user.click(screen.getByLabelText("Prompt"))
    await user.keyboard("slowly")
    expect(screen.getByLabelText("Prompt")).toHaveValue("slowly")
    expect(screen.getByLabelText("Prompt")).toHaveFocus()
  })

  it("✕ on a note deletes its edge", async () => {
    const user = userEvent.setup()
    renderBar()

    await user.click(
      await screen.findByRole("button", {
        name: "Disconnect a bellhop opens the lift",
      })
    )

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("canvas:edge:delete", {
        ids: ["e-text"],
      })
    )
    expect(submissions()).toHaveLength(0)
  })
})

describe("the full prompt panel", () => {
  /** A second generate node with the same note wired in. */
  const OTHER = node({ id: "other", type: "video_gen", x: 600, y: 400 })
  const OTHER_CANVAS: CanvasDto = {
    nodes: [
      OTHER,
      node({ id: "note", type: "text", text: "a bellhop opens the lift" }),
    ],
    edges: [
      edge({ id: "e-other", sourceNodeId: "note", targetNodeId: "other" }),
    ],
  }

  it("is open for a node with a note and shows the prompt that is sent", async () => {
    const user = userEvent.setup()
    renderBar()

    const toggle = await screen.findByRole("button", { name: "Full prompt" })
    expect(toggle).toHaveAttribute("aria-pressed", "true")
    const panel = screen.getByTestId("full-prompt-panel")
    expect(toggle).toHaveAttribute("aria-controls", panel.id)

    const run = screen.getByRole("button", { name: "Run" })
    await waitFor(() => expect(run).toBeEnabled())
    await user.type(await screen.findByLabelText("Prompt"), "slowly")
    await user.click(run)

    await waitFor(() => expect(submissions()).toHaveLength(1))
    const sent = (submissions()[0]![1] as { request: { prompt: string } })
      .request.prompt
    expect(sent).toBe("a bellhop opens the lift\n\nslowly")
    expect(screen.getByTestId("full-prompt").textContent).toBe(sent)
  })

  it("shows a mention substituted, and the note after it still marked", async () => {
    const user = userEvent.setup()
    // The mention comes *before* the note, so the note's range has to move by
    // however much longer the substitution is than `@venkz`.
    renderBar(WIRED, {
      ...TARGET,
      text: JSON.stringify({
        prompt: "a shot of @venkz",
        modelKey: MODEL_KEY,
        common: { resolution: "720p", duration: 5 },
        advanced: {},
        count: 1,
        blocks: [
          { kind: "text", text: "a shot of @venkz" },
          { kind: "note", nodeId: "note" },
        ],
      }),
    })

    const box = screen.getByTestId("full-prompt")
    await waitFor(() => expect(box.textContent).toContain("Venkz ("))
    expect(box.textContent).not.toContain("@venkz")
    const fromNote = box.querySelectorAll("[data-from-note]")
    expect([...fromNote].map((piece) => piece.textContent)).toEqual([
      "a bellhop opens the lift",
    ])
    // Two pictures in one input: the wire and the mention.
    expect(screen.getByTestId("full-prompt-stats")).toHaveTextContent(
      "1 notes · 2 images"
    )

    const run = screen.getByRole("button", { name: "Run" })
    await waitFor(() => expect(run).toBeEnabled())
    await user.click(run)
    await waitFor(() => expect(submissions()).toHaveLength(1))
    const sent = (submissions()[0]![1] as { request: { prompt: string } })
      .request.prompt
    expect(sent).toBe(
      "a shot of Venkz (the person in reference image 2)\n\na bellhop opens the lift"
    )
    expect(box.textContent).toBe(sent)
  })

  it("opens an input's gallery from its chip", async () => {
    const user = userEvent.setup()
    renderBar()

    await user.click(
      await screen.findByRole("button", { name: /^reference_images × 1/ })
    )

    expect(
      await screen.findByRole("region", { name: "Reference Images gallery" })
    ).toBeInTheDocument()
  })

  it("is closed for a node with no note", async () => {
    renderBar(BARE)

    const toggle = await screen.findByRole("button", { name: "Full prompt" })
    expect(toggle).toHaveAttribute("aria-pressed", "false")
    // It controls nothing while there is nothing to control.
    expect(toggle).not.toHaveAttribute("aria-controls")
    expect(screen.queryByTestId("full-prompt-panel")).not.toBeInTheDocument()
  })

  it("keeps the user's choice for every node in the window", async () => {
    const user = userEvent.setup()
    const first = renderBar()

    await user.click(await screen.findByRole("button", { name: "Full prompt" }))
    expect(screen.queryByTestId("full-prompt-panel")).not.toBeInTheDocument()
    first.unmount()

    renderBar(OTHER_CANVAS, OTHER)
    const toggle = await screen.findByRole("button", { name: "Full prompt" })
    // The other node has a note too, and still opens closed.
    expect(
      await screen.findByRole("button", { name: /note 1, a bellhop/i })
    ).toBeInTheDocument()
    expect(toggle).toHaveAttribute("aria-pressed", "false")
    expect(screen.queryByTestId("full-prompt-panel")).not.toBeInTheDocument()
  })
})

describe("saved prompts and unknown pricing", () => {
  it("persists the complete recipe without submitting a paid run", async () => {
    const user = userEvent.setup()
    renderBar(BARE)
    const prompt = await screen.findByRole("combobox", { name: /prompt/i })
    await user.type(prompt, "A saved composition")
    await user.click(screen.getByRole("button", { name: "Save prompt" }))
    await waitFor(() => {
      const saved = invoke.mock.calls.find(
        ([channel, payload]) =>
          channel === "canvas:node:update" &&
          (payload as { patch: { text?: string } }).patch.text
      )
      expect(saved).toBeDefined()
      const recipe = JSON.parse(
        (saved![1] as { patch: { text: string } }).patch.text
      )
      expect(recipe.prompt).toBe("A saved composition")
      expect(recipe.modelKey).toBe(MODEL_KEY)
      expect(recipe.count).toBe(1)
      // Saving alone never pins a note order onto a legacy recipe.
      expect(recipe.blocks).toBeUndefined()
    })
    expect(submissions()).toHaveLength(0)
  })

  describe("a recipe that orders its notes", () => {
    /** The note placed *after* the user's words, as an imported workflow can. */
    const ORDERED = {
      ...TARGET,
      text: JSON.stringify({
        prompt: "at dusk",
        modelKey: MODEL_KEY,
        common: { resolution: "720p", duration: 5 },
        advanced: {},
        count: 1,
        blocks: [
          { kind: "text", text: "at dusk" },
          { kind: "note", nodeId: "note" },
        ],
      }),
    }

    it("sends the blocks in their own order", async () => {
      const user = userEvent.setup()
      renderBar(WIRED, ORDERED)

      const run = await screen.findByRole("button", { name: "Run" })
      await waitFor(() => expect(run).toBeEnabled())
      await user.click(run)

      await waitFor(() => expect(submissions()).toHaveLength(1))
      expect(submissions()[0]![1]).toMatchObject({
        request: { prompt: "at dusk\n\na bellhop opens the lift" },
      })
    })

    it("sends what is typed into the prompt field", async () => {
      const user = userEvent.setup()
      renderBar(WIRED, ORDERED)

      const run = await screen.findByRole("button", { name: "Run" })
      await waitFor(() => expect(run).toBeEnabled())
      await user.type(
        await screen.findByLabelText("Prompt, part 1"),
        ", slowly"
      )
      await user.click(run)

      await waitFor(() => expect(submissions()).toHaveLength(1))
      expect(submissions()[0]![1]).toMatchObject({
        // The note stays after the user's words, where the recipe put it.
        request: { prompt: "at dusk, slowly\n\na bellhop opens the lift" },
      })
    })

    /** The recipe Save prompt wrote, parsed. */
    function savedRecipe() {
      const saved = invoke.mock.calls
        .filter(
          ([channel, payload]) =>
            channel === "canvas:node:update" &&
            (payload as { patch: { text?: string } }).patch.text
        )
        .at(-1)
      return saved
        ? JSON.parse((saved[1] as { patch: { text: string } }).patch.text)
        : undefined
    }

    it("sends and saves an applied AI prompt", async () => {
      const user = userEvent.setup()
      renderBar(WIRED, ORDERED)

      await user.click(
        await screen.findByRole("button", { name: "AI helpers" })
      )
      await user.click(
        await screen.findByRole("button", { name: /improve prompt/i })
      )
      await user.click(
        await screen.findByRole("button", { name: "Use this prompt" })
      )
      await waitFor(() =>
        expect(screen.queryByTestId("ai-result-text")).not.toBeInTheDocument()
      )

      const run = await screen.findByRole("button", { name: "Run" })
      await waitFor(() => expect(run).toBeEnabled())
      await user.click(run)
      await waitFor(() => expect(submissions()).toHaveLength(1))
      expect(submissions()[0]![1]).toMatchObject({
        request: {
          // Apply rewrites the text and leaves the note where it was: the
          // note now leads, as the only block the answer did not replace.
          prompt:
            "a bellhop opens the lift\n\na bellhop opens the lift, slowly",
        },
      })

      await user.click(screen.getByRole("button", { name: "Save prompt" }))
      await waitFor(() => expect(savedRecipe()).toBeDefined())
      expect(savedRecipe()).toEqual(
        expect.objectContaining({
          prompt: "a bellhop opens the lift, slowly",
          blocks: [
            { kind: "note", nodeId: "note" },
            { kind: "text", text: "a bellhop opens the lift, slowly" },
          ],
        })
      )
    })

    it("sends and saves an inserted shot", async () => {
      const served = invoke.getMockImplementation()!
      invoke.mockImplementation(
        async (channel: IpcChannel, payload: unknown) =>
          channel === "ai:run"
            ? { text: "Two shots.", shots: ["a slow push-in"], tool: "claude" }
            : served(channel, payload)
      )
      const user = userEvent.setup()
      renderBar(WIRED, ORDERED)

      await user.click(
        await screen.findByRole("button", { name: "AI helpers" })
      )
      await user.click(
        await screen.findByRole("button", { name: /suggest shots/i })
      )
      await user.click(await screen.findByRole("button", { name: "Insert" }))
      await user.keyboard("{Escape}")
      await waitFor(() =>
        expect(screen.queryByTestId("ai-result-text")).not.toBeInTheDocument()
      )

      const run = await screen.findByRole("button", { name: "Run" })
      await waitFor(() => expect(run).toBeEnabled())
      await user.click(run)
      await waitFor(() => expect(submissions()).toHaveLength(1))
      expect(submissions()[0]![1]).toMatchObject({
        request: {
          // The shot lands in the last text block, after the note.
          prompt: "at dusk\n\na bellhop opens the lift\n\na slow push-in",
        },
      })

      await user.click(screen.getByRole("button", { name: "Save prompt" }))
      await waitFor(() => expect(savedRecipe()).toBeDefined())
      expect(savedRecipe()).toEqual(
        expect.objectContaining({
          prompt: "at dusk\n\na slow push-in",
          blocks: [
            { kind: "text", text: "at dusk" },
            { kind: "note", nodeId: "note" },
            { kind: "text", text: "a slow push-in" },
          ],
        })
      )
    })
  })

  it("requires cost acceptance again when the batch size changes", async () => {
    quote = { ...estimated, confidence: "unknown" }
    const user = userEvent.setup()
    renderBar(BARE)
    await user.type(
      await screen.findByRole("combobox", { name: /prompt/i }),
      "A portrait"
    )
    const acceptance = await screen.findByRole("checkbox", {
      name: /pricing is unavailable/i,
    })
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled()
    await user.click(acceptance)
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled()
    await user.click(screen.getByRole("button", { name: "One more result" }))
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled()
    expect(submissions()).toHaveLength(0)
  })
})
