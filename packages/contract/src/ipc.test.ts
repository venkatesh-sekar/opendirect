import { describe, expect, it } from "vitest"

import {
  ipcChannels,
  ipcContract,
  ipcEventChannels,
  ipcEvents,
  ipcResultSchema,
  isIpcChannel,
  isIpcEventChannel,
  keysSummarySchema,
  settingsDefaults,
  settingsSchema,
} from "./ipc"

describe("ipcContract", () => {
  it("validates app:info output", () => {
    const parsed = ipcContract["app:info"].output.parse({
      version: "1.0.0",
      platform: "linux",
      dev: false,
      catalogRefreshAccelerator: "mod+r",
    })
    expect(parsed.platform).toBe("linux")
    // The chord main hands the renderer; see `apps/desktop/src/main/menu.ts`.
    expect(parsed.catalogRefreshAccelerator).toBe("mod+r")
  })

  it("rejects malformed app:info output", () => {
    expect(() => ipcContract["app:info"].output.parse({ version: 1 })).toThrow()
  })

  it("accepts no input for app:info and rejects a payload", () => {
    expect(ipcContract["app:info"].input.parse(undefined)).toBeUndefined()
    expect(() => ipcContract["app:info"].input.parse({ nope: true })).toThrow()
  })

  it("gives every channel both an input and an output schema", () => {
    expect(ipcChannels.length).toBeGreaterThan(0)
    for (const channel of ipcChannels) {
      const spec = ipcContract[channel]
      expect(typeof spec.input.safeParse).toBe("function")
      expect(typeof spec.output.safeParse).toBe("function")
    }
  })
})

describe("project channels", () => {
  it("declares every project, container, asset and generation channel", () => {
    for (const channel of [
      "project:current",
      "project:recent",
      "project:create",
      "project:open",
      "project:choose",
      "containers:tree",
      "containers:summaries",
      "containers:related",
      "containers:create",
      "containers:rename",
      "containers:reparent",
      "containers:delete",
      "assets:list",
      "assets:choose",
      "assets:import",
      "assets:get",
      "assets:addToContainer",
      "assets:removeFromContainer",
      "generations:list",
      "generations:get",
      "generations:lineage",
      "generations:submit",
      "cost:estimate",
      "shell:openAsset",
      "shell:revealAsset",
    ]) {
      expect(isIpcChannel(channel)).toBe(true)
    }
  })

  it("takes an asset id to open, never a filesystem path", () => {
    const { input } = ipcContract["shell:openAsset"]
    expect(input.safeParse({ assetId: "a1" }).success).toBe(true)
    expect(input.safeParse({ path: "/etc/passwd" }).success).toBe(false)
    expect(input.safeParse({ assetId: "" }).success).toBe(false)
  })

  it("rejects a container kind the schema does not know", () => {
    const { input } = ipcContract["containers:create"]
    expect(input.safeParse({ kind: "scene", name: "Lobby" }).success).toBe(true)
    expect(input.safeParse({ kind: "moodboard", name: "Lobby" }).success).toBe(
      false
    )
    expect(input.safeParse({ kind: "scene", name: "" }).success).toBe(false)
  })

  it("creates a shot, and picks and reorders one by id", () => {
    expect(
      ipcContract["containers:create"].input.safeParse({
        kind: "shot",
        name: "Shot 1",
        parentId: "hall",
      }).success
    ).toBe(true)
    const pick = ipcContract["containers:setPick"].input
    expect(pick.safeParse({ id: "s1", assetId: "a1" }).success).toBe(true)
    expect(pick.safeParse({ id: "s1", assetId: null }).success).toBe(true)
    expect(pick.safeParse({ id: "s1" }).success).toBe(false)
    const reorder = ipcContract["containers:reorder"].input
    expect(reorder.safeParse({ id: "s1", index: 0 }).success).toBe(true)
    expect(reorder.safeParse({ id: "s1", index: -1 }).success).toBe(false)
    expect(reorder.safeParse({ id: "s1", index: 1.5 }).success).toBe(false)
  })

  it("requires at least one path to import", () => {
    const { input } = ipcContract["assets:import"]
    expect(input.safeParse({ paths: [] }).success).toBe(false)
    expect(input.safeParse({ paths: ["/tmp/a.png"] }).success).toBe(true)
  })

  it("hands the renderer asset:// URLs, never a filesystem path", () => {
    const parsed = ipcContract["assets:list"].output.parse({
      items: [
        {
          id: "a1",
          projectId: "p1",
          kind: "image",
          relPath: "assets/2026/09/a1.png",
          text: null,
          mimeType: "image/png",
          width: 64,
          height: 64,
          durationMs: null,
          bytes: 100,
          sha256: "abc",
          thumbnailRelPath: "thumbnails/a1.webp",
          label: null,
          originalName: "a1.png",
          pinned: false,
          generationId: null,
          createdAt: 1,
          url: "asset://media/assets/2026/09/a1.png",
          thumbnailUrl: "asset://media/thumbnails/a1.webp",
        },
      ],
      total: 1,
      nextOffset: null,
    })
    expect(parsed.items[0]?.url).toMatch(/^asset:\/\//)
  })

  it("lists generations for one container or for the whole project", () => {
    const { input } = ipcContract["generations:list"]
    expect(input.safeParse({ containerId: "c1" }).success).toBe(true)
    // Omitted means every run in the open project, newest first.
    expect(input.safeParse({}).success).toBe(true)
    expect(input.safeParse({ limit: 12 }).success).toBe(true)
    expect(input.safeParse({ containerId: 7 }).success).toBe(false)
  })

  it("summarises containers with a nullable cover asset", () => {
    const { input, output } = ipcContract["containers:summaries"]
    expect(input.parse(undefined)).toBeUndefined()
    expect(input.safeParse({ id: "c1" }).success).toBe(false)
    const parsed = output.parse([
      {
        id: "c1",
        assetCount: 0,
        generationCount: 0,
        coverAsset: null,
        lastActivityAt: 1,
        castIds: [],
      },
    ])
    expect(parsed[0]?.coverAsset).toBeNull()
    expect(
      output.safeParse([
        { id: "c1", assetCount: 0, generationCount: 0, lastActivityAt: 1 },
      ]).success
    ).toBe(false)
  })

  it("names a scene's cast, or a character's scenes, as the id's kind", () => {
    const { input, output } = ipcContract["containers:related"]
    expect(input.safeParse({ id: "c1" }).success).toBe(true)
    expect(input.safeParse({}).success).toBe(false)
    const container = {
      id: "c2",
      projectId: "p1",
      parentId: null,
      kind: "character",
      name: "Mira",
      position: 0,
      handle: "mira",
      description: null,
      createdAt: 1,
    }
    const cast = output.parse({ kind: "scene", characters: [container] })
    expect(cast.kind === "scene" && cast.characters[0]?.name).toBe("Mira")
    expect(output.parse({ kind: "character", scenes: [] })).toEqual({
      kind: "character",
      scenes: [],
    })
    // The arm follows the kind: a scene's answer never carries scenes.
    expect(output.safeParse({ kind: "scene", scenes: [] }).success).toBe(false)
    expect(output.safeParse({ kind: "folder", characters: [] }).success).toBe(
      false
    )
  })

  it("parses a container tree recursively", () => {
    const node = {
      id: "c1",
      projectId: "p1",
      parentId: null,
      kind: "folder" as const,
      name: "Scenes",
      position: 0,
      handle: null,
      description: null,
      createdAt: 1,
      children: [
        {
          id: "c2",
          projectId: "p1",
          parentId: "c1",
          kind: "scene" as const,
          name: "Lobby",
          position: 0,
          handle: "lobby",
          description: "a marble lobby at night",
          createdAt: 2,
          children: [],
        },
      ],
    }
    const parsed = ipcContract["containers:tree"].output.parse([node])
    expect(parsed[0]?.children[0]?.name).toBe("Lobby")
  })
})

describe("isIpcChannel", () => {
  it("accepts declared channels", () => {
    expect(isIpcChannel("app:info")).toBe(true)
  })

  it("rejects undeclared channels and inherited keys", () => {
    for (const value of [
      "app:eval",
      "",
      "toString",
      "constructor",
      "__proto__",
      42,
      null,
      undefined,
      { toString: () => "app:info" },
    ]) {
      expect(isIpcChannel(value)).toBe(false)
    }
  })
})

describe("ipcEvents", () => {
  it("validates an updater status payload", () => {
    expect(
      ipcEvents["updater:status"].payload.parse({
        state: "downloading",
        percent: 42,
      })
    ).toEqual({ state: "downloading", percent: 42 })
  })

  it("rejects an unknown updater state and a malformed payload", () => {
    const { payload } = ipcEvents["updater:status"]
    expect(payload.safeParse({ state: "exploded" }).success).toBe(false)
    expect(payload.safeParse({ state: "available" }).success).toBe(false)
    expect(payload.safeParse("ready").success).toBe(false)
  })

  it("guards event channels the same way", () => {
    expect(ipcEventChannels).toContain("updater:status")
    expect(isIpcEventChannel("updater:status")).toBe(true)
    expect(isIpcEventChannel("app:info")).toBe(false)
    expect(isIpcEventChannel("__proto__")).toBe(false)
  })
})

describe("ipcResultSchema", () => {
  it("parses both arms of the envelope", () => {
    expect(ipcResultSchema.parse({ ok: true, data: { a: 1 } })).toEqual({
      ok: true,
      data: { a: 1 },
    })
    const failure = ipcResultSchema.parse({
      ok: false,
      error: { message: "boom" },
    })
    expect(failure).toEqual({ ok: false, error: { message: "boom" } })
  })

  it("rejects anything that is not an envelope", () => {
    expect(ipcResultSchema.safeParse({ ok: false }).success).toBe(false)
    expect(ipcResultSchema.safeParse({ data: 1 }).success).toBe(false)
    expect(ipcResultSchema.safeParse(null).success).toBe(false)
  })
})

describe("settings channels", () => {
  it("declares every settings channel", () => {
    for (const channel of [
      "settings:get",
      "settings:set",
      "settings:projectRoot:choose",
      "settings:keys:summary",
      "settings:keys:set",
      "settings:keys:clear",
      "settings:keys:verify",
    ] as const) {
      expect(ipcChannels).toContain(channel)
    }
  })

  it("matches the documented settings defaults", () => {
    expect(settingsSchema.parse(settingsDefaults)).toEqual(settingsDefaults)
    expect(settingsDefaults.maxConcurrentJobs).toBe(2)
    expect(settingsDefaults.pollIntervalMs).toBe(3000)
    expect(settingsDefaults).toMatchObject({
      providerOrder: ["replicate", "openrouter"],
      remoteRegistry: true,
      registryUrl: null,
      includeUnverified: false,
    })
  })

  it("accepts a provider order patch and rejects an unknown provider", () => {
    const { input } = ipcContract["settings:set"]
    expect(input.parse({ providerOrder: ["openrouter"] })).toEqual({
      providerOrder: ["openrouter"],
    })
    expect(input.safeParse({ providerOrder: ["midjourney"] }).success).toBe(
      false
    )
    expect(input.safeParse({ registryUrl: "not a url" }).success).toBe(false)
    expect(
      input.safeParse({ registryUrl: "http://example.test/registry" }).success
    ).toBe(false)
    expect(
      input.safeParse({ registryUrl: "file:///etc/registry" }).success
    ).toBe(false)
    expect(
      input.safeParse({ registryUrl: "https://example.test/registry" }).success
    ).toBe(true)
  })

  it("rejects out-of-range settings", () => {
    expect(
      settingsSchema.safeParse({ ...settingsDefaults, maxConcurrentJobs: 0 })
        .success
    ).toBe(false)
    expect(
      settingsSchema.safeParse({ ...settingsDefaults, pollIntervalMs: 10 })
        .success
    ).toBe(false)
  })

  it("accepts a partial patch for settings:set", () => {
    const parsed = ipcContract["settings:set"].input.parse({ theme: "dark" })
    expect(parsed).toEqual({ theme: "dark" })
  })

  it("only allows the two known providers on a key channel", () => {
    const { input } = ipcContract["settings:keys:set"]
    expect(
      input.safeParse({ provider: "replicate", key: "r8_x" }).success
    ).toBe(true)
    expect(input.safeParse({ provider: "midjourney", key: "x" }).success).toBe(
      false
    )
    expect(input.safeParse({ provider: "replicate", key: "" }).success).toBe(
      false
    )
  })

  it("keeps the key summary redacted — presence, tail and source only", () => {
    const status = { present: true, last4: "3456", source: "vault" }
    const parsed = keysSummarySchema.parse({
      encryptionAvailable: true,
      replicate: status,
      openrouter: { present: false, last4: null, source: "none" },
      secret: "should be stripped",
    })
    expect(JSON.stringify(parsed)).not.toContain("should be stripped")
    expect(Object.keys(parsed.replicate).sort()).toEqual([
      "last4",
      "present",
      "source",
    ])
  })
})

describe("generation submission", () => {
  const request = {
    modelKey: "replicate:bytedance/seedance-2.5",
    containerId: "c1",
    prompt: "a bellhop opens the lift",
    params: { duration: 5, resolution: "720p" },
    references: [{ slotField: "reference_images", assetId: "a1", position: 0 }],
    estimatedCostUsd: 1.156,
    costConfidence: "estimated",
    parentGenerationId: null,
  }

  it("accepts a fully formed request", () => {
    expect(
      ipcContract["generations:submit"].input.safeParse(request).success
    ).toBe(true)
  })

  it("records which containers the prompt mentioned, unknown by default", () => {
    const { input } = ipcContract["generations:submit"]
    // Left out — a caller that knows nothing of mentions — is "not recorded",
    // which is not the same as "mentioned nobody".
    expect(input.parse(request).mentionedContainerIds).toBeNull()
    expect(
      input.parse({ ...request, mentionedContainerIds: [] })
        .mentionedContainerIds
    ).toEqual([])
    expect(
      input.parse({ ...request, mentionedContainerIds: ["c2", "c3"] })
        .mentionedContainerIds
    ).toEqual(["c2", "c3"])
    expect(
      input.safeParse({ ...request, mentionedContainerIds: [""] }).success
    ).toBe(false)
  })

  it("carries a family run's provider override, and no family until main sets one", () => {
    const { input } = ipcContract["generations:submit"]
    const parsed = input.parse(request)
    expect(parsed.providerOverride).toBeNull()
    expect(parsed.familyId).toBeNull()
    expect(parsed.shapes).toBeNull()
    expect(
      input.parse({
        ...request,
        shapes: { elements: "kling-elements", image: null },
      }).shapes
    ).toEqual({ elements: "kling-elements", image: null })
    expect(
      input.parse({
        ...request,
        modelKey: "family:seedance-2-5",
        providerOverride: "openrouter",
      }).providerOverride
    ).toBe("openrouter")
    expect(
      input.safeParse({ ...request, providerOverride: "fal" }).success
    ).toBe(false)
  })

  it("rejects a request with no model", () => {
    expect(
      ipcContract["generations:submit"].input.safeParse({
        ...request,
        modelKey: "",
      }).success
    ).toBe(false)
  })

  it("rejects a reference with no slot to go in", () => {
    expect(
      ipcContract["generations:submit"].input.safeParse({
        ...request,
        references: [{ assetId: "a1", position: 0 }],
      }).success
    ).toBe(false)
  })

  it("lets a cost be unknown without inventing a number", () => {
    const quote = ipcContract["cost:estimate"].output.parse({
      amount: 0,
      currency: "USD",
      basis: "unknown",
      confidence: "unknown",
      source: "none",
      note: "No published rate.",
      sku: null,
    })
    expect(quote.confidence).toBe("unknown")
  })
})

describe("canvas channels", () => {
  it("declares every canvas channel", () => {
    for (const channel of [
      "canvas:get",
      "canvas:node:create",
      "canvas:node:update",
      "canvas:node:move",
      "canvas:node:delete",
      "canvas:node:pick",
      "canvas:edge:create",
      "canvas:edge:update",
      "canvas:edge:delete",
      "canvas:migrate",
    ] as const) {
      expect(ipcChannels).toContain(channel)
      expect(isIpcChannel(channel)).toBe(true)
    }
  })

  it("only accepts the four node types", () => {
    const { input } = ipcContract["canvas:node:create"]
    const base = { x: 0, y: 0, width: 320, height: 180 }
    for (const type of ["text", "media", "image_gen", "video_gen"]) {
      expect(input.safeParse({ ...base, type }).success).toBe(true)
    }
    expect(input.safeParse({ ...base, type: "audio_gen" }).success).toBe(false)
    expect(input.safeParse({ ...base, type: "media", width: 0 }).success).toBe(
      false
    )
  })

  it("moves many nodes in one call, resizing only when asked", () => {
    const parsed = ipcContract["canvas:node:move"].input.parse({
      moves: [
        { id: "n1", x: 10, y: 20 },
        { id: "n2", x: 30, y: 40, width: 100, height: 100 },
      ],
    })
    expect(parsed.moves).toHaveLength(2)
    expect(parsed.moves[0]?.width).toBeUndefined()
    expect(parsed.moves[1]?.height).toBe(100)
  })

  it("lets a text edge carry no slot field, but never an empty one", () => {
    const { input } = ipcContract["canvas:edge:create"]
    const base = { sourceNodeId: "n1", targetNodeId: "n2" }
    expect(input.safeParse(base).success).toBe(true)
    expect(input.safeParse({ ...base, slotField: null }).success).toBe(true)
    expect(
      input.safeParse({ ...base, slotField: "reference_images" }).success
    ).toBe(true)
    expect(input.safeParse({ ...base, slotField: "" }).success).toBe(false)
  })

  it("leaves a patch's omitted fields out rather than nulling them", () => {
    const parsed = ipcContract["canvas:node:update"].input.parse({
      id: "n1",
      patch: { pickAssetId: "a2" },
    })
    expect(parsed.patch).toEqual({ pickAssetId: "a2" })
    // `null` is a value here — "no pick" — not an absence.
    expect(
      ipcContract["canvas:node:update"].input.parse({
        id: "n1",
        patch: { pickAssetId: null },
      }).patch.pickAssetId
    ).toBeNull()
  })

  it("parses a node with its resolved generation and no asset", () => {
    const parsed = ipcContract["canvas:node:pick"].output.parse({
      id: "n1",
      projectId: "p1",
      type: "image_gen",
      x: 0,
      y: 0,
      width: 512,
      height: 512,
      assetId: null,
      generationId: null,
      batchId: "b1",
      pickAssetId: null,
      modelKey: "replicate:google/nano-banana-2",
      text: null,
      color: null,
      createdAt: 1,
      updatedAt: 2,
      asset: null,
      generation: null,
    })
    expect(parsed.batchId).toBe("b1")
    // The chosen model rides on the row, so an edge's slot can be resolved
    // before the node has ever run.
    expect(parsed.modelKey).toBe("replicate:google/nano-banana-2")
    expect(parsed.asset).toBeNull()
  })
})

describe("batched generation requests", () => {
  it("defaults batchId to null so an existing caller still validates", () => {
    const parsed = ipcContract["generations:submit"].input.parse({
      modelKey: "replicate:bytedance/seedance-2.5",
      containerId: null,
      prompt: null,
      params: {},
      references: [],
      estimatedCostUsd: null,
      costConfidence: null,
      parentGenerationId: null,
    })
    expect(parsed.batchId).toBeNull()
  })

  it("carries a batch id when the canvas sets one", () => {
    const parsed = ipcContract["generations:submit"].input.parse({
      modelKey: "replicate:bytedance/seedance-2.5",
      containerId: null,
      prompt: null,
      params: {},
      references: [],
      estimatedCostUsd: null,
      costConfidence: null,
      parentGenerationId: null,
      batchId: "b1",
    })
    expect(parsed.batchId).toBe("b1")
  })
})

describe("model registry channels", () => {
  const family = {
    id: "my-model",
    name: "My model",
    kind: "image",
    endpoints: [{ provider: "replicate", model: "me/my-model" }],
  }
  const override = {
    key: "k1",
    id: "my-model",
    raw: family,
    family,
    issues: [],
    updatedAt: 1,
  }

  it("parses a status with a remote error", () => {
    const parsed = ipcContract["registry:status"].output.parse({
      format: 1,
      bundledVersion: 1,
      activeVersion: 1,
      activeSource: "bundled",
      remote: {
        enabled: true,
        url: "https://example.com/registry",
        version: null,
        fetchedAt: null,
        error:
          "Could not fetch the model registry from https://example.com/registry: HTTP 404",
      },
      overrides: 0,
      families: 5,
      warnings: [],
    })
    expect(parsed.remote.error).toContain("HTTP 404")
    expect(ipcContract["registry:reload"].output.parse(parsed)).toEqual(parsed)
  })

  it("parses families and overrides, invalid ones included", () => {
    expect(
      ipcContract["registry:families"].output.parse([
        { family, source: "user", shadows: ["bundled"], warnings: [] },
      ])
    ).toHaveLength(1)
    const broken = {
      key: "legacy-1",
      id: null,
      raw: { name: 1 },
      family: null,
      issues: [{ path: "name", message: "Expected a string" }],
      updatedAt: 2,
    }
    expect(
      ipcContract["registry:overrides:list"].output.parse([override, broken])
    ).toHaveLength(2)
  })

  it("takes any JSON to save and answers with the saved entry or per-field issues", () => {
    const input = ipcContract["registry:overrides:save"].input.parse({
      family: { anything: true },
      replaceId: null,
    })
    expect(input.replaceId).toBeNull()
    expect(
      ipcContract["registry:overrides:save"].output.parse({
        ok: true,
        override,
      })
    ).toMatchObject({ ok: true })
    const rejected = ipcContract["registry:overrides:save"].output.parse({
      ok: false,
      issues: [{ path: "endpoints.0.model", message: "Too small" }],
    })
    expect(rejected).toEqual({
      ok: false,
      issues: [{ path: "endpoints.0.model", message: "Too small" }],
    })
  })

  it("takes a family key's provider override and filled slots", () => {
    for (const channel of ["models:get", "cost:estimate"] as const) {
      const { input } = ipcContract[channel]
      const base = { key: "family:seedance-2-5", params: {} }
      expect(
        input.parse({
          ...base,
          provider: "openrouter",
          filled: ["first_frame"],
        })
      ).toMatchObject({ provider: "openrouter", filled: ["first_frame"] })
      // Both optional: a concrete key sends neither.
      expect(input.safeParse(base).success).toBe(true)
      expect(input.safeParse({ ...base, provider: null }).success).toBe(true)
      expect(input.safeParse({ ...base, provider: "fal" }).success).toBe(false)
      expect(
        input.safeParse({ ...base, filled: Array(41).fill("reference") })
          .success
      ).toBe(false)
    }
  })

  it("maps model keys to the roles their slots take", () => {
    const { output } = ipcContract["registry:capabilities"]
    expect(
      output.parse({ "replicate:a/b": ["character", "reference"], "x:y": [] })
    ).toEqual({ "replicate:a/b": ["character", "reference"], "x:y": [] })
    expect(output.safeParse({ "replicate:a/b": ["unknown"] }).success).toBe(
      false
    )
  })

  it("parses delete, import and export payloads", () => {
    expect(
      ipcContract["registry:overrides:delete"].input.parse({ key: "k1" })
    ).toEqual({ key: "k1" })
    expect(
      ipcContract["registry:overrides:delete"].input.safeParse({ id: "x" })
        .success
    ).toBe(false)
    expect(
      ipcContract["registry:overrides:import"].output.parse({
        candidates: [override],
      }).candidates
    ).toHaveLength(1)
    expect(
      ipcContract["registry:overrides:export"].input.parse({ id: "my-model" })
    ).toEqual({ id: "my-model" })
    expect(
      ipcContract["registry:overrides:export"].output.parse({ path: null })
    ).toEqual({ path: null })
  })
})
