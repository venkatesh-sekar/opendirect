/**
 * Pure navigation/CSP policy helpers for the main process.
 *
 * Kept free of `electron` imports so they can be unit tested in plain Node.
 */

/** Origin `electron-serve` serves the production renderer from. */
export const APP_ORIGIN = "app://-"

/**
 * Content-Security-Policy applied as a response header in production.
 *
 * This is defence in depth only. The `app://` renderer is served by
 * `electron-serve` v3 through `session.protocol.handle`, which bypasses the
 * `webRequest` module, so those responses never see this header — the
 * renderer's real policy is the `<meta http-equiv>` tag emitted by the Next.js
 * root layout from `apps/web/lib/csp.ts`. `test/csp.test.ts` keeps the two
 * strings identical.
 *
 * `'unsafe-inline'` is required for scripts and styles because a Next.js static
 * export inlines its hydration bootstrap and critical CSS. Everything else is
 * locked to the app bundle: no remote code, no framing, no `<base>` hijacking.
 */
export const PRODUCTION_CSP = [
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

function parse(url: string): URL | undefined {
  try {
    return new URL(url)
  } catch {
    return undefined
  }
}

/** `<protocol>//<host>` — `URL.origin` is `"null"` for non-special schemes like `app:`. */
function originOf(url: URL): string {
  return `${url.protocol}//${url.host}`
}

/**
 * Only plain web URLs may be handed to `shell.openExternal`; anything else
 * (`file:`, `javascript:`, custom handler schemes, …) is a local-code vector.
 */
export function isAllowedExternalUrl(url: string): boolean {
  const parsed = parse(url)
  if (!parsed) return false
  return parsed.protocol === "http:" || parsed.protocol === "https:"
}

/**
 * True when `url` stays inside the renderer's own origin — the dev server in
 * development, `app://-` in production. Everything else must not load in-window.
 */
export function isInternalNavigation(
  url: string,
  allowedOrigin: string
): boolean {
  const parsed = parse(url)
  const allowed = parse(allowedOrigin)
  if (!parsed || !allowed) return false
  return originOf(parsed) === originOf(allowed)
}
