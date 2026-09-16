// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import type { AiTools } from "@opendirect/contract"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { HelperMenu } from "./helper-menu"

function tools(overrides: Partial<AiTools> = {}): AiTools {
  return {
    claude: {
      id: "claude",
      available: true,
      path: "/bin/claude",
      version: "2.1.0",
    },
    codex: { id: "codex", available: false, path: null, version: null },
    preferred: "claude",
    detectedAt: 1,
    ...overrides,
  }
}

afterEach(cleanup)

describe("HelperMenu", () => {
  it("renders nothing at all when no CLI was detected", () => {
    const { container } = render(
      <HelperMenu
        tools={tools({
          claude: { id: "claude", available: false, path: null, version: null },
          preferred: null,
        })}
        helpers={["improve-prompt"]}
        onRun={vi.fn()}
      />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it("renders nothing while detection has not answered yet", () => {
    const { container } = render(
      <HelperMenu
        tools={undefined}
        helpers={["improve-prompt"]}
        onRun={vi.fn()}
      />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it("runs the chosen helper with the preferred tool", async () => {
    const onRun = vi.fn()
    render(
      <HelperMenu
        tools={tools()}
        helpers={["improve-prompt", "suggest-shots"]}
        onRun={onRun}
      />
    )

    await userEvent.click(screen.getByRole("button", { name: /ai helpers/i }))
    await userEvent.click(
      screen.getByRole("button", { name: "Improve prompt" })
    )

    expect(onRun).toHaveBeenCalledWith("improve-prompt", "claude")
  })

  it("offers only the helpers this surface declares", async () => {
    render(
      <HelperMenu tools={tools()} helpers={["analyze-video"]} onRun={vi.fn()} />
    )

    await userEvent.click(screen.getByRole("button", { name: /ai helpers/i }))

    expect(screen.getByRole("button", { name: "Analyze video" })).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "Improve prompt" })
    ).not.toBeInTheDocument()
  })

  it("lets the user pick the other CLI when both are installed", async () => {
    const onRun = vi.fn()
    render(
      <HelperMenu
        tools={tools({
          codex: {
            id: "codex",
            available: true,
            path: "/bin/codex",
            version: "1",
          },
        })}
        helpers={["improve-prompt"]}
        onRun={onRun}
      />
    )

    await userEvent.click(screen.getByRole("button", { name: /ai helpers/i }))
    await userEvent.click(screen.getByRole("radio", { name: "codex" }))
    await userEvent.click(
      screen.getByRole("button", { name: "Improve prompt" })
    )

    expect(onRun).toHaveBeenCalledWith("improve-prompt", "codex")
  })

  it("hides the tool chooser when only one CLI is installed", async () => {
    render(
      <HelperMenu
        tools={tools()}
        helpers={["improve-prompt"]}
        onRun={vi.fn()}
      />
    )

    await userEvent.click(screen.getByRole("button", { name: /ai helpers/i }))

    expect(screen.queryByRole("radio")).not.toBeInTheDocument()
  })

  it("says which CLI is answering", async () => {
    render(
      <HelperMenu
        tools={tools()}
        helpers={["improve-prompt"]}
        onRun={vi.fn()}
      />
    )

    await userEvent.click(screen.getByRole("button", { name: /ai helpers/i }))

    expect(screen.getByText(/claude/i)).toBeVisible()
  })
})
