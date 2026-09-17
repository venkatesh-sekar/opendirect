// Browser-only performance fixture. Inject before application scripts in a
// fresh browser page; never run in the Electron window or a real project.
if (window.opendirect)
  throw new Error("Refusing to replace a real IPC bridge")(() => {
    const nodes = Array.from({ length: 120 }, (_, i) => ({
      id: "n" + i,
      projectId: "perf",
      type: i % 3 === 0 ? "image_gen" : "text",
      x: (i % 12) * 380,
      y: Math.floor(i / 12) * 350,
      width: 320,
      height: 280,
      assetId: null,
      generationId: null,
      batchId: null,
      pickAssetId: null,
      modelKey: null,
      text: "Note " + i,
      color: null,
      createdAt: 1,
      updatedAt: 1,
      asset: null,
      generation: null,
    }))
    const graph = {
      nodes,
      edges: Array.from({ length: 39 }, (_, i) => ({
        id: "e" + i,
        projectId: "perf",
        sourceNodeId: "n" + (i * 3 + 1),
        targetNodeId: "n" + (i * 3 + 3),
        slotField: null,
        createdAt: 1,
      })),
    }
    const listeners = {}
    const calls = []
    window.__canvasTest = { graph, calls, listeners }
    window.opendirect = {
      on: (channel, fn) => {
        ;(listeners[channel] ??= new Set()).add(fn)
        return () => listeners[channel].delete(fn)
      },
      invoke: async (channel, input) => {
        calls.push({ channel, input, time: performance.now() })
        let data
        if (channel === "canvas:get") data = structuredClone(graph)
        else if (channel === "canvas:node:move") {
          for (const move of input.moves)
            Object.assign(
              nodes.find((n) => n.id === move.id),
              move
            )
          data = { ok: true }
        } else if (channel === "canvas:node:update") {
          data = nodes.find((n) => n.id === input.id)
          Object.assign(data, input.patch)
          data = structuredClone(data)
        } else if (channel === "project:current")
          data = {
            project: {
              id: "perf",
              name: "Canvas performance fixture",
              path: "/test",
              createdAt: 1,
            },
          }
        else if (channel === "containers:tree")
          data = [
            {
              id: "shelf",
              projectId: "perf",
              parentId: null,
              kind: "scene",
              name: "Test scene",
              position: 0,
              handle: "test",
              description: null,
              createdAt: 1,
              children: [],
            },
          ]
        else if (channel === "settings:get")
          data = {
            projectRoot: null,
            theme: "dark",
            defaultVideoModel: null,
            defaultImageModel: null,
            maxConcurrentJobs: 2,
            pollIntervalMs: 3000,
            preferredAiTool: null,
          }
        else if (
          channel === "jobs:list" ||
          channel === "project:recent" ||
          channel === "models:list" ||
          channel === "models:recommended"
        )
          data = []
        else if (channel === "ai:tools")
          data = {
            claude: {
              id: "claude",
              available: false,
              path: null,
              version: null,
            },
            codex: { id: "codex", available: false, path: null, version: null },
            preferred: null,
            detectedAt: 1,
          }
        else if (channel === "app:info")
          data = {
            version: "test",
            platform: "linux",
            dev: false,
            catalogRefreshAccelerator: "mod+r",
          }
        else if (channel === "updater:status:get") data = null
        else if (channel === "generations:list" || channel === "assets:list")
          data = { items: [], total: 0, nextOffset: null }
        else
          return {
            ok: false,
            error: {
              code: "TEST_UNHANDLED",
              message: "Unsupported test channel " + channel,
            },
          }
        return { ok: true, data }
      },
    }
  })()
;(() => {
  const test = window.__canvasTest,
    assets = [],
    runs = []
  const asset = (id, generationId, i) => ({
    id,
    projectId: "perf",
    kind: "image",
    relPath: null,
    text: null,
    mimeType: "image/svg+xml",
    width: 2048,
    height: 2048,
    durationMs: null,
    bytes: 200000,
    sha256: null,
    thumbnailRelPath: null,
    label: "Image " + i,
    originalName: null,
    pinned: false,
    generationId,
    createdAt: i + 1,
    url:
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048"><rect width="2048" height="2048" fill="hsl(' +
          i * 17 +
          ' 50% 40%)"/><circle cx="1000" cy="1000" r="600" fill="hsl(' +
          i * 27 +
          ' 60% 60%)"/></svg>'
      ),
    thumbnailUrl: null,
  })
  for (let i = 0; i < test.graph.nodes.length; i++) {
    const node = test.graph.nodes[i]
    if (i % 3 === 2) {
      node.type = "media"
      node.assetId = "a" + i
      node.asset = asset("a" + i, null, i)
      assets.push(node.asset)
    }
    if (i % 3 === 0) {
      const run = {
        id: "g" + i,
        projectId: "perf",
        containerId: "shelf",
        provider: "replicate",
        modelSlug: "test",
        modelVersion: null,
        kind: "image",
        prompt: "A landscape",
        paramsJson: "{}",
        requestJson: null,
        responseJson: null,
        status: "succeeded",
        error: null,
        providerJobId: null,
        estimatedCostUsd: null,
        actualCostUsd: null,
        predictTimeSeconds: null,
        costConfidence: null,
        parentGenerationId: null,
        batchId: null,
        branchNote: null,
        createdAt: i + 1,
        startedAt: 1,
        completedAt: 2,
      }
      runs.push(run)
      node.generation = run
      node.generationId = run.id
      node.modelKey = "replicate:test"
      for (let j = 0; j < 3; j++)
        assets.push(asset("out" + i + "-" + j, run.id, i + j))
      node.pickAssetId = "out" + i + "-0"
      node.asset = assets.find((a) => a.id === node.pickAssetId)
    }
  }
  const original = window.opendirect.invoke
  window.opendirect.invoke = async (channel, input) => {
    let data
    if (channel === "assets:list")
      data = { items: assets, total: assets.length, nextOffset: null }
    else if (channel === "generations:list")
      data = { items: runs, total: runs.length, nextOffset: null }
    else if (channel === "models:list") data = { models: [], failures: [] }
    else if (channel === "models:recommended") data = { image: [], video: [] }
    else if (channel === "models:get")
      data = {
        key: "replicate:test",
        provider: "replicate",
        slug: "test",
        name: "Test image model",
        description: null,
        kind: "image",
        versionId: null,
        coverImageUrl: null,
        inputSchema: {
          type: "object",
          properties: { prompt: { type: "string" } },
        },
        outputSchema: null,
        referenceSlots: [],
        commonControls: {
          prompt: "prompt",
          aspectRatio: null,
          duration: null,
          resolution: null,
          seed: null,
          audio: null,
        },
        pricing: {
          basis: "unknown",
          currency: "USD",
          skus: {},
          estimate: null,
          source: "none",
          note: null,
        },
        raw: {},
        fetchedAt: 1,
      }
    else if (channel === "canvas:node:pick") {
      data = test.graph.nodes.find((n) => n.id === input.id)
      data.pickAssetId = input.assetId
      data.asset = assets.find((a) => a.id === input.assetId)
      data = structuredClone(data)
    } else if (channel === "canvas:node:create") {
      data = {
        ...test.graph.nodes[1],
        ...input,
        id: "new-" + Date.now(),
        text: input.text ?? null,
      }
      test.graph.nodes.push(data)
    } else if (channel === "canvas:node:delete") {
      const gone = new Set(input.ids)
      test.graph.nodes.splice(
        0,
        test.graph.nodes.length,
        ...test.graph.nodes.filter((n) => !gone.has(n.id))
      )
      test.graph.edges = test.graph.edges.filter(
        (e) => !gone.has(e.sourceNodeId) && !gone.has(e.targetNodeId)
      )
      data = { ok: true }
    } else if (channel === "canvas:edge:create") {
      data = {
        id: "new-edge-" + Date.now(),
        projectId: "perf",
        createdAt: Date.now(),
        ...input,
      }
      test.graph.edges.push(data)
    } else if (channel === "canvas:edge:delete") {
      test.graph.edges = test.graph.edges.filter(
        (e) => !input.ids.includes(e.id)
      )
      data = { ok: true }
    } else return original(channel, input)
    test.calls.push({ channel, input, time: performance.now() })
    return { ok: true, data }
  }
})()
window.__canvasBenchmark = {
  drag: async () => {
    const ev = (type, x, y, extra = {}) =>
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: type === "mouseup" ? 0 : 1,
        view: window,
        ...extra,
      })
    const frames = [],
      durations = [],
      longTasks = []
    const observer = new PerformanceObserver((list) =>
      longTasks.push(...list.getEntries().map((e) => e.duration))
    )
    observer.observe({ type: "longtask" })
    const view = document.querySelector(".react-flow").getBoundingClientRect()
    const headers = [
      ...document.querySelectorAll('[data-node-type="text"] header'),
    ]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(
        ({ r }) =>
          r.x > view.x + 60 &&
          r.right < view.right - 80 &&
          r.y > view.y + 60 &&
          r.bottom < view.bottom - 80
      )
    headers.sort(
      (a, b) =>
        Math.hypot(
          a.r.x - view.x - view.width / 2,
          a.r.y - view.y - view.height / 2
        ) -
        Math.hypot(
          b.r.x - view.x - view.width / 2,
          b.r.y - view.y - view.height / 2
        )
    )
    const { el, r } = headers[0],
      id = el.closest(".react-flow__node").dataset.id,
      x = r.x + r.width / 2,
      y = r.y + r.height / 2
    const calls = window.__canvasTest.calls,
      start = calls.length
    await new Promise(requestAnimationFrame)
    let last = performance.now()
    el.dispatchEvent(ev("mousedown", x, y))
    for (let i = 1; i <= 120; i++) {
      await new Promise(requestAnimationFrame)
      const now = performance.now()
      frames.push(now - last)
      last = now
      const begin = performance.now()
      window.dispatchEvent(ev("mousemove", x + i * 0.3, y + i * 0.2))
      durations.push(performance.now() - begin)
    }
    const during = calls
      .slice(start)
      .filter((c) => c.channel === "canvas:node:move").length
    window.dispatchEvent(ev("mouseup", x + 36, y + 24))
    await new Promise((r) => setTimeout(r, 500))
    observer.disconnect()
    const summarize = (a) => {
      a.sort((x, y) => x - y)
      return {
        median: a[Math.floor(a.length * 0.5)],
        p95: a[Math.floor(a.length * 0.95)],
        max: a.at(-1),
        over25ms: a.filter((x) => x > 25).length,
      }
    }
    return {
      nodes: document.querySelectorAll(".react-flow__node").length,
      jobsListeners: window.__canvasTest.listeners["jobs:update"]?.size,
      dragFrames: summarize(frames),
      eventWork: summarize(durations),
      longTasks,
      during,
      writes: calls.slice(start).filter((c) => c.channel === "canvas:node:move")
        .length,
      id,
      position: window.__canvasTest.graph.nodes
        .filter((n) => n.id === id)
        .map((n) => [n.x, n.y])[0],
    }
  },
  dragGeneration: async () => {
    const ev = (type, x, y, extra = {}) =>
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: type === "mouseup" ? 0 : 1,
        view: window,
        ...extra,
      })
    const frames = [],
      durations = [],
      longTasks = []
    const observer = new PerformanceObserver((list) =>
      longTasks.push(...list.getEntries().map((e) => e.duration))
    )
    observer.observe({ type: "longtask" })
    const view = document.querySelector(".react-flow").getBoundingClientRect()
    const headers = [
      ...document.querySelectorAll('[data-node-type="image_gen"] header'),
    ]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(
        ({ r }) =>
          r.x > view.x + 60 &&
          r.right < view.right - 80 &&
          r.y > view.y + 60 &&
          r.bottom < view.bottom - 80
      )
    headers.sort(
      (a, b) =>
        Math.hypot(
          a.r.x - view.x - view.width / 2,
          a.r.y - view.y - view.height / 2
        ) -
        Math.hypot(
          b.r.x - view.x - view.width / 2,
          b.r.y - view.y - view.height / 2
        )
    )
    const { el, r } = headers[0],
      id = el.closest(".react-flow__node").dataset.id,
      x = r.x + r.width / 2,
      y = r.y + r.height / 2
    const calls = window.__canvasTest.calls,
      start = calls.length
    await new Promise(requestAnimationFrame)
    let last = performance.now()
    el.dispatchEvent(ev("mousedown", x, y))
    for (let i = 1; i <= 120; i++) {
      await new Promise(requestAnimationFrame)
      const now = performance.now()
      frames.push(now - last)
      last = now
      const begin = performance.now()
      window.dispatchEvent(ev("mousemove", x + i * 0.3, y + i * 0.2))
      durations.push(performance.now() - begin)
    }
    const during = calls
      .slice(start)
      .filter((c) => c.channel === "canvas:node:move").length
    window.dispatchEvent(ev("mouseup", x + 36, y + 24))
    await new Promise((r) => setTimeout(r, 500))
    observer.disconnect()
    const summarize = (a) => {
      a.sort((x, y) => x - y)
      return {
        median: a[Math.floor(a.length * 0.5)],
        p95: a[Math.floor(a.length * 0.95)],
        max: a.at(-1),
        over25ms: a.filter((x) => x > 25).length,
      }
    }
    return {
      nodes: document.querySelectorAll(".react-flow__node").length,
      jobsListeners: window.__canvasTest.listeners["jobs:update"]?.size,
      dragFrames: summarize(frames),
      eventWork: summarize(durations),
      longTasks,
      during,
      writes: calls.slice(start).filter((c) => c.channel === "canvas:node:move")
        .length,
      id,
      position: window.__canvasTest.graph.nodes
        .filter((n) => n.id === id)
        .map((n) => [n.x, n.y])[0],
    }
  },
  viewport: async () => {
    const pane = document.querySelector(".react-flow__pane"),
      r = pane.getBoundingClientRect(),
      x = r.x + r.width * 0.65,
      y = r.y + r.height * 0.5
    const stats = (a) => {
      a.sort((x, y) => x - y)
      return {
        median: a[Math.floor(a.length * 0.5)],
        p95: a[Math.floor(a.length * 0.95)],
        max: a.at(-1),
        over25ms: a.filter((x) => x > 25).length,
      }
    }
    const frame = () => new Promise(requestAnimationFrame)
    const ev = (type, a, b) =>
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: a,
        clientY: b,
        button: 0,
        buttons: type === "mouseup" ? 0 : 1,
        view: window,
      })
    let frames = []
    await frame()
    let last = performance.now()
    pane.dispatchEvent(ev("mousedown", x, y))
    for (let i = 1; i <= 120; i++) {
      await frame()
      const t = performance.now()
      frames.push(t - last)
      last = t
      window.dispatchEvent(
        ev("mousemove", x + Math.sin(i / 30) * 40, y + Math.cos(i / 30) * 30)
      )
    }
    window.dispatchEvent(ev("mouseup", x, y))
    const pan = stats(frames)
    await new Promise((r) => setTimeout(r, 300))
    frames = []
    await frame()
    last = performance.now()
    for (let i = 0; i < 120; i++) {
      await frame()
      const t = performance.now()
      frames.push(t - last)
      last = t
      pane.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          deltaY: i < 60 ? -1 : 1,
          deltaMode: 0,
        })
      )
    }
    await new Promise((r) => setTimeout(r, 300))
    return {
      pan,
      zoom: stats(frames),
      transform: document.querySelector(".react-flow__viewport").style
        .transform,
    }
  },
}
