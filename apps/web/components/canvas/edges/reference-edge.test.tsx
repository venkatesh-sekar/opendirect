// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import type { ReferenceSlot } from "@opendirect/contract"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { createElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children?: ReactNode
  }) => createElement("a", { href, ...props }, children),
}))

import { EdgeSlotLabel, UNASSIGNED_SLOT_LABEL } from "./reference-edge"

/**
 * The label, not the curve. React Flow draws the path and portals the label
 * into its own renderer; what is worth asserting is the three states a stored
 * `slotField` can be in against a model's declared slots.
 */
function slot(overrides: Partial<ReferenceSlot> = {}): ReferenceSlot {
  return {
    field: "first_frame",
    label: "First Frame",
    kind: "image",
    multiple: false,
    max: null,
    role: "first_frame",
    verified: false,
    required: false,
    shape: null,
    ...overrides,
  }
}

afterEach(cleanup)

describe("EdgeSlotLabel", () => {
  it("shows the model's own name for the slot the edge carries", () => {
    render(
      <EdgeSlotLabel
        slotField="first_frame"
        slots={[slot()]}
        onChange={() => {}}
      />
    )

    const label = screen.getByTestId("edge-slot-label")
    expect(label).toHaveTextContent("First Frame")
    expect(label).not.toHaveAttribute("data-unresolved")
  })

  it("marks a slot the model no longer declares as unresolved", () => {
    render(
      <EdgeSlotLabel
        slotField="motion_reference"
        slots={[slot()]}
        onChange={() => {}}
      />
    )

    const label = screen.getByTestId("edge-slot-label")
    // The stored field is kept, not silently dropped: it is the user's choice
    // on a model they may switch back to.
    expect(label).toHaveTextContent("motion_reference")
    expect(label).toHaveTextContent(/unresolved/i)
    expect(label).toHaveAttribute("data-unresolved", "true")
  })

  it("does not accuse an edge whose model is still loading", () => {
    render(
      <EdgeSlotLabel
        slotField="motion_reference"
        slots={[]}
        loading
        onChange={() => {}}
      />
    )

    expect(screen.getByTestId("edge-slot-label")).not.toHaveAttribute(
      "data-unresolved"
    )
  })

  it("reads as unassigned for a text edge, which has no slot at all", () => {
    render(
      <EdgeSlotLabel slotField={null} slots={[slot()]} onChange={() => {}} />
    )

    expect(screen.getByTestId("edge-slot-label")).toHaveTextContent(
      UNASSIGNED_SLOT_LABEL
    )
  })

  it("offers exactly the slots the model declares, and re-labels on a click", async () => {
    const onChange = vi.fn()
    render(
      <EdgeSlotLabel
        slotField="first_frame"
        slots={[
          slot(),
          slot({
            field: "last_frame",
            label: "Last Frame",
            role: "last_frame",
          }),
        ]}
        onChange={onChange}
      />
    )

    await userEvent.click(screen.getByTestId("edge-slot-label"))
    await userEvent.click(
      await screen.findByRole("button", { name: "Last Frame" })
    )

    expect(onChange).toHaveBeenCalledWith("last_frame")
  })

  it("labels the edge with the slot's role, and says when the role is a guess", async () => {
    const user = userEvent.setup()
    render(
      <EdgeSlotLabel
        slotField="first_frame"
        slots={[slot()]}
        onChange={() => {}}
      />
    )

    const label = screen.getByTestId("edge-slot-label")
    expect(label).toHaveAttribute("data-role", "first_frame")
    expect(label).toHaveAttribute("data-verified", "false")
    // Keyboard and screen reader get the hint too, not only a hover.
    expect(label).toHaveAccessibleDescription(/Guessed from the field name/)
    await user.hover(label)
    await waitFor(() =>
      expect(
        screen.getAllByText(/Guessed from the field name/).length
      ).toBeGreaterThan(1)
    )
  })

  it("draws a mapped slot plainly", () => {
    render(
      <EdgeSlotLabel
        slotField="first_frame"
        slots={[slot({ verified: true })]}
        onChange={() => {}}
      />
    )

    const label = screen.getByTestId("edge-slot-label")
    expect(label).toHaveAttribute("data-verified", "true")
    expect(label).not.toHaveAccessibleDescription(/Guessed/)
  })

  it("disables a slot the wiring rules out, and says why in the menu itself", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <EdgeSlotLabel
        slotField="first_frame"
        slots={[
          slot({ verified: true }),
          slot({
            field: "soundtrack",
            label: "Reference audio",
            role: "soundtrack",
            kind: "audio",
            verified: true,
          }),
          slot({
            field: "last_frame",
            label: "Last frame",
            role: "last_frame",
            verified: true,
          }),
        ]}
        availability={{
          first_frame: { available: true, reason: null },
          soundtrack: {
            available: false,
            reason: "Not available on OpenRouter",
          },
          last_frame: { available: true, reason: null },
        }}
        onChange={onChange}
      />
    )

    await user.click(screen.getByTestId("edge-slot-label"))
    const audio = await screen.findByRole("button", {
      name: "Reference audio",
    })
    expect(audio).toHaveAttribute("aria-disabled", "true")
    // Visible text, and the button's description: not a hover-only tooltip.
    expect(audio).toHaveTextContent("Not available on OpenRouter")
    expect(audio).toHaveAccessibleDescription(/Not available on OpenRouter/)
    await user.click(audio)
    expect(onChange).not.toHaveBeenCalled()

    // An available one still re-labels the edge.
    await user.click(screen.getByRole("button", { name: "Last frame" }))
    expect(onChange).toHaveBeenCalledWith("last_frame")
  })

  it("marks the edge when the slot it carries is ruled out", () => {
    render(
      <EdgeSlotLabel
        slotField="soundtrack"
        slots={[
          slot({
            field: "soundtrack",
            label: "Reference audio",
            role: "soundtrack",
            verified: true,
          }),
        ]}
        availability={{
          soundtrack: {
            available: false,
            reason: "Not available on OpenRouter",
          },
        }}
        onChange={() => {}}
      />
    )

    const label = screen.getByTestId("edge-slot-label")
    expect(label).toHaveAttribute("data-unavailable", "true")
    expect(label).toHaveAccessibleDescription(/Not available on OpenRouter/)
  })

  it("offers to map a concrete model whose slots are guesses", async () => {
    const user = userEvent.setup()
    render(
      <EdgeSlotLabel
        slotField="first_frame"
        slots={[slot()]}
        mapModelKey="replicate:acme/model-2"
        onChange={() => {}}
      />
    )

    await user.click(screen.getByTestId("edge-slot-label"))
    const link = await screen.findByRole("link", { name: /Map this model/ })
    expect(link).toHaveAttribute(
      "href",
      `/settings?tab=models&map=${encodeURIComponent("replicate:acme/model-2")}`
    )
    expect(
      within(link.parentElement!).getByText(/Wrong input\?/)
    ).toBeInTheDocument()
  })

  it("does not offer mapping when every slot is mapped", async () => {
    const user = userEvent.setup()
    render(
      <EdgeSlotLabel
        slotField="first_frame"
        slots={[slot({ verified: true })]}
        mapModelKey="replicate:acme/model-2"
        onChange={() => {}}
      />
    )

    await user.click(screen.getByTestId("edge-slot-label"))
    await screen.findByRole("button", { name: "First Frame" })
    expect(screen.queryByRole("link", { name: /Map this model/ })).toBeNull()
  })
})
