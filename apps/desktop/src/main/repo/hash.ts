/**
 * Content hashing for imports and generation outputs.
 *
 * Streamed, never buffered: a project holds video, and `readFile` on a 4 GB
 * clip would pin the whole file in the main process's heap just to compute a
 * 32-byte digest. `pipeline` also guarantees the read stream is destroyed if
 * the hash side ever errors, which a manual `on("data")` loop does not.
 */
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { pipeline } from "node:stream/promises"

export async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256")
  await pipeline(createReadStream(path), hash)
  return hash.digest("hex")
}
