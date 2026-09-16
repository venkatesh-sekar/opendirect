import { beforeEach, describe, expect, it } from "vitest"

import {
  getProvider,
  listConfigured,
  listProviders,
  registerProvider,
  requireProvider,
  resetProviders,
} from "./registry"
import type { ModelProvider } from "./types"

function stubProvider(
  id: ModelProvider["id"],
  configured: boolean
): ModelProvider {
  return {
    id,
    isConfigured: () => configured,
    listModels: async () => [],
    getModel: async () => {
      throw new Error("not implemented")
    },
    submit: async () => {
      throw new Error("not implemented")
    },
    poll: async () => {
      throw new Error("not implemented")
    },
    cancel: async () => {},
  }
}

describe("provider registry", () => {
  beforeEach(() => {
    resetProviders()
  })

  it("returns a registered provider by id", () => {
    const replicate = stubProvider("replicate", true)
    registerProvider(replicate)
    expect(getProvider("replicate")).toBe(replicate)
    expect(getProvider("openrouter")).toBeUndefined()
  })

  it("replaces an existing registration for the same id", () => {
    registerProvider(stubProvider("replicate", true))
    const replacement = stubProvider("replicate", false)
    registerProvider(replacement)
    expect(listProviders()).toEqual([replacement])
  })

  it("lists only providers that hold a key", () => {
    registerProvider(stubProvider("replicate", true))
    registerProvider(stubProvider("openrouter", false))
    expect(listConfigured().map((p) => p.id)).toEqual(["replicate"])
  })

  it("throws from requireProvider when nothing is registered", () => {
    expect(() => requireProvider("openrouter")).toThrow(/openrouter/)
  })
})
