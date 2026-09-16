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
  CanvasDto,
  CanvasNodeDto,
  ReferenceSlot,
} from "@opendirect/contract"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { MentionOutcome } from "@/lib/mentions/resolve"

import { MentionNotes, ReferenceTray } from "./reference-tray"

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
      <ReferenceTray
        node={NODE}
        canvas={EMPTY}
        slots={SLOTS}
        containerId="c1"
        mentions={mentions}
      />
      <MentionNotes mentions={mentions} />
    </QueryClientProvider>
  )
}

afterEach(cleanup)

describe("ReferenceTray mentions", () => {
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
