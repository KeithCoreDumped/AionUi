/**
 * Parse `.github/aioncore.lock` and reject floating revisions.
 */

const fs = require('fs');
const path = require('path');

const FULL_SHA = /^[0-9a-f]{40}$/;

function readAioncoreLock(repoRoot) {
  const lockPath = path.join(repoRoot, '.github', 'aioncore.lock');
  const raw = fs.readFileSync(lockPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid AionCore lock: ${lockPath}`);
  }
  const repository = typeof parsed.repository === 'string' ? parsed.repository.trim() : '';
  const revision = typeof parsed.revision === 'string' ? parsed.revision.trim().toLowerCase() : '';
  const upstreamVersion = typeof parsed.upstreamVersion === 'string' ? parsed.upstreamVersion.trim() : '';
  if (!repository) {
    throw new Error('AionCore lock is missing repository');
  }
  if (!FULL_SHA.test(revision)) {
    throw new Error(`AionCore lock revision must be a full 40-char commit SHA, got: ${parsed.revision}`);
  }
  return { lockPath, repository, revision, upstreamVersion };
}

module.exports = { readAioncoreLock, FULL_SHA };
