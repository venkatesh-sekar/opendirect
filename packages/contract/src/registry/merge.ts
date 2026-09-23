/**
 * Merging the registry layers (design §4,
 * docs/plans/2026-09-24-model-registry-design.md): bundled, then remote,
 * then the user's own mappings. A later layer replaces a family BY ID,
 * wholesale — no deep merge, so what a family file says is exactly what
 * runs.
 *
 * Nothing is ever dropped silently. An entry that fails validation becomes a
 * warning and the lower layer's family stays in force; a duplicate id or an
 * endpoint claimed by two families is a warning too. Pure: the caller reads
 * the files and settings, this only decides.
 */
import { modelKey } from "../model"
import {
  modelFamilySchema,
  type RegistryFamilyEntry,
  type RegistrySource,
  type RegistryWarning,
} from "./schema"

export interface RegistryLayerInput {
  source: RegistrySource
  /** `origin` names the entry in warnings: a file name, "remote x.json", … */
  entries: ReadonlyArray<{ origin: string; raw: unknown }>
}

export interface MergedRegistry {
  /** Sorted by family name. */
  families: RegistryFamilyEntry[]
  warnings: RegistryWarning[]
  /** "provider:model" → family id, highest layer wins. */
  endpointIndex: Map<string, string>
}

function rawId(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null
  const id = (raw as { id?: unknown }).id
  return typeof id === "string" ? id : null
}

/** Layers in precedence order: bundled, remote, user. Later replaces earlier BY ID, wholesale. */
export function mergeRegistry(
  layers: readonly RegistryLayerInput[]
): MergedRegistry {
  const warnings: RegistryWarning[] = []
  const byId = new Map<string, RegistryFamilyEntry & { rank: number }>()

  layers.forEach((layer, rank) => {
    const firstOrigin = new Map<string, string>()
    for (const { origin, raw } of layer.entries) {
      const parsed = modelFamilySchema.safeParse(raw)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        const path = issue?.path.length ? issue.path.join(".") : "(root)"
        warnings.push({
          source: layer.source,
          familyId: rawId(raw),
          message: `${origin}: ${path}: ${issue?.message ?? "invalid"}`,
        })
        continue
      }

      const family = parsed.data
      const first = firstOrigin.get(family.id)
      if (first !== undefined) {
        warnings.push({
          source: layer.source,
          familyId: family.id,
          message: `${origin}: family "${family.id}" is already defined by ${first}; the first entry wins.`,
        })
        continue
      }
      firstOrigin.set(family.id, origin)

      const lower = byId.get(family.id)
      byId.set(family.id, {
        family,
        source: layer.source,
        shadows: lower ? [...lower.shadows, lower.source] : [],
        warnings: [],
        rank,
      })
    }
  })

  // One endpoint, one family: the higher layer wins, then the
  // alphabetically first id, so the answer never depends on file order.
  const claims = new Map<string, Array<{ id: string; rank: number }>>()
  for (const entry of byId.values()) {
    for (const endpoint of entry.family.endpoints) {
      const key = modelKey(endpoint.provider, endpoint.model)
      claims.set(key, [
        ...(claims.get(key) ?? []),
        { id: entry.family.id, rank: entry.rank },
      ])
    }
  }
  const endpointIndex = new Map<string, string>()
  const alsoFor: Array<{ familyId: string; message: string }> = []
  for (const [key, claimants] of [...claims].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const [winner, ...others] = [...claimants].sort(
      (a, b) => b.rank - a.rank || a.id.localeCompare(b.id)
    )
    endpointIndex.set(key, winner!.id)
    for (const other of others) {
      const message = `Endpoint ${key} is mapped by both "${winner!.id}" and "${other.id}"; "${winner!.id}" is used.`
      warnings.push({
        source: byId.get(winner!.id)!.source,
        familyId: other.id,
        message,
      })
      // Both families' rows show it, not only the one that lost.
      alsoFor.push({ familyId: winner!.id, message })
    }
  }

  const families: RegistryFamilyEntry[] = [...byId.values()]
    .map((entry) => ({
      family: entry.family,
      source: entry.source,
      shadows: entry.shadows,
      warnings: [...warnings, ...alsoFor]
        .filter((w) => w.familyId === entry.family.id)
        .map((w) => w.message),
    }))
    .sort(
      (a, b) =>
        a.family.name.localeCompare(b.family.name) ||
        a.family.id.localeCompare(b.family.id)
    )

  return { families, warnings, endpointIndex }
}
