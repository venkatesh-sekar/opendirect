// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

/**
 * The provider keys screen, from an unanswered summary to a key the user has
 * typed but not saved.
 *
 * ⛔ Every channel is stubbed. `settings:keys:verify` is the only one that
 * would reach a provider at all, and in main it reaches a *listing* endpoint;
 * here it reaches nothing.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { IpcChannel } from "@opendirect/contract"
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

const { ProviderKeysForm } = await import("./provider-keys-form")

const EMPTY = { present: false, last4: null, source: "none" as const }
const SAVED = { present: true, last4: "9f2a", source: "vault" as const }

/** The summary the screen reads, or a promise that never settles. */
let summary: unknown | "pending" = {
  replicate: EMPTY,
  openrouter: EMPTY,
  encryptionAvailable: true,
}

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ProviderKeysForm />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  summary = {
    replicate: EMPTY,
    openrouter: EMPTY,
    encryptionAvailable: true,
  }
  invoke.mockReset()
  invoke.mockImplementation(async (channel: IpcChannel) => {
    if (channel === "settings:keys:summary") {
      if (summary === "pending") return new Promise(() => {})
      return summary
    }
    if (channel === "settings:keys:verify") return { valid: true }
    return { ok: true }
  })
})

afterEach(cleanup)

describe("ProviderKeysForm", () => {
  /**
   * The rows used to paint their `{present: false}` fallback while the summary
   * was in flight, so a user who *had* saved a key was told "Not set" — a
   * false negative on the one piece of state this screen exists for.
   */
  it("shows a skeleton rather than 'Not set' while the summary loads", () => {
    summary = "pending"
    renderForm()

    expect(screen.getAllByTestId("provider-row-skeleton")).toHaveLength(2)
    expect(screen.queryByText("Not set")).toBeNull()
  })

  /**
   * "Test" used to check only the *stored* key, so paste → Test → Save — the
   * order everybody tries — was impossible: you had to save an unverified key
   * before you could find out whether it worked.
   */
  it("tests the key in the field before it has been saved", async () => {
    const user = userEvent.setup()
    renderForm()

    const field = await screen.findByLabelText("Replicate API key")
    const test = screen.getAllByRole("button", { name: /^test$/i })[0]!
    expect(test).toBeDisabled()

    await user.type(field, "r8_secret")

    const draftTest = await screen.findByRole("button", {
      name: "Test this key",
    })
    await user.click(draftTest)

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("settings:keys:verify", {
        provider: "replicate",
        key: "r8_secret",
      })
    )
    // ⛔ Testing a draft must not write it: Save is still the only thing that
    // reaches the vault.
    expect(
      invoke.mock.calls.some(([channel]) => channel === "settings:keys:set")
    ).toBe(false)
  })

  it("tests the stored key when the field is empty", async () => {
    const user = userEvent.setup()
    summary = { replicate: SAVED, openrouter: EMPTY, encryptionAvailable: true }
    renderForm()

    const test = (await screen.findAllByRole("button", { name: /^test$/i }))[0]!
    await waitFor(() => expect(test).toBeEnabled())
    await user.click(test)

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("settings:keys:verify", {
        provider: "replicate",
      })
    )
  })

  /** A rejected key has to be announced, not just coloured red. */
  it("announces a rejected key", async () => {
    const user = userEvent.setup()
    invoke.mockImplementation(async (channel: IpcChannel) => {
      if (channel === "settings:keys:summary") return summary
      if (channel === "settings:keys:verify") {
        return { valid: false, message: "The provider rejected this key." }
      }
      return { ok: true }
    })
    renderForm()

    await user.type(
      await screen.findByLabelText("Replicate API key"),
      "r8_wrong"
    )
    await user.click(screen.getByRole("button", { name: "Test this key" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("The provider rejected this key.")
  })
})
