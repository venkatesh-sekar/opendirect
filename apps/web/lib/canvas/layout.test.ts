import { describe, expect, it } from "vitest"

import {
  aspectRatioOf,
  centerOf,
  defaultNodeSize,
  dropPosition,
  dropPositions,
  frameSize,
  FRAME_WIDTH,
  MAX_FRAME_HEIGHT,
  MIN_FRAME_HEIGHT,
  NODE_GAP,
  overlaps,
  parseAspectRatio,
  spawnPosition,
  TEXT_NODE_SIZE,
  type Box,
} from "./layout"

describe("parseAspectRatio", () => {
  it("reads the ratios the schemas actually publish", () => {
    expect(parseAspectRatio("16:9")).toEqual({ w: 16, h: 9 })
    expect(parseAspectRatio("9:16")).toEqual({ w: 9, h: 16 })
    expect(parseAspectRatio("1:1")).toEqual({ w: 1, h: 1 })
    expect(parseAspectRatio("21:9")).toEqual({ w: 21, h: 9 })
    expect(parseAspectRatio(" 4 : 3 ")).toEqual({ w: 4, h: 3 })
    expect(parseAspectRatio("1920x1080")).toEqual({ w: 1920, h: 1080 })
  })

  it("refuses to read a ratio out of a value that is not one", () => {
    for (const value of [
      "auto",
      "adaptive",
      "match_input_image",
      "",
      "16:",
      "0:9",
      "16:-9",
      null,
      undefined,
    ]) {
      expect(parseAspectRatio(value)).toBeNull()
    }
  })
})

describe("frameSize", () => {
  it("fixes the width and derives the height", () => {
    expect(frameSize("16:9")).toEqual({ width: 360, height: 203 })
    expect(frameSize("1:1")).toEqual({ width: 360, height: 360 })
    expect(frameSize("9:16")).toEqual({ width: 360, height: 640 })
  })

  it("falls back to a square rather than guessing a ratio", () => {
    expect(frameSize(null)).toEqual(frameSize("1:1"))
    expect(frameSize("adaptive")).toEqual(frameSize("1:1"))
  })

  it("clamps an extreme ratio into a usable frame", () => {
    expect(frameSize("100:1").height).toBe(MIN_FRAME_HEIGHT)
    expect(frameSize("1:100").height).toBe(MAX_FRAME_HEIGHT)
  })

  it("takes a parsed ratio and a custom width", () => {
    expect(frameSize({ w: 2, h: 1 }, 200)).toEqual({ width: 200, height: 120 })
  })

  it("sizes a media frame from the asset's own pixels", () => {
    expect(frameSize(aspectRatioOf(1920, 1080))).toEqual(frameSize("16:9"))
    expect(aspectRatioOf(null, 1080)).toBeNull()
    expect(aspectRatioOf(0, 1080)).toBeNull()
  })
})

describe("defaultNodeSize", () => {
  it("gives a note a fixed sticky and everything else a frame", () => {
    expect(defaultNodeSize("text")).toEqual(TEXT_NODE_SIZE)
    expect(defaultNodeSize("media", "9:16")).toEqual(frameSize("9:16"))
    expect(defaultNodeSize("image_gen", "16:9")).toEqual(frameSize("16:9"))
    expect(defaultNodeSize("video_gen")).toEqual(frameSize(null))
  })

  it("hands back a fresh object, so a node never shares a size", () => {
    const size = defaultNodeSize("text")
    size.width = 1
    expect(defaultNodeSize("text")).toEqual(TEXT_NODE_SIZE)
  })
})

describe("overlaps", () => {
  const a: Box = { x: 0, y: 0, width: 100, height: 100 }

  it("is true only when the rectangles share area", () => {
    expect(overlaps(a, { x: 50, y: 50, width: 100, height: 100 })).toBe(true)
    expect(overlaps(a, { x: 100, y: 0, width: 100, height: 100 })).toBe(false)
    expect(overlaps(a, { x: 0, y: 100, width: 100, height: 100 })).toBe(false)
    expect(overlaps(a, { x: 200, y: 200, width: 10, height: 10 })).toBe(false)
  })
})

describe("spawnPosition", () => {
  const origin: Box = { x: 0, y: 0, width: 360, height: 360 }
  const size = { width: 360, height: 200 }

  it("puts a new node one gap to the right, vertically centred", () => {
    expect(spawnPosition({ origin, direction: "right", size })).toEqual({
      x: 360 + NODE_GAP,
      y: 80,
    })
  })

  it("puts a new node one gap to the left", () => {
    expect(spawnPosition({ origin, direction: "left", size })).toEqual({
      x: -NODE_GAP - 360,
      y: 80,
    })
  })

  it("scans down past whatever is already parked there", () => {
    const blocker: Box = { x: 360 + NODE_GAP, y: 80, width: 360, height: 200 }
    expect(
      spawnPosition({ origin, direction: "right", size, occupied: [blocker] })
    ).toEqual({ x: 360 + NODE_GAP, y: 80 + 200 + NODE_GAP })
  })

  it("keeps scanning while each new spot is taken too", () => {
    const step = 200 + NODE_GAP
    const occupied: Box[] = [0, 1, 2].map((index) => ({
      x: 360 + NODE_GAP,
      y: 80 + index * step,
      width: 360,
      height: 200,
    }))
    expect(
      spawnPosition({ origin, direction: "right", size, occupied })
    ).toEqual({ x: 360 + NODE_GAP, y: 80 + 3 * step })
  })

  it("ignores a node that is nowhere near the candidate", () => {
    const far: Box = { x: 5000, y: 5000, width: 100, height: 100 }
    expect(
      spawnPosition({ origin, direction: "right", size, occupied: [far] })
    ).toEqual({ x: 360 + NODE_GAP, y: 80 })
  })

  it("honours a caller's own gap", () => {
    expect(
      spawnPosition({ origin, direction: "right", size, gap: 10 })
    ).toEqual({ x: 370, y: 80 })
  })
})

describe("dropPosition", () => {
  it("centres the node on the pointer", () => {
    expect(
      dropPosition({ x: 100, y: 100 }, { width: 360, height: 200 })
    ).toEqual({
      x: -80,
      y: 0,
    })
  })

  it("cascades a multi-file drop so nothing hides underneath", () => {
    const points = dropPositions({ x: 0, y: 0 }, { width: 100, height: 100 }, 3)
    expect(points).toEqual([
      { x: -50, y: -50 },
      { x: -50 + NODE_GAP, y: -50 + NODE_GAP },
      { x: -50 + 2 * NODE_GAP, y: -50 + 2 * NODE_GAP },
    ])
    expect(dropPositions({ x: 0, y: 0 }, { width: 10, height: 10 }, 0)).toEqual(
      []
    )
  })
})

describe("centerOf", () => {
  it("is the middle of the box", () => {
    expect(centerOf({ x: 10, y: 20, width: 100, height: 50 })).toEqual({
      x: 60,
      y: 45,
    })
  })
})

describe("the frame width every node shares", () => {
  it("is what a frame is built at unless a caller says otherwise", () => {
    expect(frameSize("16:9").width).toBe(FRAME_WIDTH)
  })
})
