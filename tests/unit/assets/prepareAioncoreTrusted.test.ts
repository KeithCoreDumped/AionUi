import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { prepareAioncore } = require('../../../packages/shared-scripts/src/prepare-aioncore');

describe('prepare-aioncore trusted build', () => {
  it('refuses GitHub Actions artifacts when AIONUI_TRUSTED_BUILD=1', () => {
    const previousTrusted = process.env.AIONUI_TRUSTED_BUILD;
    const previousRunId = process.env.AIONUI_BACKEND_RUN_ID;
    process.env.AIONUI_TRUSTED_BUILD = '1';
    process.env.AIONUI_BACKEND_RUN_ID = '123';
    try {
      expect(() =>
        prepareAioncore({
          projectRoot: mkdtempSync(join(tmpdir(), 'aionui-trusted-prepare-')),
          platform: 'linux',
          arch: 'x64',
          version: 'v0.2.2',
        })
      ).toThrow(/AIONUI_TRUSTED_BUILD=1 refuses AIONUI_BACKEND_RUN_ID/);
    } finally {
      if (previousTrusted === undefined) delete process.env.AIONUI_TRUSTED_BUILD;
      else process.env.AIONUI_TRUSTED_BUILD = previousTrusted;
      if (previousRunId === undefined) delete process.env.AIONUI_BACKEND_RUN_ID;
      else process.env.AIONUI_BACKEND_RUN_ID = previousRunId;
    }
  });

  it('refuses GitHub release downloads when trusted local inputs are missing', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-trusted-prepare-'));
    const previousTrusted = process.env.AIONUI_TRUSTED_BUILD;
    const previousRunId = process.env.AIONUI_BACKEND_RUN_ID;
    const previousLocal = process.env.AIONUI_BACKEND_LOCAL_BINARY;
    const previousBundle = process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
    process.env.AIONUI_TRUSTED_BUILD = '1';
    delete process.env.AIONUI_BACKEND_RUN_ID;
    delete process.env.AIONUI_BACKEND_LOCAL_BINARY;
    delete process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
    try {
      expect(() =>
        prepareAioncore({
          projectRoot: tmp,
          platform: 'linux',
          arch: 'x64',
          version: 'v0.2.2',
        })
      ).toThrow(/refuses GitHub AionCore downloads/);
    } finally {
      if (previousTrusted === undefined) delete process.env.AIONUI_TRUSTED_BUILD;
      else process.env.AIONUI_TRUSTED_BUILD = previousTrusted;
      if (previousRunId === undefined) delete process.env.AIONUI_BACKEND_RUN_ID;
      else process.env.AIONUI_BACKEND_RUN_ID = previousRunId;
      if (previousLocal === undefined) delete process.env.AIONUI_BACKEND_LOCAL_BINARY;
      else process.env.AIONUI_BACKEND_LOCAL_BINARY = previousLocal;
      if (previousBundle === undefined) delete process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
      else process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = previousBundle;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
