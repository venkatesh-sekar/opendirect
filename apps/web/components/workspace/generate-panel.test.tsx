// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

/**
 * The generate panel on a character's page, from opening it to the one call
 * that spends money.
 *
 * Every IPC channel is stubbed; the assertions are about what
 * `generations:submitBatch` is handed and how often — never on arrival, once
 * per click on Generate.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  CostQuote,
  IpcChannel,
  MentionSubjectDto,
  ModelDescriptor,
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

import { container } from "./fixtures"

const invoke = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ipc", () => ({
  invoke,
  isBridgeAvailable: () => true,
  pathsForFiles: () => [],
  subscribe: () => () => {},
}))

const { GeneratePanel } = await import("./generate-panel")

const MODEL_KEY = "replicate:google/nano-banana-2"

const descriptor = {
  key: MODEL_KEY,
  provider: "replicate",
  slug: "google/nano-banana-2",
  name: "Nano Banana 2",
  description: null,
  kind: "image",
  versionId: "v1",
  coverImageUrl: null,
  inputSchema: {
    type: "object",
    required: ["prompt"],
    properties: {
      prompt: { type: "string", title: "Prompt" },
      aspect_ratio: {
        type: "string",
        enum: ["1:1", "16:9", "9:16"],
        default: "1:1",
      },
      image_input: { type: "array", items: { type: "string" } },
    },
  },
  outputSchema: null,
  referenceSlots: [
    {
      field: "image_input",
      label: "Image input",
      kind: "image",
      multiple: true,
      max: 8,
      role: "reference",
    },
  ],
  commonControls: {
    prompt: "prompt",
    aspectRatio: "aspect_ratio",
    duration: null,
    resolution: null,
    seed: null,
    audio: null,
  },
  pricing: {
    basis: "per_image",
    currency: "USD",
    skus: {},
    estimate: null,
    source: "local_table",
    note: null,
  },
  raw: null,
  fetchedAt: 0,
} as unknown as ModelDescriptor

const estimated = {
  amount: 0.04,
  currency: "USD",
  basis: "per_image",
  confidence: "estimated",
  source: "local_table",
  note: null,
  sku: null,
} as unknown as CostQuote

const MIRA: MentionSubjectDto = {
  containerId: "mira",
  kind: "character",
  handle: "mira",
  name: "Mira",
  description: "late 20s, sharp bob",
  explicitReferences: true,
  images: [
    { assetId: "sheet", label: "Sheet", thumbnailUrl: "asset://t/sheet.png" },
    { assetId: "side", label: "Side", thumbnailUrl: "asset://t/side.png" },
  ],
}

const NODE = container({
  id: "mira",
  name: "Mira",
  handle: "mira",
  referenceAssetIds: ["sheet", "side"],
})

let quote: CostQuote = estimated

function submissions() {
  return invoke.mock.calls.filter(
    ([channel]) => channel === "generations:submitBatch"
  )
}

function mount(onSubmitted = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <GeneratePanel
          node={NODE}
          cover={null}
          onClose={() => {}}
          onSubmitted={onSubmitted}
        />
      </TooltipProvider>
    </QueryClientProvider>
  )
  return { onSubmitted }
}

beforeEach(() => {
  quote = estimated
  invoke.mockReset()
  invoke.mockImplementation(async (channel: IpcChannel) => {
    switch (channel) {
      case "settings:get":
        return { defaultImageModel: MODEL_KEY, defaultVideoModel: null }
      case "models:get":
        return descriptor
      case "models:list":
        return { models: [], failures: [] }
      case "models:recommended":
        return { video: [], image: [] }
      case "mentions:subjects":
        return [MIRA]
      case "cost:estimate":
        return quote
      case "ai:tools":
        return { preferred: null }
      case "generations:submitBatch":
        return {
          batchId: "b1",
          generations: [{ id: "g1", status: "queued" }],
        }
      default:
        throw new Error(`Unexpected channel ${String(channel)}`)
    }
  })
})

afterEach(cleanup)

describe("the generate panel", () => {
  it("starts from the character: its handle in the prompt, its references, where it saves", async () => {
    mount()
    const panel = screen.getByRole("complementary", { name: /generate/i })

    // The identity row, then the "Save to" line: both name the character.
    expect(within(panel).getAllByText("Mira")).toHaveLength(2)
    expect(within(panel).getByText("@mira · sheet + 1 ref")).toBeVisible()
    expect(within(panel).getByLabelText("Prompt")).toHaveValue("@mira ")
    expect(within(panel).getByText(/save to/i).parentElement).toHaveTextContent(
      "Mira"
    )

    // The references the model will be sent, in order, as `@mira` resolves
    // them for this model.
    const refs = await within(panel).findAllByTestId("panel-reference")
    expect(refs.map((ref) => ref.dataset.assetId)).toEqual(["sheet", "side"])
  })

  it("spends nothing until Generate is clicked, then exactly once", async () => {
    const user = userEvent.setup()
    const { onSubmitted } = mount()

    const generate = await screen.findByRole("button", { name: /^generate/i })
    await waitFor(() => expect(generate).toBeEnabled())
    expect(generate).toHaveTextContent("$0.04")
    await user.type(screen.getByLabelText("Prompt"), "in the rain")
    expect(submissions()).toHaveLength(0)

    await user.click(generate)

    await waitFor(() => expect(submissions()).toHaveLength(1))
    expect(submissions()[0]![1]).toMatchObject({
      count: 1,
      request: {
        modelKey: MODEL_KEY,
        containerId: "mira",
        params: { aspect_ratio: "1:1" },
        references: [
          { slotField: "image_input", assetId: "sheet", position: 0 },
          { slotField: "image_input", assetId: "side", position: 1 },
        ],
        estimatedCostUsd: 0.04,
      },
    })
    // The mention is resolved in what is sent; the draft keeps `@mira`.
    const sent = submissions()[0]![1] as { request: { prompt: string } }
    expect(sent.request.prompt).toMatch(
      /^Mira \(the person in reference images 1 and 2\) in the rain$/
    )
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1))
  })

  it("will not run an unknown price until the user accepts it", async () => {
    const user = userEvent.setup()
    quote = { ...estimated, confidence: "unknown" } as CostQuote
    mount()

    const generate = await screen.findByRole("button", { name: /^generate/i })
    const accept = await screen.findByRole("checkbox", {
      name: /pricing is unavailable/i,
    })
    expect(generate).toBeDisabled()

    await user.click(accept)
    await waitFor(() => expect(generate).toBeEnabled())
    await user.click(generate)
    await waitFor(() => expect(submissions()).toHaveLength(1))
    expect(submissions()[0]![1]).toMatchObject({
      request: { acceptUnknownCost: true, estimatedCostUsd: null },
    })
  })

  it("says why it cannot run without a model", async () => {
    invoke.mockImplementation(async (channel: IpcChannel) => {
      if (channel === "settings:get")
        return { defaultImageModel: null, defaultVideoModel: null }
      if (channel === "mentions:subjects") return [MIRA]
      if (channel === "models:list") return { models: [], failures: [] }
      if (channel === "models:recommended") return { video: [], image: [] }
      if (channel === "ai:tools") return { preferred: null }
      throw new Error(`Unexpected channel ${String(channel)}`)
    })
    mount()

    expect(
      await screen.findByText("Pick a model to generate with.")
    ).toBeVisible()
    expect(screen.getByRole("button", { name: /^generate/i })).toBeDisabled()
  })
})
