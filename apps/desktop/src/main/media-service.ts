/**
 * Electron wiring for the `asset://` media protocol.
 *
 * `media.ts` decides *what* a URL means; this registers the scheme and answers
 * the requests. Two details matter:
 *
 * - `registerSchemesAsPrivileged` must run **before** `app.whenReady()`, like
 *   `electron-serve`'s own scheme. `stream: true` is what makes `<video>` seek:
 *   without it Chromium cannot issue range requests against the scheme.
 * - The bytes are streamed with `net.fetch` over a `file://` URL rather than
 *   read into memory, and the request's `Range` header is forwarded. Every path
 *   goes through `resolveMediaRequest` first, so only existing files inside the
 *   open project's media folders are opened; everything else — a traversal, a
 *   symlink out of the project, the database, a missing file — is the same
 *   opaque 404.
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
      resolved = await resolveMediaRequest(project, request.url)
    } catch {
      // Outside the project, not a servable folder, not one of our URLs, or
      // simply missing — the renderer is told the same thing either way.
      return notFound()
    }

    try {
      // The `Range` header is forwarded so a seek in a long clip can be served
      // as a 206 rather than a full re-read. Electron's `file:` handler may
      // still answer 200 with the whole body; the response is passed through
      // as-is, so playback works either way and improves if it starts honouring
      // the header.
      const range = request.headers.get("range")
      const response = await net.fetch(
        pathToFileURL(resolved.path).toString(),
        range ? { headers: { Range: range } } : undefined
      )
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
