import { describe, expect, it } from "vitest"

import { aiToolsLabel, updaterErrorDetail, updaterLabel } from "./status-bar"

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
  })

  it("keeps a failed check to a few words, however long the error is", () => {
    // electron-updater's messages can carry a whole HTTP response — headers,
    // CSP and all — which wrapped over the window when shown verbatim.
    const huge = `Cannot parse releases feed: HttpError: 406\n${"header ".repeat(2000)}`
    expect(updaterLabel({ state: "error", message: huge })).toBe(
      "Couldn't check for updates"
    )
  })
})

describe("updaterErrorDetail", () => {
  it("keeps the first line of the error, trimmed to fit a tooltip", () => {
    expect(updaterErrorDetail("no feed")).toBe("no feed")
    expect(updaterErrorDetail("first line\nsecond line")).toBe("first line")
    const detail = updaterErrorDetail("x".repeat(1000))
    expect(detail.length).toBeLessThanOrEqual(200)
    expect(detail.endsWith("…")).toBe(true)
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
