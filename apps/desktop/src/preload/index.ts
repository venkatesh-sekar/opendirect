import { contextBridge } from "electron"

// Stub bridge — Task 5 replaces this with the typed, zod-validated IPC contract.
// The renderer never gets Node: `contextIsolation` is on and `nodeIntegration` off.
contextBridge.exposeInMainWorld("opendirect", {
  version: process.versions.electron,
})
