# Release checklist

Work through this in order before cutting a release. [`RELEASING.md`](RELEASING.md)
explains the machinery; this is the list you tick.

> **Step 5 contains the only step in this project that spends money, and it is
> performed by a human.** No agent, script or CI job may run it.

---

## 1. Green from a clean tree

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

All four must pass with no working-tree changes left behind.

## 2. Re-verify the model slugs

```bash
pnpm --filter @opendirect/desktop verify:providers
```

Read-only: it resolves every key in `providers/defaults.ts` against the
providers' listing endpoints. A slug that no longer resolves is a recommendation
the picker will show as **unavailable** — fix or remove it rather than shipping
it. Needs `REPLICATE_API_TOKEN` / `OPENROUTER_API_KEY` in `.env.local`.

⛔ The script calls listing endpoints only. It must stay that way.

## 3. Re-verify the pricing table

Open each entry in `REPLICATE_PRICING` (`apps/desktop/src/main/providers/cost.ts`)
against its model page on replicate.com. Replicate publishes no pricing through
the API, so this table is hand-maintained and will drift.

**Remove a stale entry rather than shipping a wrong number.** A missing rate
renders as "Cost unknown", which is honest; a wrong rate is a number the user
will budget against.

While you are here, re-check [open question 1 from the plan]: has
`GET /v1/models/{owner}/{name}` gained a pricing field yet? If so, the curated
table can start to retire.

## 4. Version and changelog

```bash
pnpm changeset version
```

Review `apps/desktop/CHANGELOG.md`. Every entry should be a sentence a user
recognises, not a commit subject. Then:

```bash
git add -A && git commit -m "chore(release): v<version>"
```

## 5. Packaged smoke test — **human only**

On at least one OS:

```bash
pnpm --filter @opendirect/desktop dist
```

Install the produced artifact, open it, and:

1. Create a project, and confirm the folder layout appears on disk.
2. Import an asset; confirm the thumbnail and that it is deduplicated on a
   second import of the same file.
3. Open the model picker (`⌘K`); confirm models list and prices read sensibly.
4. Read the cost badge. If it says **Cost unknown** for a model you expect a
   price for, go back to step 3 of this list.
5. **Exactly one** real generation, on the cheapest available *image* model —
   never a video model. Follow
   [the manual checklist in `DEVELOPMENT.md`](DEVELOPMENT.md#first-real-generation--a-manual-check-for-a-human),
   including the restart-mid-run step that proves a run is never paid for twice.
6. Confirm the renderer's CSP is reported as active in DevTools on this
   packaged build, and that nothing in the app is blocked by it.

## 6. Signing secrets

Confirm all of these exist in the repository's Actions secrets:

| Secret                         | Platform |
| ------------------------------ | -------- |
| `MAC_CSC_LINK`                 | macOS    |
| `MAC_CSC_KEY_PASSWORD`         | macOS    |
| `APPLE_ID`                     | macOS    |
| `APPLE_APP_SPECIFIC_PASSWORD`  | macOS    |
| `APPLE_TEAM_ID`                | macOS    |
| `WIN_CSC_LINK`                 | Windows  |
| `WIN_CSC_KEY_PASSWORD`         | Windows  |

Without them the release ships **unsigned**, and Gatekeeper and SmartScreen will
block it for every user who is not willing to override them.

Also confirm `publish.owner` in `apps/desktop/electron-builder.yml` is the real
GitHub owner — electron-builder bakes it into `app-update.yml`, so a placeholder
there means the shipped app can never find its update feed.

## 7. Tag and watch

```bash
git push
git tag v<version> && git push origin v<version>
```

Watch `.github/workflows/release.yml`. When it finishes, confirm the GitHub
Release has, for each platform, the installer **and** the auto-update metadata:
`latest.yml`, `latest-mac.yml`, `latest-linux.yml` plus the `.blockmap` files.
An installer without its `latest*.yml` is a release no existing user will be
offered.

## 8. Prove the update path

Install the **previous** version, launch it, and leave it running. Confirm
electron-updater finds the new version, downloads it, and that the status bar
offers **Restart to update** — then take it and confirm the app comes back on
the new version with its projects intact.

This is the step that catches a wrong `publish.owner`, a missing `latest*.yml`
and a signature mismatch, and it is the only one that catches them before users
do.
