import { afterEach, expect, it, vi } from "vitest"
import {
  unknownPricing,
  type ModelDescriptor,
  type GenerationRequest,
} from "@opendirect/contract"
import { preflightGeneration } from "./generation-preflight"
import { registerProvider, resetProviders } from "./providers/registry"
import { validateGenerationParams } from "./generation-validation"

const descriptor: ModelDescriptor = {
  key: "openrouter:test/image",
  slug: "test/image",
  provider: "openrouter",
  name: "Test image",
  kind: "image",
  description: null,
  versionId: null,
  coverImageUrl: null,
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", minLength: 1 },
      steps: { type: "integer", minimum: 1, maximum: 10 },
    },
    required: ["prompt"],
  },
  outputSchema: null,
  referenceSlots: [],
  commonControls: {
    prompt: "prompt",
    aspectRatio: null,
    duration: null,
    resolution: null,
    seed: null,
    audio: null,
  },
  pricing: unknownPricing,
  raw: null,
  fetchedAt: 0,
}
const request: GenerationRequest = {
  modelKey: descriptor.key,
  containerId: null,
  prompt: "Portrait",
  params: {},
  references: [],
  estimatedCostUsd: 0,
  costConfidence: "exact",
  parentGenerationId: null,
  batchId: null,
}
function provider(configured = true) {
  const validateSpend = vi.fn(async () => {})
  registerProvider({
    id: "openrouter",
    isConfigured: () => configured,
    getModel: vi.fn(),
    listModels: vi.fn(),
    submit: vi.fn(),
    poll: vi.fn(),
    cancel: vi.fn(),
    validateSpend,
  })
  return validateSpend
}
afterEach(resetProviders)
it("rejects missing credentials before spend validation", async () => {
  const check = provider(false)
  await expect(preflightGeneration(descriptor, [request])).rejects.toThrow(
    "API key"
  )
  expect(check).not.toHaveBeenCalled()
})
it("requires explicit unknown-cost acceptance and discards forged free quotes", async () => {
  const check = provider()
  await expect(preflightGeneration(descriptor, [request])).rejects.toThrow(
    "cost is unknown"
  )
  const checked = await preflightGeneration(descriptor, [
    { ...request, acceptUnknownCost: true },
  ])
  expect(checked[0]?.estimatedCostUsd).toBeNull()
  expect(checked[0]?.costConfidence).toBe("unknown")
  expect(check).toHaveBeenCalledWith(null)
})
it("validates imported settings and required prompts against the model schema", () => {
  expect(() =>
    validateGenerationParams(descriptor, { ...request, params: { steps: 100 } })
  ).toThrow("Check model settings")
  expect(() =>
    validateGenerationParams(descriptor, { ...request, prompt: "" })
  ).toThrow("required")
  expect(() =>
    validateGenerationParams(descriptor, { ...request, params: { steps: 3 } })
  ).not.toThrow()
})
