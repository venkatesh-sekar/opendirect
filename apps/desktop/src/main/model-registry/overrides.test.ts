import { describe, expect, it } from "vitest"

import type { SettingsStore } from "../settings"
import {
  OVERRIDES_KEY,
  OverrideValidationError,
  createOverrideStore,
} from "./overrides"

function memoryStore(initial: Record<string, unknown> = {}): SettingsStore & {
  data: Record<string, unknown>
} {
  const data = { ...initial }
  return {
    data,
    get: (key) => data[key],
    set: (key, value) => {
      data[key] = value
    },
    delete: (key) => {
      delete data[key]
    },
  }
}

const family = (id: string, name = id) => ({
  id,
  name,
  kind: "image",
  endpoints: [{ provider: "replicate", model: `me/${id}` }],
})

describe("createOverrideStore", () => {
  it("saves a valid family and lists it validated", () => {
    const store = memoryStore()
    const overrides = createOverrideStore(store)

    const saved = overrides.save(family("mine"), null, 5)

    expect(saved).toMatchObject({ id: "mine", issues: [], updatedAt: 5 })
    expect(saved.key).toEqual(expect.any(String))
    expect(saved.family?.endpoints[0]?.inputs).toEqual({})
    expect(store.data[OVERRIDES_KEY]).toEqual([
      { key: saved.key, raw: family("mine"), updatedAt: 5 },
    ])
    expect(overrides.list()).toEqual([saved])
  })

  it("refuses an invalid family with per-field issues and stores nothing", () => {
    const store = memoryStore()
    const overrides = createOverrideStore(store)

    let thrown: unknown
    try {
      overrides.save({ ...family("mine"), endpoints: [] }, null, 5)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(OverrideValidationError)
    const error = thrown as OverrideValidationError
    expect(error.issues).toEqual([
      { path: "endpoints", message: expect.any(String) },
    ])
    expect(error.message).toContain("endpoints:")
    expect(store.data[OVERRIDES_KEY]).toBeUndefined()
    expect(overrides.list()).toEqual([])
  })

  it("updates the entry with the same id in place, keeping its key", () => {
    const overrides = createOverrideStore(memoryStore())
    const first = overrides.save(family("a"), null, 1)
    const other = overrides.save(family("b"), null, 2)
    expect(first.key).not.toBe(other.key)

    const again = overrides.save(family("a", "A again"), null, 3)

    expect(again.key).toBe(first.key)
    expect(overrides.list().map((o) => [o.id, o.family?.name])).toEqual([
      ["a", "A again"],
      ["b", "b"],
    ])
  })

  it("renames through replaceId without leaving the old id behind", () => {
    const overrides = createOverrideStore(memoryStore())
    overrides.save(family("old"), null, 1)
    overrides.save(family("other"), null, 2)

    overrides.save(family("new"), "old", 3)

    expect(overrides.list().map((o) => o.id)).toEqual(["new", "other"])
  })

  it("drops an older entry the new id would duplicate on rename", () => {
    const overrides = createOverrideStore(memoryStore())
    overrides.save(family("a"), null, 1)
    overrides.save(family("b"), null, 2)

    overrides.save(family("b", "renamed a"), "a", 3)

    expect(overrides.list().map((o) => [o.id, o.family?.name])).toEqual([
      ["b", "renamed a"],
    ])
  })

  it("deletes by storage key", () => {
    const overrides = createOverrideStore(memoryStore())
    const a = overrides.save(family("a"), null, 1)
    overrides.save(family("b"), null, 2)

    overrides.delete(a.key)

    expect(overrides.list().map((o) => o.id)).toEqual(["b"])
  })

  it("gives legacy entries stable keys, so one without an id can be deleted", () => {
    const store = memoryStore({
      [OVERRIDES_KEY]: [
        { raw: { name: "no id" }, updatedAt: 1 },
        { raw: 42, updatedAt: 2 },
        { raw: family("fine"), updatedAt: 3 },
      ],
    })
    const overrides = createOverrideStore(store)

    const listed = overrides.list()
    expect(listed.map((o) => o.id)).toEqual([null, null, "fine"])
    expect(new Set(listed.map((o) => o.key)).size).toBe(3)
    // Derived keys do not change between reads.
    expect(overrides.list().map((o) => o.key)).toEqual(listed.map((o) => o.key))

    overrides.delete(listed[0]!.key)
    expect(overrides.list().map((o) => o.raw)).toEqual([42, family("fine")])
    overrides.delete(listed[1]!.key)
    expect(overrides.list().map((o) => o.id)).toEqual(["fine"])
  })

  it("deletes one of two hand-edited entries that share an id", () => {
    const store = memoryStore({
      [OVERRIDES_KEY]: [
        { raw: family("dup", "first"), updatedAt: 1 },
        { raw: family("dup", "second"), updatedAt: 1 },
        { key: "same", raw: family("x", "x1"), updatedAt: 1 },
        { key: "same", raw: family("x", "x2"), updatedAt: 1 },
      ],
    })
    const overrides = createOverrideStore(store)

    const listed = overrides.list()
    expect(new Set(listed.map((o) => o.key)).size).toBe(4)

    overrides.delete(listed[1]!.key)
    overrides.delete(listed[3]!.key)

    expect(overrides.list().map((o) => o.family?.name)).toEqual(["first", "x1"])
  })

  it("keeps a legacy entry's key once a save writes the list back", () => {
    const store = memoryStore({
      [OVERRIDES_KEY]: [{ raw: { name: "no id" }, updatedAt: 1 }],
    })
    const overrides = createOverrideStore(store)
    const [legacy] = overrides.list()

    overrides.save(family("new"), null, 2)

    expect(overrides.list()[0]?.key).toBe(legacy!.key)
    overrides.delete(legacy!.key)
    expect(overrides.list().map((o) => o.id)).toEqual(["new"])
  })

  it("lists a stored entry that no longer validates, with its issues", () => {
    const broken = { id: "broken", name: "", kind: "image", endpoints: [] }
    const overrides = createOverrideStore(
      memoryStore({
        [OVERRIDES_KEY]: [
          { raw: broken, updatedAt: 4 },
          "not even an entry",
          { raw: family("fine"), updatedAt: 6 },
        ],
      })
    )

    const listed = overrides.list()

    expect(listed).toHaveLength(2)
    expect(listed[0]).toMatchObject({ id: "broken", family: null, raw: broken })
    expect(listed[0]?.issues.map((issue) => issue.path)).toEqual([
      "name",
      "endpoints",
    ])
    expect(listed[1]).toMatchObject({ id: "fine", issues: [] })
  })

  it("reads a store that holds no list as empty", () => {
    const overrides = createOverrideStore(
      memoryStore({ [OVERRIDES_KEY]: { nope: true } })
    )
    expect(overrides.list()).toEqual([])
  })
})
