import { BrowserWindow, shell } from "electron"
import serve from "electron-serve"

import {
  isDevelopment,
  resolveDevServerUrl,
  resolvePreloadPath,
  resolveRendererDirectory,
} from "./resolve"

let loadProduction: ((window: BrowserWindow) => Promise<void>) | undefined

function productionLoader(): (window: BrowserWindow) => Promise<void> {
  loadProduction ??= serve({ directory: resolveRendererDirectory(__dirname) })
  return loadProduction
}

export async function createMainWindow(): Promise<BrowserWindow> {
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

  // Anything that tries to open a new window goes to the user's browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: "deny" }
  })

  if (isDevelopment()) {
    await win.loadURL(resolveDevServerUrl())
    win.webContents.openDevTools({ mode: "detach" })
  } else {
    await productionLoader()(win)
  }

  return win
}
