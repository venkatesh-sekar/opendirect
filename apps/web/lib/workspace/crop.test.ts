import { describe, expect, it } from "vitest"

import {
  CROP_ASPECTS,
  centeredCrop,
  croppedSize,
  fitWidth,
  toCropRect,
} from "./crop"

describe("centeredCrop", () => {
  it("takes 90% of each side when free-form", () => {
    expect(centeredCrop(null, 4000, 3000)).toEqual({
      unit: "%",
      x: 5,
      y: 5,
      width: 90,
      height: 90,
    })
  })

  it("makes a square crop square in pixels, not in percent", () => {
    const crop = centeredCrop(1, 4000, 2000)
    const size = croppedSize(crop, 4000, 2000)
    expect(size).toEqual({ width: 1800, height: 1800 })
    // Centred.
    expect(crop.x + crop.width / 2).toBeCloseTo(50)
    expect(crop.y + crop.height / 2).toBeCloseTo(50)
  })

  it("fits a tall preset inside a wide picture", () => {
    const crop = centeredCrop(9 / 16, 1920, 1080)
    expect(crop.height).toBeCloseTo(90)
    expect(crop.width).toBeLessThan(90)
    const size = croppedSize(crop, 1920, 1080)
    expect(size.width / size.height).toBeCloseTo(9 / 16, 2)
  })

  it("never spills outside the image for any preset", () => {
    for (const { ratio } of CROP_ASPECTS) {
      for (const [w, h] of [
        [4000, 1000],
        [1000, 4000],
        [512, 512],
      ] as const) {
        const crop = centeredCrop(ratio, w, h)
        expect(crop.x).toBeGreaterThanOrEqual(0)
        expect(crop.y).toBeGreaterThanOrEqual(0)
        expect(crop.x + crop.width).toBeLessThanOrEqual(100 + 1e-9)
        expect(crop.y + crop.height).toBeLessThanOrEqual(100 + 1e-9)
      }
    }
  })
})

describe("toCropRect", () => {
  it("turns percent into fractions", () => {
    expect(
      toCropRect({ unit: "%", x: 25, y: 10, width: 50, height: 40 })
    ).toEqual({ x: 0.25, y: 0.1, width: 0.5, height: 0.4 })
  })

  it("clamps a selection that overshoots the edge", () => {
    expect(
      toCropRect({ unit: "%", x: -2, y: 80, width: 50, height: 30 })
    ).toEqual({ x: 0, y: 0.8, width: 0.5, height: expect.closeTo(0.2) })
  })
})

describe("croppedSize", () => {
  it("rounds edge by edge, like main", () => {
    expect(
      croppedSize(
        { unit: "%", x: 100 / 3, y: 0, width: 100 / 3, height: 100 },
        100,
        10
      )
    ).toEqual({ width: 34, height: 10 })
  })
})

describe("fitWidth", () => {
  it("fits by width or by height, whichever binds", () => {
    expect(fitWidth(800, 600, 4000, 1000)).toBe(800)
    expect(fitWidth(800, 600, 1000, 4000)).toBe(150)
  })

  it("survives an image with no size yet", () => {
    expect(fitWidth(800, 600, 0, 0)).toBe(800)
  })
})
