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

/** The id a duplicate gets: `<id>-custom`, kept inside the 64-character limit. */
export function customCopyId(id: string): string {
  const suffix = "-custom"
  return `${id.slice(0, 64 - suffix.length)}${suffix}`
}

/** A copy of a family to become the user's own mapping. */
export function duplicateAsCustom(family: ModelFamily): ModelFamily {
  return {
    ...structuredClone(family),
    id: customCopyId(family.id),
    name: `${family.name} (custom)`.slice(0, 80),
  }
}
