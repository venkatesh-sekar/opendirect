/**
 * The `asset://` media protocol — how the renderer displays a local file.
 *
 * The renderer is sandboxed behind `contextIsolation` and a CSP that allows
 * only `'self'`, so it cannot read the disk and `file://` URLs are both blocked
 * by the policy and unacceptable on their own: a `file://` allowlist would have
 * to hand the renderer absolute paths, and any path it could then *invent*
 * would be fetched. Instead main registers one custom scheme,
 *
 * ```
 * asset://media/assets/2026/09/<id>.png
 * ```
 *
 * whose only input is a project-relative path. Every request is resolved
 * through `resolveAssetPath()`, which refuses anything that escapes the project
 * folder, so `..%2f..%2f.ssh/id_rsa` resolves to nothing. `asset:` is added to
 * `img-src` and `media-src` in the CSP (and nowhere else — it is not a script
 * or connect source), and the scheme is registered as standard + secure so
 * Chromium treats it like `https:` for mixed-content and origin purposes.
 *
 * This module is Electron-free and pure; `media-service.ts` registers the
 * scheme and serves the bytes.
 */
import { extname } from "node:path"

import { resolveAssetPath, type ProjectRef } from "./project"

export const MEDIA_SCHEME = "asset"
/**
 * A fixed host, so the URL is a *standard* URL (`scheme://host/path`) whose
 * origin is stable — a path-only `asset:foo` URL would be opaque and blocked.
 */
export const MEDIA_HOST = "media"
export const MEDIA_ORIGIN = `${MEDIA_SCHEME}://${MEDIA_HOST}`

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  heic: "image/heic",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  m4v: "video/x-m4v",
  avi: "video/x-msvideo",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  flac: "audio/flac",
  txt: "text/plain",
  json: "application/json",
}

export const DEFAULT_CONTENT_TYPE = "application/octet-stream"

export function extensionOf(path: string): string {
  return extname(path).replace(/^\./, "").toLowerCase()
}

/** Best-effort MIME type from the extension; never throws. */
export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extensionOf(path)] ?? DEFAULT_CONTENT_TYPE
}

/** Which board lane a file belongs to, from its extension alone. */
export function assetKindFor(
  path: string
): "image" | "video" | "audio" | "text" {
  const type = contentTypeFor(path)
  if (type.startsWith("image/")) return "image"
  if (type.startsWith("video/")) return "video"
  if (type.startsWith("audio/")) return "audio"
  if (type.startsWith("text/")) return "text"
  // An unrecognised binary is still a file the user chose to import; treating
  // it as an image is wrong, and "text" is the only non-media bucket we have.
  return "text"
}

/**
 * The URL the renderer puts in an `<img src>` / `<video src>`.
 *
 * Each segment is encoded separately so the slashes survive; `null` in gives
 * `null` out, which is the common case for a text asset or a missing thumbnail.
 */
export function mediaUrl(relPath: string): string
export function mediaUrl(relPath: string | null): string | null
export function mediaUrl(relPath: string | null): string | null {
  if (!relPath) return null
  const encoded = relPath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/")
  return `${MEDIA_ORIGIN}/${encoded}`
}

/**
 * The project-relative path inside an `asset://` URL, or null when the URL is
 * not one of ours. Does **not** decide whether the path is safe — that is
 * `resolveMediaRequest`'s job.
 */
export function parseMediaUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:`) return null
  if (parsed.host !== MEDIA_HOST) return null
  const path = decodeURIComponent(parsed.pathname).replace(/^\/+/, "")
  return path || null
}

export interface MediaRequest {
  /** Absolute path, guaranteed to be inside the project folder. */
  path: string
  contentType: string
}

/**
 * Resolves an `asset://` URL against the open project.
 *
 * Throws on anything that is not a well-formed URL for a file inside the
 * project — the caller turns that into a 404, never a filesystem read.
 */
export function resolveMediaRequest(
  project: Pick<ProjectRef, "path">,
  url: string
): MediaRequest {
  const relPath = parseMediaUrl(url)
  if (!relPath) throw new Error(`Not an ${MEDIA_SCHEME}:// media URL: ${url}`)
  const path = resolveAssetPath(project, relPath)
  return { path, contentType: contentTypeFor(path) }
}
