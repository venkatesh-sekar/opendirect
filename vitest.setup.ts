import "@testing-library/jest-dom/vitest"

import { afterAll, afterEach, beforeAll } from "vitest"

import { server } from "./test/msw/server"

// `onUnhandledRequest: "error"` is deliberate: any accidental live API call
// in a test fails loudly instead of silently hitting a paid endpoint.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

/**
 * jsdom ships neither `ResizeObserver` nor `matchMedia`, and the renderer's
 * shell depends on both — `masonic` measures cells with the first and the
 * shadcn sidebar picks its layout with the second. Stubbing them here keeps
 * every component test from re-declaring the same two shims.
 */
const browser = globalThis as typeof globalThis & {
  window?: unknown
  ResizeObserver?: unknown
  matchMedia?: unknown
}

if (browser.window !== undefined) {
  if (browser.ResizeObserver === undefined) {
    browser.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  }

  if (typeof browser.matchMedia !== "function") {
    browser.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList
  }
}

/**
 * jsdom implements no Web Animations API, and Base UI's ScrollArea asks the
 * viewport for its running animations on a timer — which throws *after* the
 * test that mounted it has finished, so it surfaces as an unhandled error
 * rather than a failure. A no-op list is the honest answer: nothing is
 * animating in jsdom.
 */
if (browser.window !== undefined && typeof Element !== "undefined") {
  const element = Element.prototype as Element & {
    getAnimations?: () => unknown[]
  }
  if (typeof element.getAnimations !== "function") {
    element.getAnimations = () => []
  }
}
