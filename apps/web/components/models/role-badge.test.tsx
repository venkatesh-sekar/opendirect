// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

/**
 * The one look for a role: its name, and — when a name guess rather than a
 * mapping set it — a visible "unverified" with the way to fix it.
 */
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { RoleBadge, UNVERIFIED_HINT } from "./role-badge"

afterEach(cleanup)

function renderBadge(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

describe("RoleBadge", () => {
  it("shows the role's label", () => {
    renderBadge(<RoleBadge role="first_frame" />)
    expect(screen.getByText("First frame")).toBeVisible()
    expect(screen.queryByText(/unverified/i)).toBeNull()
  })

  it("says unverified, dashed, when a name guess set the role", () => {
    renderBadge(<RoleBadge role="character" verified={false} />)
    const badge = screen.getByText("Character").closest("[data-role]")
    expect(badge).toHaveAttribute("data-verified", "false")
    expect(badge).toHaveClass("border-dashed")
    expect(screen.getByText(/unverified/i)).toBeVisible()
  })

  it("explains an unverified role on focus, not only on hover", async () => {
    const user = userEvent.setup()
    renderBadge(<RoleBadge role="style" verified={false} />)

    await user.tab()

    await waitFor(() =>
      expect(
        document.querySelector('[data-slot="tooltip-content"]')
      ).toHaveTextContent(UNVERIFIED_HINT)
    )
  })

  it("takes a slot key and reads its role", () => {
    renderBadge(<RoleBadge role="reference:2" />)
    expect(screen.getByText("Reference")).toBeVisible()
  })
})
