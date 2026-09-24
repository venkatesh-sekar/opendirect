/**
 * What the mapping editor is asked to open on (plan Tasks 8 and 9).
 *
 * The Models tab, its family list and the `?map=<modelKey>` deep link only
 * say *what* to edit; the editor (Task 9) decides how to turn that into its
 * state. Keeping the request a plain value means every entry point — New
 * mapping, Edit, Duplicate as custom, Fix, Import…, and the model picker's
 * "Map this model" link — goes through one `openEditor(request)`.
 */
import type { ModelFamily, UserOverride } from "@opendirect/contract"

export type MappingEditorSource =
  /** New mapping, from nothing. */
  | { kind: "blank" }
  /** New mapping for one catalog model (`provider:slug`), from `?map=`. */
  | { kind: "model"; modelKey: string }
  /**
   * Edit a stored user mapping — or Fix one that no longer validates, in
   * which case `override.family` is null and `override.raw` is the JSON.
   * Saves replace this entry (`override.key`).
   */
  | { kind: "override"; override: UserOverride }
  /** Duplicate as custom: `family` is the copy (new id), `source` the original. */
  | { kind: "duplicate"; source: ModelFamily; family: ModelFamily }
  /** Import…: validated candidates from a file, nothing saved yet. */
  | { kind: "import"; candidates: UserOverride[] }

export interface MappingEditorRequest {
  from: MappingEditorSource
}

/**
 * The id a duplicate gets: `<id>-custom`, or `-custom-2`, `-custom-3`… when
 * that is taken, always inside the 64-character limit — so duplicating twice
 * never silently replaces the first copy.
 */
export function customCopyId(id: string, taken: Iterable<string> = []): string {
  const used = new Set(taken)
  for (let n = 1; ; n += 1) {
    const suffix = n === 1 ? "-custom" : `-custom-${n}`
    const candidate = `${id.slice(0, 64 - suffix.length)}${suffix}`
    if (!used.has(candidate)) return candidate
  }
}

/** A copy of a family to become the user's own mapping. */
export function duplicateAsCustom(
  family: ModelFamily,
  taken: Iterable<string> = []
): ModelFamily {
  return {
    ...structuredClone(family),
    id: customCopyId(family.id, taken),
    name: `${family.name} (custom)`.slice(0, 80),
  }
}
