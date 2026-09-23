// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { container } from "./fixtures"

const invoke = vi.hoisted(() => vi.fn())
const canvasProps = vi.hoisted(() => [] as { containerId: string | null }[])

vi.mock("@/lib/ipc", () => ({
  invoke,
  isBridgeAvailable: () => true,
  subscribe: () => () => {},
  pathsForFiles: () => [],
}))

// The surface itself is React Flow and a dozen queries; what is under test
// here is only which container it is handed.
vi.mock("@/components/canvas/canvas", () => ({
  Canvas: (props: { containerId: string | null }) => {
    canvasProps.push(props)
    return <div data-testid="canvas" data-container={props.containerId ?? ""} />
  },
}))

const { CanvasScreen } = await import("./canvas-screen")
const { forgetFilingContainer, lastFilingContainer, rememberFilingContainer } =
  await import("@/lib/canvas/filing")

const TREE = [
  container({ id: "mira", name: "Mira", handle: "mira" }),
  container({ id: "hall", name: "Hotel hallway", kind: "scene" }),
]

function mount(focus: string | null) {
  invoke.mockImplementation((channel: string) =>
    channel === "containers:tree"
      ? Promise.resolve(TREE)
      : new Promise(() => {})
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CanvasScreen focus={focus} />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  invoke.mockReset()
  canvasProps.length = 0
  forgetFilingContainer()
})

async function filedUnder() {
  const canvas = await screen.findByTestId("canvas")
  await waitFor(() => expect(canvas.dataset.container).not.toBe(""))
  return canvas.dataset.container
}

describe("the canvas page", () => {
  it("files under the focused container, and remembers it", async () => {
    mount("hall")
    expect(await filedUnder()).toBe("hall")
    expect(lastFilingContainer()).toBe("hall")
  })

  it("files under the container last visited when there is no focus", async () => {
    rememberFilingContainer("hall")
    mount(null)
    expect(await filedUnder()).toBe("hall")
  })

  it("says where new nodes go, and lets that be changed", async () => {
    const user = userEvent.setup()
    mount(null)
    expect(await filedUnder()).toBe("mira")

    const picker = await screen.findByRole("combobox", {
      name: /file new nodes under/i,
    })
    expect(picker).toHaveTextContent("Mira")

    await user.click(picker)
    await user.click(
      await screen.findByRole("option", { name: /hotel hallway/i })
    )

    await waitFor(() =>
      expect(screen.getByTestId("canvas").dataset.container).toBe("hall")
    )
    expect(lastFilingContainer()).toBe("hall")
  })
})
