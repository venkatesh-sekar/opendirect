// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

/**
 * Provider preference: the order a family model tries providers in, saved
 * the moment it changes, reorderable without a pointer, and honest about
 * which providers can actually run anything (planning decision 4).
 *
 * ⛔ Every channel is stubbed; nothing here reaches a provider.
 */
import { createElement, type ReactNode } from "react"
import type { IpcChannel, KeysSummary, Settings } from "@opendirect/contract"
import { cleanup, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { keys, renderWithProviders, settings } from "./test-utils"

const invoke = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ipc", () => ({
  invoke,
  isBridgeAvailable: () => true,
  pathsForFiles: () => [],
  subscribe: () => () => {},
}))

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

const { ProviderOrder } = await import("./provider-order")

let current: { settings: Settings; keys: KeysSummary }

beforeEach(() => {
  current = {
    settings: settings(),
    keys: keys({ replicate: true, openrouter: false }),
  }
  invoke.mockReset()
  invoke.mockImplementation(async (channel: IpcChannel, input: unknown) => {
    switch (channel) {
      case "settings:get":
        return current.settings
      case "settings:set":
        current.settings = { ...current.settings, ...(input as object) }
        return current.settings
      case "settings:keys:summary":
        return current.keys
      default:
        return { ok: true }
    }
  })
})

afterEach(cleanup)

function rows() {
  return within(
    screen.getByRole("list", { name: "Provider order" })
  ).getAllByRole("listitem")
}

describe("ProviderOrder", () => {
  it("lists providers in the saved order", async () => {
    current.settings = settings({ providerOrder: ["openrouter", "replicate"] })
    renderWithProviders(<ProviderOrder />)

    await waitFor(() => expect(rows()[0]).toHaveTextContent("OpenRouter"))
    expect(rows()[1]).toHaveTextContent("Replicate")
  })

  it("appends a provider the saved order leaves out, as main does", async () => {
    current.settings = settings({ providerOrder: ["openrouter"] })
    renderWithProviders(<ProviderOrder />)

    await waitFor(() => expect(rows()).toHaveLength(2))
    expect(rows()[1]).toHaveTextContent("Replicate")
  })

  it("moves OpenRouter up with a button and saves the new order at once", async () => {
    const user = userEvent.setup()
    renderWithProviders(<ProviderOrder />)

    await user.click(
      await screen.findByRole("button", { name: "Move OpenRouter up" })
    )

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("settings:set", {
        providerOrder: ["openrouter", "replicate"],
      })
    )
    await waitFor(() => expect(rows()[0]).toHaveTextContent("OpenRouter"))
    expect(
      await screen.findByText("OpenRouter moved to position 1.")
    ).toBeInTheDocument()
  })

  it("cannot move the first provider up or the last one down", async () => {
    renderWithProviders(<ProviderOrder />)

    expect(
      await screen.findByRole("button", { name: "Move Replicate up" })
    ).toHaveAttribute("aria-disabled", "true")
    expect(
      screen.getByRole("button", { name: "Move OpenRouter down" })
    ).toHaveAttribute("aria-disabled", "true")
  })

  it("says No key for a provider without one and links to add it", async () => {
    renderWithProviders(<ProviderOrder />)

    await waitFor(() => expect(rows()[1]).toHaveTextContent("No key"))
    const row = rows()[1]!
    expect(row).toHaveAttribute("data-configured", "false")
    expect(within(row).getByRole("link", { name: /Add key/ })).toHaveAttribute(
      "href",
      "/settings?tab=providers"
    )
    expect(rows()[0]).not.toHaveTextContent("No key")
    expect(rows()[0]).toHaveAttribute("data-configured", "true")
  })

  it("marks which configured provider runs first", async () => {
    current.settings = settings({ providerOrder: ["openrouter", "replicate"] })
    renderWithProviders(<ProviderOrder />)

    await waitFor(() => expect(rows()[1]).toHaveTextContent("Used first"))
    expect(rows()[0]).not.toHaveTextContent("Used first")
  })
})
