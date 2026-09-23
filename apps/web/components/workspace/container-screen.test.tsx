// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { createElement, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { container, summary } from "./fixtures"

const invoke = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ipc", () => ({
  invoke,
  isBridgeAvailable: () => true,
  subscribe: () => () => {},
  pathsForFiles: () => [],
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/container/",
  useRouter: () => ({ push: () => {} }),
}))

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children?: ReactNode
  }) => createElement("a", { href, ...props }, children),
}))

const { ContainerScreen } = await import("./container-screen")
const { forgetFilingContainer, lastFilingContainer } =
  await import("@/lib/canvas/filing")

const RESPONSES: Record<string, unknown> = {
  "containers:tree": [
    container({
      id: "mira",
      name: "Mira",
      handle: "mira",
      description: "Night-shift concierge",
    }),
    container({ id: "moods", name: "Moodboards", kind: "folder" }),
  ],
  "containers:summaries": [
    summary({ id: "mira", assetCount: 12, generationCount: 38 }),
  ],
  "assets:list": { items: [], total: 0, nextOffset: null },
}

function mount(id: string | null) {
  invoke.mockImplementation((channel: string) =>
    channel in RESPONSES
      ? Promise.resolve(RESPONSES[channel])
      : new Promise(() => {})
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ContainerScreen id={id} />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  invoke.mockReset()
  forgetFilingContainer()
})

describe("a container's page", () => {
  it("names the character, what is in it and where it lives on the canvas", async () => {
    mount("mira")

    const bar = await screen.findByRole("banner")
    expect(
      await within(bar).findByRole("link", { name: "Characters" })
    ).toHaveAttribute("href", "/characters/")
    expect(within(bar).getByText("Mira")).toBeVisible()
    expect(
      within(bar).getByRole("link", { name: /open canvas/i })
    ).toHaveAttribute("href", "/canvas/?focus=mira")

    const main = screen.getByRole("main")
    expect(within(main).getByText("@mira")).toBeVisible()
    expect(within(main).getByText("Night-shift concierge")).toBeVisible()
    expect(
      await within(main).findByText("12 assets · 38 generations")
    ).toBeVisible()
  })

  it("opens the reference library on request, not on arrival", async () => {
    const user = userEvent.setup()
    mount("mira")

    await screen.findByRole("banner")
    expect(screen.queryByRole("dialog")).toBeNull()
    await user.click(
      await screen.findByRole("button", { name: /open library/i })
    )
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      /character library/i
    )
  })

  /** The canvas files new nodes under the container last visited. */
  it("becomes where the canvas files new nodes", async () => {
    mount("mira")
    await screen.findByRole("banner")
    await waitFor(() => expect(lastFilingContainer()).toBe("mira"))
  })

  it("is not remembered when it does not exist", async () => {
    mount("nope")
    await screen.findByText(/no longer exists/i)
    expect(lastFilingContainer()).toBeNull()
  })

  it("offers no library for a folder", async () => {
    mount("moods")
    await screen.findByText("Moodboards", { selector: "h2" })
    expect(screen.queryByRole("button", { name: /open library/i })).toBeNull()
  })

  it("says so when the container is gone", async () => {
    mount("nope")
    expect(await screen.findByText(/no longer exists/i)).toBeVisible()
    expect(screen.getByRole("link", { name: /back to home/i })).toHaveAttribute(
      "href",
      "/"
    )
  })
})
