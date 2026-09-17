// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import type { CanvasNodeDto } from "@opendirect/contract"
import {
  CanvasSurfaceProvider,
  createNoteDrafts,
  type CanvasSurface,
} from "../canvas-context"
import { TextNodeBody } from "./text-node"

vi.mock("@/lib/ipc", () => ({
  invoke: () => Promise.resolve({}),
  isBridgeAvailable: () => true,
}))
afterEach(cleanup)

it("keeps an unsaved note when its offscreen body unmounts, and accepts a newer committed row", () => {
  const client = new QueryClient()
  const surface: CanvasSurface = {
    containerId: null,
    noteDrafts: createNoteDrafts(),
    spawn: vi.fn(),
    pick: vi.fn(),
    branch: vi.fn(),
    selectGeneration: vi.fn(),
  }
  const node = { id: "note", text: "Original", color: null } as CanvasNodeDto
  const view = (visible: boolean, row = node) => (
    <QueryClientProvider client={client}>
      <CanvasSurfaceProvider value={surface}>
        {visible ? <TextNodeBody node={row} /> : null}
      </CanvasSurfaceProvider>
    </QueryClientProvider>
  )
  const { rerender } = render(view(true))
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Unsaved draft" },
  })
  rerender(view(false))
  rerender(view(true))
  expect(screen.getByRole("textbox")).toHaveValue("Unsaved draft")
  rerender(view(false))
  rerender(view(true, { ...node, text: "Updated elsewhere" }))
  expect(screen.getByRole("textbox")).toHaveValue("Updated elsewhere")
})
