// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import type { CostQuote } from "@opendirect/contract"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(cleanup)

import { UnknownCostNotice } from "./unknown-cost-notice"

const wan = { provider: "openrouter", slug: "alibaba/wan-3.0" } as const

const noDuration: CostQuote = {
  amount: 0,
  currency: "USD",
  basis: "per_second",
  confidence: "unknown",
  source: "none",
  note: "Pick a duration to see an estimated cost for this model.",
  sku: "duration_seconds_1080p",
  rate: { amount: 0.2, unit: "second" },
}

describe("UnknownCostNotice", () => {
  it("names the rate a model is billed at when only the duration is missing", () => {
    render(
      <UnknownCostNotice
        quote={noDuration}
        descriptor={wan}
        checked={false}
        onCheckedChange={() => {}}
      />
    )
    const box = screen.getByRole("checkbox", { name: /billed at \$0\.20\/s/ })
    expect(box).not.toBeChecked()
    expect(screen.queryByText(/pricing is unavailable/i)).toBeNull()
    expect(screen.getByText(/pick a duration/i)).toBeInTheDocument()
  })

  it("keeps the honest 'unavailable' wording, with the provider's page, when there is no rate", () => {
    render(
      <UnknownCostNotice
        quote={{ ...noDuration, rate: null, sku: null, note: null }}
        descriptor={{ provider: "replicate", slug: "someone/new-model" }}
        checked={false}
        onCheckedChange={() => {}}
      />
    )
    expect(
      screen.getByRole("checkbox", { name: /pricing is unavailable/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /see pricing on replicate/i })
    ).toHaveAttribute("href", "https://replicate.com/someone/new-model")
  })

  it("reports the acknowledgement and nothing else", async () => {
    const onCheckedChange = vi.fn()
    render(
      <UnknownCostNotice
        quote={noDuration}
        descriptor={wan}
        checked={false}
        onCheckedChange={onCheckedChange}
      />
    )
    await userEvent.click(screen.getByRole("checkbox"))
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })
})
