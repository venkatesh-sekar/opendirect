/**
 * Which project is open, and what happens to the one it replaces.
 *
 * Only Electron is faked — `electron-store` stands in as a Map, and the
 * projects themselves are real folders with real SQLite files, because the
 * whole point of these tests is *when a handle is closed*.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createProject, type OpenProject } from "./project"
import {
  closeCurrentProject,
  getCurrentProject,
  onProjectClose,
  openProjectAt,
  resetProjectService,
} from "./project-service"

const store = vi.hoisted(() => new Map<string, unknown>())

vi.mock("electron", () => ({
  app: { getPath: () => tmpdir() },
}))

vi.mock("electron-log/main", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("./settings-service", () => ({
  getSettingsService: () => ({
    store: {
      get: (key: string) => store.get(key),
      set: (key: string, value: unknown) => store.set(key, value),
      delete: (key: string) => store.delete(key),
    },
    settings: { get: () => ({}) },
  }),
}))

let root: string
const unsubscribes: (() => void)[] = []

beforeEach(async () => {
  store.clear()
  root = await mkdtemp(join(tmpdir(), "od-project-service-"))
})

afterEach(async () => {
  for (const unsubscribe of unsubscribes.splice(0)) unsubscribe()
  resetProjectService()
  await rm(root, { recursive: true, force: true })
})

/** Registers a listener and cleans it up after the test. */
function track(listener: (project: OpenProject) => void): void {
  unsubscribes.push(onProjectClose(listener))
}

describe("openProjectAt", () => {
  it("re-opening the project already open keeps the same handle", async () => {
    const project = await createProject({ root, name: "Test" })

    const first = await openProjectAt(project.path)
    const second = await openProjectAt(project.path)

    // Identity, not just an equal-looking project: everything holding the
    // first handle — the job runner above all — must still be holding a live
    // connection afterwards.
    expect(second).toBe(first)
    expect(first.handle.sqlite.open).toBe(true)
    expect(getCurrentProject()).toBe(first)
  })

  it("recognises the open project through an unnormalised path", async () => {
    const project = await createProject({ root, name: "Test" })

    const first = await openProjectAt(project.path)
    const second = await openProjectAt(join(project.path, "assets", ".."))

    expect(second).toBe(first)
    expect(first.handle.sqlite.open).toBe(true)
  })

  it("still bumps the project to the top of the recents", async () => {
    const one = await createProject({ root, name: "One" })
    const two = await createProject({ root, name: "Two" })

    await openProjectAt(one.path)
    await openProjectAt(two.path)
    await openProjectAt(two.path)

    const recents = store.get("recentProjects") as { path: string }[]
    expect(recents.map((entry) => entry.path)).toEqual([two.path, one.path])
  })

  it("closes the previous project when a different one is opened", async () => {
    const one = await createProject({ root, name: "One" })
    const two = await createProject({ root, name: "Two" })

    const first = await openProjectAt(one.path)
    const second = await openProjectAt(two.path)

    expect(second).not.toBe(first)
    expect(first.handle.sqlite.open).toBe(false)
    expect(second.handle.sqlite.open).toBe(true)
  })
})

describe("onProjectClose", () => {
  it("runs before the handle is closed, with no project current", async () => {
    const project = await createProject({ root, name: "Test" })
    const opened = await openProjectAt(project.path)

    const seen: { open: boolean; current: OpenProject | undefined }[] = []
    track((closing) => {
      // A listener's whole job is to let go of this database, so it has to
      // still be usable while the listener runs.
      seen.push({
        open: closing.handle.sqlite.open,
        current: getCurrentProject(),
      })
    })

    closeCurrentProject()

    expect(seen).toEqual([{ open: true, current: undefined }])
    expect(opened.handle.sqlite.open).toBe(false)
  })

  it("fires when a different project replaces the open one", async () => {
    const one = await createProject({ root, name: "One" })
    const two = await createProject({ root, name: "Two" })
    await openProjectAt(one.path)

    const closed: string[] = []
    track((closing) => closed.push(closing.project.path))

    await openProjectAt(two.path)

    expect(closed).toEqual([one.path])
  })

  it("does not fire when the project already open is re-opened", async () => {
    const project = await createProject({ root, name: "Test" })
    await openProjectAt(project.path)

    const closed: string[] = []
    track((closing) => closed.push(closing.project.path))

    await openProjectAt(project.path)

    expect(closed).toEqual([])
  })

  it("closes the handle even when a listener throws", async () => {
    const project = await createProject({ root, name: "Test" })
    const opened = await openProjectAt(project.path)

    track(() => {
      throw new Error("a listener went wrong")
    })
    const after = vi.fn()
    track(after)

    expect(() => closeCurrentProject()).not.toThrow()
    expect(after).toHaveBeenCalledOnce()
    expect(opened.handle.sqlite.open).toBe(false)
  })

  it("stops firing once unsubscribed", async () => {
    const project = await createProject({ root, name: "Test" })
    await openProjectAt(project.path)

    const listener = vi.fn()
    const unsubscribe = onProjectClose(listener)
    unsubscribe()

    closeCurrentProject()

    expect(listener).not.toHaveBeenCalled()
  })
})
