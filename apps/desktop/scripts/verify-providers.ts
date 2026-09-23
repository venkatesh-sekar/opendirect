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
 * Registry mode performs the same kind of GETs: it reads each endpoint's
 * live input schema through the adapters' `getModel` (Replicate: one
 * `GET /v1/models/{owner}/{name}` per endpoint; OpenRouter: its video and
 * image model listings, fetched at most once each and cached for the run)
 * and checks the mapping against it with
 * `checkEndpointAgainstSchema`, the same check the fixture guard and the
 * mapping editor run. A provider with no key is skipped, not failed.
 *
 * ⛔ Do not add `predictions.create`, `replicate.run`, or any other POST that
 * runs a model to this file. Generation paths are verified against `msw`
 * fixtures in `replicate.test.ts`, never against the live API.
 *
 * Usage (reads `REPLICATE_API_TOKEN` and `OPENROUTER_API_KEY` from the
 * repo-root `.env.local`):
 *
 *   pnpm --filter @opendirect/desktop verify:providers
 *   pnpm --filter @opendirect/desktop verify:providers -- --registry
 *   pnpm --filter @opendirect/desktop verify:providers -- --registry --file path/to/family.json
 *
 * Registry mode exits 1 when a mapped field is missing upstream or an
 * endpoint cannot be read, and 0 otherwise.
 */
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

import { config as loadEnv } from "dotenv"

import {
  modelFamilySchema,
  registryIndexSchema,
  type ModelFamily,
  type ProviderId,
} from "@opendirect/contract"

import {
  formatVerifyReport,
  parseVerifyArgs,
  resolveFamilyPath,
  verifyRegistry,
  type FetchSchema,
} from "../src/main/model-registry/verify"
import { createOpenRouterProvider } from "../src/main/providers/openrouter"
import { createReplicateProvider } from "../src/main/providers/replicate"
import { PROVIDER_ENV_VARS, findEnvFile } from "../src/main/settings"

const SLUGS = ["bytedance/seedance-2.5", "google/nano-banana-pro"]

/** The same files `bundled.ts` compiles into the app. */
const REGISTRY_DIR = resolve(__dirname, "../../../registry")

function loadEnvFile(): void {
  const envFile = findEnvFile(process.cwd(), existsSync)
  if (envFile) loadEnv({ path: envFile, quiet: true })
}

function envKey(provider: ProviderId): string | null {
  return process.env[PROVIDER_ENV_VARS[provider]]?.trim() || null
}

function readFamily(path: string): ModelFamily {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown
  const parsed = modelFamilySchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(file)"}: ${issue.message}`)
      .join("\n")
    throw new Error(`${path} is not a valid family:\n${issues}`)
  }
  return parsed.data
}

/** The bundled families, then each `--file`, replacing a bundled one by id. */
function loadFamilies(extraFiles: readonly string[]): ModelFamily[] {
  const index = registryIndexSchema.parse(
    JSON.parse(readFileSync(resolve(REGISTRY_DIR, "index.json"), "utf8"))
  )
  const families = index.families.map((id) =>
    readFamily(resolve(REGISTRY_DIR, "models", `${id}.json`))
  )
  for (const file of extraFiles) {
    const family = readFamily(
      resolveFamilyPath(file, process.env, process.cwd())
    )
    const at = families.findIndex((existing) => existing.id === family.id)
    if (at === -1) families.push(family)
    else families[at] = family
  }
  return families
}

async function verifyRegistryMode(
  extraFiles: readonly string[]
): Promise<void> {
  const families = loadFamilies(extraFiles)

  const keys: Record<ProviderId, string | null> = {
    replicate: envKey("replicate"),
    openrouter: envKey("openrouter"),
  }
  // ⛔ Only `getModel` is ever called: both adapters answer it with free GETs.
  const readers: Record<
    ProviderId,
    { getModel(slug: string): Promise<{ inputSchema: unknown }> }
  > = {
    replicate: createReplicateProvider({ getKey: () => keys.replicate }),
    openrouter: createOpenRouterProvider({ getKey: () => keys.openrouter }),
  }
  const fetchSchema: FetchSchema = async (provider, model) => {
    if (!keys[provider]) {
      return { status: "skipped", reason: `no ${PROVIDER_ENV_VARS[provider]}` }
    }
    const descriptor = await readers[provider].getModel(model)
    return { status: "ok", inputSchema: descriptor.inputSchema }
  }

  const report = await verifyRegistry(families, fetchSchema)
  console.log(formatVerifyReport(report))
  if (report.failed) process.exitCode = 1
}

async function main(): Promise<void> {
  const args = parseVerifyArgs(process.argv.slice(2))
  loadEnvFile()
  if (args.registry) {
    await verifyRegistryMode(args.files)
    return
  }

  const token = envKey("replicate")
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
