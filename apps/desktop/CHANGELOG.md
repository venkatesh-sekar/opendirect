# @opendirect/desktop

## 0.4.1

### Patch Changes

- 9c2d272: Cost estimates now follow a video model's resolution and duration. Models priced per second at each resolution, such as Wan 3.0 on OpenRouter, are quoted at the rate for the resolution you pick. Before, 1080p was quoted at the 480p rate. Rates in cents, minimum charges, per-image charges and image-to-video rates are read too. If no duration is set yet, the cost badge shows the rate (for example `$0.20/s`) instead of "Cost unknown". The confirmation box says why there is no estimate and links to the model's pricing page on the provider's site. Hand-maintained Replicate rates now live in `registry/pricing.json`, which also adds FLUX Schnell.
- 5534039: You can now set the duration of a video. The settings chip in the prompt bar (and in the generate panel) shows the length next to resolution and aspect ratio, and opens a Duration control for any video model that has one. It starts at the model's own default and is sent in the type and under the name the model expects: an integer range like Wan 3's 2–30 s, a list like Kling's 5 or 10 s, Sora's `seconds`, `"5s"`-style strings, or a frame count with its frame rate. The cost estimate updates as the duration changes. A seed, an audio switch or any other input that had no control in the bar is now under Advanced, and Advanced always opens once a model is chosen, even when every input is already on the bar.

## 0.4.0

### Minor Changes

- e9cd040: Assets: crop an image into a new image from its card menu (⋯ or right-click) or from the full-size viewer. Crop free-form or to a fixed shape (1:1, 4:5, 3:4, 16:9, 9:16), zoom in to place it precisely, and see the output size before saving. The original image is never changed.
- ebcef47: Assets: delete an asset, or move it to another container, from its card's menu (⋯ or right-click) on a container's Assets tab
- e9cd040: Canvas images stay sharp when you zoom in: the canvas swaps in a larger copy of each visible image as you zoom, and you can now zoom in up to 8× to see the original's detail. Photos taken in portrait now show upright in thumbnails.
- e9cd040: AI helpers (✨): add an optional direction to steer what the helper writes, and choose which model Claude Code or Codex uses for that run. Settings → AI helpers saves a default model for each installed CLI.
- e9cd040: Review pictures and clips at full size. On the canvas, double-click a generated output or a media node (or use the magnifier in the node header) to open a viewer with zoom, pan and Open / Reveal in folder; the arrow keys step through every output of the run, each captioned with its model, prompt and size, without changing which take is picked. On a container's Assets tab, clicking a picture or clip opens the same viewer and steps through the grid as filtered.

### Patch Changes

- e9cd040: Retrying a failed or cancelled run whose input image has been deleted is now refused with an explanation, instead of sending the run without that input; the delete confirmation warns about this. Deleting an asset also removes the larger preview copies cached for it.
- e9cd040: Canvas fixes: after deleting a node, selecting a generate node brings the prompt bar back again; deleting a connected node is now a single undo step; and undo skips, with a short notice, a step whose asset has since been deleted instead of getting stuck on it. The "Add to…" dialog on a card no longer fails as soon as it opens.

## 0.3.0

### Minor Changes

- 8d9b6b0: Models that run on several providers now appear once, and each input says what it controls (first frame, character, style, …). The picker can filter by what a model takes, the canvas explains why a slot can't be used, and Settings → Models lets you map any model yourself.

## 0.2.0

### Minor Changes

- A new prompt composer on the canvas. Notes connected to a run now appear as
  blocks inside its prompt, which you can drag to reorder or remove alongside
  your own text, and saved or imported workflow templates keep that order. A
  **Full prompt** panel shows exactly the text that will be sent to the model,
  with each note highlighted, word and character counts, and a Copy button.
  Reference images are grouped by the model input they feed, show a +N count when
  there are more than fit, and open in an inline gallery. The prompt bar is now a
  single, cleaner card whose toolbar stays on one line instead of wrapping.

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
