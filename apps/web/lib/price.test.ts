import type { CostQuote } from "@opendirect/contract"
import { describe, expect, it } from "vitest"

import { formatCostQuote, formatPriceHint, formatUsd } from "./price"

describe("formatPriceHint", () => {
  it("says the price is unknown rather than showing a zero", () => {
    expect(formatPriceHint(null)).toBe("price unknown")
    expect(formatPriceHint(undefined)).toBe("price unknown")
    expect(formatPriceHint(null)).not.toContain("0.00")
  })

  it("marks a hand-transcribed Replicate rate as an estimate", () => {
    expect(
      formatPriceHint({
        amount: 0.1028,
        unit: "second",
        basis: "per_second",
        source: "local_table",
      })
    ).toBe("from $0.10/second est.")
  })

  it("does not mark a provider-published rate as an estimate", () => {
    expect(
      formatPriceHint({
        amount: 0.03,
        unit: "second",
        basis: "per_second",
        source: "provider_api",
      })
    ).toBe("from $0.03/second")
  })

  it("keeps the significant digits of a per-token rate", () => {
    expect(
      formatPriceHint({
        amount: 0.0000107,
        unit: "token",
        basis: "per_token",
        source: "provider_api",
      })
    ).toBe("from $0.000011/token")
  })
})

describe("formatUsd", () => {
  it.each([
    [1.5, "$1.50"],
    [0.01, "$0.01"],
    [0.0005, "$0.0005"],
  ])("formats %s as %s", (amount, expected) => {
    expect(formatUsd(amount)).toBe(expected)
  })
})

describe("formatCostQuote", () => {
  const quote: CostQuote = {
    amount: 0.6436,
    currency: "USD",
    basis: "per_second",
    confidence: "estimated",
    source: "local_table",
    note: null,
    sku: "720p",
  }

  it("marks an estimate with a tilde", () => {
    expect(formatCostQuote(quote)).toBe("~$0.64")
  })

  it("shows a provider-reported cost without one", () => {
    expect(formatCostQuote({ ...quote, confidence: "exact" })).toBe("$0.64")
  })

  it("says the cost is unknown rather than showing zero", () => {
    expect(
      formatCostQuote({ ...quote, amount: 0, confidence: "unknown" })
    ).toBe("Cost unknown")
  })

  it("says the cost is unknown when there is no quote at all", () => {
    expect(formatCostQuote(null)).toBe("Cost unknown")
  })
})
