// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import type { AssetDto } from "@opendirect/contract"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * ⛔ The bridge is a spy. The only channels this viewer can reach are the two
 * shell actions — open a file, reveal it — and neither spends anything.
 */
const invoke = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ipc", () => ({
  invoke,
  isBridgeAvailable: () => true,
  subscribe: () => () => {},
}))

const { MediaViewer, assetSlide, isViewable, mediaFacts } =
  await import("./media-viewer")

function asset(overrides: Partial<AssetDto> = {}): AssetDto {
  return {
    id: "asset-1",
    projectId: "proj-1",
    kind: "image",
    relPath: "media/asset-1.png",
    text: null,
    mimeType: "image/png",
    width: 1024,
    height: 768,
    durationMs: null,
    bytes: 1024,
    sha256: "abc",
    thumbnailRelPath: null,
    label: null,
    originalName: "bellhop.png",
    pinned: false,
    generationId: "gen-1",
    createdAt: 1,
    url: "asset://media/asset-1.png",
    thumbnailUrl: "asset://thumbs/asset-1.webp",
    ...overrides,
  }
}

function mount(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

/** The element the lightbox's keyboard and pointer sensors listen on. */
function controls(viewer: HTMLElement): HTMLElement {
  const container = viewer.querySelector<HTMLElement>(".yarl__container")
  if (!container) throw new Error("the lightbox rendered no container")
  return container
}

afterEach(() => {
  cleanup()
  invoke.mockReset()
})

describe("slides", () => {
  it("shows the full file, not the thumbnail, with its size as a fact", () => {
    const slide = assetSlide(asset(), { title: "Nano Banana 2" })
    expect(slide).toMatchObject({
      src: "asset://media/asset-1.png",
      width: 1024,
      height: 768,
      title: "Nano Banana 2",
    })
    expect(mediaFacts(asset())).toBe("1024 × 768")
  })

  it("turns a clip into a video slide with its own type and length", () => {
    const clip = asset({
      kind: "video",
      mimeType: "video/webm",
      url: "asset://media/clip.webm",
      durationMs: 5_000,
      thumbnailUrl: null,
    })
    expect(assetSlide(clip)).toMatchObject({
      type: "video",
      sources: [{ src: "asset://media/clip.webm", type: "video/webm" }],
    })
    expect(mediaFacts(clip)).toBe("1024 × 768 · 5.0s")
  })

  it("only offers what has a file to look at", () => {
    expect(isViewable(asset())).toBe(true)
    expect(isViewable(asset({ url: null }))).toBe(false)
    expect(isViewable(asset({ kind: "text", url: null, text: "hi" }))).toBe(
      false
    )
  })
})

describe("MediaViewer", () => {
  const pair = [
    asset(),
    asset({ id: "asset-2", originalName: "lift.png", relPath: "media/2.png" }),
  ]

  it("renders nothing while closed", () => {
    mount(
      <MediaViewer assets={pair} index={0} open={false} onClose={vi.fn()} />
    )
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("opens on the asked-for output, with its caption, and walks the set", async () => {
    mount(
      <MediaViewer
        assets={pair}
        index={1}
        open
        onClose={vi.fn()}
        caption={(one) => ({ title: `Take ${one.id}`, prompt: "a bellhop" })}
      />
    )

    const viewer = await screen.findByRole("dialog", {
      name: "Full-size viewer",
    })
    expect(viewer).toHaveTextContent("2 of 2")
    expect(viewer).toHaveTextContent("Take asset-2")
    expect(viewer).toHaveTextContent("a bellhop")
    expect(viewer).toHaveTextContent("1024 × 768")

    fireEvent.click(screen.getByRole("button", { name: "Previous" }))
    await waitFor(() => expect(viewer).toHaveTextContent("1 of 2"))
  })

  it("opens and reveals the file on screen through the shell, and nothing else", async () => {
    invoke.mockResolvedValue({ ok: true })
    mount(<MediaViewer assets={pair} index={1} open onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole("button", { name: "Open" }))
    fireEvent.click(screen.getByRole("button", { name: "Reveal in folder" }))

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    expect(invoke).toHaveBeenCalledWith("shell:openAsset", {
      assetId: "asset-2",
    })
    expect(invoke).toHaveBeenCalledWith("shell:revealAsset", {
      assetId: "asset-2",
    })
  })

  it("closes on Escape", async () => {
    const onClose = vi.fn()
    mount(<MediaViewer assets={pair} index={0} open onClose={onClose} />)

    fireEvent.keyDown(controls(await screen.findByRole("dialog")), {
      key: "Escape",
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it("closes from its close button", async () => {
    const onClose = vi.fn()
    mount(<MediaViewer assets={pair} index={0} open onClose={onClose} />)

    fireEvent.click(await screen.findByRole("button", { name: "Close" }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it("keeps its keys and clicks from reaching the surface it was opened on", async () => {
    const parentKeys = vi.fn()
    const parentClicks = vi.fn()
    mount(
      <div onKeyDown={parentKeys} onClick={parentClicks}>
        <MediaViewer assets={pair} index={0} open onClose={vi.fn()} />
      </div>
    )

    const viewer = await screen.findByRole("dialog")
    expect(viewer).toHaveClass("nokey")
    fireEvent.keyDown(controls(viewer), { key: "ArrowRight" })
    await waitFor(() => expect(viewer).toHaveTextContent("2 of 2"))
    fireEvent.click(screen.getByRole("button", { name: "Previous" }))

    expect(parentKeys).not.toHaveBeenCalled()
    expect(parentClicks).not.toHaveBeenCalled()
  })

  it("hides the arrows when there is only one output", async () => {
    mount(<MediaViewer assets={[asset()]} index={0} open onClose={vi.fn()} />)
    await screen.findByRole("dialog")
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull()
  })

  it("has no file actions for an asset with no file on disk", async () => {
    mount(
      <MediaViewer
        assets={[asset({ relPath: null })]}
        index={0}
        open
        onClose={vi.fn()}
      />
    )
    await screen.findByRole("dialog")
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull()
  })
})
