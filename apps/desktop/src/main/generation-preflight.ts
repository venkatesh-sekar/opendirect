import type { GenerationRequest, ModelDescriptor } from "@opendirect/contract"
import { estimateForDescriptor } from "./providers/cost"
import { requireProvider } from "./providers/registry"

/** Recompute the batch price in main; never trust a renderer-supplied quote. */
export async function preflightGeneration(
  descriptor: ModelDescriptor,
  requests: GenerationRequest[]
): Promise<GenerationRequest[]> {
  const provider = requireProvider(descriptor.provider)
  if (!provider.isConfigured())
    throw new Error(
      `Add a ${descriptor.provider} API key in Settings before generating.`
    )
  const checked = requests.map((request) => {
    const quote = estimateForDescriptor(descriptor, request.params)
    const unknown = quote.confidence === "unknown"
    if (unknown && !request.acceptUnknownCost)
      throw new Error(
        "This model's cost is unknown. Review the cost notice and accept it before running."
      )
    return {
      ...request,
      estimatedCostUsd: unknown ? null : quote.amount,
      costConfidence: quote.confidence,
    }
  })
  const total = checked.some((request) => request.estimatedCostUsd === null)
    ? null
    : checked.reduce((sum, request) => sum + request.estimatedCostUsd!, 0)
  await provider.validateSpend?.(total)
  return checked
}
