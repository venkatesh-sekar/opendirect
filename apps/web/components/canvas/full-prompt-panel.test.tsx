// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

/**
 * The panel is a read-out: it is handed the resolved prompt and shows it,
 * cut where the blocks were, with nothing of its own added or taken away.
 * ⛔ Nothing in this file submits or spends.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { FullPromptPanel, type FullPromptPanelProps } from "./full-prompt-panel"

/** A note, then the user's words: `"a note"` + `"\n\n"` + `"slowly"`. */
const PROPS: FullPromptPanelProps = {
  prompt: "a note\n\nslowly",
  segments: [
    { start: 0, end: 6, kind: "note" },
    { start: 8, end: 14, kind: "text" },
  ],
  noteCount: 1,
  inputs: [
    { field: "reference_images", label: "Reference Images", count: 2 },
    { field: "first_frame", label: "First Frame", count: 1 },
  ],
  onOpenInput: () => {},
}

function renderPanel(over: Partial<FullPromptPanelProps> = {}) {
  return render(<FullPromptPanel {...PROPS} {...over} />)
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  })
}

describe("FullPromptPanel", () => {
  it("counts characters, words, notes and images", () => {
    renderPanel({ prompt: "ab cd\n\nef", segments: [], noteCount: 2 })

    expect(screen.getByTestId("full-prompt-stats")).toHaveTextContent(
      "9 chars · 3 words · 2 notes · 3 images"
    )
  })

  it("wraps its counts between items, never inside one", () => {
    renderPanel({ prompt: "ab cd\n\nef", segments: [], noteCount: 2 })

    // A narrow bar stacks the header; each count stays whole on its line.
    const stats = screen.getByTestId("full-prompt-stats")
    expect(stats).toHaveClass("flex-wrap")
    const pieces = [...stats.children].map((piece) => piece.textContent)
    expect(pieces).toEqual([
      "9 chars",
      " · 3 words",
      " · 2 notes",
      " · 3 images",
    ])
    for (const piece of stats.children) {
      expect(piece).toHaveClass("whitespace-nowrap")
    }
  })

  it("shows the prompt exactly, cut at the block boundaries", () => {
    renderPanel()

    const box = screen.getByTestId("full-prompt")
    expect(box.textContent).toBe("a note\n\nslowly")
    const fromNote = box.querySelectorAll("[data-from-note]")
    expect(fromNote).toHaveLength(1)
    expect(fromNote[0]!.textContent).toBe("a note")
  })

  it("tints note text until Highlight notes is unchecked", async () => {
    const user = userEvent.setup()
    renderPanel()

    const note = screen
      .getByTestId("full-prompt")
      .querySelector("[data-from-note]")!
    const highlight = screen.getByRole("checkbox", { name: "Highlight notes" })
    expect(highlight).toBeChecked()
    expect(note).toHaveClass("bg-primary/10")

    await user.click(highlight)

    expect(highlight).not.toBeChecked()
    expect(note).not.toHaveClass("bg-primary/10")
    // Still marked: the tint is a view choice, the source is a fact.
    expect(note).toHaveAttribute("data-from-note")
  })

  it("says so when there is nothing to send", () => {
    renderPanel({ prompt: "", segments: [], noteCount: 0 })

    expect(screen.getByTestId("full-prompt")).toHaveTextContent(
      "Nothing yet — type or connect a note."
    )
  })

  it("copies the exact prompt", async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => {})
    // After `setup`, which installs a clipboard of its own.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    renderPanel()

    await user.click(screen.getByRole("button", { name: "Copy" }))

    expect(writeText).toHaveBeenCalledExactlyOnceWith("a note\n\nslowly")
    expect(
      await screen.findByRole("button", { name: "Copied" })
    ).toBeInTheDocument()
  })

  it("still says Copied when the clipboard refuses", async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error("no"))) },
    })
    renderPanel()

    await user.click(screen.getByRole("button", { name: "Copy" }))

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Copied" })).toBeVisible()
    )
  })

  it("says Copy again 1.4s after Copied", async () => {
    vi.useFakeTimers()
    stubClipboard(async () => {})
    renderPanel()

    fireEvent.click(screen.getByRole("button", { name: "Copy" }))
    await act(async () => {})
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(1399))
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument()
  })

  it("starts no timer when it is closed before the copy settles", async () => {
    vi.useFakeTimers()
    let settle = () => {}
    stubClipboard(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve
        })
    )
    const { unmount } = renderPanel()

    fireEvent.click(screen.getByRole("button", { name: "Copy" }))
    unmount()
    await act(async () => settle())

    expect(vi.getTimerCount()).toBe(0)
  })

  it("opens an input's gallery from its chip", async () => {
    const user = userEvent.setup()
    const onOpenInput = vi.fn()
    renderPanel({ onOpenInput })

    const chip = screen.getByRole("button", { name: /reference_images × 2/ })
    await user.click(chip)
    expect(onOpenInput).toHaveBeenCalledExactlyOnceWith("reference_images")

    // A real button, so the keyboard reaches it too.
    chip.focus()
    await user.keyboard("{Enter}")
    expect(onOpenInput).toHaveBeenCalledTimes(2)
  })

  it("hides the images row when no input carries a picture", () => {
    renderPanel({ inputs: [] })

    expect(screen.queryByTestId("full-prompt-inputs")).not.toBeInTheDocument()
  })

  it("keeps its keys away from the canvas", () => {
    renderPanel()

    // React Flow listens for Space and Backspace on the whole document.
    expect(screen.getByTestId("full-prompt-panel")).toHaveClass("nokey")
  })
})
