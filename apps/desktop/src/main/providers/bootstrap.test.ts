/**
 * ⛔ No network: registration only builds the adapters, it never calls them.
 */
import type { ProviderId } from "@opendirect/contract"
import { beforeEach, describe, expect, it } from "vitest"

import { registerModelProviders } from "./bootstrap"
import { listConfigured, listProviders, resetProviders } from "./registry"

function keySource(keys: Partial<Record<ProviderId, string>>) {
  return {
    getKeyWithEnvFallback: (provider: ProviderId) => keys[provider] ?? null,
  }
}

describe("registerModelProviders", () => {
  beforeEach(() => {
    resetProviders()
  })

  it("registers both shipped adapters", () => {
    registerModelProviders(keySource({}))

    expect(listProviders().map((p) => p.id)).toEqual([
      "replicate",
      "openrouter",
    ])
  })

  it("treats a provider with no key as unconfigured", () => {
    registerModelProviders(keySource({ replicate: "r8_test" }))

    expect(listConfigured().map((p) => p.id)).toEqual(["replicate"])
  })

  it("re-reads the key on every check, so a key added later takes effect", () => {
    const keys: Partial<Record<ProviderId, string>> = {}
    registerModelProviders({
      getKeyWithEnvFallback: (provider) => keys[provider] ?? null,
    })

    expect(listConfigured()).toHaveLength(0)
    keys.openrouter = "sk-or-v1-test"
    expect(listConfigured().map((p) => p.id)).toEqual(["openrouter"])
  })

  it("replaces an earlier registration rather than duplicating it", () => {
    registerModelProviders(keySource({}))
    registerModelProviders(keySource({}))

    expect(listProviders()).toHaveLength(2)
  })
})
