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
 * whose only input is a project-relative path. A request must clear three
 * checks: it has to name one of the media folders (so the database, the
 * manifest and the in-flight `tmp/` downloads are not addressable at all), it
 * has to survive `resolveAssetPath()`, which refuses anything lexically outside
 * the project, and its `realpath` has to still be inside the project — which is
 * what stops a symlink planted under `assets/` from serving `~/.ssh/id_rsa`.
 * `asset:` is added to
 * `img-src` and `media-src` in the CSP (and nowhere else — it is not a script
 * or connect source), and the scheme is registered as standard + secure so
 * Chromium treats it like `https:` for mixed-content and origin purposes.
 *
 * This module is Electron-free and pure; `media-service.ts` registers the
 * scheme and serves the bytes.
 */
import { extname } from "node:path"

import { realAssetPath, type ProjectRef } from "./project"

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

/**
 * The only folders the protocol will serve.
 *
 * Everything else in a project folder is either private (`opendirect.db`,
 * `project.json`) or transient (`tmp/`, which holds partial downloads), and no
 * view in the app needs to fetch it.
 */
export const SERVABLE_MEDIA_FOLDERS = [
  "assets",
  "generations",
  "thumbnails",
] as const

const SERVABLE = new Set<string>(SERVABLE_MEDIA_FOLDERS)

export interface MediaRequest {
  /** Absolute path, guaranteed to be inside the project folder. */
  path: string
  contentType: string
}

/**
 * Resolves an `asset://` URL against the open project.
 *
 * Throws on anything that is not a well-formed URL for an existing file inside
 * one of the media folders — including a file that resolves out of the project
 * through a symlink. The caller turns every throw into a 404, so a refusal and
 * a missing file are indistinguishable from the renderer.
 */
export async function resolveMediaRequest(
  project: Pick<ProjectRef, "path">,
  url: string
): Promise<MediaRequest> {
  const relPath = parseMediaUrl(url)
  if (!relPath) throw new Error(`Not an ${MEDIA_SCHEME}:// media URL: ${url}`)

  const [folder] = relPath.split("/")
  if (!folder || !SERVABLE.has(folder)) {
    throw new Error(`Refusing to serve outside the media folders: ${relPath}`)
  }

  // Lexical containment, then real containment — and `realpath` also fails for
  // a file that does not exist, which is the 404 the handler wants anyway.
  const target = await realAssetPath(project, relPath)

  // The type comes from the URL, not the link target: a `.png` request is a
  // `.png` response, whatever the symlink happened to point at.
  return { path: target, contentType: contentTypeFor(relPath) }
}
