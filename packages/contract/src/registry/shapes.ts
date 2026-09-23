/**
 * Named payload shapes (design §3). Code, not data: a mapping file can only
 * NAME one, so a remote registry can never run code. Each takes the final
 * URLs for one input, in position order, and returns the field's value.
 *
 * Shapes run in the job runner after uploads, because only then are the
 * final URLs known.
 */
export type ShapeFn = (urls: readonly string[]) => unknown

export const SHAPES = {
  /**
   * Kling "elements": one element whose first image is the frontal photo and
   * the rest are extra references, per the payload in the design doc §3
   * (`elements: [{ frontal_image_url, reference_image_urls }]`). No bundled
   * mapping uses it yet (no Kling fixture is recorded); it is the worked,
   * tested example of the mechanism.
   */
  "kling-elements": (urls) =>
    urls.length === 0
      ? []
      : [{ frontal_image_url: urls[0], reference_image_urls: urls.slice(1) }],
} as const satisfies Record<string, ShapeFn>

export type ShapeName = keyof typeof SHAPES
export const SHAPE_NAMES = Object.keys(SHAPES) as ShapeName[]

export function isShapeName(name: string): name is ShapeName {
  return Object.hasOwn(SHAPES, name)
}

/**
 * The value one input field receives: the named shape applied to its URLs,
 * or — with no shape — the plain URL (single field) or a copy of the URL
 * list (multiple field). An unknown name throws rather than sending a
 * payload the mapping did not mean.
 */
export function applyShape(
  shape: string | null | undefined,
  urls: readonly string[],
  multiple: boolean
): unknown {
  if (shape === null || shape === undefined) {
    return multiple ? [...urls] : urls[0]
  }
  if (!isShapeName(shape)) {
    throw new Error(
      `Unknown shape "${shape}". The app ships: ${SHAPE_NAMES.join(", ")}.`
    )
  }
  return SHAPES[shape](urls)
}
