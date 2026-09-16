import { BrowserWindow, session, shell } from "electron"
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

function productionLoader(): (window: BrowserWindow) => Promise<void> {
  loadProduction ??= serve({ directory: resolveRendererDirectory(__dirname) })
  return loadProduction
}

/**
 * Sets the CSP on every response served to the production renderer.
 *
 * A response header beats a meta tag (it also covers assets and cannot be
 * stripped by injected markup) and it is skipped in development, where the
 * Next.js dev server needs eval and a websocket for HMR.
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
    await productionLoader()(win)
  }

  return win
}
