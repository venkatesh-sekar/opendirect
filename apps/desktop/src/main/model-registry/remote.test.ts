/**
 * ⛔ Every request here is served by `msw`; the root harness errors on any
 * request no handler claims, so nothing reaches GitHub. Each handler records
 * the method it saw, and the tests assert that the registry only ever GETs.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { http, HttpResponse } from "msw"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { server } from "../../../../../test/msw/server"
import {
  MAX_REGISTRY_JSON_BYTES,
  createRemoteSource,
  type RemoteCache,
} from "./remote"

const BASE =
  "https://raw.githubusercontent.com/example/opendirect/main/registry"
const NOW = 1_790_000_000_000

const family = (id: string) => ({
  id,
  name: id,
  kind: "image",
  endpoints: [{ provider: "replicate", model: `me/${id}` }],
})

let dir: string
let path: string
let methods: string[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "opendirect-registry-"))
  path = join(dir, "model-registry.json")
  methods = []
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function serve(files: Record<string, { status: number; body?: unknown }>) {
  server.use(
    http.all(`${BASE}/*`, ({ request }) => {
      methods.push(request.method)
      const name = new URL(request.url).pathname.split("/registry/")[1] ?? ""
      const file = files[name]
      if (!file || file.status !== 200) {
        return new HttpResponse("Not Found", { status: file?.status ?? 404 })
      }
      return HttpResponse.json(file.body as Record<string, unknown>)
    })
  )
}

describe("createRemoteSource", () => {
  it("fetches the index and every listed family, then writes the cache", async () => {
    serve({
      "index.json": {
        status: 200,
        body: { format: 1, registryVersion: 3, families: ["a", "b"] },
      },
      "models/a.json": { status: 200, body: family("a") },
      "models/b.json": { status: 200, body: family("b") },
    })
    const source = createRemoteSource({ path, now: () => NOW })

    const cache = await source.fetch(BASE)
    source.write(cache)

    expect(cache).toEqual({
      version: 1,
      url: BASE,
      fetchedAt: NOW,
      index: { format: 1, registryVersion: 3, families: ["a", "b"] },
      files: { a: family("a"), b: family("b") },
    })
    expect(source.read()).toEqual(cache)
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(cache)
    expect(methods).toEqual(["GET", "GET", "GET"])
  })

  it("rejects on a missing index and leaves the previous cache alone", async () => {
    const previous: RemoteCache = {
      version: 1,
      url: BASE,
      fetchedAt: 1,
      index: { format: 1, registryVersion: 2, families: [] },
      files: {},
    }
    const source = createRemoteSource({ path, now: () => NOW })
    source.write(previous)
    serve({})

    await expect(source.fetch(BASE)).rejects.toThrow(
      `Could not fetch the model registry from ${BASE}: HTTP 404`
    )
    expect(source.read()).toEqual(previous)
    expect(methods).toEqual(["GET"])
  })

  it("rejects an index that is not a registry index", async () => {
    serve({ "index.json": { status: 200, body: { hello: "world" } } })
    const source = createRemoteSource({ path, now: () => NOW })

    await expect(source.fetch(BASE)).rejects.toThrow(
      `Could not fetch the model registry from ${BASE}:`
    )
  })

  it("records a family file that failed, and keeps the others", async () => {
    serve({
      "index.json": {
        status: 200,
        body: { format: 1, registryVersion: 3, families: ["a", "gone"] },
      },
      "models/a.json": { status: 200, body: family("a") },
    })
    const source = createRemoteSource({ path, now: () => NOW })

    const cache = await source.fetch(BASE)

    expect(cache.files).toEqual({
      a: family("a"),
      gone: { __error: "HTTP 404" },
    })
    expect(methods.every((method) => method === "GET")).toBe(true)
  })

  it("fetches no family files for a format it does not understand", async () => {
    serve({
      "index.json": {
        status: 200,
        body: { format: 2, registryVersion: 9, families: ["a"] },
      },
    })
    const source = createRemoteSource({ path, now: () => NOW })

    const cache = await source.fetch(BASE)

    expect(cache.files).toEqual({})
    expect(methods).toEqual(["GET"])
  })

  it("refuses a registry file larger than the cap", async () => {
    const pad = "x".repeat(MAX_REGISTRY_JSON_BYTES)
    serve({
      "index.json": {
        status: 200,
        body: { format: 1, registryVersion: 3, families: ["a", "big"] },
      },
      "models/a.json": { status: 200, body: family("a") },
      "models/big.json": { status: 200, body: { ...family("big"), pad } },
    })
    const source = createRemoteSource({ path, now: () => NOW })

    const cache = await source.fetch(BASE)

    expect(cache.files.a).toEqual(family("a"))
    expect(cache.files.big).toEqual({
      __error: "The file is larger than 2 MB.",
    })

    serve({
      "index.json": {
        status: 200,
        body: { format: 1, registryVersion: 3, families: [], pad },
      },
    })
    await expect(source.fetch(BASE)).rejects.toThrow(
      `Could not fetch the model registry from ${BASE}: The file is larger than 2 MB.`
    )
  })

  it("strips a trailing slash from the base URL", async () => {
    serve({
      "index.json": {
        status: 200,
        body: { format: 1, registryVersion: 1, families: [] },
      },
    })
    const source = createRemoteSource({ path, now: () => NOW })

    const cache = await source.fetch(`${BASE}/`)

    expect(cache.url).toBe(BASE)
  })

  it("reads a missing or corrupt cache as none", () => {
    const source = createRemoteSource({ path, now: () => NOW })
    expect(source.read()).toBeNull()
    writeFileSync(path, "{ not json", "utf8")
    expect(source.read()).toBeNull()
    writeFileSync(path, JSON.stringify({ version: 7 }), "utf8")
    expect(source.read()).toBeNull()
  })
})
