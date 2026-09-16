/// <reference types="node" />

/** Surface exposed to the renderer by `src/preload/index.ts` over `contextBridge`. */
export interface OpenDirectBridge {
  /** Electron runtime version — a smoke-test value until Task 5 lands the IPC contract. */
  version: string
}

declare global {
  interface Window {
    opendirect: OpenDirectBridge
  }
}
