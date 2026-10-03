// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

/**
 * The AI helpers tab: the saved model per local CLI.
 *
 * ⛔ Every channel is stubbed and nothing here runs a CLI — choosing a model
 * is a `settings:set`, not a prompt.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  settingsDefaults,
  type AiToolModels,
  type IpcChannel,
} from "@opendirect/contract"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const invoke = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ipc", () => ({
  invoke,
  isBridgeAvailable: () => true,
  pathsForFiles: () => [],
  subscribe: () => () => {},
}))

const { AiToolsForm } = await import("./ai-tools-form")

let aiModels: AiToolModels = { claude: null, codex: null }

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AiToolsForm />
    </QueryClientProvider>
  )
}

function setCalls(): unknown[] {
  return invoke.mock.calls
    .filter(([channel]) => channel === "settings:set")
    .map(([, patch]) => patch)
}

beforeEach(() => {
  aiModels = { claude: null, codex: "gpt-5.5" }
  invoke.mockReset()
  invoke.mockImplementation(
    async (channel: IpcChannel, payload: { aiModels?: AiToolModels }) => {
      switch (channel) {
        case "ai:tools":
          return {
            claude: {
              id: "claude",
              available: true,
              path: "/bin/claude",
              version: "2.1.288",
            },
            codex: {
              id: "codex",
              available: true,
              path: "/bin/codex",
              version: "0.155.0",
            },
            preferred: "claude",
            detectedAt: 0,
          }
        case "settings:get":
          return { ...settingsDefaults, aiModels }
        case "settings:set":
          aiModels = payload.aiModels ?? aiModels
          return { ...settingsDefaults, aiModels }
        default:
          return { ok: true }
      }
    }
  )
})

afterEach(cleanup)

describe("AiToolsForm", () => {
  it("shows each installed CLI's saved model, defaulting to the CLI's own", async () => {
    renderForm()

    expect(
      await screen.findByRole("combobox", { name: "Default claude model" })
    ).toHaveTextContent("CLI default")
    expect(
      screen.getByRole("combobox", { name: "Default codex model" })
    ).toHaveTextContent("GPT-5.5")
  })

  it("saves a preset for one CLI without touching the other's", async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(
      await screen.findByRole("combobox", { name: "Default claude model" })
    )
    await user.click(await screen.findByRole("option", { name: /^Opus/ }))

    await waitFor(() =>
      expect(setCalls()).toEqual([
        { aiModels: { claude: "opus", codex: "gpt-5.5" } },
      ])
    )
  })

  it("saves a custom model on Enter, and never an invalid one", async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(
      await screen.findByRole("combobox", { name: "Default claude model" })
    )
    await user.click(await screen.findByRole("option", { name: "Custom…" }))

    const field = screen.getByRole("textbox", { name: "Custom claude model" })
    await user.type(field, "-p{Enter}")
    expect(screen.getByRole("alert")).toBeVisible()
    expect(setCalls()).toEqual([])

    await user.clear(field)
    await user.type(field, "claude-opus-5-5{Enter}")
    await waitFor(() =>
      expect(setCalls()).toEqual([
        { aiModels: { claude: "claude-opus-5-5", codex: "gpt-5.5" } },
      ])
    )
  })
})
