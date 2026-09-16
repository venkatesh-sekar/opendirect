import { join, normalize } from "node:path"

/** Where `next dev` serves the renderer from during development. */
export const DEFAULT_DEV_SERVER_URL = "http://localhost:3000"

/**
 * Sub-directory of `process.resourcesPath` holding the renderer bundle in a
 * packaged app.
 *
 * Must stay in sync with the `extraResources` entry in
 * `apps/desktop/electron-builder.yml` (`from: ../web/out` → `to: web`);
 * `packaging.test.ts` asserts that.
 */
export const PACKAGED_RENDERER_DIR = "web"

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

/** Everything `resolveRendererDirectory` needs, injected so it stays pure. */
export interface RendererPaths {
  /** Directory of the built main bundle (`__dirname`). */
  readonly mainDir: string
  /** `app.isPackaged`. */
  readonly packaged: boolean
  /** `process.resourcesPath` — only meaningful when packaged. */
  readonly resourcesPath?: string
}

/**
 * Directory `electron-serve` serves in production.
 *
 * Two layouts exist and no fixed relative path covers both:
 *
 * - **packaged** — electron-builder copies `apps/web/out` into the app's
 *   resources directory (`extraResources`), so the bundle sits next to
 *   `app.asar` at `<resources>/web` while the main bundle lives *inside*
 *   `app.asar`. Walking up from `dist/main` would land inside the archive.
 * - **unpacked** — running `dist/main/index.js` straight out of the workspace,
 *   where `apps/web/out` is three levels up from `apps/desktop/dist/main`.
 */
export function resolveRendererDirectory(paths: RendererPaths): string {
  if (paths.packaged) {
    if (!paths.resourcesPath) {
      throw new Error(
        "resolveRendererDirectory: resourcesPath is required for a packaged app"
      )
    }
    return normalize(join(paths.resourcesPath, PACKAGED_RENDERER_DIR))
  }
  return normalize(join(paths.mainDir, "..", "..", "..", "web", "out"))
}

/** Path of the built preload bundle, a sibling of the main bundle. */
export function resolvePreloadPath(mainDir: string): string {
  return normalize(join(mainDir, "..", "preload", "index.js"))
}
