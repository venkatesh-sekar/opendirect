/**
 * ⛔ Every URL here is served by `msw`. The root harness runs with
 * `onUnhandledRequest: "error"`, so a request that escaped to a real CDN would
 * fail this file rather than quietly download from the internet.
 */
import { createHash } from "node:crypto"
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { HttpResponse, http } from "msw"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { server } from "../../../../../test/msw/server"
import { createProject, openProject, type OpenProject } from "../project"
import { downloadOutput } from "./download"

const OUTPUT_URL = "https://replicate.delivery/pbxt/out.mp4"

const payload = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

let root: string
let opened: OpenProject
let generationId: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "opendirect-download-"))
  const project = await createProject({ root, name: "Infinite Hotel" })
  opened = await openProject(project.path)
  generationId = "gen-1"
})

afterEach(async () => {
  opened.close()
  await rm(root, { recursive: true, force: true })
})

function serve(body: Uint8Array, headers: Record<string, string> = {}): void {
  server.use(
    http.get(OUTPUT_URL, () =>
      HttpResponse.arrayBuffer(body.buffer as ArrayBuffer, {
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(body.byteLength),
          ...headers,
        },
      })
    )
  )
}

async function tmpEntries(): Promise<string[]> {
  return readdir(join(opened.project.path, "tmp"))
}

describe("downloadOutput", () => {
  it("streams the output into generations/<id>/<index>.<ext>", async () => {
    serve(payload)

    const result = await downloadOutput({
      url: OUTPUT_URL,
      project: opened.project,
      generationId,
      index: 0,
    })

    expect(result.relPath).toBe(`generations/${generationId}/0.mp4`)
    expect(result.bytes).toBe(payload.byteLength)
    expect(result.sha256).toBe(sha256(payload))
    expect(result.mimeType).toBe("video/mp4")

    const written = await readFile(join(opened.project.path, result.relPath))
    expect(new Uint8Array(written)).toEqual(payload)
  })

  it("leaves nothing behind in tmp/ once the file is in place", async () => {
    serve(payload)
    await downloadOutput({
      url: OUTPUT_URL,
      project: opened.project,
      generationId,
      index: 0,
    })
    expect(await tmpEntries()).toEqual([])
  })

  it("names the file from the content type when the URL has no extension", async () => {
    const url = "https://replicate.delivery/pbxt/output"
    server.use(
      http.get(url, () =>
        HttpResponse.arrayBuffer(payload.buffer as ArrayBuffer, {
          headers: { "Content-Type": "image/png" },
        })
      )
    )

    const result = await downloadOutput({
      url,
      project: opened.project,
      generationId,
      index: 2,
    })
    expect(result.relPath).toBe(`generations/${generationId}/2.png`)
  })

  it("decodes a data: URL without going near the network", async () => {
    const result = await downloadOutput({
      url: `data:image/png;base64,${Buffer.from(payload).toString("base64")}`,
      project: opened.project,
      generationId,
      index: 1,
    })

    expect(result.relPath).toBe(`generations/${generationId}/1.png`)
    expect(result.bytes).toBe(payload.byteLength)
    expect(result.sha256).toBe(sha256(payload))
  })

  it("refuses a truncated download and leaves no half-file behind", async () => {
    // The body is shorter than the length the server promised.
    serve(payload.slice(0, 4), { "Content-Length": "10" })

    await expect(
      downloadOutput({
        url: OUTPUT_URL,
        project: opened.project,
        generationId,
        index: 0,
      })
    ).rejects.toThrow(/incomplete|truncated|bytes/i)

    await expect(
      stat(join(opened.project.path, "generations", generationId, "0.mp4"))
    ).rejects.toThrow()
    expect(await tmpEntries()).toEqual([])
  })

  it("reports an HTTP failure and writes nothing", async () => {
    server.use(
      http.get(OUTPUT_URL, () => new HttpResponse(null, { status: 502 }))
    )

    await expect(
      downloadOutput({
        url: OUTPUT_URL,
        project: opened.project,
        generationId,
        index: 0,
      })
    ).rejects.toThrow(/502/)
    expect(await tmpEntries()).toEqual([])
  })

  it("refuses a URL that is neither http(s) nor data:", async () => {
    await expect(
      downloadOutput({
        url: "file:///etc/passwd",
        project: opened.project,
        generationId,
        index: 0,
      })
    ).rejects.toThrow(/file:/)
  })
})
