/**
 * Content-Security-Policy for the renderer.
 *
 * In production the renderer is served by `electron-serve` over the `app://`
 * protocol. Those responses come from `session.protocol.handle`, which bypasses
 * Electron's `webRequest` module, so a `onHeadersReceived` header never reaches
 * them — the policy has to ship inside the document as a `<meta http-equiv>`
 * tag instead (see `app/layout.tsx`).
 *
 * `apps/desktop/src/main/security.ts` carries the same policy for everything
 * that *does* go through the network stack; `test/csp.test.ts` keeps the two
 * byte-identical.
 *
 * `'unsafe-inline'` is required for scripts and styles because a Next.js static
 * export inlines its hydration bootstrap and critical CSS. Everything else is
 * locked to the app bundle: no remote code, no framing, no `<base>` hijacking.
 */
export const RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
].join("; ")
