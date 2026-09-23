// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import type { ReferenceSlot } from "@opendirect/contract"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

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
})
