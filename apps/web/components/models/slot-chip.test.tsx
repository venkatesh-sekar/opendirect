// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

/**
 * The single look for a slot everywhere (settings, editor, picker, canvas):
 * role, label, kind, how many, whether it is required, whether a mapping
 * verified it, and — when it cannot be filled right now — why.
 */
import type { ReferenceSlot } from "@opendirect/contract"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { SlotChip } from "./slot-chip"

afterEach(cleanup)

function slot(overrides: Partial<ReferenceSlot> = {}): ReferenceSlot {
  return {
    field: "character",
    label: "Characters (frontal photo)",
    kind: "image",
    multiple: true,
    max: 4,
    role: "character",
    verified: true,
    required: false,
    shape: null,
    ...overrides,
  }
}

function renderChip(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

describe("SlotChip", () => {
  it("shows the label, the kind and how many it takes", () => {
    renderChip(<SlotChip slot={slot()} />)
    const chip = screen.getByTestId("slot-chip")
    expect(chip).toHaveTextContent("Characters (frontal photo)")
    expect(chip).toHaveTextContent("×4")
    expect(chip).toHaveAccessibleName(
      /Characters \(frontal photo\).*Character.*image.*up to 4/i
    )
    expect(chip).not.toHaveAttribute("aria-disabled")
  })

  it("leaves out ×max for a single-item slot", () => {
    renderChip(<SlotChip slot={slot({ multiple: false, max: null })} />)
    expect(screen.getByTestId("slot-chip")).not.toHaveTextContent("×")
  })

  it("marks a required slot", () => {
    renderChip(<SlotChip slot={slot({ required: true })} />)
    expect(screen.getByTestId("slot-chip")).toHaveAccessibleName(/required/i)
    expect(screen.getByTestId("slot-required")).toBeInTheDocument()
  })

  it("carries the unverified badge when a name guess set the role", () => {
    renderChip(<SlotChip slot={slot({ verified: false })} />)
    expect(screen.getByText(/unverified/i)).toBeVisible()
  })

  it("dims an unavailable slot and says why, on focus as well as hover", async () => {
    const user = userEvent.setup()
    renderChip(
      <SlotChip
        slot={slot()}
        availability={{
          available: false,
          reason: "No endpoint takes a character with a last frame.",
        }}
      />
    )
    const chip = screen.getByTestId("slot-chip")
    expect(chip).toHaveAttribute("aria-disabled", "true")
    expect(chip).toHaveClass("opacity-50")
    expect(chip).toHaveAccessibleDescription(
      "No endpoint takes a character with a last frame."
    )

    await user.tab()
    await waitFor(() =>
      expect(
        document.querySelector('[data-slot="tooltip-content"]')
      ).toHaveTextContent("No endpoint takes a character with a last frame.")
    )
  })

  it("is not dimmed when available", () => {
    renderChip(
      <SlotChip
        slot={slot()}
        availability={{ available: true, reason: null }}
      />
    )
    expect(screen.getByTestId("slot-chip")).not.toHaveClass("opacity-50")
  })
})
