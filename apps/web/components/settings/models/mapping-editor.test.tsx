// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

/**
 * The mapping editor end to end: pick a model, get a pre-filled mapping,
 * save exactly the family the rows describe; refuse to save an invalid one;
 * copy the canonical JSON; guard unsaved work; open from `?map=`; import.
 *
 * ⛔ Every channel is stubbed. `models:get` returns a descriptor built from
 * a recorded fixture; nothing reaches a provider.
 */
import { createElement, type ReactNode } from "react"
import {
  formatFamilyJson,
  modelFamilySchema,
  suggestEndpointMapping,
  type IpcChannel,
  type ModelFamily,
  type ModelSummary,
  type UserOverride,
} from "@opendirect/contract"
import { cleanup, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { MappingEditorRequest } from "@/lib/registry/editor-request"
import { seedanceDescriptor } from "@/lib/registry/test-descriptors"

import {
  family,
  keys,
  override,
  renderWithProviders,
  settings,
  status,
} from "./test-utils"

const invoke = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock("sonner", () => ({ toast }))

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

const { MappingEditor } = await import("./mapping-editor")
const { ModelsSettings } = await import("./models-settings")

const seedanceSummary: ModelSummary = {
  key: "replicate:bytedance/seedance-2.5",
  provider: "replicate",
  slug: "bytedance/seedance-2.5",
  name: "Seedance 2.5",
  description: null,
  kind: "video",
  coverImageUrl: null,
  priceHint: null,
}

function saved(family: unknown): UserOverride {
  const parsed = modelFamilySchema.parse(family)
  return override({ family: parsed, id: parsed.id, raw: family })
}

beforeEach(() => {
  invoke.mockReset()
  toast.success.mockReset()
  toast.error.mockReset()
  invoke.mockImplementation(async (channel: IpcChannel, input: unknown) => {
    switch (channel) {
      case "models:list":
        return { models: [seedanceSummary], failures: [] }
      case "models:get":
        return seedanceDescriptor()
      case "registry:families":
        return []
      case "registry:overrides:list":
        return []
      case "registry:status":
        return status()
      case "registry:overrides:save":
        return {
          ok: true,
          override: saved((input as { family: unknown }).family),
        }
      case "settings:get":
        return settings()
      case "settings:keys:summary":
        return keys({ replicate: true })
      default:
        return { ok: true }
    }
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function open(request: MappingEditorRequest, onClose = vi.fn()) {
  renderWithProviders(<MappingEditor request={request} onClose={onClose} />)
  return onClose
}

async function pickSeedance(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /add endpoint/i }))
  await user.click(await screen.findByRole("option", { name: /Seedance 2\.5/ }))
}

async function waitForRows() {
  return screen.findByRole("combobox", { name: "Maps to for image" })
}

describe("MappingEditor", () => {
  it("maps a new model from its schema and saves exactly that family", async () => {
    const user = userEvent.setup()
    const onClose = open({ from: { kind: "blank" } })

    expect(
      await screen.findByRole("dialog", { name: "New mapping" })
    ).toBeVisible()
    await pickSeedance(user)

    expect(await waitForRows()).toHaveTextContent("First frame")
    expect(
      screen.getByText(/pre-filled from the model's schema/i)
    ).toBeVisible()
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "Seedance 2.5"
    )

    const save = screen.getByRole("button", { name: "Save mapping" })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "registry:overrides:save",
        expect.anything()
      )
    )
    const payload = invoke.mock.calls.find(
      ([channel]) => channel === "registry:overrides:save"
    )![1] as { family: ModelFamily; replaceId: string | null }
    const suggested = suggestEndpointMapping(seedanceDescriptor()).endpoint
    expect(payload.replaceId).toBeNull()
    expect(modelFamilySchema.parse(payload.family)).toEqual(
      modelFamilySchema.parse({
        id: "seedance-2-5",
        name: "Seedance 2.5",
        kind: "video",
        endpoints: [suggested],
      })
    )
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("Saved"),
      expect.anything()
    )
  })

  it("will not save with an invalid id, and says why", async () => {
    const user = userEvent.setup()
    open({ from: { kind: "blank" } })
    await pickSeedance(user)
    await waitForRows()

    const id = screen.getByRole("textbox", { name: "ID" })
    await user.clear(id)
    await user.type(id, "Bad Id")

    expect(screen.getByRole("button", { name: "Save mapping" })).toBeDisabled()
    expect(
      screen.getByText(/lowercase letters, digits and dashes/i)
    ).toBeVisible()
    expect(screen.getByText(/1 problem/i)).toBeVisible()
  })

  it("copies the canonical JSON", async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    const source = family()
    const copy = { ...structuredClone(source), id: "seedance-2-5-custom" }
    open({ from: { kind: "duplicate", source, family: copy } })
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })

    expect(
      await screen.findByRole("dialog", { name: "Duplicate of Seedance 2.5" })
    ).toBeVisible()
    await waitForRows()
    const button = screen.getByRole("button", { name: "Copy JSON" })
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)

    expect(writeText).toHaveBeenCalledWith(
      formatFamilyJson(modelFamilySchema.parse(copy))
    )
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("Copied"),
      expect.objectContaining({
        description: expect.stringContaining(
          "registry/models/seedance-2-5-custom.json"
        ),
      })
    )
  })

  it("asks before discarding changes", async () => {
    const user = userEvent.setup()
    const onClose = open({ from: { kind: "blank" } })
    await user.type(
      await screen.findByRole("textbox", { name: "Name" }),
      "Mine"
    )
    await user.keyboard("{Escape}")

    const confirm = await screen.findByRole("alertdialog", {
      name: "Discard changes?",
    })
    expect(onClose).not.toHaveBeenCalled()
    await user.click(within(confirm).getByRole("button", { name: "Discard" }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it("shows the save's own refusal under the row it is about", async () => {
    const user = userEvent.setup()
    invoke.mockImplementation(async (channel: IpcChannel) => {
      switch (channel) {
        case "models:list":
          return { models: [seedanceSummary], failures: [] }
        case "models:get":
          return seedanceDescriptor()
        case "registry:families":
        case "registry:overrides:list":
          return []
        case "registry:overrides:save":
          return {
            ok: false,
            issues: [
              {
                path: "endpoints.0.inputs.first_frame.field",
                message: "Main says no.",
              },
            ],
          }
        case "settings:get":
          return settings()
        case "settings:keys:summary":
          return keys({ replicate: true })
        default:
          return { ok: true }
      }
    })
    const onClose = open({ from: { kind: "blank" } })
    await pickSeedance(user)
    await waitForRows()
    const save = screen.getByRole("button", { name: "Save mapping" })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)

    expect(await screen.findByRole("row", { name: "image" })).toHaveTextContent(
      "Main says no."
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it("edits a stored mapping and saves over it", async () => {
    const user = userEvent.setup()
    const stored = override({ family: family({ id: "mine", name: "Mine" }) })
    open({ from: { kind: "override", override: stored } })

    expect(
      await screen.findByRole("dialog", { name: "Edit Mine" })
    ).toBeVisible()
    await waitForRows()
    const name = screen.getByRole("textbox", { name: "Name" })
    await user.clear(name)
    await user.type(name, "Mine 2")
    const save = screen.getByRole("button", { name: "Save mapping" })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "registry:overrides:save",
        expect.objectContaining({ replaceId: "mine" })
      )
    )
  })

  it("lets the person choose among several imported mappings", async () => {
    const user = userEvent.setup()
    const one = override({
      key: "a",
      family: family({ id: "one", name: "One" }),
    })
    const two = override({
      key: "b",
      family: family({ id: "two", name: "Two" }),
    })
    open({ from: { kind: "import", candidates: [one, two] } })

    await user.click(await screen.findByRole("button", { name: /Two/ }))
    expect(await screen.findByRole("textbox", { name: "Name" })).toHaveValue(
      "Two"
    )
  })
})

describe("ModelsSettings → mapping editor", () => {
  it("opens on the model a ?map= link names, with that endpoint loading", async () => {
    renderWithProviders(
      <ModelsSettings mapModelKey="replicate:bytedance/seedance-2.5" />
    )

    const dialog = await screen.findByRole("dialog", { name: "New mapping" })
    expect(dialog).toHaveTextContent("bytedance/seedance-2.5")
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "models:get",
        expect.objectContaining({ key: "replicate:bytedance/seedance-2.5" })
      )
    )
    expect(await waitForRows()).toHaveTextContent("First frame")
  })
})
