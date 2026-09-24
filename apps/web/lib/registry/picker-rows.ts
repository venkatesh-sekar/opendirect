/**
 * What the model picker lists, and under which filter (design §1, §4; plan
 * Task 10).
 *
 * A mapped model is one **family** row, chosen as `family:<id>` whatever
 * provider runs it, so the provider summaries that are its endpoints are not
 * listed again on their own. Every other catalog model is an **unmapped**
 * row: usable as it is, but its roles are only guesses from field names.
 *
 * The capability filter ("takes a character") is where that difference
 * shows. A family matches on the roles its mapping declares. An unmapped
 * model is left out unless the user asks to include unverified models — and
 * then it matches on the roles main inferred from its cached descriptor, or,
 * when main has not inspected it yet, it is kept at the end with `roles:
 * null` so the picker can say "not inspected yet" rather than guess.
 *
 * Pure: no React, no IPC. The picker memoises one call per keystroke.
 */
import {
  PROVIDER_NAMES,
  REFERENCE_ROLES,
  ROLE_LABELS,
  familyKey,
  modelKey,
  slotKeyRole,
  type ModelKind,
  type ModelSummary,
  type PriceHint,
  type ProviderId,
  type ReferenceRole,
  type RegistryFamilyEntry,
} from "@opendirect/contract"

export type PickerRow =
  | {
      type: "family"
      key: string
      entry: RegistryFamilyEntry
      roles: ReferenceRole[]
      providers: Array<{ id: ProviderId; configured: boolean }>
      priceHint: PriceHint | null
    }
  | {
      type: "model"
      key: string
      summary: ModelSummary
      /** From main's cached descriptor; null when not inspected yet. */
      roles: ReferenceRole[] | null
      verified: false
    }

export type FamilyPickerRow = Extract<PickerRow, { type: "family" }>
export type ModelPickerRow = Extract<PickerRow, { type: "model" }>

export interface PickerFilter {
  kind: "all" | ModelKind
  /** Every selected role must be taken (AND). */
  roles: ReferenceRole[]
  includeUnverified: boolean
  search: string
}

export interface PickerRowsInput {
  families: RegistryFamilyEntry[]
  summaries: ModelSummary[]
  /** Model key → roles its slots take; a missing key is not inspected yet. */
  capabilities: Record<string, ReferenceRole[]>
  configured: ProviderId[]
  filter: PickerFilter
}

export interface PickerRows {
  families: FamilyPickerRow[]
  /** Matching unmapped models, then (under a role filter) uninspected ones. */
  models: ModelPickerRow[]
  /**
   * Unmapped models a role filter hides while unverified ones are off: the
   * ones the switch would bring back, whether inspected or not.
   */
  hiddenUnverified: number
  /** How many of `hiddenUnverified` main has not inspected yet. */
  hiddenUninspected: number
}

/**
 * Every endpoint key (`replicate:bytedance/seedance-2.5`) → the family that
 * maps it. When two families claim one endpoint, the first listed wins.
 */
export function endpointFamilies(
  families: RegistryFamilyEntry[]
): Map<string, RegistryFamilyEntry> {
  const byEndpoint = new Map<string, RegistryFamilyEntry>()
  for (const entry of families) {
    for (const endpoint of entry.family.endpoints) {
      const key = modelKey(endpoint.provider, endpoint.model)
      if (!byEndpoint.has(key)) byEndpoint.set(key, entry)
    }
  }
  return byEndpoint
}

/** The roles a family's inputs take across every endpoint, in list order. */
export function familyRoles(entry: RegistryFamilyEntry): ReferenceRole[] {
  const roles = new Set<ReferenceRole>()
  for (const endpoint of entry.family.endpoints) {
    for (const key of Object.keys(endpoint.inputs)) roles.add(slotKeyRole(key))
  }
  return REFERENCE_ROLES.filter((role) => roles.has(role))
}

/** Lowercased search terms; every one must appear (so "banana pro" works). */
function terms(search: string): string[] {
  return search.toLowerCase().split(/\s+/).filter(Boolean)
}

function matchesTerms(text: string, needles: string[]): boolean {
  return needles.every((needle) => text.includes(needle))
}

function familyHaystack(
  entry: RegistryFamilyEntry,
  roles: ReferenceRole[]
): string {
  const { family } = entry
  const parts = [family.name, family.id]
  for (const endpoint of family.endpoints) {
    parts.push(
      modelKey(endpoint.provider, endpoint.model),
      PROVIDER_NAMES[endpoint.provider]
    )
  }
  for (const role of roles) parts.push(ROLE_LABELS[role])
  return parts.join(" ").toLowerCase()
}

function takesAll(
  roles: readonly ReferenceRole[],
  wanted: readonly ReferenceRole[]
): boolean {
  return wanted.every((role) => roles.includes(role))
}

/**
 * The family's price hint: the lowest published rate among the endpoints
 * the user can run (a provider with a key), or among all of them when none
 * can run or none of the runnable ones has a rate. Rates are only compared
 * in one unit — the first priced endpoint's, in manifest order — because
 * $0.01 per output is not "cheaper" than $0.30 per second.
 */
function familyPrice(
  entry: RegistryFamilyEntry,
  summaryByKey: Map<string, ModelSummary>,
  configured: readonly ProviderId[]
): PriceHint | null {
  const priced: Array<{ hint: PriceHint; runnable: boolean }> = []
  for (const endpoint of entry.family.endpoints) {
    const hint = summaryByKey.get(
      modelKey(endpoint.provider, endpoint.model)
    )?.priceHint
    if (hint)
      priced.push({ hint, runnable: configured.includes(endpoint.provider) })
  }
  const pool = priced.some((p) => p.runnable)
    ? priced.filter((p) => p.runnable)
    : priced
  const first = pool[0]
  if (!first) return null
  let best = first.hint
  for (const { hint } of pool) {
    if (hint.unit === best.unit && hint.amount < best.amount) best = hint
  }
  return best
}

interface Candidates {
  /** Families past kind and search, with their union roles. */
  families: Array<{ entry: RegistryFamilyEntry; roles: ReferenceRole[] }>
  /** Unmapped summaries past kind and search, with cached roles or null. */
  models: Array<{ summary: ModelSummary; roles: ReferenceRole[] | null }>
}

/** Kind and search, which every other rule narrows further. */
function candidates(input: PickerRowsInput): Candidates {
  const { families, summaries, capabilities, filter } = input
  const needles = terms(filter.search)
  const kindMatches = (kind: string) =>
    filter.kind === "all" || kind === filter.kind
  const byEndpoint = endpointFamilies(families)

  const out: Candidates = { families: [], models: [] }
  const seen = new Set<string>()
  for (const entry of families) {
    const { family } = entry
    if (seen.has(family.id)) continue
    seen.add(family.id)
    if (!kindMatches(family.kind) || family.endpoints.length === 0) continue
    const roles = familyRoles(entry)
    if (
      needles.length > 0 &&
      !matchesTerms(familyHaystack(entry, roles), needles)
    )
      continue
    out.families.push({ entry, roles })
  }

  for (const summary of summaries) {
    if (byEndpoint.has(summary.key)) continue
    if (!kindMatches(summary.kind)) continue
    const text = `${summary.name} ${summary.key}`.toLowerCase()
    if (needles.length > 0 && !matchesTerms(text, needles)) continue
    const roles = Object.hasOwn(capabilities, summary.key)
      ? (capabilities[summary.key] ?? null)
      : null
    out.models.push({ summary, roles })
  }
  return out
}

/**
 * Each "Takes" chip's count, in one pass: how many rows would *take* the
 * role were it pressed alongside the current ones — families, plus
 * inspected unverified models while those are included. Models nobody has
 * inspected are not counted; nothing says they take it. Equal, role by
 * role, to counting `buildPickerRows` with the role added.
 */
export function countRoles(
  input: PickerRowsInput
): Record<ReferenceRole, number> {
  const { filter } = input
  const counts = Object.fromEntries(
    REFERENCE_ROLES.map((role) => [role, 0])
  ) as Record<ReferenceRole, number>
  const { families, models } = candidates(input)

  const tally = (roles: readonly ReferenceRole[]) => {
    if (!takesAll(roles, filter.roles)) return
    for (const role of roles) counts[role] += 1
  }
  for (const { roles } of families) tally(roles)
  if (filter.includeUnverified) {
    for (const { roles } of models) if (roles !== null) tally(roles)
  }
  return counts
}

export function buildPickerRows(input: PickerRowsInput): PickerRows {
  const { summaries, configured, filter } = input
  const roleFilter = filter.roles.length > 0
  const summaryByKey = new Map(summaries.map((s) => [s.key, s]))
  const found = candidates(input)

  const familyRows: FamilyPickerRow[] = []
  for (const { entry, roles } of found.families) {
    if (roleFilter && !takesAll(roles, filter.roles)) continue

    const providers: FamilyPickerRow["providers"] = []
    for (const endpoint of entry.family.endpoints) {
      if (providers.some((p) => p.id === endpoint.provider)) continue
      providers.push({
        id: endpoint.provider,
        configured: configured.includes(endpoint.provider),
      })
    }

    familyRows.push({
      type: "family",
      key: familyKey(entry.family.id),
      entry,
      roles,
      providers,
      priceHint: familyPrice(entry, summaryByKey, configured),
    })
  }

  const matched: ModelPickerRow[] = []
  const uninspected: ModelPickerRow[] = []
  let hiddenUnverified = 0
  let hiddenUninspected = 0
  for (const { summary, roles } of found.models) {
    const row: ModelPickerRow = {
      type: "model",
      key: summary.key,
      summary,
      roles,
      verified: false,
    }

    if (!roleFilter) {
      matched.push(row)
      continue
    }
    // Under a role filter: what the switch would show is what it hides.
    const wouldShow = roles === null || takesAll(roles, filter.roles)
    if (!wouldShow) continue
    if (!filter.includeUnverified) {
      hiddenUnverified += 1
      if (roles === null) hiddenUninspected += 1
      continue
    }
    if (roles === null) uninspected.push(row)
    else matched.push(row)
  }

  return {
    families: familyRows,
    models: [...matched, ...uninspected],
    hiddenUnverified,
    hiddenUninspected,
  }
}
