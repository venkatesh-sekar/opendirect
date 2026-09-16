# Releasing OpenDirect

OpenDirect ships as a signed Electron desktop app. Versions come from
[changesets](https://github.com/changesets/changesets), installers come from
[electron-builder](https://www.electron.build/), and updates are delivered by
[electron-updater](https://www.electron.build/auto-update) polling a GitHub
Release.

> **Blocker before the first public release:** `apps/desktop/electron-builder.yml`
> still has `publish.owner: REPLACE_WITH_GITHUB_OWNER`. Replace it with the real
> GitHub org/user (and `homepage` in `apps/desktop/package.json`) — electron-builder
> bakes it into `app-update.yml`, so an unpublished app can never find its feed.

## 1. Record a changeset on every user-facing PR

```bash
pnpm changeset
```

Pick `@opendirect/desktop`, pick the bump (`patch` / `minor` / `major`) and write
one sentence a user would understand. The prompt lists the private desktop app
because `.changeset/config.json` sets `privatePackages: { version: true, tag: true }`.

Internal-only changes (CI, refactors, tests) need no changeset.

## 2. Version the release

```bash
pnpm changeset version
```

This consumes the pending changeset files, bumps `apps/desktop/package.json` and
writes the entries into `CHANGELOG.md`. Review the diff, then commit it:

```bash
git add -A && git commit -m "chore(release): v<version>"
git push
```

## 3. Tag and push

```bash
git tag v<version>
git push origin v<version>
```

The tag fires `.github/workflows/release.yml`, which builds on
`macos-latest`, `windows-latest` and `ubuntu-latest` in parallel and runs
`electron-builder --publish always` on each.

## 4. What lands on the GitHub Release

| Platform | Installers                          | Update feed        |
| -------- | ----------------------------------- | ------------------ |
| macOS    | `.dmg` (arm64, x64), `.zip`         | `latest-mac.yml`   |
| Windows  | NSIS `.exe` (x64, arm64)            | `latest.yml`       |
| Linux    | `.AppImage`, `.deb`                 | `latest-linux.yml` |

The `latest*.yml` files are exactly what `electron-updater` polls. macOS
auto-update reads the `.zip`, not the `.dmg`, so both targets must be published.

The release is created as a **draft**. Publish it once every matrix job has
finished uploading — electron-updater will not see a draft.

## 5. Code signing and notarization

Set these as repository secrets. Without them the build still succeeds, but the
artifacts are unsigned.

### macOS

| Secret                        | What it is                                                     |
| ----------------------------- | -------------------------------------------------------------- |
| `MAC_CSC_LINK`                | Developer ID Application certificate, exported as `.p12` and base64-encoded (`base64 -i cert.p12 \| pbcopy`) |
| `MAC_CSC_KEY_PASSWORD`        | The password used when exporting that `.p12`                    |
| `APPLE_ID`                    | Apple ID of the developer account                               |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password generated at appleid.apple.com            |
| `APPLE_TEAM_ID`               | 10-character Apple Developer Team ID                            |

electron-builder ≥ 24 notarizes automatically once `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` are all present. The build uses
a hardened runtime with `apps/desktop/build/entitlements.mac.plist`;
`com.apple.security.cs.disable-library-validation` is required there because
`better-sqlite3` loads a prebuilt `.node` binary that is not signed by our team.

### Windows

| Secret                 | What it is                                                |
| ---------------------- | --------------------------------------------------------- |
| `WIN_CSC_LINK`         | OV or EV code-signing certificate `.pfx`, base64-encoded   |
| `WIN_CSC_KEY_PASSWORD` | Its password                                               |

An EV certificate earns SmartScreen reputation immediately; an OV certificate
has to build reputation over downloads. EV certificates usually live on a
hardware token, which a hosted runner cannot use — a cloud HSM signing service
(Azure Trusted Signing, DigiCert KeyLocker) is the usual answer.

### Linux

AppImage and `.deb` are shipped unsigned. Publish the SHA256 of each artifact in
the release notes so users can verify them:

```bash
shasum -a 256 apps/desktop/release/*.AppImage apps/desktop/release/*.deb
```

> **Unsigned builds are fine locally.** `pnpm release` produces working
> installers for development. Shipping an unsigned *public* release is not:
> macOS Gatekeeper refuses to open it and Windows SmartScreen warns on every
> download. Treat signing as a prerequisite for the first public release.

## Application icons

`directories.buildResources` is `apps/desktop/build`. Drop an `icon.icns`
(macOS), `icon.ico` (Windows) and a 512×512 `icon.png` (Linux) there and
electron-builder picks them up automatically. Until then builds ship the default
Electron icon — worth fixing before the first public release.

## Local builds

```bash
pnpm build                                          # web export + electron bundles
pnpm --filter @opendirect/desktop dist              # installers for this platform
pnpm --filter @opendirect/desktop dist:dir          # unpacked app dir, fastest smoke test
```

Output lands in `apps/desktop/release/`. Both scripts pass `--publish never`, so
a local build can never upload to GitHub by accident.

## Auto-update behaviour in the app

`apps/desktop/src/main/updater.ts` checks on launch and every six hours
(`UPDATE_CHECK_INTERVAL_MS`), downloads in the background
(`autoDownload: true`) and installs on quit (`autoInstallOnAppQuit: true`). It
pushes `{ state }` payloads to the renderer over the `updater:status` channel.
The updater is disabled in unpackaged builds because they have no
`app-update.yml`; set `OPENDIRECT_ENABLE_UPDATER=1` to force it on when testing a
feed.
