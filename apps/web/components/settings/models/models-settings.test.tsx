// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

/**
 * The Models tab as a whole: its three parts, and the one door into the
 * mapping editor — from New mapping, from a row, or from `?map=<modelKey>`.
 *
 * ⛔ Every channel is stubbed; nothing here reaches a provider.
 */
import { createElement, type ReactNode } from "react"
import type { IpcChannel } from "@opendirect/contract"
import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  entry,
  keys,
  renderWithProviders,
  settings,
  status,
} from "./test-utils"

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

const { ModelsSettings } = await import("./models-settings")

beforeEach(() => {
  invoke.mockReset()
  invoke.mockImplementation(async (channel: IpcChannel) => {
    switch (channel) {
      case "registry:status":
        return status()
      case "registry:families":
        return [entry()]
      case "registry:overrides:list":
        return []
      case "settings:get":
        return settings()
      case "settings:keys:summary":
        return keys({ replicate: true })
      default:
        return { ok: true }
    }
  })
})

afterEach(cleanup)

describe("ModelsSettings", () => {
  it("shows the registry, the provider order and the mappings", async () => {
    renderWithProviders(<ModelsSettings />)

    expect(await screen.findByText("Model registry")).toBeVisible()
    expect(screen.getByText("Provider preference")).toBeVisible()
    expect(
      screen.getByRole("heading", { name: "Model mappings" })
    ).toBeVisible()
    expect(await screen.findByText("Seedance 2.5")).toBeVisible()
  })

  it("opens the mapping editor from New mapping", async () => {
    const user = userEvent.setup()
    renderWithProviders(<ModelsSettings />)

    await user.click(await screen.findByRole("button", { name: "New mapping" }))

    expect(
      await screen.findByRole("dialog", { name: "New mapping" })
    ).toBeVisible()
  })

  it("opens the editor for the model a ?map= link names, once", async () => {
    const user = userEvent.setup()
    const onEditorClosed = vi.fn()
    renderWithProviders(
      <ModelsSettings
        mapModelKey="replicate:kwaivgi/kling-v3"
        onEditorClosed={onEditorClosed}
      />
    )

    const dialog = await screen.findByRole("dialog", { name: "New mapping" })
    expect(dialog).toHaveTextContent("replicate:kwaivgi/kling-v3")

    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(onEditorClosed).toHaveBeenCalledTimes(1)
  })
})
