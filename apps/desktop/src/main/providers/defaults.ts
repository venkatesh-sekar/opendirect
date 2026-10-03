/**
 * The recommended models the picker offers first.
 *
 * A short, curated list, not a ranking: these are the slugs OpenDirect was
 * built and verified against. The Seedance and Nano Banana slugs were checked
 * live on **2026-09-16**, the rest on **2026-10-03** — the Replicate ones via
 * `GET /v1/models/{owner}/{name}` and Replicate search, the OpenRouter one via
 * `GET /api/v1/videos/models`. After the defaults, each modality offers one
 * pick per trade-off: the best quality, a balanced one, and the fastest and
 * cheapest. Every Replicate key here is mapped by a bundled registry family.
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
    { key: "replicate:google/veo-3.1", label: "Veo 3.1" },
    {
      key: "replicate:kwaivgi/kling-v2.5-turbo-pro",
      label: "Kling 2.5 Turbo Pro",
    },
    { key: "replicate:prunaai/p-video", label: "P-Video" },
  ],
  image: [
    { key: "replicate:google/nano-banana-2", label: "Nano Banana 2" },
    { key: "replicate:google/nano-banana-pro", label: "Nano Banana Pro" },
    { key: "replicate:black-forest-labs/flux-2-pro", label: "FLUX.2 Pro" },
    { key: "replicate:bytedance/seedream-4.5", label: "Seedream 4.5" },
    { key: "replicate:google/imagen-4-fast", label: "Imagen 4 Fast" },
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
