/**
 * The recommended models the picker offers first.
 *
 * A short, curated list, not a ranking: these are the slugs OpenDirect was
 * built and verified against. Every slug below was checked live on
 * **2026-09-16** — the Replicate ones via `GET /v1/models/{owner}/{name}` and
 * Replicate search, the OpenRouter one via `GET /api/v1/videos/models`.
 *
 * Providers re-slug and retire models without notice, so this table is a
 * *hint*, never a promise: if `getModel()` reports a key here as unavailable,
 * the picker must show it greyed out and keep working, rather than treating a
 * recommendation as a guarantee.
 */
import type { ModelKind, RecommendedModel } from "@opendirect/contract"

export interface RecommendedEntry {
  /** A catalog key: `"<provider>:<slug>"`. */
  key: string
  label: string
}

export const RECOMMENDED = {
  video: [
    {
      key: "replicate:bytedance/seedance-2.5",
      label: "Seedance 2.5 (Replicate)",
    },
    {
      key: "replicate:bytedance/seedance-2.0",
      label: "Seedance 2.0 (Replicate)",
    },
    {
      key: "openrouter:bytedance/seedance-2.5",
      label: "Seedance 2.5 (OpenRouter)",
    },
  ],
  image: [
    { key: "replicate:google/nano-banana-2", label: "Nano Banana 2" },
    { key: "replicate:google/nano-banana-pro", label: "Nano Banana Pro" },
  ],
} as const satisfies Partial<Record<ModelKind, readonly RecommendedEntry[]>>

/** The recommendations for a modality, or none when it has no curated list. */
export function recommendedFor(kind: ModelKind): readonly RecommendedEntry[] {
  return kind in RECOMMENDED
    ? RECOMMENDED[kind as keyof typeof RECOMMENDED]
    : []
}

/** Every recommended key, across modalities, in display order. */
export function recommendedKeys(): string[] {
  return Object.values(RECOMMENDED).flatMap((models) =>
    models.map((model) => model.key)
  )
}

/**
 * The curated shortlist, annotated against the catalog the picker actually
 * has. A key the providers no longer list stays in the result with
 * `available: false` so the picker can grey it out and say why, rather than
 * quietly dropping a model the user may be looking for.
 */
export function describeRecommended(availableKeys: Iterable<string>): {
  video: RecommendedModel[]
  image: RecommendedModel[]
} {
  const available = new Set(availableKeys)
  const describe = (kind: "video" | "image"): RecommendedModel[] =>
    RECOMMENDED[kind].map((model) => ({
      key: model.key,
      label: model.label,
      kind,
      available: available.has(model.key),
    }))

  return { video: describe("video"), image: describe("image") }
}
