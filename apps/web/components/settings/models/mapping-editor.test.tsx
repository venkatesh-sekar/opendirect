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
  parseModelKey,
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

/** Per-test replies, consulted before the defaults. */
let handlers: Partial<Record<IpcChannel, (input: unknown) => unknown>>

/** A descriptor for any key, built on the recorded Seedance schema. */
function descriptorForKey(input: unknown) {
  const key = (input as { key: string }).key
  const parsed = parseModelKey(key)!
  return seedanceDescriptor({
    key,
    provider: parsed.provider,
    slug: parsed.slug,
  })
}

beforeEach(() => {
  handlers = {}
  invoke.mockReset()
  toast.success.mockReset()
  toast.error.mockReset()
  invoke.mockImplementation(async (channel: IpcChannel, input: unknown) => {
    const handler = handlers[channel]
    if (handler) return handler(input)
    switch (channel) {
      case "models:list":
        return { models: [seedanceSummary], failures: [] }
      case "models:get":
        return descriptorForKey(input)
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

  it("does not greet a blank mapping with errors, until asked for them", async () => {
    const user = userEvent.setup()
    open({ from: { kind: "blank" } })
    const name = await screen.findByRole("textbox", { name: "Name" })

    expect(name).not.toHaveAttribute("aria-invalid")
    expect(screen.getByRole("textbox", { name: "ID" })).not.toHaveAttribute(
      "aria-invalid"
    )
    expect(screen.queryByText(/Give the mapping a name/)).toBeNull()
    expect(screen.queryByText(/lowercase letters, digits/)).toBeNull()
    expect(screen.getByRole("button", { name: "Save mapping" })).toBeDisabled()

    await user.click(screen.getByRole("button", { name: /to fix/ }))
    expect(await screen.findByText(/Give the mapping a name/)).toBeVisible()
    await waitFor(() =>
      expect(["name", "id"]).toContain(
        document.activeElement?.getAttribute("data-issue-path")
      )
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

describe("MappingEditor, review fixes", () => {
  it("opens a stored mapping whose slot key is not a role, and says so", async () => {
    const stored = override({
      key: "bad",
      id: "bad",
      family: null,
      raw: {
        id: "bad",
        name: "Bad",
        kind: "video",
        endpoints: [
          {
            provider: "replicate",
            model: "bytedance/seedance-2.5",
            inputs: { charcter: { field: "reference_images", kind: "image" } },
            controls: {},
          },
        ],
      },
      issues: [{ path: "endpoints.0.inputs.charcter", message: "bad key" }],
    })
    open({ from: { kind: "override", override: stored } })

    const row = await screen.findByRole("row", { name: "reference_images" })
    expect(row).toHaveTextContent(/"charcter" is not a role/)
    expect(
      within(row).getByRole("combobox", {
        name: "Maps to for reference_images",
      })
    ).toHaveTextContent("Reference")
    expect(screen.getByRole("button", { name: "Save mapping" })).toBeDisabled()
  })

  it("does not call looking at another endpoint a change", async () => {
    const user = userEvent.setup()
    const base = family({ id: "mine", name: "Mine" })
    const two = {
      ...base,
      endpoints: [
        base.endpoints[0]!,
        { ...base.endpoints[0]!, provider: "openrouter" as const },
      ],
    }
    const onClose = open({
      from: { kind: "override", override: override({ family: two }) },
    })
    await waitForRows()
    await user.click(screen.getByRole("tab", { name: /OpenRouter/ }))
    await user.keyboard("{Escape}")

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("retries a schema that failed to load, and will not save it meanwhile", async () => {
    const user = userEvent.setup()
    let fail = true
    handlers["models:get"] = (input) => {
      if (fail) throw new Error("Replicate said 503")
      return descriptorForKey(input)
    }
    open({ from: { kind: "blank" } })
    await pickSeedance(user)

    expect(await screen.findByText("Replicate said 503")).toBeVisible()
    expect(screen.getByText(/didn't load, so it maps nothing/)).toBeVisible()
    expect(screen.getByRole("button", { name: "Save mapping" })).toBeDisabled()

    fail = false
    await user.click(screen.getByRole("button", { name: "Retry" }))
    expect(await waitForRows()).toHaveTextContent("First frame")
  })

  it("loads an endpoint again under a corrected slug", async () => {
    const user = userEvent.setup()
    handlers["models:get"] = (input) => {
      const key = (input as { key: string }).key
      if (key.endsWith("typo")) throw new Error("Not found")
      return descriptorForKey(input)
    }
    open({ from: { kind: "blank" } })
    await user.click(
      await screen.findByRole("button", { name: /add endpoint/i })
    )
    await user.click(
      await screen.findByRole("option", { name: /use a model slug/i })
    )
    const slug = await screen.findByRole("textbox", { name: "Model slug" })
    expect(slug).toHaveFocus()
    await user.type(slug, "bytedance/typo")
    await user.click(screen.getByRole("button", { name: "Add" }))

    expect(await screen.findByText("Not found")).toBeVisible()
    const fix = screen.getByRole("textbox", { name: "Model slug" })
    await user.clear(fix)
    await user.type(fix, "bytedance/seedance-2.5")
    await user.click(screen.getByRole("button", { name: "Load this slug" }))

    expect(await waitForRows()).toBeVisible()
  })

  it("warns, then asks, before replacing another custom mapping", async () => {
    const user = userEvent.setup()
    handlers["registry:overrides:list"] = () => [
      override({ key: "taken", family: family({ id: "seedance-2-5" }) }),
    ]
    open({ from: { kind: "blank" } })
    await pickSeedance(user)
    await waitForRows()
    const id = screen.getByRole("textbox", { name: "ID" })
    await waitFor(() => expect(id).toHaveValue("seedance-2-5-2"))

    await user.clear(id)
    await user.type(id, "seedance-2-5")
    expect(
      screen.getByText(/already have a custom mapping with this ID/)
    ).toBeVisible()
    const save = screen.getByRole("button", { name: "Save mapping" })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)

    const confirm = await screen.findByRole("alertdialog", {
      name: "Replace your mapping seedance-2-5?",
    })
    expect(invoke).not.toHaveBeenCalledWith(
      "registry:overrides:save",
      expect.anything()
    )
    await user.click(
      within(confirm).getByRole("button", { name: "Replace it" })
    )
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "registry:overrides:save",
        expect.anything()
      )
    )
  })

  it("jumps to the first problem", async () => {
    const user = userEvent.setup()
    open({ from: { kind: "blank" } })
    await pickSeedance(user)
    await waitForRows()
    const id = screen.getByRole("textbox", { name: "ID" })
    await user.clear(id)
    await user.type(id, "Bad Id")
    await user.click(screen.getByRole("tab", { name: /Replicate/ }))
    screen.getByRole("button", { name: "Save mapping" }).focus()

    await user.click(screen.getByRole("button", { name: /1 problem to fix/ }))
    await waitFor(() => expect(id).toHaveFocus())
  })

  it("saves and exports an unsaved mapping, and stays open", async () => {
    const user = userEvent.setup()
    handlers["registry:overrides:export"] = () => ({ path: "/tmp/x.json" })
    const onClose = open({
      from: {
        kind: "override",
        override: override({ family: family({ id: "mine", name: "Mine" }) }),
      },
    })
    await waitForRows()
    expect(screen.getByRole("button", { name: "Export JSON…" })).toBeEnabled()

    const name = screen.getByRole("textbox", { name: "Name" })
    await user.type(name, " 2")
    await user.click(screen.getByRole("button", { name: "Save & export…" }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("registry:overrides:export", {
        id: "mine",
      })
    )
    expect(invoke).toHaveBeenCalledWith(
      "registry:overrides:save",
      expect.anything()
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(
      await screen.findByRole("button", { name: "Export JSON…" })
    ).toBeEnabled()
  })

  it("marks catalog models whose provider has no key", async () => {
    const user = userEvent.setup()
    handlers["models:list"] = () => ({
      models: [
        seedanceSummary,
        {
          ...seedanceSummary,
          key: "openrouter:bytedance/seedance-2.5",
          provider: "openrouter",
        },
      ],
      failures: [],
    })
    open({ from: { kind: "blank" } })
    await user.click(
      await screen.findByRole("button", { name: /add endpoint/i })
    )
    const options = await screen.findAllByRole("option", {
      name: /Seedance 2\.5/,
    })
    const keyless = options.find((o) => /No key/.test(o.textContent ?? ""))
    expect(keyless).toHaveAttribute("aria-disabled", "true")
  })

  it("shows the preview from a bar below wide screens", async () => {
    const user = userEvent.setup()
    open({ from: { kind: "blank" } })
    await pickSeedance(user)
    await waitForRows()
    await user.click(screen.getByRole("button", { name: "Show preview" }))
    expect(
      screen.getAllByRole("list", { name: "Slots on the canvas" }).length
    ).toBeGreaterThan(0)
    expect(
      screen.getByRole("button", { name: "Hide preview" })
    ).toHaveAttribute("aria-expanded", "true")
  })
})
