import { describe, expect, it } from "vitest"

import {
  chooseSource,
  DOWNGRADE_RATIO,
  imageSources,
  quantizeZoom,
  requiredEdge,
} from "./image-tiers"

const URL = "asset://media/assets/2026/10/a.jpg"
const THUMB = "asset://media/thumbnails/a.webp"

/** A 12 MP phone photo, landscape. */
const photo = { url: URL, thumbnailUrl: THUMB, width: 4032, height: 3024 }

describe("imageSources", () => {
  it("ladders a large photo: thumbnail, 1024, 2048, original", () => {
    expect(imageSources(photo)).toEqual([
      { url: THUMB, edge: 512 },
      { url: `${URL}?w=1024`, edge: 1024 },
      { url: `${URL}?w=2048`, edge: 2048 },
      { url: URL, edge: 4032 },
    ])
  })

  it("skips tiers that are not smaller than the original", () => {
    const sources = imageSources({ ...photo, width: 1500, height: 1000 })
    expect(sources.map((s) => s.edge)).toEqual([512, 1024, 1500])

    const tiny = imageSources({ ...photo, width: 400, height: 300 })
    expect(tiny).toEqual([{ url: URL, edge: 400 }])
  })

  it("offers every tier, and an unbounded original, when the size is unknown", () => {
    const sources = imageSources({ ...photo, width: null, height: null })
    expect(sources.map((s) => s.edge)).toEqual([512, 1024, 2048, Infinity])
  })

  it("never asks main to resize a gif or an svg", () => {
    const gif = imageSources({
      ...photo,
      url: "asset://media/assets/2026/10/loop.gif",
    })
    expect(gif.map((s) => s.edge)).toEqual([512, 4032])
  })

  it("works without a thumbnail, and has nothing for a text asset", () => {
    expect(
      imageSources({ ...photo, thumbnailUrl: null }).map((s) => s.edge)
    ).toEqual([1024, 2048, 4032])
    expect(imageSources({ ...photo, url: null })).toEqual([])
  })
})

describe("requiredEdge", () => {
  const box = { width: 320, height: 240 }

  it("is the box's long edge × zoom × devicePixelRatio", () => {
    expect(requiredEdge({ box, intrinsic: null, scale: 1 })).toBe(320)
    expect(requiredEdge({ box, intrinsic: null, scale: 2 * 2 })).toBe(1280)
  })

  it("accounts for object-cover cropping a differently shaped image", () => {
    // A portrait photo in a landscape box is scaled to the box's width, so it
    // is drawn 320 × 427 and its long edge needs 427 px.
    expect(
      requiredEdge({ box, intrinsic: { width: 3024, height: 4032 }, scale: 1 })
    ).toBe(427)
  })

  it("is zero before the element has been measured", () => {
    expect(
      requiredEdge({ box: { width: 0, height: 0 }, intrinsic: null, scale: 2 })
    ).toBe(0)
  })
})

describe("chooseSource", () => {
  const sources = imageSources(photo)
  const pick = (required: number, current?: string) =>
    chooseSource(sources, required, current ?? null)?.edge

  it("takes the smallest source that covers the need", () => {
    expect(pick(0)).toBe(512)
    expect(pick(512)).toBe(512)
    expect(pick(513)).toBe(1024)
    expect(pick(2000)).toBe(2048)
    expect(pick(2049)).toBe(4032)
  })

  it("falls back to the largest when nothing is big enough", () => {
    expect(pick(9000)).toBe(4032)
  })

  it("keeps a bigger current source through a small zoom out", () => {
    expect(pick(900, `${URL}?w=2048`)).toBe(2048)
  })

  it("drops a source that is far bigger than needed", () => {
    expect(pick(2048 / DOWNGRADE_RATIO - 1, `${URL}?w=2048`)).toBe(1024)
    expect(pick(100, URL)).toBe(512)
  })

  it("ignores a current URL that belongs to another image", () => {
    expect(pick(100, "asset://media/assets/other.jpg")).toBe(512)
  })

  it("has nothing to choose from an empty ladder", () => {
    expect(chooseSource([], 100)).toBeNull()
  })
})

describe("quantizeZoom", () => {
  it("rounds up to a quarter octave, so it never underestimates", () => {
    expect(quantizeZoom(1)).toBe(1)
    expect(quantizeZoom(2)).toBe(2)
    expect(quantizeZoom(0.5)).toBe(0.5)
    expect(quantizeZoom(1.01)).toBeCloseTo(2 ** 0.25)
    for (const zoom of [0.13, 0.7, 1.3, 3.9, 7.5]) {
      expect(quantizeZoom(zoom)).toBeGreaterThanOrEqual(zoom)
      expect(quantizeZoom(zoom)).toBeLessThan(zoom * 2 ** 0.25 + 1e-9)
    }
  })

  it("treats a nonsense zoom as 1", () => {
    expect(quantizeZoom(0)).toBe(1)
    expect(quantizeZoom(Number.NaN)).toBe(1)
  })
})

/**
 * The before/after the fix is about, as a table: what a 320 × 240 node showing
 * a 12 MP photo is given on a 2× display. Before, it was the 512 px thumbnail
 * at every zoom.
 */
describe("a 320 × 240 node on a 2× display", () => {
  const sources = imageSources(photo)
  const at = (zoom: number) =>
    chooseSource(
      sources,
      requiredEdge({
        box: { width: 320, height: 240 },
        intrinsic: { width: 4032, height: 3024 },
        scale: quantizeZoom(zoom) * 2,
      })
    )?.edge

  it.each([
    [0.25, 512],
    [0.5, 512],
    [1, 1024],
    [2, 2048],
    [4, 4032],
    [8, 4032],
  ])("at zoom %s gets the %s px source", (zoom, edge) => {
    expect(at(zoom)).toBe(edge)
  })
})
