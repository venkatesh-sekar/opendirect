import { app, BrowserWindow, session, shell } from "electron"
import type { Session } from "electron"
import serve from "electron-serve"

import {
  isDevelopment,
  resolveDevServerUrl,
  resolvePreloadPath,
  resolveRendererDirectory,
} from "./resolve"
import {
  APP_ORIGIN,
  isAllowedExternalUrl,
  isInternalNavigation,
  PRODUCTION_CSP,
} from "./security"

let loadProduction: ((window: BrowserWindow) => Promise<void>) | undefined
let cspApplied = false

/**
 * Registers the `app://` scheme that serves the static renderer bundle.
 *
 * **Must run before `app.whenReady()`**: `electron-serve` registers its
 * privileged scheme in a microtask and attaches its protocol handler on the
 * app's `ready` event, so calling it afterwards would register a scheme too
 * late and never attach a handler at all.
 */
export function prepareProductionRenderer(): void {
  if (isDevelopment() || loadProduction) return
  loadProduction = serve({
    directory: resolveRendererDirectory({
      mainDir: __dirname,
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
    }),
  })
}

/**
 * Defence-in-depth CSP header for anything served through Chromium's network
 * stack in production.
 *
 * It does **not** cover the `app://` renderer itself: `electron-serve` v3
 * answers those requests from `session.protocol.handle`, which bypasses the
 * `webRequest` module entirely. The renderer's own policy therefore ships as a
 * `<meta http-equiv="Content-Security-Policy">` tag emitted by the Next.js root
 * layout in production builds (`apps/web/lib/csp.ts`), and the two policies are
 * kept identical by `test/csp.test.ts`.
 */
function applyContentSecurityPolicy(target: Session): void {
  if (cspApplied) return
  cspApplied = true
  target.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [PRODUCTION_CSP],
      },
    })
  })
}

/** Send a web URL to the user's browser; silently drop anything else. */
function openExternally(url: string): void {
  if (isAllowedExternalUrl(url)) void shell.openExternal(url)
}

export async function createMainWindow(): Promise<BrowserWindow> {
  const dev = isDevelopment()
  const rendererOrigin = dev ? resolveDevServerUrl() : APP_ORIGIN

  if (!dev) applyContentSecurityPolicy(session.defaultSession)

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: resolvePreloadPath(__dirname),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.once("ready-to-show", () => win.show())

  // New windows are never opened in-app; only web URLs reach the user's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url)
    return { action: "deny" }
  })

  // The renderer may only navigate within its own origin. Anything else is
  // cancelled, and a web URL is handed to the browser instead.
  win.webContents.on("will-navigate", (event, url) => {
    if (isInternalNavigation(url, rendererOrigin)) return
    event.preventDefault()
    openExternally(url)
  })

  if (dev) {
    await win.loadURL(rendererOrigin)
    win.webContents.openDevTools({ mode: "detach" })
  } else {
    if (!loadProduction) {
      throw new Error(
        "prepareProductionRenderer() must be called before app.whenReady()"
      )
    }
    await loadProduction(win)
  }

  return win
}
