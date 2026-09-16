/**
 * Bringing a finished run's outputs into the project folder.
 *
 * Two rules shape this file:
 *
 * - **No half-files in the project.** Every download lands in `tmp/` first and
 *   is renamed into `generations/<id>/` only once the last byte has arrived and
 *   the length checks out. A crash, a truncated response or a disconnect
 *   therefore leaves a stray file in `tmp/` — which the project treats as
 *   scratch — and never a playable-looking, half-written video on the board.
 * - **The provider does not get to name the file.** The extension comes from
 *   our own content-type table, the path from `assetRelPath`, and the result is
 *   re-checked with `resolveAssetPath`, so a hostile `Content-Disposition` or a
 *   `../` in a URL cannot write outside the project.
 *
 * ⛔ Downloading is free. This module fetches an output URL a provider has
 * already produced; it never submits anything.
 */
import { randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdir, rm, rename, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

import { contentTypeFor, extensionOf } from "../media"
import { assetRelPath, resolveAssetPath, type ProjectRef } from "../project"
import { hashFile } from "../repo/hash"

/** Content type → the extension we store it under. */
const EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
  "text/plain": "txt",
  "application/json": "json",
}

/** Last resort when neither the URL nor the response says what this is. */
const FALLBACK_EXTENSION = "bin"

export interface DownloadRequest {
  /** An `https:` output URL, or a `data:` URL for a provider that returns bytes. */
  url: string
  project: Pick<ProjectRef, "path">
  generationId: string
  /** Position in the run's output list; becomes the file name. */
  index: number
  signal?: AbortSignal
  /** Injected in tests that want to drive the transport directly. */
  fetchImpl?: typeof fetch
}

export interface DownloadedOutput {
  /** Project-relative, POSIX-separated — what an `assets` row stores. */
  relPath: string
  bytes: number
  sha256: string
  mimeType: string | null
}

function extensionFor(url: string, contentType: string | null): string {
  const type = contentType?.split(";")[0]?.trim().toLowerCase()
  if (type && EXTENSIONS[type]) return EXTENSIONS[type]

  // `data:` URLs have no path to read an extension off.
  if (!url.startsWith("data:")) {
    try {
      const fromUrl = extensionOf(new URL(url).pathname)
      if (
        fromUrl &&
        contentTypeFor(`x.${fromUrl}`) !== "application/octet-stream"
      )
        return fromUrl
    } catch {
      // An unparseable URL is the caller's problem, not the namer's.
    }
  }
  return FALLBACK_EXTENSION
}

/** `data:[<mime>][;base64],<data>` → its bytes and its declared type. */
function decodeDataUrl(url: string): {
  bytes: Buffer
  contentType: string | null
} {
  const comma = url.indexOf(",")
  if (comma === -1) throw new Error("Malformed data: URL in a provider output.")
  const meta = url.slice("data:".length, comma)
  const body = url.slice(comma + 1)
  const base64 = meta.endsWith(";base64")
  const contentType = (base64 ? meta.slice(0, -";base64".length) : meta) || null
  return {
    bytes: base64
      ? Buffer.from(body, "base64")
      : Buffer.from(decodeURIComponent(body), "utf8"),
    contentType,
  }
}

/**
 * Downloads one output and returns where it landed.
 *
 * The caller (the job runner) then hands the `relPath` to `attachOutputs`,
 * which is what creates the `assets` row, files it on the board and links it to
 * the generation — this module deliberately touches no database.
 */
export async function downloadOutput(
  request: DownloadRequest
): Promise<DownloadedOutput> {
  const { url, project, generationId, index } = request

  const scheme = url.slice(0, url.indexOf(":") + 1).toLowerCase()
  if (!["http:", "https:", "data:"].includes(scheme)) {
    throw new Error(
      `Refusing to download a provider output from "${scheme || url}" — only http(s) and data: URLs are fetched.`
    )
  }

  const temporaryPath = resolveAssetPath(
    project,
    `tmp/${generationId}-${index}-${randomUUID()}.part`
  )
  await mkdir(dirname(temporaryPath), { recursive: true })

  let contentType: string | null = null
  try {
    if (scheme === "data:") {
      const decoded = decodeDataUrl(url)
      contentType = decoded.contentType
      await writeFile(temporaryPath, decoded.bytes)
    } else {
      const fetchImpl = request.fetchImpl ?? fetch
      const response = await fetchImpl(url, { signal: request.signal })
      if (!response.ok) {
        throw new Error(
          `Downloading a generated output failed with HTTP ${response.status}.`
        )
      }
      if (!response.body) {
        throw new Error("The provider returned an output with no body.")
      }
      contentType = response.headers.get("content-type")

      await pipeline(
        Readable.fromWeb(
          response.body as Parameters<typeof Readable.fromWeb>[0]
        ),
        createWriteStream(temporaryPath),
        { signal: request.signal }
      )

      // A connection dropped mid-stream looks exactly like a complete one
      // otherwise, and a truncated video is worse than a failed job.
      const declared = response.headers.get("content-length")
      if (declared !== null) {
        const expected = Number.parseInt(declared, 10)
        const written = (await stat(temporaryPath)).size
        if (Number.isFinite(expected) && written !== expected) {
          throw new Error(
            `The download was incomplete: ${written} of ${expected} bytes arrived.`
          )
        }
      }
    }

    const relPath = assetRelPath({
      source: "generation",
      generationId,
      index,
      ext: extensionFor(url, contentType),
    })
    const finalPath = resolveAssetPath(project, relPath)
    await mkdir(dirname(finalPath), { recursive: true })
    // Both paths are inside the project folder, so this is a same-filesystem
    // rename: atomic, and the file appears complete or not at all.
    await rename(temporaryPath, finalPath)

    const stats = await stat(finalPath)
    return {
      relPath,
      bytes: stats.size,
      sha256: await hashFile(finalPath),
      mimeType: contentType?.split(";")[0]?.trim() ?? contentTypeFor(relPath),
    }
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}

/** Where partial downloads live, for anyone who needs to sweep it. */
export function temporaryFolder(project: Pick<ProjectRef, "path">): string {
  return join(project.path, "tmp")
}
