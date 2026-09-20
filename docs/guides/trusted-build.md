# Trusted downstream build

This fork is a **trusted downstream** of [iOfficeAI/AionUi](https://github.com/iOfficeAI/AionUi). It is intended for long-term personal use while still following upstream, with a small, reviewable privacy and supply-chain patch set.

Official binaries from this repository are produced either from a pushed `v*` tag or an explicitly approved manual release whose tag exactly matches `package.json`. They must be attributable to:

- this repository's exact Git commit
- an exact AionCore Git commit
- locked JavaScript (`bun.lock`) and Rust (`Cargo.lock`) dependencies
- the GitHub Actions run that produced them

## Threat model

We prevent:

- AionUi automatically uploading logs
- crash reporter automatically sending exceptions
- a stable anonymous device ID being used for telemetry
- the Windows installer automatically sending install errors
- CI accidentally injecting a Sentry DSN
- a release artifact shipping an AionCore binary that was not built from the locked source commit
- floating GitHub Actions / package versions making a release untraceable
- a GitHub Release that cannot be mapped to AionUi and AionCore commits

We do **not** currently try to prevent:

- user-configured AI API endpoints
- Claude Code / Codex / Grok / Kimi (and other bundled agent CLIs) using their own networks
- user-initiated Marketplace / AionHub, account, prepaid, remote-channel, or WebUI features

Those remaining surfaces are listed below.

## Security invariant

> AionUi itself has no automatic telemetry / crash / log-reporting outbound path.

This is **not** implemented as “Sentry is off because `SENTRY_DSN` is unset”. Trusted production code hard-codes:

```ts
export const AIONUI_TELEMETRY_ENABLED = false;
export const AIONUI_OFFICIAL_UPDATES_ENABLED = false;
```

in `packages/desktop/src/trustedBuild.ts`. A runtime environment variable cannot turn telemetry back on. GitHub Actions fails if `SENTRY_DSN` or `VITE_SENTRY_DSN` is set.

### Sentry dependency choice

`@sentry/electron` and `@sentry/vite-plugin` remain in `package.json`. Removing them would force a large upstream-divergent deletion across `sentry.ts`, feedback, installer NSIS, Vite config, and tests. The trusted production path never initializes or calls Sentry:

- main: `initSentry`, `setSentryDeviceId`, `captureBackendStartupFailure` (Sentry flush), and `scheduleStartupLogReport` return before `Sentry.init` / `capture*`
- renderer: `@sentry/electron/renderer` is not initialized
- preload: `@sentry/electron/preload` is not loaded
- installer: empty DSN is compiled into NSIS; the Sentry upload macro is omitted
- user feedback that previously went to Sentry is rejected locally because it is a Sentry upload

## Network surface inventory

| Connection / service                                                           | Purpose                                                      | Automatic or user-triggered                        | Enabled in trusted build?            | Potentially sensitive?                               | Location                                                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Sentry (`SENTRY_DSN`, `@sentry/electron`)                                      | Crash, exception, device id, startup log gzip                | Automatic on startup / crash                       | **No**                               | Logs, crash dumps, install path, anonymous device id | `packages/desktop/src/sentry.ts`, `renderer/main.tsx`, `preload/main.ts`                |
| Windows installer Sentry                                                       | Silent/optional install-failure report                       | Automatic on silent failure; prompt on UI failure  | **No**                               | Installer log, analytics id                          | `resources/windows/installer-errors-sentry.nsh`, `support/report-installer-failure.ps1` |
| `https://static.aionui.com/releases`                                           | Official auto-update CDN                                     | Automatic 3s after window create; also About/check | **No**                               | App version, OS/arch                                 | `updateFeed.ts`, `autoUpdaterService.ts`, `updateBridge.ts`                             |
| `https://api.github.com/repos/iOfficeAI/AionUi/releases`                       | Enrich official update notes / download                      | User-triggered check, with CDN rewrite             | **No** (official channel disabled)   | App version                                          | `updateBridge.ts` (`DEFAULT_REPO`)                                                      |
| GitHub Releases of **this fork**                                               | Human-installed updates                                      | User downloads a Release                           | Yes, as artifacts                    | None from the running app                            | GitHub Actions `trusted-release.yml`                                                    |
| `https://github.com/iOfficeAI/AionCore/releases`                               | Precompiled AionCore download                                | Build-time (upstream default)                      | **No** for trusted CI                | N/A (build)                                          | `packages/shared-scripts/src/prepare-aioncore.js`                                       |
| AionHub (`raw.githubusercontent.com/iOfficeAI/AionHub@dist-ebc6a2b`, jsDelivr) | Bundle extension index/zips as offline fallback              | Build-time                                         | Yes (pinned tag, not `dist-latest`)  | None at runtime unless user opens Hub                | `scripts/prepareHubResources.js`                                                        |
| `https://github.com/iOfficeAI/AionHub`                                         | Open Hub contribution link                                   | User-triggered                                     | Yes                                  | None                                                 | `AgentHubModal.tsx`                                                                     |
| Local `http://127.0.0.1:<aioncore-port>/api/...`                               | Desktop ↔ AionCore                                           | Automatic local                                    | Yes                                  | Workspace/chat stay on-host                          | `webuiBridge.ts`, `httpBridge.ts`                                                       |
| User-configured LLM endpoints                                                  | Model calls                                                  | User-triggered (send message / config)             | Yes                                  | Prompts, files, API keys                             | `packages/desktop/src/common/api/*`                                                     |
| `HTTP-Referer: https://aionui.com`                                             | OpenRouter-style header on some HTTP clients                 | With user-configured provider requests             | Yes (header only)                    | Identifies client as AionUi                          | `ClientFactory.ts`                                                                      |
| Telegram / Lark / DingTalk / WeCom                                             | Remote channels                                              | User-triggered, user tokens                        | Yes                                  | Channel messages if the user enables them            | `packages/desktop/src/process` channels + AionCore                                      |
| Marketplace / account / prepaid                                                | Online product features in AionCore/UI                       | User-triggered                                     | Yes, not auto-uploaded at idle start | Account tokens if the user signs in                  | AionCore HTTP API; no AionUi idle uploader found                                        |
| Feedback UI                                                                    | Previously a Sentry user-feedback event with logs/screenshot | User-triggered                                     | **Upload disabled** (Sentry)         | Logs, screenshot, optional email                     | `submitFeedbackReport.ts`                                                               |
| Electron autoUpdater                                                           | Download/install official binaries                           | Automatic + user                                   | **No**                               | Version, OS                                          | `autoUpdaterService.ts`, `index.ts`                                                     |
| Codecov / OpenAI GPT review workflows                                          | Upstream CI only                                             | CI                                                 | Skipped on this fork                 | PR diffs                                             | `.github/workflows/pr-checks.yml` etc.                                                  |

### Remaining network surfaces (intentional)

1. **External coding agents** (Claude Code, Codex, Grok, Kimi, Gemini CLI, …) keep their own network behavior. This fork does not patch those programs.
2. **User-configured AI APIs** send whatever the user asks the agent to send.
3. **AionHub / extensions / remote channels** run when the user uses those features.
4. **Local AionCore** talks to user-configured providers; that is not AionUi telemetry.
5. **Build-time** download of pinned AionHub zips and Electron/node prebuilds used by the packager.

Idle start with no agent/API use does not open the telemetry paths above.

## AionCore source lock

Source of truth for trusted releases:

`.github/aioncore.lock`

Current pin:

| Field            | Value                                            |
| ---------------- | ------------------------------------------------ |
| Repository       | `https://github.com/iOfficeAI/AionCore.git`      |
| Revision         | `47e66d0d151123e973b3fd1e77afcb5671b3f8c5`       |
| Upstream version | `v0.2.2` (AionUi `package.json#aioncoreVersion`) |

The SHA was taken from the `v0.2.2` tag object (`chore(main): release 0.2.2 (#978)`). Trusted CI checks out that commit and runs `cargo build --locked --release`. It does **not** download iOfficeAI AionCore release binaries.

`package.json#aioncoreVersion` remains the upstream pin for non-trusted local scripts. Trusted CI ignores it for artifact origin and uses the lock file. Updating the lock is an explicit commit; CI must not silently bump it.

## Auto-update

Upstream defaults to `https://static.aionui.com/releases` and can replace this fork with official iOfficeAI builds. That is unacceptable here.

**Choice:** disable the official update channel (`AIONUI_OFFICIAL_UPDATES_ENABLED = false`) and set `publishAutoUpdate: false`. The app does not auto-check or download official binaries. Update by installing a GitHub Release from this fork.

This is the smaller, clearer patch versus rewiring electron-updater onto this fork's Releases.

## Build / release architecture

Upstream:

- `prepareAioncore.js` downloads AionCore GitHub release zips (or a Manual Build artifact)
- `.github/workflows/build-and-release.yml` builds on push to `dev` and on tags, can create tags, uses `bun-version: latest`, injects `SENTRY_DSN`, and `secrets: inherit`
- Windows jobs can continue after a failed build
- `postinstall` is invoked with `|| true`

This fork:

- `.github/workflows/trusted-ci.yml` — PR and `main`: lint, format, typecheck, unit tests, trusted-build verifier. `main` also source-builds AionCore and packages Linux x64 as a smoke artifact (not a GitHub Release).
- `.github/workflows/trusted-release.yml` — `v*` tags build the full desktop matrix. `workflow_dispatch` can build individual unsigned artifacts; its opt-in public release mode is restricted to macOS arm64 and a tag matching `package.json`. Both paths build AionCore from the lock, package with upstream `scripts/build-with-builder.js`, attest, checksum, and publish through GitHub Releases.
- Upstream publish workflows are gated to `github.repository == 'iOfficeAI/AionUi'` so they do not run here.

### Platform matrix

| Target        | Runner             | Source-build          | Notes                                              |
| ------------- | ------------------ | --------------------- | -------------------------------------------------- |
| macOS arm64   | `macos-14`         | Native                | Unsigned / ad-hoc in phase 1                       |
| macOS x64     | `macos-14`         | `x86_64-apple-darwin` | Same host split upstream already uses for Electron |
| Windows x64   | `windows-2022`     | Native                | Unsigned in phase 1                                |
| Windows arm64 | `windows-11-arm`   | Native                | Fails clearly if the runner is unavailable         |
| Linux x64     | `ubuntu-22.04`     | Native                | Smoke-tested on `main`                             |
| Linux arm64   | `ubuntu-24.04-arm` | Native                |                                                    |

No other cross-compilation is used. Code signing is **not** treated as source provenance. Phase 1 ships unsigned macOS/Windows builds and says so in the Release notes. A future `release` GitHub Environment can hold Apple/Authenticode secrets; PR workflows never see that environment.

## Provenance of a Release artifact

```text
human creates tag vX.Y.Z on commit A
        ↓
trusted-release.yml checks out commit A
        ↓
checks out AionCore at .github/aioncore.lock revision B
        ↓
bun install --frozen-lockfile  (JS lock)
cargo build --locked --release (AionCore Cargo.lock)
        ↓
electron-builder via scripts/build-with-builder.js
        ↓
SHA256SUMS + per-file .sha256
BUILD-MANIFEST.json (A, B, tool versions, run id, telemetry policy)
sbom.cdx.json (JS from package.json + Rust cargo metadata)
GitHub artifact attestations
        ↓
GitHub Release for tag vX.Y.Z
```

Verify:

```bash
sha256sum -c SHA256SUMS
gh attestation verify AionUi-<version>-<os>-<arch>.<ext> --repo <this-fork>
jq . BUILD-MANIFEST.json
```

## Telemetry verifier

```bash
node .github/trusted/verify-trusted-build.js
```

Blocking in trusted CI/release. It checks compile-time flags, empty DSN policy, installer DSN, AionCore full SHA, pinned Actions, and known Sentry endpoint patterns. It does not treat the word `Sentry` in dependencies as a failure.

## SBOM

Phase 1 writes a CycloneDX 1.5 JSON (`sbom.cdx.json`) from `package.json` dependency names/versions plus `cargo metadata --locked` when AionCore source is present. This is not a fully resolved npm/cargo graph. Follow-up: emit a lockfile-accurate CycloneDX via `cdxgen` or `cargo cyclonedx` without adding a heavy default dependency.

## Tests

- Static: `verify-trusted-build.js` and `tests/unit/assets/trustedBuildPolicy.test.ts`
- Unit: telemetry functions do not call Sentry; updater does not use the official CDN; AionCore lock is a full SHA; trusted prepare-aioncore refuses downloads
- CI smoke (Linux x64 on `main` and tag): AionCore source build, packaged `bundled-aioncore` present, architecture check, `aioncore --help` with no network APIs

## Follow-up (not blocking)

- Apple notarization / Windows Authenticode via the `release` environment
- Lockfile-accurate SBOM
- Optional GitHub Releases generic updater pointed only at this fork
- Deeper AionCore-source telemetry audit at each lock bump (CI greps for `sentry.io` after checkout)
