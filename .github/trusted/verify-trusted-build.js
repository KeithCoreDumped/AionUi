/**
 * Machine-checkable trusted-build policy.
 *
 * Detects active Sentry DSN/endpoints and telemetry/update flags.
 * Does not fail merely because dependency source mentions the word "Sentry".
 */

const fs = require('fs');
const path = require('path');

const { readAioncoreLock, FULL_SHA } = require('./read-aioncore-lock');

const SENTRY_ENDPOINT_RE =
  /https:\/\/[0-9a-f]+@[a-z0-9._-]*sentry\.io\/\d+|https:\/\/[^/\s'"]+ingest\.sentry\.io\/\d+/gi;
const ACTION_USE_RE = /uses:\s*([^\s@]+)@([^\s#]+)/g;
const FULL_ACTION_SHA_RE = /^[0-9a-f]{40}$/i;
const UPSTREAM_REPOSITORY_GATE = "github.repository == 'iOfficeAI/AionUi'";

function repoRootFrom(cwd) {
  return path.resolve(cwd || process.cwd());
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function walkFiles(dir, out, skipDirNames) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (skipDirNames.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out, skipDirNames);
      continue;
    }
    if (entry.isFile()) out.push(full);
  }
}

function collectSourceFiles(root) {
  const files = [];
  const skip = new Set(['.git', 'node_modules', 'out', 'coverage', 'dist', 'target', '.aioncore-src', 'mobile']);
  const roots = [
    path.join(root, 'packages'),
    path.join(root, 'scripts'),
    path.join(root, 'resources'),
    path.join(root, '.github'),
  ];
  for (const dir of roots) {
    if (fs.existsSync(dir)) walkFiles(dir, files, skip);
  }
  return files.filter((filePath) => /\.(ts|tsx|js|mjs|cjs|yml|yaml|nsh|ps1|json)$/.test(filePath));
}

function constantIsFalse(source, name) {
  const re = new RegExp(`export const ${name}\\s*=\\s*false\\s*;`);
  return re.test(source);
}

function workflowActionFailures(source, pins, label) {
  const failures = [];
  ACTION_USE_RE.lastIndex = 0;
  let match;
  while ((match = ACTION_USE_RE.exec(source))) {
    const action = match[1];
    const ref = match[2];
    if (!FULL_ACTION_SHA_RE.test(ref)) {
      failures.push(`${label} uses non-SHA action ${action}@${ref}`);
      continue;
    }
    const expected = pins[action];
    if (!expected || typeof expected.sha !== 'string' || typeof expected.version !== 'string') {
      failures.push(`${label} uses action missing from action-pins.json: ${action}@${ref}`);
      continue;
    }
    if (expected.sha.toLowerCase() !== ref.toLowerCase()) {
      failures.push(`${label} pins ${action} to ${ref}, expected ${expected.sha} (${expected.version})`);
    }
  }
  return failures;
}

function workflowJobGateFailures(source, label) {
  const jobsStart = source.search(/^jobs:\s*$/m);
  if (jobsStart < 0) return [`${label} has no jobs section`];
  const jobsSource = source.slice(jobsStart);
  const matches = [...jobsSource.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)];
  const failures = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index;
    const end = index + 1 < matches.length ? matches[index + 1].index : jobsSource.length;
    const block = jobsSource.slice(start, end);
    if (!block.includes(UPSTREAM_REPOSITORY_GATE)) {
      failures.push(`${label} job ${match[1]} is not gated to iOfficeAI/AionUi`);
    }
  }
  return failures;
}

function verifyTrustedBuild(root = repoRootFrom()) {
  const failures = [];
  const notices = [];

  const fail = (message) => failures.push(message);

  if (process.env.SENTRY_DSN && process.env.SENTRY_DSN.trim()) {
    fail('SENTRY_DSN is set; trusted builds must not receive a Sentry DSN');
  }
  if (process.env.VITE_SENTRY_DSN && process.env.VITE_SENTRY_DSN.trim()) {
    fail('VITE_SENTRY_DSN is set; trusted builds must not receive a Sentry DSN');
  }

  const trustedBuildPath = path.join(root, 'packages/desktop/src/trustedBuild.ts');
  if (!fileExists(trustedBuildPath)) {
    fail(`missing ${path.relative(root, trustedBuildPath)}`);
  } else {
    const source = readText(trustedBuildPath);
    if (!constantIsFalse(source, 'AIONUI_TELEMETRY_ENABLED')) {
      fail('AIONUI_TELEMETRY_ENABLED must be a compile-time false literal');
    }
    if (!constantIsFalse(source, 'AIONUI_OFFICIAL_UPDATES_ENABLED')) {
      fail('AIONUI_OFFICIAL_UPDATES_ENABLED must be a compile-time false literal');
    }
    if (/AIONUI_TELEMETRY_ENABLED\s*=\s*process\.env/.test(source)) {
      fail('AIONUI_TELEMETRY_ENABLED must not read a runtime environment variable');
    }
    if (source.includes('iOfficeAI/AionUi')) {
      fail('trustedBuild.ts must not target the upstream iOfficeAI/AionUi update/release repo');
    }
  }

  const viteConfigPath = path.join(root, 'packages/desktop/electron.vite.config.ts');
  if (fileExists(viteConfigPath)) {
    const source = readText(viteConfigPath);
    if (/JSON\.stringify\(process\.env\.SENTRY_DSN/.test(source)) {
      fail('electron.vite.config.ts must not bake process.env.SENTRY_DSN into the bundle');
    }
  } else {
    fail('missing packages/desktop/electron.vite.config.ts');
  }

  const builderYmlPath = path.join(root, 'packages/desktop/electron-builder.yml');
  if (fileExists(builderYmlPath)) {
    const source = readText(builderYmlPath);
    if (/publishAutoUpdate:\s*true/.test(source) && /owner:\s*iOfficeAI/.test(source)) {
      fail('electron-builder.yml still auto-publishes/updates against iOfficeAI');
    }
    if (!/publishAutoUpdate:\s*false/.test(source)) {
      fail('electron-builder.yml must set publishAutoUpdate: false for this trusted fork');
    }
  }

  const generatedDsn = path.join(root, 'resources/windows/support/_sentry-dsn.generated.nsh');
  if (fileExists(generatedDsn)) {
    const source = readText(generatedDsn);
    if (!/^!define AIONUI_SENTRY_DSN ""\s*$/m.test(source)) {
      fail('installer generated Sentry DSN include is not empty');
    }
  }

  try {
    const lock = readAioncoreLock(root);
    if (!FULL_SHA.test(lock.revision)) {
      fail('AionCore lock revision is not a full SHA');
    }
    if (/latest|main|HEAD/i.test(lock.revision)) {
      fail('AionCore lock uses a floating revision');
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  const scanRoots = collectSourceFiles(root);
  for (const filePath of scanRoots) {
    const relative = path.relative(root, filePath);
    if (relative.includes(`${path.sep}node_modules${path.sep}`)) continue;
    const source = readText(filePath);
    const matches = source.match(SENTRY_ENDPOINT_RE);
    if (matches && matches.length > 0) {
      fail(`active Sentry endpoint/DSN found in ${relative}: ${matches[0]}`);
    }
  }

  const trustedWorkflows = [
    path.join(root, '.github/workflows/trusted-ci.yml'),
    path.join(root, '.github/workflows/trusted-release.yml'),
  ];
  const pinsPath = path.join(root, '.github/trusted/action-pins.json');
  const pins = fileExists(pinsPath) ? JSON.parse(readText(pinsPath)) : {};
  for (const workflowPath of trustedWorkflows) {
    if (!fileExists(workflowPath)) {
      fail(`missing ${path.relative(root, workflowPath)}`);
      continue;
    }
    const source = readText(workflowPath);
    const label = path.relative(root, workflowPath);
    for (const failure of workflowActionFailures(source, pins, label)) fail(failure);
    if (/bun-version:\s*latest/.test(source)) {
      fail(`${path.relative(root, workflowPath)} uses bun-version: latest`);
    }
    if (/secrets:\s*inherit/.test(source)) {
      fail(`${path.relative(root, workflowPath)} uses secrets: inherit`);
    }
  }

  const workflowsDir = path.join(root, '.github/workflows');
  if (fs.existsSync(workflowsDir)) {
    for (const entry of fs.readdirSync(workflowsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue;
      if (entry.name.startsWith('trusted-') || entry.name.startsWith('_')) continue;
      const workflowPath = path.join(workflowsDir, entry.name);
      const source = readText(workflowPath);
      for (const failure of workflowJobGateFailures(source, path.relative(root, workflowPath))) fail(failure);
    }
  }

  const prepareAioncorePath = path.join(root, 'packages/shared-scripts/src/prepare-aioncore.js');
  if (fileExists(prepareAioncorePath)) {
    const source = readText(prepareAioncorePath);
    if (!source.includes('AIONUI_TRUSTED_BUILD')) {
      fail('prepare-aioncore.js must refuse GitHub binary downloads when AIONUI_TRUSTED_BUILD=1');
    }
  }

  return { ok: failures.length === 0, failures, notices };
}

function main() {
  const result = verifyTrustedBuild();
  if (result.notices.length > 0) {
    for (const notice of result.notices) {
      console.warn(`[trusted-build] ${notice}`);
    }
  }
  if (!result.ok) {
    for (const failure of result.failures) {
      console.error(`[trusted-build] ${failure}`);
    }
    process.exit(1);
  }
  console.log('[trusted-build] policy checks passed');
}

if (require.main === module) {
  main();
}

module.exports = { verifyTrustedBuild, workflowActionFailures, workflowJobGateFailures };
