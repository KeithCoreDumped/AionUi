/**
 * Build AionCore from a locked source checkout and stage the current-platform
 * binary for `prepare-aioncore` local-binary mode.
 *
 * Does not download iOfficeAI release artifacts.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readAioncoreLock } = require('./read-aioncore-lock');

function rustTriple(platform, arch) {
  const key = `${platform}-${arch}`;
  const triples = {
    'darwin-arm64': 'aarch64-apple-darwin',
    'darwin-x64': 'x86_64-apple-darwin',
    'linux-arm64': 'aarch64-unknown-linux-gnu',
    'linux-x64': 'x86_64-unknown-linux-gnu',
    'win32-arm64': 'aarch64-pc-windows-msvc',
    'win32-x64': 'x86_64-pc-windows-msvc',
  };
  const triple = triples[key];
  if (!triple) {
    throw new Error(`Unsupported AionCore target: ${key}`);
  }
  return triple;
}

function hostTriple() {
  return rustTriple(process.platform, process.arch);
}

function assertTargetAllowed(platform, arch) {
  const wanted = rustTriple(platform, arch);
  const host = hostTriple();
  if (wanted === host) return { cross: false, triple: wanted };
  // Same exception upstream already uses: produce macOS x64 on Apple Silicon.
  if (process.platform === 'darwin' && process.arch === 'arm64' && platform === 'darwin' && arch === 'x64') {
    return { cross: true, triple: wanted };
  }
  throw new Error(
    `Refusing to cross-compile AionCore for ${platform}-${arch} on host ${process.platform}-${process.arch}`
  );
}

function binaryName(platform) {
  return platform === 'win32' ? 'aioncore.exe' : 'aioncore';
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function commandOutput(command, args, options) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function normalizeRepositoryUrl(value) {
  return value
    .trim()
    .replace(/^git@github\.com:/i, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//i, 'https://github.com/')
    .replace(/\.git$/i, '')
    .replace(/\/$/, '')
    .toLowerCase();
}

function assertSourceCheckout(sourceDir, lock) {
  const actualRevision = commandOutput('git', ['-C', sourceDir, 'rev-parse', 'HEAD']).toLowerCase();
  if (actualRevision !== lock.revision.toLowerCase()) {
    throw new Error(`AionCore checkout revision mismatch: expected ${lock.revision}, got ${actualRevision}`);
  }
  const actualRepository = commandOutput('git', ['-C', sourceDir, 'config', '--get', 'remote.origin.url']);
  if (normalizeRepositoryUrl(actualRepository) !== normalizeRepositoryUrl(lock.repository)) {
    throw new Error(`AionCore checkout repository mismatch: expected ${lock.repository}, got ${actualRepository}`);
  }
  return { actualRevision, actualRepository };
}

function buildAioncoreFromSource(options) {
  const { projectRoot, sourceDir, platform = process.platform, arch = process.arch } = options;
  const lock = readAioncoreLock(projectRoot);
  const sourceCheckout = assertSourceCheckout(sourceDir, lock);
  const target = assertTargetAllowed(platform, arch);
  const manifestPath = path.join(sourceDir, 'crates', 'aionui-app', 'Cargo.toml');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`AionCore crate manifest not found: ${manifestPath}`);
  }

  const cargoArgs = ['build', '--locked', '--release', '--manifest-path', manifestPath];
  if (target.cross) {
    cargoArgs.push('--target', target.triple);
  }

  console.log(`[aioncore-source] repository=${lock.repository}`);
  console.log(`[aioncore-source] expected revision=${lock.revision}`);
  console.log(`[aioncore-source] cargo ${cargoArgs.join(' ')}`);

  execFileSync('cargo', cargoArgs, {
    cwd: sourceDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      CARGO_TERM_COLOR: 'always',
    },
  });

  const releaseDir = target.cross
    ? path.join(sourceDir, 'target', target.triple, 'release')
    : path.join(sourceDir, 'target', 'release');
  const builtBinary = path.join(releaseDir, binaryName(platform));
  if (!fs.existsSync(builtBinary)) {
    throw new Error(`AionCore binary not produced at ${builtBinary}`);
  }

  const stagingDir = path.join(projectRoot, '.aioncore-build', `${platform}-${arch}`);
  ensureDir(stagingDir);
  const stagedBinary = path.join(stagingDir, binaryName(platform));
  fs.copyFileSync(builtBinary, stagedBinary);
  if (platform !== 'win32') {
    fs.chmodSync(stagedBinary, 0o755);
  }

  const rustcVersion = commandOutput('rustc', ['--version']);
  const cargoVersion = commandOutput('cargo', ['--version']);
  const meta = {
    repository: lock.repository,
    revision: lock.revision,
    actualRepository: sourceCheckout.actualRepository,
    actualRevision: sourceCheckout.actualRevision,
    upstreamVersion: lock.upstreamVersion,
    platform,
    arch,
    rustTriple: target.triple,
    cross: target.cross,
    rustcVersion,
    cargoVersion,
    builtBinary,
    stagedBinary,
    host: {
      platform: process.platform,
      arch: process.arch,
      os: os.type(),
      release: os.release(),
    },
  };
  fs.writeFileSync(path.join(stagingDir, 'source-build.json'), `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`[aioncore-source] staged ${stagedBinary}`);
  return meta;
}

function main() {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const sourceDir = process.env.AIONCORE_SOURCE_DIR || path.join(projectRoot, '.aioncore-src');
  const platform = process.env.AIONUI_BACKEND_PLATFORM || process.platform;
  const arch = process.env.AIONUI_BACKEND_ARCH || process.arch;
  buildAioncoreFromSource({ projectRoot, sourceDir, platform, arch });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('[aioncore-source] failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

module.exports = { assertSourceCheckout, buildAioncoreFromSource, normalizeRepositoryUrl, rustTriple };
