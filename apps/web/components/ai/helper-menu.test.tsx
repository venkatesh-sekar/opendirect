// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import type { ReactElement } from "react"
import {
  settingsDefaults,
  type AiToolModels,
  type AiTools,
  type AssetDto,
} from "@opendirect/contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  render as renderDom,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { HelperMenu } from "./helper-menu"

const invoke = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ipc", () => ({
  invoke,
  isBridgeAvailable: () => true,
  subscribe: () => () => {},
}))

/** The saved `aiModels` setting the menu reads; reset before each test. */
let savedModels: AiToolModels = { claude: null, codex: null }

beforeEach(() => {
  savedModels = { claude: null, codex: null }
  invoke.mockReset()
  invoke.mockImplementation(async (channel: string) => {
    if (channel === "settings:get") {
      return { ...settingsDefaults, aiModels: savedModels }
    }
    throw new Error(`Unexpected channel ${channel}`)
  })
})

/** Opens the ✨ menu once the saved settings it reads have arrived. */
async function openMenu() {
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("settings:get"))
  await invoke.mock.results[0]?.value
  await userEvent.click(screen.getByRole("button", { name: /ai helpers/i }))
  await screen.findByRole("combobox", { name: /model for/i })
}

function render(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return renderDom(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  )
}

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

    await openMenu()
    await userEvent.click(
      screen.getByRole("button", { name: "Improve prompt" })
    )

    expect(onRun).toHaveBeenCalledWith("improve-prompt", "claude", {
      model: null,
      instructions: null,
    })
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

    expect(onRun).toHaveBeenCalledWith(
      "improve-prompt",
      "codex",
      expect.objectContaining({ instructions: null })
    )
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

  it("sends the user's direction and the saved model with the run", async () => {
    savedModels = { claude: "opus", codex: null }
    const onRun = vi.fn()
    const user = userEvent.setup()
    render(
      <HelperMenu tools={tools()} helpers={["improve-prompt"]} onRun={onRun} />
    )

    await openMenu()
    expect(
      screen.getByRole("combobox", { name: "Model for claude" })
    ).toHaveTextContent("Opus")
    await user.type(
      screen.getByRole("textbox", { name: "Direction for the helper" }),
      "  more cinematic, keep the outfit  "
    )
    await user.click(screen.getByRole("button", { name: "Improve prompt" }))

    expect(onRun).toHaveBeenCalledWith("improve-prompt", "claude", {
      model: "opus",
      instructions: "more cinematic, keep the outfit",
    })
  })

  it("overrides the model for a run with a preset", async () => {
    const onRun = vi.fn()
    const user = userEvent.setup()
    render(
      <HelperMenu tools={tools()} helpers={["improve-prompt"]} onRun={onRun} />
    )

    await openMenu()
    await user.click(screen.getByRole("combobox", { name: "Model for claude" }))
    await user.click(await screen.findByRole("option", { name: /^Sonnet/ }))
    await user.click(screen.getByRole("button", { name: "Improve prompt" }))

    expect(onRun).toHaveBeenCalledWith(
      "improve-prompt",
      "claude",
      expect.objectContaining({ model: "sonnet" })
    )
  })

  it("picks the CLI default over a saved model, passing null", async () => {
    savedModels = { claude: "opus", codex: null }
    const onRun = vi.fn()
    const user = userEvent.setup()
    render(
      <HelperMenu tools={tools()} helpers={["improve-prompt"]} onRun={onRun} />
    )

    await openMenu()
    await user.click(screen.getByRole("combobox", { name: "Model for claude" }))
    await user.click(await screen.findByRole("option", { name: "CLI default" }))
    await user.click(screen.getByRole("button", { name: "Improve prompt" }))

    expect(onRun).toHaveBeenCalledWith(
      "improve-prompt",
      "claude",
      expect.objectContaining({ model: null })
    )
  })

  it("accepts a valid custom model and refuses one that looks like a flag", async () => {
    const onRun = vi.fn()
    const user = userEvent.setup()
    render(
      <HelperMenu tools={tools()} helpers={["improve-prompt"]} onRun={onRun} />
    )

    await openMenu()
    await user.click(screen.getByRole("combobox", { name: "Model for claude" }))
    await user.click(await screen.findByRole("option", { name: "Custom…" }))

    const field = screen.getByRole("textbox", { name: "Custom claude model" })
    await user.type(field, "--dangerously-skip-permissions")
    expect(screen.getByRole("alert")).toHaveTextContent(/letters, digits/i)
    expect(field).toHaveAttribute("aria-invalid", "true")

    await user.clear(field)
    await user.type(field, "claude-opus-5-5[[1m]")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Improve prompt" }))

    expect(onRun).toHaveBeenCalledWith(
      "improve-prompt",
      "claude",
      expect.objectContaining({ model: "claude-opus-5-5[1m]" })
    )
  })

  it("hides the image helpers until there is an image to point them at", async () => {
    render(
      <HelperMenu
        tools={tools()}
        helpers={["improve-prompt", "explain-image", "rethink-image"]}
        onRun={vi.fn()}
      />
    )

    await openMenu()
    expect(screen.getByRole("button", { name: "Improve prompt" })).toBeVisible()
    expect(screen.queryByRole("button", { name: "Explain image" })).toBeNull()
    expect(screen.queryByRole("radiogroup", { name: "Which image" })).toBeNull()
  })

  it("renders nothing for an image-only surface with no image", () => {
    const { container } = render(
      <HelperMenu tools={tools()} helpers={["explain-image"]} onRun={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("hands an image helper the image the user chose, with their question", async () => {
    const onRun = vi.fn()
    const first = image("a1", "Lobby")
    const second = image("a2", "Corridor")
    render(
      <HelperMenu
        tools={tools()}
        helpers={["improve-prompt", "explain-image", "rethink-image"]}
        images={[first, second]}
        onRun={onRun}
      />
    )

    await openMenu()
    expect(screen.getByRole("radio", { name: "Lobby" })).toHaveAttribute(
      "aria-checked",
      "true"
    )
    await userEvent.click(screen.getByRole("radio", { name: "Corridor" }))
    await userEvent.type(
      screen.getByRole("textbox", { name: "Direction for the helper" }),
      "why does it feel cold?"
    )
    await userEvent.click(screen.getByRole("button", { name: "Explain image" }))

    expect(onRun).toHaveBeenCalledWith(
      "explain-image",
      "claude",
      { model: null, instructions: "why does it feel cold?" },
      second
    )
  })

  it("passes no image to a text helper, even with images on offer", async () => {
    const onRun = vi.fn()
    render(
      <HelperMenu
        tools={tools()}
        helpers={["improve-prompt", "rethink-image"]}
        images={[image("a1", "Lobby")]}
        onRun={onRun}
      />
    )

    await openMenu()
    await userEvent.click(
      screen.getByRole("button", { name: "Improve prompt" })
    )

    expect(onRun.mock.calls[0]).toHaveLength(3)
  })
})

function image(id: string, label: string): AssetDto {
  return {
    id,
    projectId: "p1",
    kind: "image",
    relPath: `assets/${id}.png`,
    text: null,
    mimeType: "image/png",
    width: 64,
    height: 64,
    durationMs: null,
    bytes: 128,
    sha256: id,
    thumbnailRelPath: null,
    label,
    originalName: `${id}.png`,
    pinned: false,
    generationId: null,
    createdAt: 1,
    url: `asset://p1/assets/${id}.png`,
    thumbnailUrl: null,
  }
}
