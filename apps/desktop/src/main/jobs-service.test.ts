/**
 * How the runner is bound to the open project.
 *
 * ⛔ Nothing here reaches a provider: `list()` is a pure read of the `jobs`
 * table, which is exactly the first thing every runner entry point does — and
 * the first thing that throws once the database under it has been closed.
 *
 * Only the Electron-bound half is faked. `project-service.ts` is the module
 * that owns *which* project is open, so the fake is a plain holder the test
 * moves the way the real service moves it: a new handle in, the old one closed.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// `vi.mock` is hoisted above these, so the static import already sees the fakes.
import { getJobRunner, stopJobRunner } from "./jobs-service"
import { createProject, openProject, type OpenProject } from "./project"

const state = vi.hoisted(() => ({
  current: undefined as OpenProject | undefined,
}))

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
}))

vi.mock("electron-log/main", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("./project-service", () => ({
  getCurrentProject: () => state.current,
}))

vi.mock("./settings-service", () => ({
  getSettingsService: () => ({
    settings: { get: () => ({ maxConcurrentJobs: 1, pollIntervalMs: 1000 }) },
  }),
}))

vi.mock("./catalog-service", () => ({
  getModelCatalog: () => ({
    getModel: () => Promise.reject(new Error("no catalog in this test")),
  }),
}))

vi.mock("./providers/registry", () => ({
  requireProvider: () => {
    throw new Error("no provider in this test")
  },
}))

let root: string
let opened: OpenProject

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "od-jobs-service-"))
  const project = await createProject({ root, name: "Test" })
  opened = await openProject(project.path)
  state.current = opened
})

afterEach(async () => {
  stopJobRunner()
  state.current = undefined
  opened.close()
  await rm(root, { recursive: true, force: true })
})

describe("getJobRunner", () => {
  it("reuses the runner while the same handle stays open", () => {
    expect(getJobRunner()).toBe(getJobRunner())
  })

  it("rebinds when the open project's database handle is replaced", async () => {
    // Startup opens the project (this is what builds the runner, via
    // `recoverJobs`) and then the user clicks the same project in the
    // launcher, which opens it a second time and closes the first handle.
    const first = getJobRunner()
    expect(first.list()).toEqual([])

    const reopened = await openProject(opened.project.path)
    opened.close()
    opened = reopened
    state.current = reopened

    // Before the fix this threw better-sqlite3's "The database connection is
    // not open", which `generations:submit` then wrote onto the run as its
    // failure message.
    expect(() => getJobRunner().list()).not.toThrow()
    expect(getJobRunner()).not.toBe(first)
  })

  it("throws a sentence the renderer can show when no project is open", () => {
    state.current = undefined
    expect(() => getJobRunner()).toThrow("No project is open")
  })
})
