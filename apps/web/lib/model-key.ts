/**
 * A generation row records its provider and slug separately; the catalog is
 * keyed by the two joined. One helper, so "which model was this?" is answered
 * the same way everywhere.
 */
export function modelKeyOf(generation: {
  provider: string
  modelSlug: string
}): string {
  return `${generation.provider}:${generation.modelSlug}`
}
