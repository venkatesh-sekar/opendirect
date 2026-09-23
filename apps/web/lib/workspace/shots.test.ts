import { describe, expect, it } from "vitest"

import {
  asset,
  container,
  generation,
  job,
} from "@/components/workspace/fixtures"

import {
  coverVersion,
  pickLine,
  pickedVersion,
  shotNumber,
  shotTitle,
  shotVersions,
  shotsOf,
} from "./shots"

const SHOT = "shot-1"

function run(id: string, createdAt: number, over = {}) {
  return generation({ id, containerId: SHOT, createdAt, ...over })
}

function made(id: string, generationId: string, createdAt = 0) {
  return asset({ id, generationId, createdAt })
}

describe("shotsOf", () => {
  it("keeps a scene's shots, in order, and nothing else", () => {
    const scene = container({
      id: "hall",
      kind: "scene",
      children: [
        container({ id: "a", kind: "shot" }),
        container({ id: "f", kind: "folder" }),
        container({ id: "b", kind: "shot" }),
      ],
    })
    expect(shotsOf(scene).map((shot) => shot.id)).toEqual(["a", "b"])
  })
})

describe("numbering", () => {
  it("numbers shots by place, two digits", () => {
    expect(shotNumber(0)).toBe("01")
    expect(shotNumber(11)).toBe("12")
    expect(shotTitle(2)).toBe("Shot 03")
  })
})

describe("shotVersions", () => {
  it("makes one version per picture, oldest first", () => {
    const versions = shotVersions({
      shotId: SHOT,
      generations: [run("g2", 20), run("g1", 10)],
      outputs: [made("b", "g2"), made("a1", "g1", 1), made("a2", "g1", 2)],
      jobs: [],
    })
    expect(versions.map((one) => [one.label, one.asset?.id])).toEqual([
      ["v1", "a1"],
      ["v2", "a2"],
      ["v3", "b"],
    ])
  })

  it("keeps a failed run's number, with no picture", () => {
    const versions = shotVersions({
      shotId: SHOT,
      generations: [run("g1", 10, { status: "failed" }), run("g2", 20)],
      outputs: [made("b", "g2")],
      jobs: [],
    })
    expect(versions.map((one) => [one.label, one.asset?.id ?? null])).toEqual([
      ["v1", null],
      ["v2", "b"],
    ])
  })

  it("draws a run with an active job as running, even before it is listed", () => {
    const listed = run("g1", 10, { status: "running" })
    const queued = run("g2", 20, { status: "queued" })
    const versions = shotVersions({
      shotId: SHOT,
      generations: [listed],
      outputs: [],
      jobs: [
        job({
          id: "j1",
          generationId: "g1",
          generation: listed,
          progress: 0.4,
        }),
        job({
          id: "j2",
          generationId: "g2",
          generation: queued,
          state: "queued",
        }),
        job({
          id: "j3",
          generationId: "elsewhere",
          generation: generation({ id: "elsewhere", containerId: "hall" }),
        }),
      ],
    })
    expect(versions.map((one) => [one.label, one.running])).toEqual([
      ["v1", true],
      ["v2", true],
    ])
    expect(versions[0]!.progress).toBe(0.4)
  })
})

describe("picks", () => {
  const versions = shotVersions({
    shotId: SHOT,
    generations: [run("g1", 10), run("g2", 20), run("g3", 30)],
    outputs: [made("a", "g1"), made("b", "g2")],
    jobs: [],
  })

  it("finds the picked version, and only a version of this shot", () => {
    expect(pickedVersion(versions, "a")?.label).toBe("v1")
    expect(pickedVersion(versions, "stranger")).toBeNull()
    expect(pickedVersion(versions, null)).toBeNull()
  })

  it("covers the card with the pick, else the newest picture", () => {
    expect(coverVersion(versions, "a")?.asset?.id).toBe("a")
    expect(coverVersion(versions, null)?.asset?.id).toBe("b")
    expect(coverVersion([], null)).toBeNull()
  })

  it("says which version is the pick", () => {
    expect(pickLine(versions, "b")).toMatch(/^v2 is the pick/)
    expect(pickLine(versions, null)).toMatch(/no pick yet/i)
    expect(pickLine([], null)).toBe("No versions yet")
  })
})
