// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

/**
 * The `@` picker, from the keystroke that opens it to the text it leaves
 * behind.
 *
 * The control is a plain `<textarea>` on purpose — the prompt is a string from
 * here to `generations.prompt` — so every assertion here is about that string
 * and about the list that helps write it. ⛔ Nothing in this file submits
 * anything; the picker cannot spend money.
 */
import { useState } from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import type { MentionSubject } from "@/lib/mentions/resolve"

import { MentionTextarea } from "./mention-textarea"

const SUBJECTS: MentionSubject[] = [
  {
    containerId: "c-venkz",
    kind: "character",
    handle: "venkz",
    name: "Venkz",
    description: "a tired bellhop",
    images: [{ assetId: "a-venkz", label: "Character Sheet" }],
  },
  {
    containerId: "c-lobby",
    kind: "scene",
    handle: "hotel-lobby",
    name: "Hotel Lobby",
    description: null,
    images: [],
  },
]

function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <MentionTextarea
      aria-label="Prompt"
      value={value}
      onChange={setValue}
      subjects={SUBJECTS}
    />
  )
}

afterEach(cleanup)

describe("MentionTextarea", () => {
  it("opens the list on `@` and filters it as the handle is typed", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const prompt = screen.getByLabelText("Prompt")
    await user.click(prompt)
    await user.type(prompt, "@")

    const picker = await screen.findByTestId("mention-picker")
    expect(picker).toBeVisible()
    expect(
      screen.getAllByTestId("mention-option").map((one) => one.dataset.handle)
    ).toEqual(["venkz", "hotel-lobby"])

    await user.type(prompt, "ve")
    await waitFor(() =>
      expect(
        screen.getAllByTestId("mention-option").map((one) => one.dataset.handle)
      ).toEqual(["venkz"])
    )
  })

  it("writes `@venkz ` into the value on Enter", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const prompt = screen.getByLabelText("Prompt")
    await user.click(prompt)
    await user.type(prompt, "a shot of @ve")
    await screen.findByTestId("mention-picker")
    await user.keyboard("{Enter}")

    expect(prompt).toHaveValue("a shot of @venkz ")
    expect(screen.queryByTestId("mention-picker")).toBeNull()
  })

  it("moves the highlight with the arrow keys and takes the one chosen", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const prompt = screen.getByLabelText("Prompt")
    await user.click(prompt)
    await user.type(prompt, "@")
    await screen.findByTestId("mention-picker")

    await user.keyboard("{ArrowDown}")
    await user.keyboard("{Tab}")

    expect(prompt).toHaveValue("@hotel-lobby ")
  })

  it("closes on Escape and leaves the text exactly as it was typed", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const prompt = screen.getByLabelText("Prompt")
    await user.click(prompt)
    await user.type(prompt, "@ve")
    await screen.findByTestId("mention-picker")

    await user.keyboard("{Escape}")

    await waitFor(() =>
      expect(screen.queryByTestId("mention-picker")).toBeNull()
    )
    expect(prompt).toHaveValue("@ve")
  })

  it("never opens for an email address", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const prompt = screen.getByLabelText("Prompt")
    await user.click(prompt)
    await user.type(prompt, "venkz@ex")

    expect(screen.queryByTestId("mention-picker")).toBeNull()
  })

  it("paints every mention in the text as a chip", () => {
    render(<Harness initial="@venkz meets @hotel-lobby at dawn" />)

    const overlay = screen.getByTestId("mention-overlay")
    expect(
      [...overlay.querySelectorAll("mark")].map((one) => one.textContent)
    ).toEqual(["@venkz", "@hotel-lobby"])
  })

  it("⛔ says nothing about a handle nobody claims, and corrects nothing", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const prompt = screen.getByLabelText("Prompt")
    await user.click(prompt)
    await user.type(prompt, "@nobdy")

    // The list is empty rather than offering a near neighbour, and the text
    // is left exactly as typed.
    expect(screen.queryAllByTestId("mention-option")).toHaveLength(0)
    expect(prompt).toHaveValue("@nobdy")
  })
})
