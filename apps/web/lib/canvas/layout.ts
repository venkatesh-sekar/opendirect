/**
 * Where a canvas node goes, and how big it is.
 *
 * Pure geometry, deliberately kept out of the React Flow components: the
 * canvas surface owns pan, zoom and the drag in flight, but *what size a
 * frame is* and *where a "+" puts the next node* are decisions with rules,
 * and rules belong somewhere they can be read and tested without a viewport.
 *
 * Two rules this module keeps:
 *
 * 1. **A frame's width is fixed and its height follows the ratio.** Every
 *    generate node on a canvas is the same width, so a column of them reads
 *    as a column; the height is the only thing the aspect ratio moves.
 * 2. **Nothing is invented from a value the model never stated.** An aspect
 *    ratio the model spells `auto`, `adaptive` or `match_input_image` is not a
 *    ratio, so it parses to null and the frame falls back to a square rather
 *    than to a guess at 16:9.
 */
import type { CanvasNodeType } from "@opendirect/contract"

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Box extends Point, Size {}

/** The empty space between a node and the one a "+" spawns next to it. */
export const NODE_GAP = 48

/** Every generate and media frame is this wide. Height follows the ratio. */
export const FRAME_WIDTH = 360

/** Bounds on the computed height, so `21:9` and `9:16` both stay usable. */
export const MIN_FRAME_HEIGHT = 120
export const MAX_FRAME_HEIGHT = 720

/** A coloured note is a fixed sticky; its text scrolls rather than resizes. */
export const TEXT_NODE_SIZE: Size = { width: 260, height: 160 }

/**
 * The ratio a frame falls back to when the model states none, or states one
 * that is not a ratio at all. A square is the neutral answer: it favours
 * neither landscape nor portrait, which is exactly what "unstated" means.
 */
export const FALLBACK_ASPECT_RATIO = "1:1"

export interface AspectRatio {
  w: number
  h: number
}

/**
 * `"16:9"` → `{ w: 16, h: 9 }`.
 *
 * Accepts the `:` the schemas use and the `x` some models write, and returns
 * null for anything that is not two positive numbers — `auto`, `adaptive`,
 * `match_input_image`, and whatever the next model invents.
 */
export function parseAspectRatio(
  value: string | null | undefined
): AspectRatio | null {
  if (typeof value !== "string") return null
  const match = /^\s*(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)\s*$/i.exec(
    value
  )
  if (!match) return null
  const w = Number.parseFloat(match[1]!)
  const h = Number.parseFloat(match[2]!)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0)
    return null
  return { w, h }
}

/** `1920 × 1080` → `{ w: 1920, h: 1080 }`, for sizing a media node to its asset. */
export function aspectRatioOf(
  width: number | null | undefined,
  height: number | null | undefined
): AspectRatio | null {
  if (typeof width !== "number" || typeof height !== "number") return null
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width <= 0 || height <= 0) return null
  return { w: width, h: height }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * A frame of the given ratio: `width` as asked, height derived and clamped.
 * Heights are whole pixels so two nodes of the same ratio are the same size.
 */
export function frameSize(
  ratio: AspectRatio | string | null | undefined,
  width: number = FRAME_WIDTH
): Size {
  const parsed =
    typeof ratio === "string" || ratio === null || ratio === undefined
      ? (parseAspectRatio(ratio ?? null) ??
        parseAspectRatio(FALLBACK_ASPECT_RATIO)!)
      : ratio
  const raw = (width * parsed.h) / parsed.w
  return {
    width,
    height: clamp(Math.round(raw), MIN_FRAME_HEIGHT, MAX_FRAME_HEIGHT),
  }
}

/**
 * The size a freshly created node is given. A text note is fixed; everything
 * else is a frame, so a media node dropped from a 9:16 clip is tall from the
 * moment it lands.
 */
export function defaultNodeSize(
  type: CanvasNodeType,
  ratio?: AspectRatio | string | null
): Size {
  if (type === "text") return { ...TEXT_NODE_SIZE }
  return frameSize(ratio ?? null)
}

/** Plain rectangle intersection. Touching edges are not an overlap. */
export function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  )
}

export function centerOf(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

export interface SpawnInput {
  /** The node whose "+" was pressed. */
  origin: Box
  direction: "left" | "right"
  /** The size of the node about to be created. */
  size: Size
  /** Everything already on the canvas, including the origin. */
  occupied?: readonly Box[]
  gap?: number
}

/** How far down the scan is willing to look before it gives up and stacks. */
const MAX_SCAN_STEPS = 64

/**
 * Where the "+" on a node's left or right handle puts the new node.
 *
 * Vertically centred on the origin and one gap clear of it horizontally. If
 * something is already sitting there the candidate walks *down* by its own
 * height plus a gap until the space is free — a simple scan, because the user
 * is about to drag the node anyway and a clever placement that surprises them
 * is worse than an obvious one.
 */
export function spawnPosition(input: SpawnInput): Point {
  const gap = input.gap ?? NODE_GAP
  const occupied = input.occupied ?? []
  const x =
    input.direction === "right"
      ? input.origin.x + input.origin.width + gap
      : input.origin.x - gap - input.size.width
  const baseY = input.origin.y + input.origin.height / 2 - input.size.height / 2

  const step = input.size.height + gap
  let candidate: Point = { x, y: baseY }
  for (let index = 0; index < MAX_SCAN_STEPS; index += 1) {
    candidate = { x, y: baseY + index * step }
    const box: Box = { ...candidate, ...input.size }
    if (!occupied.some((other) => overlaps(box, other))) return candidate
  }
  return candidate
}

/**
 * Where a node dropped at a point lands: centred on the pointer, because that
 * is where the user was looking when they let go.
 */
export function dropPosition(point: Point, size: Size): Point {
  return { x: point.x - size.width / 2, y: point.y - size.height / 2 }
}

/**
 * Several files dropped at once: the first lands under the pointer and the
 * rest cascade down and to the right, so none of them hides another.
 */
export function dropPositions(
  point: Point,
  size: Size,
  count: number,
  gap: number = NODE_GAP
): Point[] {
  const first = dropPosition(point, size)
  const out: Point[] = []
  for (let index = 0; index < Math.max(0, count); index += 1) {
    out.push({ x: first.x + index * gap, y: first.y + index * gap })
  }
  return out
}
