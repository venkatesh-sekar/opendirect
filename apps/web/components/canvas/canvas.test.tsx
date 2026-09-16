// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Canvas } from "./canvas"

/**
 * No bridge, and therefore no project and nothing to draw.
 *
 * The canvas gives the same answer the shell does, for the same reason: the
 * renderer is one static export opened both by the Electron window and by a
 * plain browser tab, and only one of them has a preload.
 */
vi.mock("@/lib/ipc", () => ({
  invoke: vi.fn(),
  isBridgeAvailable: () => false,
  subscribe: () => () => {},
  pathsForFiles: () => [],
}))

afterEach(cleanup)

describe("Canvas", () => {
  it("renders the placeholder outside Electron", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <Canvas containerId={null} />
      </QueryClientProvider>
    )

    expect(screen.getByText(/runs in its desktop window/i)).toBeVisible()
    // Nothing of React Flow is mounted, so nothing asked for a viewport.
    expect(screen.queryByTestId("canvas-surface")).toBeNull()
    expect(screen.queryByTestId("canvas-rail")).toBeNull()
  })
})
