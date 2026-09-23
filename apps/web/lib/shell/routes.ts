/**
 * The window's routes, spelled once.
 *
 * The renderer is a static export with `trailingSlash: true`, so it has no
 * dynamic `[id]` segments: a container or a canvas focus travels in the query
 * string, and every link to one is built here rather than templated at each
 * call site.
 */

/** A character, scene or folder's own page. */
export function containerHref(id: string): string {
  return `/container/?id=${encodeURIComponent(id)}`
}

/** The canvas, optionally framed on one container's nodes. */
export function canvasHref(focus?: string | null): string {
  return focus ? `/canvas/?focus=${encodeURIComponent(focus)}` : "/canvas/"
}

/**
 * Whether `pathname` is the route `href` names.
 *
 * "/settings" arrives as "/settings/" in the packaged app and without the
 * slash in development, so both are compared without it. Home is only ever
 * itself — every path starts with "/".
 */
export function isOnRoute(pathname: string | null, href: string): boolean {
  const strip = (path: string) => path.replace(/\/+$/, "") || "/"
  return strip(pathname ?? "/") === strip(href.split("?")[0] ?? "/")
}

export function isSettingsPath(pathname: string | null): boolean {
  return (pathname ?? "/").startsWith("/settings")
}

/**
 * Where leaving Settings goes: the last route that was not Settings.
 *
 * Module state rather than a context, because it is read by the shell's ⌘,
 * handler and by the Settings page's own Back and Escape, and both only ever
 * run in the one window there is.
 */
let lastRoute: string | null = null

export function rememberRoute(pathname: string, search = ""): void {
  if (isSettingsPath(pathname)) return
  lastRoute = `${pathname}${search}`
}

export function returnRoute(): string {
  return lastRoute ?? "/"
}

/** For tests: the window as it was when it opened. */
export function forgetReturnRoute(): void {
  lastRoute = null
}
