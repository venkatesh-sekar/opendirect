// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

/**
 * The field mapping table: one row per schema field, what it maps to, and
 * the details of that choice. Driven through a real reducer, so what the
 * table dispatches is checked by what the state becomes.
 *
 * ⛔ No IPC at all; the descriptor is built from a recorded fixture.
 */
import { useEffect, useReducer } from "react"
import { cleanup, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  editorReducer,
  emptyEditor,
  validateEditor,
  type EditorState,
} from "@/lib/registry/editor-state"
import { seedanceDescriptor } from "@/lib/registry/test-descriptors"

import { FieldMappingTable } from "./field-mapping-table"
import { renderWithProviders } from "./test-utils"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

beforeEach(() => {
  toast.success.mockReset()
})

afterEach(cleanup)

function loaded(): EditorState {
  const added = editorReducer(emptyEditor(), {
    type: "addEndpoint",
    provider: "replicate",
    model: "bytedance/seedance-2.5",
  })
  return editorReducer(added, {
    type: "endpointLoaded",
    index: 0,
    descriptor: seedanceDescriptor(),
  })
}

let latest: EditorState

function Harness({ init = loaded }: { init?: () => EditorState }) {
  const [state, dispatch] = useReducer(editorReducer, undefined, init)
  useEffect(() => {
    latest = state
  })
  return (
    <FieldMappingTable
      endpoint={state.endpoints[0]!}
      index={0}
      issues={validateEditor(state)}
      dispatch={dispatch}
    />
  )
}

function rowFor(field: string): HTMLElement {
  return screen.getByRole("row", { name: new RegExp(`^${field}\\b`) })
}

function target(field: string) {
  return latest.endpoints[0]!.rows.find((r) => r.field === field)!.target
}

describe("FieldMappingTable", () => {
  it("is a real table with a row per schema field", () => {
    renderWithProviders(<Harness />)
    const table = screen.getByRole("table", { name: /fields of/i })
    expect(within(table).getAllByRole("columnheader")).toHaveLength(4)
    expect(rowFor("image")).toHaveTextContent("uri")
    expect(rowFor("aspect_ratio")).toHaveTextContent("enum(7)")
    expect(rowFor("reference_images")).toHaveTextContent("uri[]")
  })

  it("marks a pre-filled row as suggested, with how sure it is", () => {
    renderWithProviders(<Harness />)
    expect(rowFor("image")).toHaveTextContent(/suggested/i)
    expect(rowFor("image")).toHaveTextContent(/description/i)
  })

  it("disables the Inputs group for a scalar field", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />)

    await user.click(screen.getByRole("combobox", { name: "Maps to for seed" }))
    const character = await screen.findByRole("option", {
      name: /^Character/,
    })
    expect(character).toHaveAttribute("aria-disabled", "true")
    expect(
      screen.getByText(/only file\/url fields can be inputs/i)
    ).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /^Seed/ })).not.toHaveAttribute(
      "aria-disabled",
      "true"
    )
  })

  it("explains each role in the picker, so the choice reads as a question", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />)

    await user.click(
      screen.getByRole("combobox", { name: "Maps to for reference_images" })
    )
    expect(
      await screen.findByText(/what does this input control/i)
    ).toBeInTheDocument()
    expect(
      screen.getByRole("option", { name: /^Character/ })
    ).toHaveTextContent("identity, such as a person")
    await user.click(screen.getByRole("option", { name: /^Character/ }))
    expect(target("reference_images")).toMatchObject({
      kind: "input",
      key: "character",
    })
    expect(rowFor("reference_images")).toHaveTextContent(/Suggested: Reference/)
  })

  it("moves a control already used by another row", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />)

    await user.click(
      screen.getByRole("combobox", { name: "Maps to for output_format" })
    )
    const prompt = await screen.findByRole("option", { name: /^Prompt/ })
    expect(prompt).toHaveTextContent("(used by prompt)")
    await user.click(prompt)

    expect(target("output_format")).toEqual({
      kind: "control",
      control: "prompt",
    })
    expect(target("prompt")).toEqual({ kind: "advanced" })
  })

  it("writes values from the value-map editor", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />)

    await user.click(
      within(rowFor("aspect_ratio")).getByRole("button", { name: /values/i })
    )
    const editor = await screen.findByRole("dialog", {
      name: /values for aspect ratio/i,
    })
    await user.click(within(editor).getByRole("button", { name: "Add value" }))
    await user.type(
      within(editor).getByRole("combobox", { name: "Canonical value 1" }),
      "wide"
    )
    await user.click(
      within(editor).getByRole("combobox", { name: "Provider value 1" })
    )
    await user.click(await screen.findByRole("option", { name: "21:9" }))

    expect(target("aspect_ratio")).toEqual({
      kind: "control",
      control: "aspect_ratio",
      values: { wide: "21:9" },
    })
  })

  it("keeps half a value pair and says what it needs", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />)

    await user.click(
      within(rowFor("aspect_ratio")).getByRole("button", { name: /values/i })
    )
    const editor = await screen.findByRole("dialog", {
      name: /values for aspect ratio/i,
    })
    await user.click(within(editor).getByRole("button", { name: "Add value" }))
    await user.type(
      within(editor).getByRole("combobox", { name: "Canonical value 1" }),
      "wide"
    )
    expect(within(editor).getByText(/Pick what to send/)).toBeVisible()
    expect(
      within(editor).getByRole("combobox", { name: "Canonical value 1" })
    ).toHaveValue("wide")
  })

  it("fills the value map from the field's own values", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />)

    await user.click(
      within(rowFor("resolution")).getByRole("button", { name: /values/i })
    )
    const editor = await screen.findByRole("dialog", {
      name: /values for resolution/i,
    })
    await user.click(
      within(editor).getByRole("button", { name: /start from the field/i })
    )
    expect(target("resolution")).toEqual({
      kind: "control",
      control: "resolution",
      values: { "480p": "480p", "720p": "720p" },
    })
  })

  it("edits an input's details: required and label", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />)

    await user.click(screen.getByRole("button", { name: /^Details for image/ }))
    await user.click(screen.getByRole("switch", { name: "Required for image" }))
    const label = screen.getByRole("textbox", { name: "Label for image" })
    await user.clear(label)
    await user.type(label, "Opening shot")
    expect(target("image")).toMatchObject({
      kind: "input",
      input: { required: true, label: "Opening shot" },
    })
  })

  it("shows a row's problem under that row", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />)

    await user.click(
      screen.getByRole("button", { name: /^Details for reference_images/ })
    )
    const max = screen.getByRole("spinbutton", {
      name: "Max for reference_images",
    })
    await user.clear(max)
    await user.type(max, "0")
    expect(rowFor("reference_images")).toHaveTextContent(
      "Max must be 1 or more."
    )

    await user.click(screen.getByRole("button", { name: /^Problems/ }))
    expect(screen.getAllByRole("row", { name: /^[a-z_]+$/ })).toHaveLength(1)
    expect(rowFor("reference_images")).toBeVisible()
  })

  it("keeps an input's details folded into a summary until opened", () => {
    renderWithProviders(<Harness />)
    expect(
      screen.queryByRole("switch", { name: "Required for image" })
    ).toBeNull()
    expect(
      screen.getByRole("button", { name: /^Details for reference_images/ })
    ).toHaveTextContent(/Image.*30/)
  })

  it("finds fields by name or description", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />)

    await user.type(
      screen.getByRole("searchbox", { name: "Search fields" }),
      "lip-sync"
    )
    expect(screen.getAllByRole("row", { name: /^[a-z_]+$/ })).toHaveLength(1)
    expect(rowFor("reference_audios")).toBeVisible()
  })

  it("draws a row whose slot key is not a role without failing", () => {
    function broken(): EditorState {
      const state = loaded()
      const endpoint = state.endpoints[0]!
      const rows = endpoint.rows.map((r) =>
        r.field === "reference_images"
          ? {
              ...r,
              target: {
                kind: "input" as const,
                key: "charcter",
                input: { field: "reference_images", kind: "image" as const },
              },
            }
          : r
      )
      return { ...state, endpoints: [{ ...endpoint, rows }] }
    }
    renderWithProviders(<Harness init={broken} />)
    expect(
      screen.getByRole("combobox", { name: "Maps to for reference_images" })
    ).toHaveTextContent("Reference")
  })

  it("filters to inputs only", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />)

    await user.click(screen.getByRole("button", { name: "Inputs only" }))
    expect(screen.queryByRole("row", { name: /^seed\b/ })).toBeNull()
    expect(rowFor("image")).toBeVisible()
  })

  it("applies all suggestions and resets", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />)

    await user.click(
      screen.getByRole("combobox", { name: "Maps to for image" })
    )
    await user.click(await screen.findByRole("option", { name: /^Advanced/ }))
    expect(target("image")).toEqual({ kind: "advanced" })
    await user.click(screen.getByRole("button", { name: "Reset endpoint" }))
    expect(target("image")).toMatchObject({ key: "first_frame" })
  })

  it("can undo Apply all suggestions", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />)
    await user.click(screen.getByRole("combobox", { name: "Maps to for seed" }))
    await user.click(await screen.findByRole("option", { name: /^Advanced/ }))
    await user.click(
      screen.getByRole("combobox", { name: "Maps to for watermark" })
    )
    await user.click(await screen.findByRole("option", { name: /^Seed/ }))
    await user.click(screen.getByRole("button", { name: "Reset endpoint" }))
    expect(target("watermark")).toEqual({ kind: "advanced" })

    const [, options] = toast.success.mock.calls.at(-1)!
    ;(options as { action: { onClick: () => void } }).action.onClick()
    await screen.findByRole("combobox", { name: "Maps to for watermark" })
    expect(target("watermark")).toEqual({ kind: "control", control: "seed" })
  })
})
