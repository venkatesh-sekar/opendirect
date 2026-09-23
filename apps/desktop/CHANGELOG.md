# @opendirect/desktop

## 0.1.0

### Minor Changes

- Projects now open on a Home page — recent runs, characters, scenes and what is
  generating — instead of straight into the canvas. Characters and scenes each get
  a page with their references, generations and assets, and a generate panel that
  shows the cost before you press Generate. Scenes list their cast and hold an
  ordered set of shots, each with its versions and a picked take.
- 187c9e0: Status bar with the active job count, update progress and the detected AI CLIs,
  toasts when a run finishes or fails, keyboard shortcuts (⌘K model picker,
  ⌘Enter generate, ⌘, settings, ⌘R refresh catalog), a "Restart to update" action
  once an update is downloaded, and an error screen instead of a blank window when
  the interface breaks.
- c724857: Restarting OpenDirect no longer submits runs that were still queued when it quit
  — they wait in the job list with an explicit Resume. Only one copy of the app can
  run at a time, the renderer process is fully sandboxed, development gets a
  Content-Security-Policy of its own, "Open" is limited to the media types the app
  recognises, and the AI helpers now run with an allowlisted environment rather
  than a denylist of credential-shaped names.
- f432411: Package the desktop app with electron-builder for macOS, Windows and Linux, and
  ship background auto-updates from GitHub Releases via electron-updater.
