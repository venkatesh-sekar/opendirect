import { join, normalize } from "node:path"

/** Where `next dev` serves the renderer from during development. */
export const DEFAULT_DEV_SERVER_URL = "http://localhost:3000"

type Env = Record<string, string | undefined>

/** The shell only treats an exact `NODE_ENV=development` as dev mode. */
export function isDevelopment(env: Env = process.env): boolean {
  return env.NODE_ENV === "development"
}

/** Dev server URL, overridable with `OPENDIRECT_DEV_SERVER_URL`. */
export function resolveDevServerUrl(env: Env = process.env): string {
  const override = env.OPENDIRECT_DEV_SERVER_URL?.trim()
  return override ? override : DEFAULT_DEV_SERVER_URL
}

/**
 * Directory `electron-serve` serves in production.
 *
 * `mainDir` is the directory of the built main bundle
 * (`apps/desktop/dist/main`); the Next.js static export sits at
 * `apps/web/out`, three levels up.
 */
export function resolveRendererDirectory(mainDir: string): string {
  return normalize(join(mainDir, "..", "..", "..", "web", "out"))
}

/** Path of the built preload bundle, a sibling of the main bundle. */
export function resolvePreloadPath(mainDir: string): string {
  return normalize(join(mainDir, "..", "preload", "index.js"))
}
