// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

/**
 * The composer's block list, driven the way a user drives it: typing into a
 * text block, clicking and dragging notes, Backspace and Delete.
 *
 * The component holds no blocks of its own — every edit is a function handed
 * to `onEdit` — so the harness below plays PromptBar's part and keeps them in
 * state. ⛔ Nothing here submits anything; the list only decides what a later
 * Run would send.
 */
import { useEffect, useState } from "react"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { DraftBlock, IncomingNote } from "@/lib/canvas/prompt-blocks"

import { CanvasSurfaceProvider, type CanvasSurface } from "./canvas-context"
import { PromptBlocks } from "./prompt-blocks"

const NOTES: IncomingNote[] = [
  {
    nodeId: "n-light",
    title: "Lighting",
    text: "Lighting\nlow sun through the lobby windows",
  },
  { nodeId: "n-lens", title: "Lens", text: "shot on 35mm" },
  { nodeId: "n-empty", title: "Empty note", text: "   " },
]
const NOTES_BY_ID = new Map(NOTES.map((note) => [note.nodeId, note]))

const START: DraftBlock[] = [
  { id: "note:n-light", kind: "note", nodeId: "n-light" },
  { id: "t-a", kind: "text", text: "a bellhop" },
  { id: "note:n-lens", kind: "note", nodeId: "n-lens" },
  { id: "t-b", kind: "text", text: "at dusk" },
]

function surface(): CanvasSurface {
  return {
    containerId: null,
    spawn: vi.fn(),
    pick: vi.fn(),
    branch: vi.fn(),
    selectGeneration: vi.fn(),
    highlightNote: vi.fn(),
    selectNode: vi.fn(),
  }
}

let latest: DraftBlock[] = []

function Harness({
  initial,
  onDisconnect,
}: {
  initial: DraftBlock[]
  onDisconnect: (nodeId: string) => void
}) {
  const [blocks, setBlocks] = useState(initial)
  useEffect(() => {
    latest = blocks
  }, [blocks])
  return (
    <PromptBlocks
      blocks={blocks}
      notesById={NOTES_BY_ID}
      subjects={[]}
      onEdit={(edit) => setBlocks((current) => edit(current))}
      onDisconnect={onDisconnect}
    />
  )
}

function mount(initial: DraftBlock[] = START) {
  const actions = surface()
  const onDisconnect = vi.fn()
  const view = render(
    <CanvasSurfaceProvider value={actions}>
      <Harness initial={initial} onDisconnect={onDisconnect} />
    </CanvasSurfaceProvider>
  )
  return { actions, onDisconnect, ...view }
}

function items() {
  return within(screen.getByRole("list", { name: "Prompt blocks" }))
    .getAllByRole("listitem")
    .map((item) => item.dataset.blockId)
}

afterEach(cleanup)

describe("PromptBlocks", () => {
  it("draws notes dimmed with their number, title and word count", async () => {
    const user = userEvent.setup()
    mount()

    const light = screen.getByRole("button", { name: /note 1, lighting/i })
    expect(light.className).toContain("text-muted-foreground")
    expect(light).toHaveTextContent("1")
    expect(light).toHaveTextContent("Lighting")
    expect(light).toHaveTextContent("7w")
    expect(
      screen.getByRole("button", { name: /note 2, lens/i })
    ).toHaveTextContent("3w")

    expect(light).toHaveAttribute("aria-expanded", "false")
    await user.click(light)
    expect(light).toHaveAttribute("aria-expanded", "true")
    await user.click(light)
    expect(light).toHaveAttribute("aria-expanded", "false")
  })

  it("says an empty note adds nothing", () => {
    mount([
      { id: "note:n-empty", kind: "note", nodeId: "n-empty" },
      { id: "t-a", kind: "text", text: "" },
    ])
    expect(screen.getByText("Empty — adds nothing")).toBeInTheDocument()
  })

  it("labels the last text block Prompt and numbers the others", () => {
    mount()
    expect(screen.getByLabelText("Prompt, part 1")).toHaveValue("a bellhop")
    expect(screen.getByLabelText("Prompt")).toHaveValue("at dusk")
    expect(screen.getByLabelText("Prompt")).toHaveAttribute(
      "placeholder",
      "Type here, or drag a note in…"
    )
    expect(screen.getByLabelText("Prompt, part 1")).toHaveAttribute(
      "placeholder",
      "Type…"
    )
  })

  it("edits only the text block being typed in", async () => {
    const user = userEvent.setup()
    mount()

    await user.type(screen.getByLabelText("Prompt, part 1"), " waits")

    expect(latest).toEqual([
      START[0],
      { id: "t-a", kind: "text", text: "a bellhop waits" },
      START[2],
      START[3],
    ])
  })

  it("inserts an empty text block under a note with + and focuses it", async () => {
    const user = userEvent.setup()
    mount()

    const light = screen
      .getAllByRole("listitem")
      .find((item) => item.dataset.blockId === "note:n-light")!
    await user.click(
      within(light).getByRole("button", { name: "Insert text below" })
    )

    expect(latest).toHaveLength(5)
    expect(latest[1]).toMatchObject({ kind: "text", text: "" })
    const inserted = latest[1]!.id
    const field = screen
      .getAllByRole("listitem")
      .find((item) => item.dataset.blockId === inserted)!
      .querySelector("textarea")
    expect(field).toHaveFocus()
  })

  it("disconnects a note with ✕ or Delete, and never from a text block", async () => {
    const user = userEvent.setup()
    const { onDisconnect } = mount()

    await user.click(screen.getByRole("button", { name: "Disconnect Lens" }))
    expect(onDisconnect).toHaveBeenLastCalledWith("n-lens")

    screen.getByRole("button", { name: /note 1, lighting/i }).focus()
    await user.keyboard("{Delete}")
    expect(onDisconnect).toHaveBeenLastCalledWith("n-light")
    expect(onDisconnect).toHaveBeenCalledTimes(2)

    await user.click(screen.getByLabelText("Prompt, part 1"))
    await user.keyboard("{Backspace}{Delete}")
    expect(onDisconnect).toHaveBeenCalledTimes(2)
  })

  it("removes an empty text block on Backspace and focuses the previous one", async () => {
    const user = userEvent.setup()
    mount([
      { id: "t-a", kind: "text", text: "a bellhop" },
      { id: "note:n-lens", kind: "note", nodeId: "n-lens" },
      { id: "t-mid", kind: "text", text: "" },
      { id: "t-b", kind: "text", text: "at dusk" },
    ])

    await user.click(screen.getByLabelText("Prompt, part 2"))
    await user.keyboard("{Backspace}")

    expect(latest.map((block) => block.id)).toEqual([
      "t-a",
      "note:n-lens",
      "t-b",
    ])
    const previous = screen.getByLabelText("Prompt, part 1")
    expect(previous).toHaveFocus()
    expect((previous as HTMLTextAreaElement).selectionStart).toBe(
      "a bellhop".length
    )
  })

  it("moves a note below the next block from the keyboard", async () => {
    const user = userEvent.setup()
    mount()

    // jsdom lays nothing out; stack the blocks 40px apart.
    const rect = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const item = this.closest("li[data-block-id]")
        const index = item
          ? START.findIndex(
              (block) => block.id === item.getAttribute("data-block-id")
            )
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

    try {
      screen.getByRole("button", { name: "Move note 1" }).focus()
      await user.keyboard(" ")
      await user.keyboard("{ArrowDown}")
      await user.keyboard(" ")

      expect(latest.map((block) => block.id)).toEqual([
        "t-a",
        "note:n-light",
        "note:n-lens",
        "t-b",
      ])
      expect(items()).toEqual(["t-a", "note:n-light", "note:n-lens", "t-b"])
    } finally {
      rect.mockRestore()
    }
  })

  it("points the canvas at a hovered note and selects a double-clicked one", async () => {
    const user = userEvent.setup()
    const { actions, unmount } = mount()

    const lens = screen.getByRole("button", { name: /note 2, lens/i })
    await user.hover(lens)
    expect(actions.highlightNote).toHaveBeenLastCalledWith("n-lens")
    await user.unhover(lens)
    expect(actions.highlightNote).toHaveBeenLastCalledWith(null)

    fireEvent.doubleClick(lens)
    expect(actions.selectNode).toHaveBeenCalledWith("n-lens")

    await user.hover(lens)
    unmount()
    expect(actions.highlightNote).toHaveBeenLastCalledWith(null)
  })
})
