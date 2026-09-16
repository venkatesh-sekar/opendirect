import { describe, expect, it } from "vitest"

import { PRODUCTION_CSP } from "../apps/desktop/src/main/security"
import { RENDERER_CSP } from "../apps/web/lib/csp"

describe("Content-Security-Policy", () => {
  it("is the same string in the renderer meta tag and the main-process header", () => {
    // electron-serve answers `app://` from `session.protocol.handle`, which the
    // `webRequest` header hook never sees, so the policy has to exist in both
    // places. Drift between them would silently weaken the renderer.
    //
    // The two are not equally *effective*: a meta policy ignores
    // `frame-ancestors`, so only the header enforces that directive. Keeping
    // one string means the meta form is a strict subset, never a different
    // policy.
    expect(RENDERER_CSP).toBe(PRODUCTION_CSP)
  })

  it("lets the renderer display project media over asset:, and nothing more", () => {
    // The board shows local files through the `asset://` protocol
    // (`apps/desktop/src/main/media-service.ts`), which is registered with
    // `bypassCSP: false` — so it only works because the policy names it here.
    expect(RENDERER_CSP).toContain("img-src 'self' data: blob: asset:")
    expect(RENDERER_CSP).toContain("media-src 'self' data: blob: asset:")
    // …but a media scheme must never become a code or network source.
    expect(RENDERER_CSP).toContain("script-src 'self' 'unsafe-inline'")
    expect(RENDERER_CSP).toContain("connect-src 'self'")
  })

  it("relies on frame-src, not frame-ancestors, to stop the renderer framing", () => {
    // `frame-ancestors` is a no-op in the meta form the renderer actually gets.
    expect(RENDERER_CSP).toContain("frame-src 'none'")
    expect(RENDERER_CSP).toContain("object-src 'none'")
  })
})
