// @vitest-environment jsdom
import { describe, expect, it } from "vitest"

import { diffParams } from "./compare-view"

describe("diffParams", () => {
  it("lists only the fields whose values disagree", () => {
    expect(
      diffParams(
        { duration: 5, resolution: "720p", seed: 7 },
        { duration: 9, resolution: "720p", seed: 7 }
      )
    ).toEqual([{ field: "duration", left: "5", right: "9" }])
  })

  it("keeps a field only one of the two runs set", () => {
    expect(diffParams({ watermark: false }, {})).toEqual([
      { field: "watermark", left: "false", right: "—" },
    ])
    expect(diffParams({}, { watermark: false })).toEqual([
      { field: "watermark", left: "—", right: "false" },
    ])
  })

  it("compares structured values by their contents, not by identity", () => {
    expect(diffParams({ size: [1, 2] }, { size: [1, 2] })).toEqual([])
    expect(diffParams({ size: [1, 2] }, { size: [1, 3] })).toHaveLength(1)
  })

  it("says nothing when two runs were given the same parameters", () => {
    expect(diffParams({ duration: 5 }, { duration: 5 })).toEqual([])
  })

  it("orders the differences the way the left run lists them", () => {
    expect(
      diffParams({ b: 1, a: 1 }, { a: 2, b: 2, c: 3 }).map((row) => row.field)
    ).toEqual(["b", "a", "c"])
  })
})
