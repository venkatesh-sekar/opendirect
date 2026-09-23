/**
 * The user layer of the registry (design §4.3): mappings the user wrote in
 * the mapping editor or imported, kept in the settings store (the same
 * `electron-store` file as settings) under `modelRegistry.overrides`.
 *
 * Each entry keeps the `raw` JSON as the user saved it, not the parsed
 * family. An entry that stops validating — after a format change, or a
 * hand-edit of the settings file — is still listed, with its issues, so it
 * can be fixed in the editor rather than disappearing. A save, though, is
 * refused outright when the family does not validate: nothing invalid is
 * ever written by the app itself.
 *
 * ⛔ No network: this is local data only.
 */
import {
  validateFamily,
  type RegistryIssue,
  type UserOverride,
} from "@opendirect/contract"

import type { SettingsStore } from "../settings"

export const OVERRIDES_KEY = "modelRegistry.overrides"

interface StoredOverride {
  raw: unknown
  updatedAt: number
}

/** A refused save. `issues` carry paths so the editor can place each one. */
export class OverrideValidationError extends Error {
  readonly issues: RegistryIssue[]

  constructor(issues: RegistryIssue[]) {
    super(
      `This mapping is not valid: ${issues
        .map((issue) =>
          issue.path ? `${issue.path}: ${issue.message}` : issue.message
        )
        .join("; ")}`
    )
    this.name = "OverrideValidationError"
    this.issues = issues
  }
}

export interface OverrideStore {
  list(): UserOverride[]
  /**
   * Replaces the entry with `replaceId` (a rename), else the one with the
   * same id, else appends. Throws `OverrideValidationError` when `raw` does
   * not validate, and then stores nothing.
   */
  save(raw: unknown, replaceId: string | null, now: number): UserOverride
  delete(id: string): void
}

function rawId(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null
  const id = (raw as { id?: unknown }).id
  return typeof id === "string" ? id : null
}

/** The stored entry, validated now — the format may have moved since. */
export function toUserOverride(entry: StoredOverride): UserOverride {
  const { family, issues } = validateFamily(entry.raw)
  return {
    id: rawId(entry.raw),
    raw: entry.raw,
    family,
    issues,
    updatedAt: entry.updatedAt,
  }
}

export function createOverrideStore(store: SettingsStore): OverrideStore {
  function read(): StoredOverride[] {
    const value = store.get(OVERRIDES_KEY)
    if (!Array.isArray(value)) return []
    // Anything that is not even an entry is not a mapping; there is nothing
    // in it to list or fix.
    return value.flatMap((entry: unknown) => {
      if (typeof entry !== "object" || entry === null || !("raw" in entry)) {
        return []
      }
      const updatedAt = (entry as { updatedAt?: unknown }).updatedAt
      return [
        {
          raw: (entry as { raw: unknown }).raw,
          updatedAt: typeof updatedAt === "number" ? updatedAt : 0,
        },
      ]
    })
  }

  return {
    list: () => read().map(toUserOverride),

    save(raw, replaceId, now) {
      const { family, issues } = validateFamily(raw)
      if (!family) throw new OverrideValidationError(issues)

      const entry: StoredOverride = { raw, updatedAt: now }
      const entries = read()
      const target = replaceId ?? family.id
      const at = entries.findIndex((stored) => rawId(stored.raw) === target)
      // A rename onto an id another entry already holds replaces that one
      // too; two user entries with one id would only shadow each other.
      const next = entries.filter(
        (stored, index) =>
          index === at || replaceId === null || rawId(stored.raw) !== family.id
      )
      const position = at === -1 ? -1 : next.indexOf(entries[at]!)
      if (position === -1) next.push(entry)
      else next[position] = entry

      store.set(OVERRIDES_KEY, next)
      return toUserOverride(entry)
    },

    delete(id) {
      store.set(
        OVERRIDES_KEY,
        read().filter((stored) => rawId(stored.raw) !== id)
      )
    },
  }
}
