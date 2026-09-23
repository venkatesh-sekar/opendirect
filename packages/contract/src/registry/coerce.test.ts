import { describe, expect, it } from "vitest"

import { coerceToSchemaType } from "./coerce"

describe("coerceToSchemaType", () => {
  it("reads `type` as a string or an array", () => {
    expect(coerceToSchemaType("5", { type: "integer" })).toBe(5)
    expect(coerceToSchemaType("5", { type: ["integer", "null"] })).toBe(5)
    expect(coerceToSchemaType("5", { type: ["string", "integer"] })).toBe("5")
  })

  it("turns only strict decimal integers into integers", () => {
    const integer = { type: "integer" }
    expect(coerceToSchemaType(" -12 ", integer)).toBe(-12)
    for (const value of ["1.5", "1e3", "0x10", "", "  ", "abc", "Infinity"]) {
      expect(coerceToSchemaType(value, integer)).toBe(value)
    }
  })

  it("turns only strict decimals into numbers", () => {
    const number = { type: "number" }
    expect(coerceToSchemaType("1.5", number)).toBe(1.5)
    expect(coerceToSchemaType(" -2 ", number)).toBe(-2)
    expect(coerceToSchemaType(".5", number)).toBe(0.5)
    expect(coerceToSchemaType("1e3", number)).toBe(1000)
    expect(coerceToSchemaType("2.5E-1", number)).toBe(0.25)
    for (const value of [
      "0x10",
      "0b1",
      "0o7",
      "Infinity",
      "-Infinity",
      "NaN",
      "",
      " ",
      "1e999",
      "1.2.3",
      "e3",
    ]) {
      expect(coerceToSchemaType(value, number)).toBe(value)
    }
  })

  it("turns true/false into booleans", () => {
    expect(coerceToSchemaType("true", { type: "boolean" })).toBe(true)
    expect(coerceToSchemaType(" false ", { type: "boolean" })).toBe(false)
    expect(coerceToSchemaType("yes", { type: "boolean" })).toBe("yes")
  })

  it("turns a number or boolean into a string for a string field", () => {
    expect(coerceToSchemaType(5, { type: "string" })).toBe("5")
    expect(coerceToSchemaType(true, { type: "string" })).toBe("true")
  })

  it("leaves everything else unchanged", () => {
    expect(coerceToSchemaType(5, { type: "integer" })).toBe(5)
    expect(coerceToSchemaType(1.5, { type: "integer" })).toBe(1.5)
    expect(coerceToSchemaType("5", {})).toBe("5")
    expect(coerceToSchemaType("5", undefined)).toBe("5")
    expect(coerceToSchemaType(null, { type: "string" })).toBe(null)
    const list = ["a"]
    expect(coerceToSchemaType(list, { type: "string" })).toBe(list)
  })
})
