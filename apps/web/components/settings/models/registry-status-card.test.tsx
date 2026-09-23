// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

/**
 * The registry card: which registry is in force and where it came from, a
 * Reload that says how it went, the remote switch and URL, and every
 * skipped mapping or fetch failure in plain words.
 *
 * ⛔ Every channel is stubbed; `registry:reload` here is a mock, and in the
 * app it is only ever free `GET`s of static JSON.
 */
import type { IpcChannel, RegistryStatus, Settings } from "@opendirect/contract"
import { cleanup, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders, settings, status } from "./test-utils"

const invoke = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ipc", () => ({
  invoke,
  isBridgeAvailable: () => true,
  pathsForFiles: () => [],
  subscribe: () => () => {},
}))

const { RegistryStatusCard, describeRegistry } =
  await import("./registry-status-card")

let current: { status: RegistryStatus; settings: Settings }
let reload: () => Promise<RegistryStatus>

beforeEach(() => {
  current = { status: status(), settings: settings() }
  reload = async () => current.status
  invoke.mockReset()
  invoke.mockImplementation(async (channel: IpcChannel, input: unknown) => {
    switch (channel) {
      case "registry:status":
        return current.status
      case "registry:reload":
        return reload()
      case "settings:get":
        return current.settings
      case "settings:set":
        current.settings = { ...current.settings, ...(input as object) }
        return current.settings
      default:
        return { ok: true }
    }
  })
})

afterEach(cleanup)

describe("describeRegistry", () => {
  const now = 1_000_000_000

  it("names a bundled registry plainly", () => {
    expect(describeRegistry(status(), now)).toBe("v1 · bundled with the app")
  })

  it("says a remote registry came from GitHub and when it was checked", () => {
    expect(
      describeRegistry(
        status({
          activeVersion: 12,
          activeSource: "remote",
          remote: {
            ...status().remote,
            version: 12,
            fetchedAt: now - 3 * 60_000,
          },
        }),
        now
      )
    ).toBe("v12 · from GitHub (remote) · checked 3 min ago")
  })

  it("says when GitHub was checked even if the bundled copy stayed newer", () => {
    expect(
      describeRegistry(
        status({
          remote: { ...status().remote, version: 1, fetchedAt: now - 10_000 },
        }),
        now
      )
    ).toBe("v1 · bundled with the app · GitHub checked just now")
  })
})

describe("RegistryStatusCard", () => {
  it("shows the version and where it came from", async () => {
    renderWithProviders(<RegistryStatusCard />)
    expect(await screen.findByText("v1 · bundled with the app")).toBeVisible()
  })

  it("reloads the registry and says so while it works", async () => {
    const user = userEvent.setup()
    let finish: (value: RegistryStatus) => void = () => {}
    reload = () =>
      new Promise<RegistryStatus>((resolve) => {
        finish = resolve
      })
    renderWithProviders(<RegistryStatusCard />)

    await user.click(
      await screen.findByRole("button", { name: "Reload registry" })
    )

    expect(invoke).toHaveBeenCalledWith("registry:reload")
    expect(
      await screen.findByRole("button", { name: /Reloading/ })
    ).toHaveAttribute("aria-disabled", "true")

    finish(status({ activeVersion: 3, activeSource: "remote" }))
    expect(
      await screen.findByRole("button", { name: "Reload registry" })
    ).not.toHaveAttribute("aria-disabled", "true")
    expect(await screen.findByText(/Reloaded/)).toBeInTheDocument()
  })

  it("cannot reload from GitHub while fetching is switched off", async () => {
    current.settings = settings({ remoteRegistry: false })
    current.status = status({
      remote: { ...status().remote, enabled: false },
    })
    renderWithProviders(<RegistryStatusCard />)

    const button = await screen.findByRole("button", {
      name: "Reload registry",
    })
    await waitFor(() => expect(button).toHaveAttribute("aria-disabled", "true"))
    expect(button).toHaveAccessibleDescription(
      /Turn on Fetch updates from GitHub/
    )
  })

  it("switches fetching from GitHub off", async () => {
    const user = userEvent.setup()
    renderWithProviders(<RegistryStatusCard />)

    const toggle = await screen.findByRole("switch", {
      name: "Fetch updates from GitHub",
    })
    await waitFor(() => expect(toggle).toBeChecked())
    await user.click(toggle)

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("settings:set", {
        remoteRegistry: false,
      })
    )
  })

  it("lists every skipped mapping when asked", async () => {
    const user = userEvent.setup()
    current.status = status({
      warnings: [
        {
          source: "remote",
          familyId: "kling-v3",
          message: "endpoints.0.provider: not a provider",
        },
        { source: "user", familyId: null, message: "id is missing" },
      ],
    })
    renderWithProviders(<RegistryStatusCard />)

    expect(await screen.findByText("2 mappings were skipped")).toBeVisible()
    expect(
      screen.queryByText(/endpoints\.0\.provider: not a provider/)
    ).toBeNull()

    await user.click(screen.getByRole("button", { name: /Show details/ }))

    const list = await screen.findByRole("list", { name: "Skipped mappings" })
    const items = within(list).getAllByRole("listitem")
    expect(items[0]).toHaveTextContent(
      "GitHub · kling-v3 · endpoints.0.provider: not a provider"
    )
    expect(items[1]).toHaveTextContent("Your mappings · id is missing")
  })

  it("shows a failed fetch and what is in force instead", async () => {
    current.status = status({
      remote: { ...status().remote, error: "HTTP 404 for index.json" },
    })
    renderWithProviders(<RegistryStatusCard />)

    const alert = await screen.findByText("Could not fetch the remote registry")
    const box = alert.closest('[data-slot="alert"]') as HTMLElement
    expect(box).toHaveTextContent("HTTP 404 for index.json")
    expect(box).toHaveTextContent("Using the bundled registry")
  })

  it("saves a custom registry URL on blur, and refuses one that is not https", async () => {
    const user = userEvent.setup()
    renderWithProviders(<RegistryStatusCard />)

    await user.click(
      await screen.findByRole("button", { name: /Registry URL/ })
    )
    const input = await screen.findByRole("textbox", { name: "Registry URL" })

    await user.type(input, "http://example.test/registry")
    await user.tab()
    expect(await screen.findByText(/must start with https:\/\//)).toBeVisible()
    expect(invoke).not.toHaveBeenCalledWith(
      "settings:set",
      expect.objectContaining({ registryUrl: expect.anything() })
    )

    await user.clear(input)
    await user.type(input, "https://example.test/registry")
    await user.tab()
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("settings:set", {
        registryUrl: "https://example.test/registry",
      })
    )

    await user.click(screen.getByRole("button", { name: "Reset" }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("settings:set", { registryUrl: null })
    )
  })
})
