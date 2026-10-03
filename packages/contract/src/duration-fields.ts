/**
 * The names a video model's length goes by, and how a length value reads.
 *
 * Shared here because both processes must agree: the renderer's duration
 * control (`apps/web/lib/schema-form/duration.ts`) offers whichever of these
 * fields a model declares, and main's cost estimate
 * (`apps/desktop/src/main/providers/cost.ts`) must read the value back from
 * the same field — otherwise a duration the user picked prices as "no
 * duration".
 */

/** Field names that are a length in seconds, in preference order. */
export const DURATION_SECONDS_FIELDS = [
  "duration",
  "duration_seconds",
  "seconds",
  "duration_sec",
  "video_duration",
] as const

/** Field names that may be a length in frames, in preference order. */
export const DURATION_FRAME_FIELDS = [
  "num_frames",
  "video_length",
  "length",
  "frames",
  "num_video_frames",
  "frame_count",
] as const

/** Field names that state the frame rate a frame count plays at. */
export const DURATION_FPS_FIELDS = [
  "fps",
  "frames_per_second",
  "frame_rate",
] as const

/** `5`, `"5"`, `"5s"`, `"5 sec"`, `"5 seconds"` → 5. Anything else → null. */
export function parseSeconds(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string") return null
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*(?:s|secs?|seconds?)?\s*$/i.exec(value)
  return match ? Number(match[1]) : null
}
