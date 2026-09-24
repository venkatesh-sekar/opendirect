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
 * Every entry has a storage `key`, assigned when the app writes it and kept
 * across updates. The family id cannot serve: a hand-edited entry may have
 * none, or share one with another entry. An entry written before keys
 * existed gets one derived from its content, stable across reads, and keeps
 * it once any save writes the list back.
 *
 * ⛔ No network: this is local data only.
 */
import { createHash, randomUUID } from "node:crypto"

import {
  validateFamily,
  type RegistryIssue,
  type UserOverride,
} from "@opendirect/contract"

import type { SettingsStore } from "../settings"

export const OVERRIDES_KEY = "modelRegistry.overrides"

interface StoredOverride {
  key: string
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
  /** Removes the one entry with this storage key; unknown keys are a no-op. */
  delete(key: string): void
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
    key: entry.key,
    id: rawId(entry.raw),
    raw: entry.raw,
    family,
    issues,
    updatedAt: entry.updatedAt,
  }
}

/** A key for an entry stored without one: its content, so it is stable. */
function derivedKey(raw: unknown, updatedAt: number): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([raw, updatedAt]) ?? "undefined")
    .digest("hex")
  return `legacy-${digest.slice(0, 16)}`
}

export function createOverrideStore(store: SettingsStore): OverrideStore {
  function read(): StoredOverride[] {
    const value = store.get(OVERRIDES_KEY)
    if (!Array.isArray(value)) return []
    const entries = value.flatMap((entry: unknown) => {
      // Anything that is not even an entry is not a mapping; there is nothing
      // in it to list or fix.
      if (typeof entry !== "object" || entry === null || !("raw" in entry)) {
        return []
      }
      const raw = (entry as { raw: unknown }).raw
      const stored = entry as { updatedAt?: unknown; key?: unknown }
      const updatedAt =
        typeof stored.updatedAt === "number" ? stored.updatedAt : 0
      const base =
        typeof stored.key === "string" && stored.key !== ""
          ? stored.key
          : derivedKey(raw, updatedAt)
      return [{ base, raw, updatedAt }]
    })
    // A copied entry repeats a key; the copy gets the first free `#n`. A
    // suffix never takes a key some entry has stored as its own (`x#2` next
    // to two `x`s), so a key the UI holds always names one entry.
    const reserved = new Set(entries.map((entry) => entry.base))
    const used = new Set<string>()
    return entries.map(({ base, raw, updatedAt }) => {
      let key = base
      for (
        let n = 2;
        used.has(key) || (key !== base && reserved.has(key));
        n++
      ) {
        key = `${base}#${n}`
      }
      used.add(key)
      return { key, raw, updatedAt }
    })
  }

  return {
    list: () => read().map(toUserOverride),

    save(raw, replaceId, now) {
      const { family, issues } = validateFamily(raw)
      if (!family) throw new OverrideValidationError(issues)

      const entries = read()
      const target = replaceId ?? family.id
      const at = entries.findIndex((stored) => rawId(stored.raw) === target)
      // An update keeps the entry's key, so a key the UI holds stays valid.
      const entry: StoredOverride = {
        key: at === -1 ? randomUUID() : entries[at]!.key,
        raw,
        updatedAt: now,
      }
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

    delete(key) {
      const entries = read()
      const next = entries.filter((stored) => stored.key !== key)
      if (next.length !== entries.length) store.set(OVERRIDES_KEY, next)
    },
  }
}
