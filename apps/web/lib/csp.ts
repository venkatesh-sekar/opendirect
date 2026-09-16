/**
 * Content-Security-Policy for the renderer.
 *
 * In production the renderer is served by `electron-serve` over the `app://`
 * protocol. Those responses come from `session.protocol.handle`, which bypasses
 * Electron's `webRequest` module, so an `onHeadersReceived` header never reaches
 * them — the policy has to ship inside the document as a `<meta http-equiv>`
 * tag instead (see `app/layout.tsx`).
 *
 * A meta policy only governs content the parser sees *after* it, and React
 * hoists `<meta>` to the end of `<head>`, behind Next's async script tags. The
 * `scripts/hoist-csp.ts` post-build step therefore moves the tag to the front of
 * `<head>` in every exported page; `hoistCspMeta` below is that transform.
 *
 * Two directives behave differently in the meta form and are handled elsewhere:
 * `frame-ancestors` is **ignored** in a meta policy (framing is instead
 * prevented by the app never loading the renderer in a frame, plus the
 * main-process response header), and `sandbox` is likewise meta-only-ignored and
 * so is not used at all.
 *
 * `apps/desktop/src/main/security.ts` carries the same policy string for
 * everything that *does* go through the network stack; `test/csp.test.ts` keeps
 * the two byte-identical.
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

/** Matches only a real CSP meta tag, never the copy inside the RSC payload. */
const CSP_META = /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i
const HEAD_OPEN = /<head(?:\s[^>]*)?>/i

/**
 * Moves the CSP meta tag to the first position inside `<head>`.
 *
 * Returns the input unchanged when there is no head or no CSP tag, and is
 * idempotent so re-running the export step is harmless.
 */
export function hoistCspMeta(html: string): string {
  const head = HEAD_OPEN.exec(html)
  if (!head) return html

  const headEnd = head.index + head[0].length
  const meta = CSP_META.exec(html)
  if (!meta || meta.index < headEnd) return html

  const tag = meta[0]
  const withoutTag =
    html.slice(0, meta.index) + html.slice(meta.index + tag.length)
  return withoutTag.slice(0, headEnd) + tag + withoutTag.slice(headEnd)
}
