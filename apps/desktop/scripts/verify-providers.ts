/**
 * READ-ONLY. This script must never create a prediction.
 *
 * A manual smoke test for the provider adapters, deliberately kept out of
 * `pnpm test` because it talks to the live API. It calls only free, read-only
 * `GET` endpoints (`/v1/collections/{slug}`, `/v1/models/{owner}/{name}`) and
 * prints the normalized descriptor for a couple of models, so a schema change
 * at Replicate shows up as a diff in the printed shape rather than as a broken
 * form at generation time.
 *
 * ⛔ Do not add `predictions.create`, `replicate.run`, or any other POST that
 * runs a model to this file. Generation paths are verified against `msw`
 * fixtures in `replicate.test.ts`, never against the live API.
 *
 * Usage (reads `REPLICATE_API_TOKEN` from the repo-root `.env.local`):
 *
 *   pnpm --filter @opendirect/desktop verify:providers
 */
import { existsSync } from "node:fs"

import { config as loadEnv } from "dotenv"

import { findEnvFile } from "../src/main/settings"
import { createReplicateProvider } from "../src/main/providers/replicate"

const SLUGS = ["bytedance/seedance-2.5", "google/nano-banana-pro"]

function loadToken(): string | null {
  const envFile = findEnvFile(process.cwd(), existsSync)
  if (envFile) loadEnv({ path: envFile, quiet: true })
  return process.env.REPLICATE_API_TOKEN?.trim() || null
}

async function main(): Promise<void> {
  const token = loadToken()
  if (!token) {
    console.error(
      "No REPLICATE_API_TOKEN found (checked the environment and the nearest .env.local)."
    )
    process.exitCode = 1
    return
  }

  const provider = createReplicateProvider({ getKey: () => token })

  const summaries = await provider.listModels({ kinds: ["video", "image"] })
  console.log(`listModels → ${summaries.length} models from the collections`)
  for (const summary of summaries.slice(0, 5)) {
    console.log(`  ${summary.kind.padEnd(5)} ${summary.slug}`)
  }

  for (const slug of SLUGS) {
    const descriptor = await provider.getModel(slug)
    console.log(`\n=== ${descriptor.key} (${descriptor.kind})`)
    console.log(`version   ${descriptor.versionId}`)
    console.log(
      `inputs    ${Object.keys(
        (descriptor.inputSchema.properties ?? {}) as object
      ).join(", ")}`
    )
    console.log(`controls  ${JSON.stringify(descriptor.commonControls)}`)
    console.log(
      `slots     ${JSON.stringify(descriptor.referenceSlots, null, 2)}`
    )
    console.log(
      `pricing   ${descriptor.pricing.source} ${JSON.stringify(descriptor.pricing.skus)}`
    )
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
