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
    })
    expect(parsed.platform).toBe("linux")
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
      "project:close",
      "containers:tree",
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

  it("parses a container tree recursively", () => {
    const node = {
      id: "c1",
      projectId: "p1",
      parentId: null,
      kind: "folder" as const,
      name: "Scenes",
      position: 0,
      createdAt: 1,
      children: [
        {
          id: "c2",
          projectId: "p1",
          parentId: "c1",
          kind: "scene" as const,
          name: "Lobby",
          position: 0,
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
