import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { AIONUI_GITHUB_REPO, AIONUI_OFFICIAL_UPDATES_ENABLED, AIONUI_TELEMETRY_ENABLED } from '@/trustedBuild';

const {
  verifyTrustedBuild,
  workflowActionFailures,
  workflowJobGateFailures,
} = require('../../../.github/trusted/verify-trusted-build');
const { readAioncoreLock, FULL_SHA } = require('../../../.github/trusted/read-aioncore-lock');
const { assertSourceCheckout } = require('../../../.github/trusted/build-aioncore-from-source');

const repoRoot = resolve(__dirname, '../../..');

describe('trusted build policy', () => {
  it('hard-codes telemetry and official updates off', () => {
    expect(AIONUI_TELEMETRY_ENABLED).toBe(false);
    expect(AIONUI_OFFICIAL_UPDATES_ENABLED).toBe(false);
    expect(AIONUI_GITHUB_REPO).not.toBe('iOfficeAI/AionUi');
  });

  it('locks AionCore to a full commit SHA', () => {
    const lock = readAioncoreLock(repoRoot);
    expect(lock.revision).toMatch(FULL_SHA);
    expect(lock.repository).toBe('https://github.com/iOfficeAI/AionCore.git');
    expect(lock.upstreamVersion).toBe('v0.2.2');
  });

  it('passes the machine-checkable verifier', () => {
    const result = verifyTrustedBuild(repoRoot);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('fails the verifier when a Sentry DSN is present in the environment', () => {
    const previous = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/1';
    try {
      const result = verifyTrustedBuild(repoRoot);
      expect(result.ok).toBe(false);
      expect(result.failures.some((failure: string) => failure.includes('SENTRY_DSN'))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.SENTRY_DSN;
      else process.env.SENTRY_DSN = previous;
    }
  });

  it('rejects unapproved or floating actions in trusted workflows', () => {
    const pins = { 'actions/checkout': { sha: 'a'.repeat(40), version: 'v4.2.2' } };

    expect(workflowActionFailures('uses: actions/checkout@v4', pins, 'trusted.yml')).toEqual([
      'trusted.yml uses non-SHA action actions/checkout@v4',
    ]);
    expect(workflowActionFailures(`uses: unknown/action@${'b'.repeat(40)}`, pins, 'trusted.yml')).toEqual([
      `trusted.yml uses action missing from action-pins.json: unknown/action@${'b'.repeat(40)}`,
    ]);
    expect(workflowActionFailures(`uses: actions/checkout@${'a'.repeat(40)}`, pins, 'trusted.yml')).toEqual([]);
  });

  it('requires every upstream workflow job to carry the fork gate', () => {
    const ungated = ['jobs:', '  build:', '    runs-on: ubuntu-latest'].join('\n');
    const gated = [
      'jobs:',
      '  build:',
      "    if: github.repository == 'iOfficeAI/AionUi'",
      '    runs-on: ubuntu-latest',
    ].join('\n');

    expect(workflowJobGateFailures(ungated, 'upstream.yml')).toEqual([
      'upstream.yml job build is not gated to iOfficeAI/AionUi',
    ]);
    expect(workflowJobGateFailures(gated, 'upstream.yml')).toEqual([]);
  });

  it('binds an AionCore source checkout to the locked revision and repository', () => {
    const sourceDir = mkdtempSync(resolve(tmpdir(), 'aioncore-source-checkout-'));
    try {
      execFileSync('git', ['init'], { cwd: sourceDir });
      execFileSync('git', ['config', 'user.name', 'Trusted Build Test'], { cwd: sourceDir });
      execFileSync('git', ['config', 'user.email', 'trusted-build@example.invalid'], { cwd: sourceDir });
      writeFileSync(resolve(sourceDir, 'README.md'), 'locked source\n');
      execFileSync('git', ['add', 'README.md'], { cwd: sourceDir });
      execFileSync('git', ['commit', '-m', 'test fixture'], { cwd: sourceDir });
      execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:iOfficeAI/AionCore.git'], { cwd: sourceDir });
      const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceDir, encoding: 'utf8' }).trim();
      const lock = { revision, repository: 'https://github.com/iOfficeAI/AionCore.git' };

      expect(assertSourceCheckout(sourceDir, lock).actualRevision).toBe(revision);
      expect(() => assertSourceCheckout(sourceDir, { ...lock, revision: '0'.repeat(40) })).toThrow(
        /checkout revision mismatch/
      );
      expect(() =>
        assertSourceCheckout(sourceDir, { ...lock, repository: 'https://github.com/example/other.git' })
      ).toThrow(/checkout repository mismatch/);
    } finally {
      rmSync(sourceDir, { force: true, recursive: true });
    }
  });
});
