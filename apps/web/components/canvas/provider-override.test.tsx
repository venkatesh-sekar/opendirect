// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

/**
 * The per-node provider override: which providers it offers, which it
 * refuses and why, and what choosing one reports. Presentational — the node
 * write is the prompt bar's (see `prompt-bar.test.tsx`).
 */
import type { FamilyInfo } from "@opendirect/contract"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { seedanceFamilyDescriptor } from "@/lib/canvas/test-family"

import { ProviderOverride } from "./provider-override"

function familyOf(
  options: Parameters<typeof seedanceFamilyDescriptor>[0] = {}
): FamilyInfo {
  return seedanceFamilyDescriptor(options).family!
}

function renderControl(
  props: Partial<Parameters<typeof ProviderOverride>[0]> = {}
) {
  const onChange = vi.fn()
  render(
    <TooltipProvider>
      <ProviderOverride
        family={familyOf()}
        value={null}
        filled={[]}
        onChange={onChange}
        {...props}
      />
    </TooltipProvider>
  )
  return { onChange }
}

afterEach(cleanup)

describe("ProviderOverride", () => {
  it("names the provider Auto resolves to", () => {
    renderControl()
    const trigger = screen.getByRole("combobox", { name: /provider/i })
    expect(trigger).toHaveTextContent("Auto · Replicate")
  })

  it("offers Auto and each provider the family runs on", async () => {
    const user = userEvent.setup()
    renderControl()
    await user.click(screen.getByRole("combobox", { name: /provider/i }))

    expect(
      (await screen.findAllByRole("option")).map((one) => one.textContent)
    ).toEqual(["Auto · Replicate", "Replicate", "OpenRouter"])
  })

  it("reports the choice, and Auto as null", async () => {
    const user = userEvent.setup()
    const { onChange } = renderControl()
    await user.click(screen.getByRole("combobox", { name: /provider/i }))
    await user.click(await screen.findByRole("option", { name: "OpenRouter" }))
    expect(onChange).toHaveBeenLastCalledWith("openrouter")

    cleanup()
    const second = renderControl({
      family: familyOf({ override: "openrouter" }),
      value: "openrouter",
    })
    await user.click(screen.getByRole("combobox", { name: /provider/i }))
    await user.click(await screen.findByRole("option", { name: /^Auto/ }))
    expect(second.onChange).toHaveBeenLastCalledWith(null)
  })

  it("refuses a provider with no key, and says to add one", async () => {
    const user = userEvent.setup()
    renderControl({ family: familyOf({ configured: ["replicate"] }) })
    await user.click(screen.getByRole("combobox", { name: /provider/i }))

    const openrouter = await screen.findByRole("option", {
      name: /OpenRouter/,
    })
    expect(openrouter).toHaveAttribute("aria-disabled", "true")
    expect(openrouter).toHaveTextContent("Add key")
  })

  it("says why the chosen endpoint cannot run", () => {
    // An override kept after its key was removed.
    renderControl({
      family: familyOf({ configured: ["replicate"], override: "openrouter" }),
      value: "openrouter",
    })
    const trigger = screen.getByRole("combobox", { name: /provider/i })
    expect(trigger).toHaveAttribute("aria-invalid", "true")
    // Visible too, not only to a screen reader or on hover.
    expect(trigger).toHaveClass("text-destructive", "border-destructive")
    expect(trigger).toHaveAccessibleDescription(
      /Add an OpenRouter key in Settings/
    )
  })

  it("is not tinted when the choice can run", () => {
    renderControl()
    expect(screen.getByRole("combobox", { name: /provider/i })).not.toHaveClass(
      "text-destructive"
    )
  })

  it("is an icon with a name when compact", () => {
    renderControl({ compact: true })
    const trigger = screen.getByRole("combobox", {
      name: "Provider: Auto · Replicate",
    })
    expect(trigger).toHaveAttribute("title", "Provider: Auto · Replicate")
    expect(trigger).toHaveTextContent(/^$/)
  })
})
