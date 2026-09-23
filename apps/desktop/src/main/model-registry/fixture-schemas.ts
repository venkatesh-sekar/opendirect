/**
 * Test helper: the input JSON Schema an endpoint really has, read from the
 * recorded fixtures under `test/fixtures/` and built exactly as the adapters
 * build it (Replicate: Cog's `Input` with enums dereferenced; OpenRouter: the
 * capability manifest through `buildVideoInputSchema` /
 * `buildImageInputSchema`). The bundled-registry guard checks every mapped
 * field against this, so a mapping can never name a field the provider does
 * not publish.
 *
 * ⛔ Test-only. It reads fixtures from the repo, so production code must never
 * import it. It never touches the network.
 */
import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

import type { ProviderId } from "@opendirect/contract"

import {
  buildImageInputSchema,
  buildVideoInputSchema,
  type OpenRouterImageModel,
  type OpenRouterVideoModel,
} from "../providers/openrouter-schema"
import { dereferenceCogSchema } from "../providers/replicate"

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const FIXTURES = resolve(process.cwd(), "test/fixtures")

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown
}

/** `owner/name` → the recorded `model-*.json` whose owner and name match. */
function replicateInputSchema(model: string): JsonObject | null {
  const dir = resolve(FIXTURES, "replicate")
  for (const file of readdirSync(dir)) {
    if (!file.startsWith("model-") || !file.endsWith(".json")) continue
    const recorded = readJson(resolve(dir, file))
    if (!isObject(recorded)) continue
    if (`${String(recorded.owner)}/${String(recorded.name)}` !== model) continue
    const version = recorded.latest_version
    const openapi = isObject(version) ? version.openapi_schema : undefined
    const components = isObject(openapi) ? openapi.components : undefined
    const schemas = isObject(components) ? components.schemas : undefined
    if (!isObject(schemas)) return null
    const input = dereferenceCogSchema(schemas.Input, schemas)
    return isObject(input) ? input : null
  }
  return null
}

function openRouterCatalog(name: string): JsonObject[] {
  const listing = readJson(resolve(FIXTURES, "openrouter", `${name}.json`))
  const data = isObject(listing) ? listing.data : undefined
  return Array.isArray(data) ? data.filter(isObject) : []
}

function openRouterInputSchema(model: string): JsonObject | null {
  const video = openRouterCatalog("videos-models").find((m) => m.id === model)
  if (video) return buildVideoInputSchema(video as OpenRouterVideoModel)
  const image = openRouterCatalog("images-models").find((m) => m.id === model)
  if (image) return buildImageInputSchema(image as OpenRouterImageModel)
  return null
}

/**
 * The recorded input schema for `provider:model`, or null when no fixture
 * has been recorded for it.
 */
export function fixtureInputSchema(
  provider: ProviderId,
  model: string
): JsonObject | null {
  switch (provider) {
    case "replicate":
      return replicateInputSchema(model)
    case "openrouter":
      return openRouterInputSchema(model)
  }
}
