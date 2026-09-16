/**
 * Electron wiring for the `asset://` media protocol.
 *
 * `media.ts` decides *what* a URL means; this registers the scheme and answers
 * the requests. Two details matter:
 *
 * - `registerSchemesAsPrivileged` must run **before** `app.whenReady()`, like
 *   `electron-serve`'s own scheme. `stream: true` is what makes `<video>` seek:
 *   without it Chromium cannot issue range requests against the scheme.
 * - The bytes are served with `net.fetch` over a `file://` URL, which gives
 *   range support and streaming for free rather than reading whole clips into
 *   memory. Every path is resolved through `resolveMediaRequest` first, so only
 *   files inside the open project are ever opened; anything else is a 404,
 *   never a filesystem error the renderer could probe with.
 */
import { pathToFileURL } from "node:url"

import { net, protocol } from "electron"
import log from "electron-log/main"

import { MEDIA_SCHEME, resolveMediaRequest } from "./media"
import { getCurrentProject } from "./project-service"

let registered = false

/** Must be called before `app.whenReady()`. */
export function prepareMediaProtocol(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        // Range requests — a 200 MB clip must not be buffered to play.
        stream: true,
        // The renderer's CSP explicitly allows `asset:` in img-src/media-src;
        // a protocol that bypassed CSP would undo that decision.
        bypassCSP: false,
      },
    },
  ])
}

function notFound(): Response {
  return new Response(null, { status: 404 })
}

/** Called once the app is ready, after a session exists. */
export function registerMediaProtocol(): void {
  if (registered) return
  registered = true

  protocol.handle(MEDIA_SCHEME, async (request) => {
    const project = getCurrentProject()?.project
    if (!project) return notFound()

    let resolved
    try {
      resolved = resolveMediaRequest(project, request.url)
    } catch {
      // Outside the project, or not one of our URLs at all.
      return notFound()
    }

    try {
      const response = await net.fetch(pathToFileURL(resolved.path).toString())
      if (!response.ok) return notFound()
      const headers = new Headers(response.headers)
      headers.set("Content-Type", resolved.contentType)
      return new Response(response.body, {
        status: response.status,
        headers,
      })
    } catch (error) {
      log.warn(`Could not serve ${request.url}`, error)
      return notFound()
    }
  })
}
