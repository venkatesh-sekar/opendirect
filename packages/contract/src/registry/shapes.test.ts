import { describe, expect, it } from "vitest"

import { applyShape, SHAPE_NAMES, SHAPES } from "./shapes"

describe("kling-elements", () => {
  const shape = SHAPES["kling-elements"]

  it("is empty for no urls", () => {
    expect(shape([])).toEqual([])
  })

  it("makes one element with no extra references for one url", () => {
    expect(shape(["a"])).toEqual([
      { frontal_image_url: "a", reference_image_urls: [] },
    ])
  })

  it("puts the first url in front and the rest as references", () => {
    expect(shape(["a", "b", "c"])).toEqual([
      { frontal_image_url: "a", reference_image_urls: ["b", "c"] },
    ])
  })
})

describe("applyShape", () => {
  it("passes a single url through when no shape is named", () => {
    expect(applyShape(null, ["a"], false)).toBe("a")
  })

  it("passes a copy of the urls through for a multiple field", () => {
    expect(applyShape(null, ["a", "b"], true)).toEqual(["a", "b"])
  })

  it("applies a named shape", () => {
    expect(applyShape("kling-elements", ["a"], true)).toEqual([
      { frontal_image_url: "a", reference_image_urls: [] },
    ])
  })

  it("throws on a shape the app does not ship", () => {
    expect(() => applyShape("nested", ["a"], true)).toThrow(
      /Unknown shape "nested"/
    )
  })

  it("lists every shape by name", () => {
    expect(SHAPE_NAMES).toEqual(["kling-elements"])
  })
})
