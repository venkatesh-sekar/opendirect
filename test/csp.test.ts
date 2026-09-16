import { describe, expect, it } from "vitest"

import { PRODUCTION_CSP } from "../apps/desktop/src/main/security"
import { RENDERER_CSP } from "../apps/web/lib/csp"

describe("Content-Security-Policy", () => {
  it("is identical in the renderer meta tag and the main-process header", () => {
    // electron-serve answers `app://` from `session.protocol.handle`, which the
    // `webRequest` header hook never sees, so the policy has to exist in both
    // places. Drift between them would silently weaken the renderer.
    expect(RENDERER_CSP).toBe(PRODUCTION_CSP)
  })
})
