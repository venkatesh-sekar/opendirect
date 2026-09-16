/**
 * The application menu.
 *
 * Electron's default menu is generous: it hands the window `⌘R` for Reload and
 * `⌘⇧I` for DevTools whether or not the app wants them. In a packaged build a
 * user cannot usefully reload a renderer they did not author, and `⌘R` is a
 * chord this app wants for itself — so production gets a menu with the reload
 * items removed, and development keeps them, because reloading is most of what
 * development is.
 *
 * `rendererRefreshAccelerator` is the one piece of this the renderer also has
 * an opinion about: the model-catalog refresh uses `⌘⇧R` in development, where
 * `⌘R` still belongs to Chromium, and `⌘R` in production, where it no longer
 * does. `test/menu.test.ts` is what stops those two drifting apart.
 */
import type { MenuItemConstructorOptions } from "electron"

/**
 * The chord the renderer should bind catalog refresh to.
 *
 * Kept here rather than in the renderer because the answer depends on what the
 * menu above gave away, and only one of the two can be the source of truth.
 */
export function rendererRefreshAccelerator(dev: boolean): string {
  return dev ? "mod+shift+r" : "mod+r"
}

/** Roles the View menu keeps; `reload`/`forceReload` are conspicuously absent. */
const VIEW_ROLES_PRODUCTION: MenuItemConstructorOptions["role"][] = [
  "resetZoom",
  "zoomIn",
  "zoomOut",
  "togglefullscreen",
]

const VIEW_ROLES_DEVELOPMENT: MenuItemConstructorOptions["role"][] = [
  "reload",
  "forceReload",
  "toggleDevTools",
  ...VIEW_ROLES_PRODUCTION,
]

export interface MenuOptions {
  dev: boolean
  platform: NodeJS.Platform
  appName: string
  /**
   * Toggles Settings in the renderer.
   *
   * `CmdOrCtrl+,` is an application-menu accelerator, and a menu accelerator
   * wins over anything the renderer binds — so the renderer's own ⌘, never
   * fires in a packaged build. This item therefore has to carry the *same*
   * semantics the renderer's hotkey has (to Settings, or back out of it),
   * which it does by asking the renderer to toggle rather than to push.
   *
   * Optional, and the item is omitted when it is missing: the menu is built in
   * a plain Node test with no window to push to, and a "Settings…" that does
   * nothing would be exactly the dead end this item exists to fix.
   */
  onToggleSettings?: () => void
}

/**
 * The full template. Built as data so it can be asserted in a plain Node test
 * without an Electron runtime — the only thing that reads it is `Menu`.
 */
export function buildMenuTemplate(
  options: MenuOptions
): MenuItemConstructorOptions[] {
  const mac = options.platform === "darwin"
  const viewRoles = options.dev ? VIEW_ROLES_DEVELOPMENT : VIEW_ROLES_PRODUCTION

  const template: MenuItemConstructorOptions[] = []

  const settingsItem: MenuItemConstructorOptions[] = options.onToggleSettings
    ? [
        {
          label: "Settings…",
          accelerator: "CmdOrCtrl+,",
          click: options.onToggleSettings,
        },
        { type: "separator" },
      ]
    : []

  if (mac) {
    template.push({
      label: options.appName,
      submenu: [
        { role: "about" },
        { type: "separator" },
        ...settingsItem,
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    })
  }

  template.push({
    label: "File",
    submenu: mac
      ? [{ role: "close" }]
      : [...settingsItem, { role: "quit" as const }],
  })

  // Editing roles are kept in full: the prompt is a textarea, and a desktop app
  // whose ⌘C does nothing is broken in a way users blame on the app.
  template.push({
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      ...(mac
        ? ([
            { role: "pasteAndMatchStyle" },
            { role: "delete" },
            { role: "selectAll" },
          ] satisfies MenuItemConstructorOptions[])
        : ([
            { role: "delete" },
            { type: "separator" },
            { role: "selectAll" },
          ] satisfies MenuItemConstructorOptions[])),
    ],
  })

  template.push({
    label: "View",
    submenu: viewRoles.map((role) => ({ role })),
  })

  template.push({
    label: "Window",
    submenu: mac
      ? [
          { role: "minimize" },
          { role: "zoom" },
          { type: "separator" },
          { role: "front" },
        ]
      : [{ role: "minimize" }, { role: "close" }],
  })

  return template
}

/** Does this template hand `⌘R` (or `Ctrl+R`) to Chromium's reload? */
export function templateBindsReload(
  template: MenuItemConstructorOptions[]
): boolean {
  return template.some((item) =>
    (Array.isArray(item.submenu) ? item.submenu : []).some(
      (entry) => entry.role === "reload" || entry.role === "forceReload"
    )
  )
}
