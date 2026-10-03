// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { createElement } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { asset, container } from "./fixtures"

const invoke = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ipc", () => ({
  invoke,
  isBridgeAvailable: () => true,
  subscribe: () => () => {},
  pathsForFiles: () => [],
}))

const { CropImageDialog } = await import("./crop-image-dialog")
const { AssetLibrary } = await import("./asset-library")

const SELFIE = asset({
  id: "selfie",
  originalName: "group selfie.jpg",
  mimeType: "image/jpeg",
  url: "asset://media/selfie.jpg",
})

function wrap(node: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(createElement(QueryClientProvider, { client }, node))
}

/** jsdom never decodes images; pretend this one is 4000×2000. */
function loadImage(img: HTMLElement, width = 4000, height = 2000) {
  Object.defineProperty(img, "naturalWidth", { value: width })
  Object.defineProperty(img, "naturalHeight", { value: height })
  fireEvent.load(img)
}

afterEach(() => {
  cleanup()
  invoke.mockReset()
})

describe("CropImageDialog", () => {
  it("saves a square crop of the original as a new asset in the container", async () => {
    const user = userEvent.setup()
    invoke.mockResolvedValue(
      asset({ id: "crop", originalName: "group selfie (crop).jpg" })
    )
    const onClose = vi.fn()
    const onCropped = vi.fn()

    wrap(
      createElement(CropImageDialog, {
        asset: SELFIE,
        containerId: "venkz",
        containerName: "venkz",
        onClose,
        onCropped,
      })
    )

    expect(
      screen.getByRole("heading", { name: "Crop group selfie.jpg" })
    ).toBeInTheDocument()
    loadImage(screen.getByRole("img", { name: "group selfie.jpg" }))
    expect(screen.getByText("3600 × 1800 px")).toBeInTheDocument()

    await user.click(screen.getByRole("radio", { name: "1:1" }))
    expect(screen.getByText("1800 × 1800 px")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Save as new image" }))

    await waitFor(() => expect(onCropped).toHaveBeenCalled())
    expect(invoke).toHaveBeenCalledTimes(1)
    const [channel, payload] = invoke.mock.calls[0]!
    expect(channel).toBe("assets:crop")
    expect(payload.assetId).toBe("selfie")
    expect(payload.containerId).toBe("venkz")
    expect(payload.rect.x).toBeCloseTo(0.275)
    expect(payload.rect.y).toBeCloseTo(0.05)
    expect(payload.rect.width).toBeCloseTo(0.45)
    expect(payload.rect.height).toBeCloseTo(0.9)
    expect(onClose).toHaveBeenCalled()
  })

  it("never calls main when cancelled", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    wrap(
      createElement(CropImageDialog, {
        asset: SELFIE,
        containerId: "venkz",
        onClose,
      })
    )
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onClose).toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe("AssetLibrary crop entry points", () => {
  const clip = asset({ id: "clip", kind: "video", originalName: "clip.mp4" })

  function mountLibrary() {
    invoke.mockImplementation((channel: string) =>
      channel === "assets:list"
        ? Promise.resolve({ items: [SELFIE, clip], total: 2, nextOffset: null })
        : Promise.reject(new Error(`unexpected ${channel}`))
    )
    wrap(
      createElement(AssetLibrary, {
        node: container({ id: "venkz", name: "venkz" }),
      })
    )
  }

  it("offers Crop… in an image card's menu only, and opens the crop dialog", async () => {
    const user = userEvent.setup()
    mountLibrary()

    // No standalone button: Crop lives in the card menu, between Move and Delete.
    await screen.findByRole("button", { name: "Preview group selfie.jpg" })
    expect(
      screen.queryByRole("button", { name: "Crop group selfie.jpg" })
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole("button", { name: "More actions for group selfie.jpg" })
    )
    expect(
      (await screen.findAllByRole("menuitem")).map((item) => item.textContent)
    ).toEqual(["Move to…", "Crop…", "Delete…"])
    await user.click(screen.getByRole("menuitem", { name: "Crop…" }))
    expect(
      await screen.findByRole("heading", { name: "Crop group selfie.jpg" })
    ).toBeInTheDocument()
  })

  it("has no Crop… in a clip's menu", async () => {
    const user = userEvent.setup()
    mountLibrary()
    await user.click(
      await screen.findByRole("button", { name: "More actions for clip.mp4" })
    )
    expect(
      (await screen.findAllByRole("menuitem")).map((item) => item.textContent)
    ).toEqual(["Move to…", "Delete…"])
  })

  it("opens a card in the full-size viewer, whose Crop opens the crop dialog", async () => {
    const user = userEvent.setup()
    mountLibrary()

    await user.click(
      await screen.findByRole("button", { name: "Preview group selfie.jpg" })
    )
    expect(
      await screen.findByRole("dialog", { name: "Full-size viewer" })
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Crop" }))

    expect(
      await screen.findByRole("heading", { name: "Crop group selfie.jpg" })
    ).toBeInTheDocument()
    expect(invoke).not.toHaveBeenCalledWith("assets:crop", expect.anything())
  })
})
