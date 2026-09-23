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
  selectedShot,
  shotAim,
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
  it("numbers versions by run, oldest first, a run's extra pictures after a dot", () => {
    const versions = shotVersions({
      shotId: SHOT,
      generations: [run("g2", 20), run("g1", 10)],
      outputs: [made("b", "g2"), made("a1", "g1", 1), made("a2", "g1", 2)],
      jobs: [],
    })
    expect(versions.map((one) => [one.label, one.asset?.id])).toEqual([
      ["v1", "a1"],
      ["v1.2", "a2"],
      ["v2", "b"],
    ])
  })

  it("keeps numbers stable when only the newest runs were read", () => {
    // 250 runs in all; the page holds the newest two.
    const versions = shotVersions({
      shotId: SHOT,
      generations: [run("g250", 250), run("g249", 249)],
      total: 250,
      outputs: [made("x", "g249"), made("y", "g250")],
      jobs: [],
    })
    expect(versions.map((one) => one.label)).toEqual(["v249", "v250"])
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

describe("the selected shot and the panel's aim", () => {
  const scene = container({
    id: "hall",
    name: "Hotel hallway",
    kind: "scene",
    handle: "hallway",
    children: [
      container({ id: "a", kind: "shot", description: "Wide" }),
      container({ id: "b", kind: "shot", description: null }),
    ],
  })

  it("selects the asked-for shot, else the first, else none", () => {
    expect(selectedShot(scene, "b")).toMatchObject({ index: 1 })
    expect(selectedShot(scene, "b")?.shot.id).toBe("b")
    expect(selectedShot(scene, "gone")?.shot.id).toBe("a")
    expect(selectedShot(scene, null)?.shot.id).toBe("a")
    expect(selectedShot({ ...scene, children: [] }, "a")).toBeNull()
  })

  it("aims at the selected shot, by its place and label", () => {
    expect(shotAim(scene, "b")).toEqual({
      target: {
        containerId: "b",
        label: "Generate a version of Shot 02",
        destination: "Hotel hallway · Shot 02",
        initialPrompt: "@hallway ",
      },
      whenQueued: "/container/?id=hall&tab=shots&shot=b",
    })
    expect(shotAim(scene, "a")?.target.initialPrompt).toBe("@hallway Wide")
    expect(shotAim({ ...scene, children: [] }, null)).toBeNull()
  })
})
