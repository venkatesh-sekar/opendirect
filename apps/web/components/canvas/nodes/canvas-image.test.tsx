// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { act, cleanup, render, screen } from "@testing-library/react"
import { ReactFlow, ReactFlowProvider, type Node } from "@xyflow/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CanvasImage } from "./canvas-image"

const URL = "asset://media/assets/2026/10/a.jpg"
const THUMB = "asset://media/thumbnails/a.webp"
const photo = { url: URL, thumbnailUrl: THUMB, width: 4032, height: 3024 }

/*
 * jsdom lays nothing out and decodes nothing, so both are driven by hand: a
 * ResizeObserver whose callback the test fires, and an `Image.decode` that
 * resolves when the test says so.
 */
class ControlledResizeObserver {
  /** Every live observer — React Flow makes its own alongside ours. */
  static all = new Set<ControlledResizeObserver>()
  observed = new Set<Element>()
  constructor(readonly callback: (entries: ResizeObserverEntry[]) => void) {
    ControlledResizeObserver.all.add(this)
  }
  observe(element: Element) {
    this.observed.add(element)
  }
  unobserve(element: Element) {
    this.observed.delete(element)
  }
  disconnect() {
    this.observed.clear()
  }
}
vi.stubGlobal("ResizeObserver", ControlledResizeObserver)

function layOut(element: Element, width: number, height: number) {
  const entry = { target: element, contentRect: { width, height } }
  act(() => {
    for (const observer of ControlledResizeObserver.all) {
      if (observer.observed.has(element)) {
        observer.callback([entry as unknown as ResizeObserverEntry])
      }
    }
  })
}

let decodes: { src: string; resolve: () => void }[] = []

beforeEach(() => {
  vi.useFakeTimers()
  decodes = []
  // jsdom has no `decode` at all, so it is defined rather than spied on.
  Object.defineProperty(HTMLImageElement.prototype, "decode", {
    configurable: true,
    value: function (this: HTMLImageElement) {
      return new Promise<void>((resolve) => {
        decodes.push({ src: this.src, resolve })
      })
    },
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete (HTMLImageElement.prototype as { decode?: unknown }).decode
})

/** Lets the settle delay pass, then finishes every pending decode. */
async function settleAndDecode() {
  await act(async () => {
    vi.advanceTimersByTime(200)
  })
  await act(async () => {
    for (const decode of decodes) decode.resolve()
  })
}

describe("CanvasImage outside a canvas", () => {
  it("starts on the thumbnail before it has been measured", () => {
    render(<CanvasImage asset={photo} alt="Photo" />)
    expect(screen.getByAltText("Photo")).toHaveAttribute("src", THUMB)
  })

  it("keeps the thumbnail up until the sharper file has decoded", async () => {
    render(<CanvasImage asset={photo} alt="Photo" />)
    const img = screen.getByAltText("Photo")
    // 600 CSS px wide on a 1× display: the 1024 tier covers it.
    layOut(img, 600, 450)

    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    expect(decodes.map((d) => d.src)).toEqual([`${URL}?w=1024`])
    expect(img).toHaveAttribute("src", THUMB)

    await act(async () => decodes[0]!.resolve())
    expect(img).toHaveAttribute("src", `${URL}?w=1024`)
  })

  it("does not fetch anything while the need keeps changing", async () => {
    render(<CanvasImage asset={photo} alt="Photo" />)
    const img = screen.getByAltText("Photo")
    layOut(img, 600, 450)
    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    layOut(img, 1500, 1125)
    await settleAndDecode()

    // Only the file it settled on — not the 1024 rung on the way.
    expect(decodes.map((d) => d.src)).toEqual([`${URL}?w=2048`])
    expect(img).toHaveAttribute("src", `${URL}?w=2048`)
  })

  it("passes alt, className and other props through to the <img>", () => {
    render(
      <CanvasImage
        asset={photo}
        alt="Photo"
        className="object-cover"
        data-testid="tile"
      />
    )
    const img = screen.getByTestId("tile")
    expect(img.tagName).toBe("IMG")
    expect(img).toHaveClass("object-cover")
  })
})

describe("CanvasImage inside a canvas node", () => {
  function ImageNode() {
    return <CanvasImage asset={photo} alt="On canvas" />
  }
  const nodes: Node[] = [
    { id: "n", type: "image", position: { x: 0, y: 0 }, data: {} },
  ]

  it("scales the need by the viewport zoom", async () => {
    render(
      <div style={{ width: 800, height: 600 }}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            nodeTypes={{ image: ImageNode }}
            defaultViewport={{ x: 0, y: 0, zoom: 4 }}
            maxZoom={8}
          />
        </ReactFlowProvider>
      </div>
    )
    const img = screen.getByAltText("On canvas")
    // 320 CSS px at zoom 4 on a 1× display needs 1280 px: the 2048 tier.
    layOut(img, 320, 240)
    await settleAndDecode()

    expect(img).toHaveAttribute("src", `${URL}?w=2048`)
  })
})
