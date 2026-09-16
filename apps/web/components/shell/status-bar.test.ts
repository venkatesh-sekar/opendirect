import { describe, expect, it } from "vitest"

import { aiToolsLabel, updaterLabel } from "./status-bar"

describe("updaterLabel", () => {
  it("says nothing until the updater has something to say", () => {
    expect(updaterLabel(null)).toBeNull()
    // "Up to date" forever is noise, not news.
    expect(updaterLabel({ state: "not-available" })).toBeNull()
  })

  it("reports the states that are worth a strip", () => {
    expect(updaterLabel({ state: "available", version: "1.2.0" })).toContain(
      "1.2.0"
    )
    expect(updaterLabel({ state: "downloading", percent: 42 })).toContain("42%")
    expect(updaterLabel({ state: "ready", version: "1.2.0" })).toBe(
      "Update 1.2.0 ready"
    )
    expect(updaterLabel({ state: "error", message: "no feed" })).toContain(
      "no feed"
    )
  })
})

describe("aiToolsLabel", () => {
  const absent = { available: false }
  const present = { available: true }

  it("names only the CLIs that are actually installed", () => {
    expect(aiToolsLabel({ claude: present, codex: absent })).toBe("claude")
    expect(aiToolsLabel({ claude: present, codex: present })).toBe(
      "claude · codex"
    )
  })

  it("stays silent when there is no CLI and when detection has not run", () => {
    expect(aiToolsLabel({ claude: absent, codex: absent })).toBeNull()
    expect(aiToolsLabel(null)).toBeNull()
  })
})
