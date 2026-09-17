# Canvas interaction performance

## Changes

- Live node positions stay in React Flow's store. Query-cache updates happen at gesture end; keyboard nudges remain debounced. Blur, page hide, and unmount flush interrupted gestures.
- Node bodies ignore position-only props. Synchronization retains live node objects and measurements, avoiding repeated measurement on selection. Surface actions stay stable across selection, history, and unrelated row changes. Edges retain their identities, and moving an edge does not rerender its slot menu.
- One job-event subscription is shared per query client. Each generation node subscribes only to its own jobs.
- React Flow culls offscreen elements. Note drafts live for the canvas session, and a small headless observer maintains default output picks independently of whether the node is visible.
- The viewport and node surfaces use compositor-friendly CSS. Canvas image previews use available thumbnails, lazy loading, and asynchronous decoding. Videos with posters do not preload their media.
- Create responses populate the cache immediately, eliminating the extra fetch before a new node/edge appears. Connecting a newly created node reads the current cache, avoiding a stale-render race.

## Browser measurements

Measured on local Chromium, without CPU/network throttling, in foreground tabs using production exports. Both baseline (`a8ff187`) and optimized versions used the same browser, fixture, viewport, and 120-frame synthetic gestures. These are local frame-interval measurements, not a guarantee for every device or media collection.

The mixed fixture contains 120 nodes (40 notes, 40 imported images, 40 generation nodes with three outputs each), 39 edges, and 200 displayed images. Images are deterministic SVG fixtures, not production photographs or decoded videos.

| Interaction | Baseline p95 frame interval | Optimized p95 frame interval |
| --- | ---: | ---: |
| Drag a note | 34.1 ms | 17.9 ms |
| Pan | 29.4 ms | 17.4 ms |
| Zoom | 30.9 ms | 17.5 ms |

Optimized medians were approximately 16.6 ms. Drag frames above 25 ms fell from 19/120 to 0/120. Dragging a generation node with its prompt bar open had an 18.1 ms p95, with no frames above 25 ms. Job listeners fell from 41 to 1. Dragging made zero position IPC writes during the gesture and one on release.

A separate 480-node/159-edge stress fixture exposed additional compositing and node-measurement cost. In the final build, zoomed-out dragging measured 19.1 ms p95 with no long tasks or frames above 25 ms. Pan measured 17.8 ms p95 and zoom 17.6 ms p95; a few frames crossed 25 ms as nodes entered the viewport. At 0.8 zoom only 13 nodes were mounted, and pan/zoom measured 17.4 ms p95 with no frames above 25 ms in that run. These measurements should not be read as a guarantee that every event on every board stays below 16.7 ms.

## Reproduction

Use `test/fixtures/canvas/performance.js` as a document-init script in a fresh browser page loading the web app. It installs an in-memory IPC fixture and refuses to replace an existing bridge. Never inject it into the Electron window or a real project.

Bring the page to the foreground and let its images finish loading before calling:

```js
await window.__canvasBenchmark.drag()
await window.__canvasBenchmark.dragGeneration()
await window.__canvasBenchmark.viewport()
```

The returned results include frame intervals, slow-frame counts, long tasks, listener counts, and position-write counts. Reload between comparisons. Background tabs throttle animation frames and invalidate these measurements; development HMR and concurrent builds also distort them.

Production exports were built in isolated temporary worktrees with `next build --webpack` and served over localhost. Both test worktrees used `assetPrefix: "/"` because this Next.js version's webpack font loader rejects the application's Electron-specific `"./"` prefix. The application configuration was not changed. This verifies a production renderer build, not the packaged Electron release workflow.

## Regression coverage

- Sixty drag frames leave the persisted query object untouched; final group positions are saved together and undo/redo restore them exactly.
- Background query changes preserve live drag positions; interrupted gestures save on unmount.
- Keyboard nudges persist, and consecutive selection events do not retain stale selections.
- New nodes can be connected before a background refetch finishes.
- Unrelated edges retain identity; changed models and slots still update.
- Many job consumers share one listener; unrelated job progress does not rerender a filtered consumer; listener cleanup and separate clients work independently.
- Unsaved notes survive offscreen unmount/remount. New committed text supersedes an obsolete draft.
- Default picks are maintained without mounting an offscreen node's media body.

All 1,063 unit tests, workspace type checking, and lint checks of changed renderer files passed. Browser smoke checks covered selection, generation-node dragging with its prompt bar, note dragging, pan, zoom, undo/redo, connected-node creation, and deletion. No paid generation was submitted.
