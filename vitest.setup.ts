import { afterAll, afterEach, beforeAll } from "vitest"

import { server } from "./test/msw/server"

// `onUnhandledRequest: "error"` is deliberate: any accidental live API call
// in a test fails loudly instead of silently hitting a paid endpoint.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
