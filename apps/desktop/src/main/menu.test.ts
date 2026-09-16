import { describe, expect, it } from "vitest"

import {
  buildMenuTemplate,
  rendererRefreshAccelerator,
  templateBindsReload,
} from "./menu"

const base = { platform: "darwin" as NodeJS.Platform, appName: "OpenDirect" }

describe("buildMenuTemplate", () => {
  it("keeps reload in development, where reloading is the job", () => {
    const template = buildMenuTemplate({ ...base, dev: true })
    expect(templateBindsReload(template)).toBe(true)
  })

  it("drops reload in production, so ⌘R is the app's to give away", () => {
    const template = buildMenuTemplate({ ...base, dev: false })
    expect(templateBindsReload(template)).toBe(false)
  })

  it("never drops the editing roles — the prompt is a textarea", () => {
    for (const dev of [true, false]) {
      const edit = buildMenuTemplate({ ...base, dev }).find(
        (item) => item.label === "Edit"
      )
      const roles = (Array.isArray(edit?.submenu) ? edit.submenu : []).map(
        (entry) => entry.role
      )
      expect(roles).toEqual(expect.arrayContaining(["copy", "paste", "undo"]))
    }
  })

  /**
   * ⌘, is an application-menu accelerator, and a menu accelerator wins over
   * whatever the renderer binds — so this item, not the renderer's hotkey, is
   * what the chord does in a packaged build. It therefore has to be wired to
   * the *toggle*, or ⌘, would be a one-way trip into Settings on the desktop
   * while the same chord toggled in a browser tab.
   */
  it("offers Settings — the screen that used to have no menu path at all", () => {
    const onToggleSettings = () => {}
    const mac = buildMenuTemplate({ ...base, dev: false, onToggleSettings })
    const appMenu = Array.isArray(mac[0]?.submenu) ? mac[0].submenu : []
    const item = appMenu.find((entry) => entry.label === "Settings…")
    expect(item?.accelerator).toBe("CmdOrCtrl+,")
    expect(item?.click).toBe(onToggleSettings)

    const win = buildMenuTemplate({
      ...base,
      platform: "win32",
      dev: false,
      onToggleSettings,
    })
    const file = Array.isArray(win[0]?.submenu) ? win[0].submenu : []
    expect(file.some((entry) => entry.label === "Settings…")).toBe(true)
  })

  it("omits Settings rather than offering an item that does nothing", () => {
    const template = buildMenuTemplate({ ...base, dev: false })
    const labels = template.flatMap((item) =>
      (Array.isArray(item.submenu) ? item.submenu : []).map(
        (entry) => entry.label
      )
    )
    expect(labels).not.toContain("Settings…")
  })

  it("gives macOS its application menu and the others a File → Quit", () => {
    const mac = buildMenuTemplate({ ...base, dev: false })
    expect(mac[0]?.label).toBe("OpenDirect")

    const win = buildMenuTemplate({ ...base, platform: "win32", dev: false })
    expect(win[0]?.label).toBe("File")
  })
})

describe("rendererRefreshAccelerator", () => {
  /**
   * The contract with the renderer: whichever chord the menu did *not* take is
   * the one the catalog refresh gets. If these two ever disagree, ⌘R either
   * reloads the window mid-session or does nothing at all.
   */
  it("hands the renderer the chord the menu left alone", () => {
    for (const dev of [true, false]) {
      const chord = rendererRefreshAccelerator(dev)
      const bindsReload = templateBindsReload(
        buildMenuTemplate({ ...base, dev })
      )
      expect(chord === "mod+r").toBe(!bindsReload)
    }
  })

  it("is a chord react-hotkeys-hook understands", () => {
    expect(rendererRefreshAccelerator(true)).toBe("mod+shift+r")
    expect(rendererRefreshAccelerator(false)).toBe("mod+r")
  })
})
