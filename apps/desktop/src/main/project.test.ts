import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  assetRelPath,
  createProject,
  createRecentProjects,
  DB_FILE_NAME,
  openProject,
  PROJECT_DIRECTORIES,
  PROJECT_FILE_NAME,
  projectDirectoryName,
  resolveAssetPath,
  type RecentProjectsStore,
} from "./project"

const roots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "od-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

describe("createProject", () => {
  it("creates the project folder layout", async () => {
    const root = await makeRoot()
    const project = await createProject({ root, name: "Infinite Hotel" })

    for (const directory of PROJECT_DIRECTORIES) {
      expect(existsSync(join(project.path, directory))).toBe(true)
    }
    expect(existsSync(join(project.path, DB_FILE_NAME))).toBe(true)

    const manifest = JSON.parse(
      await readFile(join(project.path, PROJECT_FILE_NAME), "utf8")
    ) as { name: string; id: string }
    expect(manifest.name).toBe("Infinite Hotel")
    expect(manifest.id).toBe(project.id)
  })

  it("records the project row in its own database", async () => {
    const root = await makeRoot()
    const project = await createProject({ root, name: "Infinite Hotel" })
    const opened = await openProject(project.path)
    try {
      const rows = opened.handle.sqlite
        .prepare<[], { id: string; name: string; path: string }>(
          "select id, name, path from projects"
        )
        .all()
      expect(rows).toEqual([
        { id: project.id, name: "Infinite Hotel", path: project.path },
      ])
    } finally {
      opened.close()
    }
  })

  it("slugifies the folder name and avoids collisions", async () => {
    const root = await makeRoot()
    const first = await createProject({ root, name: "Infinite Hotel!" })
    const second = await createProject({ root, name: "Infinite Hotel!" })
    expect(first.path).toBe(join(root, "infinite-hotel"))
    expect(second.path).toBe(join(root, "infinite-hotel-2"))
  })

  it("rejects a blank name", async () => {
    const root = await makeRoot()
    await expect(createProject({ root, name: "   " })).rejects.toThrow(/name/i)
  })
})

describe("openProject", () => {
  it("is idempotent when opened twice", async () => {
    const root = await makeRoot()
    const created = await createProject({ root, name: "Infinite Hotel" })

    const first = await openProject(created.path)
    first.close()
    const second = await openProject(created.path)
    second.close()

    expect(first.project.id).toBe(created.id)
    expect(second.project.id).toBe(created.id)
    expect(second.project.createdAt).toBe(created.createdAt)
  })

  it("restores a directory that was partly deleted", async () => {
    const root = await makeRoot()
    const created = await createProject({ root, name: "Infinite Hotel" })
    await rm(join(created.path, "tmp"), { recursive: true, force: true })

    const opened = await openProject(created.path)
    opened.close()
    expect(existsSync(join(created.path, "tmp"))).toBe(true)
  })

  it("refuses a directory that is not an OpenDirect project", async () => {
    const root = await makeRoot()
    await expect(openProject(root)).rejects.toThrow(
      /not an OpenDirect project/i
    )
  })

  it("refuses a corrupt manifest rather than silently re-creating it", async () => {
    const root = await makeRoot()
    const created = await createProject({ root, name: "Infinite Hotel" })
    await writeFile(join(created.path, PROJECT_FILE_NAME), "{ not json", "utf8")
    await expect(openProject(created.path)).rejects.toThrow(/project\.json/i)
  })
})

describe("asset paths", () => {
  it("lays uploads out by year and month", () => {
    expect(
      assetRelPath({
        source: "upload",
        id: "abc123",
        ext: "png",
        now: new Date(Date.UTC(2026, 8, 16)),
      })
    ).toBe("assets/2026/09/abc123.png")
  })

  it("tolerates a dotted extension", () => {
    expect(
      assetRelPath({
        source: "upload",
        id: "abc",
        ext: ".JPEG",
        now: new Date(Date.UTC(2026, 0, 2)),
      })
    ).toBe("assets/2026/01/abc.jpeg")
  })

  it("groups generation outputs under their generation", () => {
    expect(
      assetRelPath({
        source: "generation",
        generationId: "g1",
        index: 2,
        ext: "mp4",
      })
    ).toBe("generations/g1/2.mp4")
  })

  it("resolves a relative path inside the project", () => {
    const project = {
      id: "p1",
      name: "p",
      path: "/projects/p1",
      createdAt: 0,
    }
    expect(resolveAssetPath(project, "assets/2026/09/a.png")).toBe(
      join("/projects/p1", "assets/2026/09/a.png")
    )
  })

  it("refuses to escape the project directory", () => {
    const project = { id: "p1", name: "p", path: "/projects/p1", createdAt: 0 }
    for (const bad of ["../secrets.txt", "/etc/passwd", "assets/../../x"]) {
      expect(() => resolveAssetPath(project, bad)).toThrow(/outside/i)
    }
  })

  it("derives a filesystem-safe directory name", () => {
    expect(projectDirectoryName("  My Project / 2  ")).toBe("my-project-2")
    expect(projectDirectoryName("🙂")).toBe("project")
  })
})

describe("recentProjects", () => {
  function memoryStore(): RecentProjectsStore {
    const data = new Map<string, unknown>()
    return {
      get: (key) => data.get(key),
      set: (key, value) => void data.set(key, value),
    }
  }

  it("starts empty and ignores a corrupt entry", () => {
    const store = memoryStore()
    store.set("recentProjects", [{ nope: true }, 7])
    expect(createRecentProjects(store).list()).toEqual([])
  })

  it("puts the most recently opened project first and de-duplicates by path", () => {
    const recent = createRecentProjects(memoryStore())
    recent.remember({ id: "a", name: "A", path: "/p/a", createdAt: 1 })
    recent.remember({ id: "b", name: "B", path: "/p/b", createdAt: 2 })
    recent.remember({ id: "a", name: "A renamed", path: "/p/a", createdAt: 1 })

    expect(recent.list().map((entry) => entry.path)).toEqual(["/p/a", "/p/b"])
    expect(recent.list()[0]?.name).toBe("A renamed")
  })

  it("caps the list", () => {
    const recent = createRecentProjects(memoryStore(), { limit: 3 })
    for (let index = 0; index < 5; index += 1) {
      recent.remember({
        id: `p${index}`,
        name: `P${index}`,
        path: `/p/${index}`,
        createdAt: index,
      })
    }
    expect(recent.list().map((entry) => entry.path)).toEqual([
      "/p/4",
      "/p/3",
      "/p/2",
    ])
  })

  it("forgets a project", () => {
    const recent = createRecentProjects(memoryStore())
    recent.remember({ id: "a", name: "A", path: "/p/a", createdAt: 1 })
    recent.forget("/p/a")
    expect(recent.list()).toEqual([])
  })
})
