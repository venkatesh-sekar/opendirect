/**
 * Handles: the `@venkz` a character or a scene answers to.
 *
 * Pure, dependency-free and imported by both processes, so the renderer
 * validates exactly what main will accept and a handle typed into the rename
 * field cannot be rejected only after the round trip.
 *
 * Two rules the rest of the feature leans on:
 *
 * - **A handle is typeable or it does not exist.** A name that survives
 *   slugification as nothing at all yields `null` — the container is simply
 *   not `@`-able. ⛔ Never a generated id like `c-4f2a`, which nobody would
 *   ever type into a prompt and which would make the picker a list of noise.
 * - **Uniqueness is per project**, and it is settled here rather than by a
 *   database error, so the caller can offer `venkz-2` instead of failing.
 */

/** `venkz`, `hotel-lobby`. Lowercase, digits, single hyphens, 1–32 chars. */
export const HANDLE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const HANDLE_MAX = 32

/** The pattern *and* the length bound — what main enforces on a write. */
export function isValidHandle(handle: string): boolean {
  return handle.length <= HANDLE_MAX && HANDLE_PATTERN.test(handle)
}

/** Truncates to `HANDLE_MAX` and never leaves a hyphen dangling at the cut. */
function truncate(slug: string, max: number = HANDLE_MAX): string {
  return slug.slice(0, max).replace(/-+$/, "")
}

/**
 * `"Venkz Sekar!"` → `"venkz-sekar"`. Returns null when nothing survives.
 *
 * NFKD first, so `Saldaña` loses its tilde rather than its letter; a name of
 * pure punctuation, pure emoji or pure CJK has no ASCII to keep and comes back
 * null.
 */
export function slugifyHandle(name: string): string | null {
  const slug = truncate(
    name
      .normalize("NFKD")
      // Combining marks left behind by the decomposition.
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  )
  return slug === "" ? null : slug
}

/**
 * `base`, else `base-2`, `base-3`… skipping everything in `taken`.
 *
 * The suffix is counted from 2 because `venkz` and `venkz-1` reading as the
 * same person is a trap; the base is shortened as far as the suffix needs, so
 * the result is always a valid handle.
 */
export function uniqueHandle(
  base: string | null,
  taken: ReadonlySet<string>
): string | null {
  if (!base) return null
  const root = truncate(base)
  if (root === "") return null
  if (!taken.has(root)) return root

  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`
    const candidate = `${truncate(root, HANDLE_MAX - suffix.length)}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}
