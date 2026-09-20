# Syncing this fork with upstream AionUi

This repository is a trusted downstream of [iOfficeAI/AionUi](https://github.com/iOfficeAI/AionUi). Keep downstream patches small and concentrated so rebase/merge stays cheap.

## Remotes

```bash
git remote add upstream https://github.com/iOfficeAI/AionUi.git
git fetch upstream
```

Prefer merge for a shared trusted branch; rebase only on a private branch you have not published:

```bash
git checkout main
git fetch upstream
git merge upstream/main
# or: git rebase upstream/main
```

Resolve conflicts in the files listed below first. Do not “fix” conflicts by re-enabling Sentry, CDN updates, or AionCore binary downloads.

## Downstream patch design

Keep privacy / supply-chain behavior in as few files as possible:

| Area                   | Files                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Compile-time flags     | `packages/desktop/src/trustedBuild.ts`                                                                                                     |
| Sentry / log upload    | `packages/desktop/src/sentry.ts`, `index.ts`, `renderer/main.tsx`, `preload/main.ts`, `renderer/services/feedback/submitFeedbackReport.ts` |
| Official updater       | `autoUpdaterService.ts`, `updateBridge.ts`, `electron-builder.yml`                                                                         |
| AionCore origin        | `.github/aioncore.lock`, `packages/shared-scripts/src/prepare-aioncore.js`                                                                 |
| Installer reporting    | `resources/windows/installer-errors-sentry.nsh`, `scripts/build-with-builder.js`                                                           |
| CI                     | `.github/workflows/trusted-*.yml`, `.github/trusted/*`                                                                                     |
| Upstream workflow mute | `if: github.repository == 'iOfficeAI/AionUi'` on upstream publish/PR workflows                                                             |

Do not vendor `node_modules`, rewrite electron-builder, or patch Claude/Codex/Grok/Kimi.

## After every upstream sync

Re-run this checklist. CI should stay red until it passes.

- [ ] New telemetry / analytics / crash-reporter dependency?
- [ ] New network endpoint or `https://` host in desktop/main/preload/installer?
- [ ] Sentry init / DSN / source-map upload changed?
- [ ] Windows NSIS / installer reporting changed?
- [ ] Auto-updater feed, `static.aionui.com`, or `publish.owner` changed?
- [ ] `package.json#aioncoreVersion` changed? If yes, **do not** silently edit `.github/aioncore.lock`. Open an explicit commit that records old SHA → new SHA after you have mapped the upstream tag to a full AionCore commit.
- [ ] `scripts/prepareAioncore.js`, `prepare-aioncore.js`, or bundled-binary layout changed?
- [ ] New bundled executable (Hub, ACP, helper)?
- [ ] `bun.lock` / Rust lockfiles changed? Review, do not regenerate casually in CI.
- [ ] GitHub Actions added/updated? Trusted workflows must keep full action SHAs. Upstream workflows should remain repository-gated.
- [ ] `bun run lint`, `bun run format:check`, `bunx tsc --noEmit`, `bun run test`, and `node .github/trusted/verify-trusted-build.js` still pass without `|| true`.

When the AionCore pin changes upstream, CI of this fork should fail or at least show old vs new in the lock-update PR. Never let a workflow rewrite the lock file.

## What not to take from upstream CI

- `bun-version: latest`
- `SENTRY_DSN` injection
- `secrets: inherit`
- automatic tag creation / `package.json` bumps / PAT `GH_TOKEN` pushes
- downloading iOfficeAI AionCore release zips for a trusted Release
- `postinstall \|\| true` as a way to hide new failures
