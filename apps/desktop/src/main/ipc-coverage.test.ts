/**
 * The contract, the handlers and the renderer must agree — statically.
 *
 * `createIpcRegistrar` already refuses a channel the contract does not declare,
 * but nothing catches the two failures that matter in the other direction: a
 * contract entry with no `handle()` behind it (the renderer calls it and gets
 * "no handler registered" at runtime), and a contract entry nothing calls at
 * all, which is dead surface across a security boundary.
 *
 * This is read as source rather than executed, because registering the real
 * handlers means booting Electron, a database and a provider registry to learn
 * something that is true of the files on disk.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { ipcContract, type IpcChannel } from "@opendirect/contract"
import { describe, expect, it } from "vitest"

const MAIN_DIR = __dirname
const WEB_DIR = join(__dirname, "..", "..", "..", "web")

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    if (entry.name === "out") continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path))
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) continue
    if (/\.test\.tsx?$/.test(entry.name)) continue
    found.push(path)
  }
  return found
}

function read(dir: string): string {
  return sourceFiles(dir)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n")
}

const mainSource = read(MAIN_DIR)
const webSource = read(WEB_DIR)
const channels = Object.keys(ipcContract) as IpcChannel[]

describe("IPC contract coverage", () => {
  it("declares at least the channels the app is built from", () => {
    expect(channels.length).toBeGreaterThan(20)
  })

  it("has a registered handler for every channel", () => {
    // Prettier wraps a long `handle(...)` call onto the next line, so the
    // opening paren and the channel name are not always adjacent.
    const unhandled = channels.filter(
      (channel) => !new RegExp(`handle\\(\\s*"${channel}"`).test(mainSource)
    )
    expect(unhandled).toEqual([])
  })

  it("has no channel the renderer never calls", () => {
    // A channel nobody invokes is a door left open onto the main process for
    // no reason. Wire it or delete it.
    const unused = channels.filter(
      (channel) => !webSource.includes(`"${channel}"`)
    )
    expect(unused).toEqual([])
  })
})
