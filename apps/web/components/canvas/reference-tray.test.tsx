// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

/**
 * The plan, shown before the run.
 *
 * The whole reason substitution happens in the renderer is that the user can
 * read it while it is still free to change: an attached mention, a downgrade
 * and a handle nobody claims each look different, and none of them blocks
 * anything. ⛔ Nothing in this file submits or spends.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  AssetDto,
  CanvasDto,
  CanvasEdgeDto,
  CanvasNodeDto,
  ReferenceSlot,
  SlotAvailability,
} from "@opendirect/contract"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@workspace/ui/components/tooltip"

import type { MentionOutcome } from "@/lib/mentions/resolve"

import {
  CanvasReferenceStrip,
  groupStrip,
  MentionNotes,
} from "./reference-tray"

vi.mock("@/lib/ipc", () => ({
  invoke: vi.fn(),
  isBridgeAvailable: () => true,
  pathsForFiles: () => [],
  subscribe: () => () => {},
}))

const SLOTS: ReferenceSlot[] = [
  {
    field: "reference_images",
    label: "Reference Images",
    kind: "image",
    multiple: true,
    max: 4,
    role: "reference",
    verified: false,
    required: false,
    shape: null,
  },
]

const NODE = {
  id: "target",
  type: "video_gen",
  x: 0,
  y: 0,
  width: 360,
  height: 200,
} as unknown as CanvasNodeDto

const EMPTY: CanvasDto = { nodes: [NODE], edges: [] }

function renderTray(mentions: MentionOutcome[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <CanvasReferenceStrip
          node={NODE}
          canvas={EMPTY}
          slots={SLOTS}
          containerId="c1"
          mentions={mentions}
          galleryFor={null}
          onGalleryChange={vi.fn()}
        />
        <MentionNotes mentions={mentions} />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

afterEach(cleanup)

describe("CanvasReferenceStrip mentions", () => {
  it("shows an attached mention with its handle, its slot and no remove button", () => {
    renderTray([
      {
        kind: "image",
        handle: "venkz",
        containerId: "c-venkz",
        slotField: "reference_images",
        assetIds: ["a-venkz"],
        thumbnailUrls: ["asset://media/thumbnails/a-venkz.webp"],
        substitution: "Venkz (the person in the reference image)",
      },
    ])

    const thumb = screen.getByTestId("mention-thumb")
    expect(thumb.dataset.handle).toBe("venkz")
    // The picture the run will send, not just the word for it.
    expect(thumb.querySelector("img")).toHaveAttribute(
      "src",
      "asset://media/thumbnails/a-venkz.webp"
    )
    expect(thumb.dataset.slot).toBe("reference_images")
    // The substitution is readable verbatim, so the exact sentence the model
    // will be given is never a guess.
    expect(thumb.getAttribute("title")).toContain(
      "Venkz (the person in the reference image)"
    )
    // ⛔ It is removed by deleting `@venkz` from the prompt, not from here.
    expect(screen.queryByRole("button", { name: /disconnect/i })).toBeNull()
    expect(screen.queryByTestId("mention-note")).toBeNull()
  })

  it("says in one line why a mention is text only", () => {
    renderTray([
      {
        kind: "text",
        handle: "venkz",
        containerId: "c-venkz",
        reason: "no-image-slot",
        substitution: "a tired bellhop",
      },
    ])

    expect(screen.getByTestId("mention-note")).toHaveTextContent(
      "@venkz → text only (this model has no image input)"
    )
    expect(screen.queryByTestId("mention-thumb")).toBeNull()
  })

  it("names the other two downgrades in the user's own terms", () => {
    renderTray([
      {
        kind: "text",
        handle: "venkz",
        containerId: "c-venkz",
        reason: "slots-full",
        substitution: "a tired bellhop",
      },
      {
        kind: "text",
        handle: "hotel-lobby",
        containerId: "c-lobby",
        reason: "no-images",
        substitution: "Hotel Lobby",
      },
    ])

    const notes = screen
      .getAllByTestId("mention-note")
      .map((one) => one.textContent)
    expect(notes).toEqual([
      "@venkz → text only (the image slots are already wired)",
      "@hotel-lobby → text only (no reference image yet)",
    ])
  })

  it("marks a handle nobody claims, without removing it from anything", () => {
    renderTray([{ kind: "unresolved", handle: "nobody" }])

    const note = screen.getByTestId("mention-note")
    expect(note).toHaveTextContent(
      "@nobody → no character or scene with that handle"
    )
    expect(note.className).toContain("text-destructive")
  })
})

/* ------------------------------------------------------------------ */
/* Groups                                                              */
/* ------------------------------------------------------------------ */

const FIRST: ReferenceSlot = {
  field: "first_frame",
  label: "First Frame",
  kind: "image",
  multiple: false,
  max: null,
  role: "first_frame",
  verified: false,
  required: false,
  shape: null,
}

function picture(id: string): AssetDto {
  return {
    id,
    kind: "image",
    url: `asset://media/${id}.png`,
    thumbnailUrl: `asset://media/thumbnails/${id}.webp`,
    label: id,
    originalName: `${id}.png`,
  } as unknown as AssetDto
}

function mediaNode(id: string): CanvasNodeDto {
  return {
    id,
    type: "media",
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    assetId: `a-${id}`,
    asset: picture(`a-${id}`),
  } as unknown as CanvasNodeDto
}

function noteNode(id: string): CanvasNodeDto {
  return {
    id,
    type: "text",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    text: "a bellhop opens the lift",
  } as unknown as CanvasNodeDto
}

function wire(
  id: string,
  sourceNodeId: string,
  slotField: string | null,
  createdAt: number
): CanvasEdgeDto {
  return {
    id,
    projectId: "p",
    sourceNodeId,
    targetNodeId: NODE.id,
    slotField,
    createdAt,
  }
}

/** `count` pictures wired into `slotField`, in creation order. */
function wiredCanvas(count: number, slotField = "reference_images"): CanvasDto {
  const sources = Array.from({ length: count }, (_, i) => mediaNode(`m${i}`))
  return {
    nodes: [NODE, ...sources],
    edges: sources.map((one, i) => wire(`e${i}`, one.id, slotField, i + 1)),
  }
}

const VENKZ: MentionOutcome = {
  kind: "image",
  handle: "venkz",
  containerId: "c-venkz",
  slotField: "reference_images",
  assetIds: ["a-venkz"],
  thumbnailUrls: ["asset://media/thumbnails/a-venkz.webp"],
  substitution: "Venkz (the person in the reference image)",
}

describe("groupStrip", () => {
  it("puts every wired picture of a one-slot model in that slot, in wire order", () => {
    const groups = groupStrip(NODE, wiredCanvas(3), SLOTS, [])

    expect(groups).toHaveLength(1)
    expect(groups[0]!.slot).toBe(SLOTS[0])
    expect(groups[0]!.capacity).toBe(4)
    expect(groups[0]!.full).toBe(false)
    expect(
      groups[0]!.items.map((item) => (item.kind === "edge" ? item.edgeId : ""))
    ).toEqual(["e0", "e1", "e2"])
  })

  it("gives each of the model's slots its own group, empty ones included", () => {
    const canvas: CanvasDto = {
      nodes: [NODE, mediaNode("m0"), mediaNode("m1")],
      edges: [
        wire("e0", "m0", "reference_images", 1),
        wire("e1", "m1", "first_frame", 2),
      ],
    }

    const groups = groupStrip(NODE, canvas, [FIRST, ...SLOTS], [])

    expect(groups.map((group) => group.slot?.field)).toEqual([
      "first_frame",
      "reference_images",
    ])
    expect(groups.map((group) => group.items.length)).toEqual([1, 1])
    // A single-value slot holds one, and holds it now.
    expect(groups[0]!.capacity).toBe(1)
    expect(groups[0]!.full).toBe(true)
  })

  it("collects edges with no slot, or a slot the model does not declare, under Unassigned", () => {
    const canvas: CanvasDto = {
      nodes: [NODE, mediaNode("m0"), mediaNode("m1"), mediaNode("m2")],
      edges: [
        wire("e0", "m0", null, 1),
        wire("e1", "m1", "reference_images", 2),
        wire("e2", "m2", "end_image", 3),
      ],
    }

    const groups = groupStrip(NODE, canvas, SLOTS, [])

    expect(groups.map((group) => group.slot?.field ?? null)).toEqual([
      "reference_images",
      null,
    ])
    const unassigned = groups[1]!
    expect(
      unassigned.items.map((item) => (item.kind === "edge" ? item.edgeId : ""))
    ).toEqual(["e0", "e2"])
    // Both block the run, so both are drawn as problems.
    expect(
      unassigned.items.map((item) => (item.kind === "edge" ? item.problem : ""))
    ).toEqual(["No slot", "Unknown input"])
    expect(unassigned.capacity).toBeNull()
    expect(unassigned.full).toBe(false)
  })

  it("counts a mention's picture in the slot it resolved to, after the wires", () => {
    const groups = groupStrip(NODE, wiredCanvas(3), SLOTS, [
      VENKZ,
      { kind: "unresolved", handle: "nobody" },
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]!.items.map((item) => item.kind)).toEqual([
      "edge",
      "edge",
      "edge",
      "mention",
    ])
    // Four of four: the mention takes a place a wire would otherwise have.
    expect(groups[0]!.full).toBe(true)
  })

  it("leaves text edges out — they are note blocks now", () => {
    const canvas: CanvasDto = {
      nodes: [NODE, noteNode("note"), mediaNode("m0")],
      edges: [
        wire("e-note", "note", null, 1),
        wire("e0", "m0", "reference_images", 2),
      ],
    }

    const groups = groupStrip(NODE, canvas, SLOTS, [])

    // No Unassigned group: the note's null slot is not a missing slot.
    expect(groups).toHaveLength(1)
    expect(groups[0]!.items).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ */
/* The strip                                                           */
/* ------------------------------------------------------------------ */

/** The strip with its gallery state held the way `PromptBar` holds it. */
function Controlled({
  canvas,
  slots,
  availability,
}: {
  canvas: CanvasDto
  slots: ReferenceSlot[]
  availability?: Record<string, SlotAvailability>
}) {
  const [galleryFor, setGalleryFor] = useState<string | null>(null)
  return (
    <CanvasReferenceStrip
      node={NODE}
      canvas={canvas}
      slots={slots}
      availability={availability}
      containerId="c1"
      galleryFor={galleryFor}
      onGalleryChange={setGalleryFor}
    />
  )
}

function renderStrip(
  canvas: CanvasDto,
  slots: ReferenceSlot[] = SLOTS,
  availability?: Record<string, SlotAvailability>
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const tree = (next: CanvasDto) => (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <Controlled canvas={next} slots={slots} availability={availability} />
      </TooltipProvider>
    </QueryClientProvider>
  )
  const view = render(tree(canvas))
  return { ...view, redraw: (next: CanvasDto) => view.rerender(tree(next)) }
}

const UNBOUNDED: ReferenceSlot[] = [{ ...SLOTS[0]!, max: null }]

describe("CanvasReferenceStrip", () => {
  it("shows 3 of 100 and a +97 that opens the whole slot inline", async () => {
    const user = userEvent.setup()
    renderStrip(wiredCanvas(100), UNBOUNDED)

    const strip = screen.getByTestId("canvas-reference-strip")
    expect(within(strip).getAllByTestId("reference-thumb")).toHaveLength(3)
    expect(within(strip).getByText("100 images")).toBeInTheDocument()
    // The count is its own line, not glued to the label.
    expect(within(strip).queryByText(/^Reference Images \d/)).toBeNull()

    const more = screen.getByRole("button", {
      name: "Show all 100 Reference Images",
    })
    expect(more).toHaveTextContent("+97")
    expect(
      screen.queryByRole("region", { name: "Reference Images gallery" })
    ).toBeNull()

    await user.click(more)

    const gallery = screen.getByRole("region", {
      name: "Reference Images gallery",
    })
    const items = within(gallery).getAllByTestId("gallery-item")
    expect(items).toHaveLength(100)
    // Numbered in the order they are sent.
    expect(items[0]).toHaveTextContent("1")
    expect(items[99]).toHaveTextContent("100")
    expect(gallery).toHaveTextContent("sent as reference_images")

    await user.click(within(gallery).getByRole("button", { name: "Done" }))
    expect(
      screen.queryByRole("region", { name: "Reference Images gallery" })
    ).toBeNull()
  })

  it("shows all four when there are four, with no +N", () => {
    renderStrip(wiredCanvas(4), UNBOUNDED)

    expect(screen.getAllByTestId("reference-thumb")).toHaveLength(4)
    expect(screen.queryByRole("button", { name: /^Show all/ })).toBeNull()
  })

  it("opens the gallery from a thumbnail too", async () => {
    const user = userEvent.setup()
    renderStrip(wiredCanvas(2), UNBOUNDED)

    await user.click(
      screen.getAllByRole("button", { name: /^Open .* gallery/ })[1]!
    )

    expect(
      screen.getByRole("region", { name: "Reference Images gallery" })
    ).toBeInTheDocument()
  })

  it("says a full slot is full and will not take another", () => {
    renderStrip(wiredCanvas(2), [{ ...SLOTS[0]!, max: 2 }])

    expect(screen.getByText("2 / 2")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Add references to Reference Images" })
    ).toBeDisabled()
  })

  it("heads each slot when the model has several, and Unassigned when present", () => {
    const canvas: CanvasDto = {
      nodes: [NODE, mediaNode("m0"), mediaNode("m1")],
      edges: [wire("e0", "m0", "first_frame", 1), wire("e1", "m1", null, 2)],
    }
    renderStrip(canvas, [FIRST, ...SLOTS])

    // One count per heading: `n / max` when the slot has a max, else just n.
    expect(screen.getByText("First Frame")).toBeInTheDocument()
    expect(screen.getByText("Reference Images")).toBeInTheDocument()
    expect(screen.getByText("Unassigned 1")).toBeInTheDocument()
    expect(screen.queryByText("First Frame 1")).not.toBeInTheDocument()
    expect(screen.queryByText("Reference Images 0")).not.toBeInTheDocument()
    // A single-value slot holding its one is full.
    expect(screen.getByText("1 / 1")).toBeInTheDocument()
    expect(screen.getByText("0 / 4")).toBeInTheDocument()
  })

  it("says why a full slot's + is off, to the keyboard as well as the pointer", async () => {
    const user = userEvent.setup()
    renderStrip(wiredCanvas(2), [{ ...SLOTS[0]!, max: 2 }])

    const add = screen.getByRole("button", {
      name: "Add references to Reference Images",
    })
    expect(add).toHaveAccessibleDescription("Reference Images is full (2 / 2)")

    // The disabled button cannot take focus; the span around it can.
    const wrapper = screen.getByTestId("add-full-wrapper")
    for (let i = 0; i < 10 && document.activeElement !== wrapper; i++) {
      await user.tab()
    }
    expect(wrapper).toHaveFocus()
    await waitFor(() =>
      expect(
        screen.getAllByText("Reference Images is full (2 / 2)")
      ).toHaveLength(2)
    )
  })

  it("heads the Unassigned gallery with why it is not sent", async () => {
    const user = userEvent.setup()
    const canvas: CanvasDto = {
      nodes: [NODE, mediaNode("m0")],
      edges: [wire("e0", "m0", null, 1)],
    }
    renderStrip(canvas)

    await user.click(
      screen.getByRole("button", { name: /^Open Unassigned gallery/ })
    )

    const gallery = screen.getByRole("region", { name: "Unassigned gallery" })
    expect(within(gallery).getByRole("banner")).toHaveTextContent(
      "Unassigned· 1 · not sent until each wire has an input"
    )
    expect(gallery).not.toHaveTextContent("sent as")
  })

  it("forgets a gallery whose group is gone, so it does not spring back", async () => {
    const user = userEvent.setup()
    const canvas: CanvasDto = {
      nodes: [NODE, mediaNode("m0")],
      edges: [wire("e0", "m0", null, 1)],
    }
    const { redraw } = renderStrip(canvas)
    await user.click(
      screen.getByRole("button", { name: /^Open Unassigned gallery/ })
    )
    expect(
      screen.getByRole("region", { name: "Unassigned gallery" })
    ).toBeInTheDocument()

    // The wire is deleted: no Unassigned group, no gallery.
    redraw({ nodes: [NODE, mediaNode("m0")], edges: [] })
    expect(
      screen.queryByRole("region", { name: "Unassigned gallery" })
    ).toBeNull()

    // Drawn again, the group is back, but nobody asked for its gallery.
    redraw(canvas)
    expect(screen.getByTestId("reference-thumb")).toBeInTheDocument()
    expect(
      screen.queryByRole("region", { name: "Unassigned gallery" })
    ).toBeNull()
  })

  it("keeps its keys away from the canvas behind it", () => {
    renderStrip(wiredCanvas(1))

    // React Flow ignores keys whose target sits inside `.nokey`.
    expect(screen.getByTestId("canvas-reference-strip")).toHaveClass("nokey")
  })

  it("heads each slot with its role, and says when the role is a guess", () => {
    renderStrip(EMPTY, [FIRST, { ...SLOTS[0]!, verified: false }])

    const groups = screen.getAllByTestId("strip-group")
    const reference = groups.find(
      (group) => group.dataset.slot === "reference_images"
    )!
    const chip = within(reference).getByTestId("slot-chip")
    expect(chip).toHaveAttribute("data-role", "reference")
    expect(chip).toHaveTextContent("unverified")
  })

  it("dims an empty slot the wiring rules out, says why, and will not take a reference", async () => {
    const user = userEvent.setup()
    const soundtrack: ReferenceSlot = {
      field: "soundtrack",
      label: "Reference audio",
      kind: "audio",
      multiple: true,
      max: 3,
      role: "soundtrack",
      verified: true,
      required: false,
      shape: null,
    }
    renderStrip(EMPTY, [FIRST, soundtrack], {
      first_frame: { available: true, reason: null },
      soundtrack: { available: false, reason: "Not available on OpenRouter" },
    })

    const group = screen
      .getAllByTestId("strip-group")
      .find((one) => one.dataset.slot === "soundtrack")!
    expect(group).toHaveAttribute("aria-disabled", "true")
    expect(group).toHaveAttribute("data-unavailable", "empty")
    const chip = within(group).getByTestId("slot-chip")
    expect(chip).toHaveAccessibleDescription(/Not available on OpenRouter/)

    const add = within(group).getByRole("button", {
      name: "Add references to Reference audio",
    })
    expect(add).toBeDisabled()
    expect(add).toHaveAccessibleDescription(
      "Reference audio: Not available on OpenRouter"
    )
    await user.click(add)
    expect(screen.queryByRole("dialog")).toBeNull()

    // The slot that is still open is untouched.
    const first = screen
      .getAllByTestId("strip-group")
      .find((one) => one.dataset.slot === "first_frame")!
    expect(first).not.toHaveAttribute("aria-disabled")
    expect(
      within(first).getByRole("button", {
        name: "Add references to First Frame",
      })
    ).toBeEnabled()
  })

  it("rings a filled slot that became unavailable and says why beside it", () => {
    const soundtrack: ReferenceSlot = {
      ...SLOTS[0]!,
      field: "soundtrack",
      label: "Reference audio",
      role: "soundtrack",
      verified: true,
    }
    renderStrip(wiredCanvas(1, "soundtrack"), [FIRST, soundtrack], {
      first_frame: { available: true, reason: null },
      soundtrack: { available: false, reason: "Not available on OpenRouter" },
    })

    const group = screen
      .getAllByTestId("strip-group")
      .find((one) => one.dataset.slot === "soundtrack")!
    expect(group).toHaveAttribute("data-unavailable", "filled")
    // Inline, not only in a tooltip: the run is blocked on it.
    expect(within(group).getByTestId("strip-group-reason")).toHaveTextContent(
      "Not available on OpenRouter"
    )
    // The wire can still be opened and removed — that is the way out.
    expect(
      within(group).getByRole("button", { name: /^Disconnect/ })
    ).toBeEnabled()
  })

  it("leaves one plain mapped slot unheaded", () => {
    renderStrip(wiredCanvas(1), [{ ...SLOTS[0]!, verified: true }])

    expect(screen.queryByTestId("slot-chip")).toBeNull()
  })

  it("draws nothing dimmed for a model with no availability (unmapped)", () => {
    renderStrip(EMPTY, [FIRST, SLOTS[0]!])

    for (const group of screen.getAllByTestId("strip-group")) {
      expect(group).not.toHaveAttribute("aria-disabled")
      expect(group).not.toHaveAttribute("data-unavailable")
    }
  })
})
