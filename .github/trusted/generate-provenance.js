/**
 * Write SHA-256 checksums, BUILD-MANIFEST.json, and a basic CycloneDX SBOM
 * for trusted release artifacts. Never records secrets.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { readAioncoreLock } = require('./read-aioncore-lock');

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function listReleaseFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.isFile()) out.push(full);
    }
  };
  walk(dir);
  return out.toSorted();
}

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function jsComponents(projectRoot) {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const sections = [
    ['dependencies', pkg.dependencies || {}],
    ['devDependencies', pkg.devDependencies || {}],
  ];
  const components = [];
  for (const [scope, deps] of sections) {
    for (const [name, version] of Object.entries(deps).toSorted(([a], [b]) => a.localeCompare(b))) {
      components.push({
        type: 'library',
        name,
        version: String(version),
        scope: scope === 'devDependencies' ? 'optional' : 'required',
        properties: [{ name: 'source', value: 'package.json' }],
      });
    }
  }
  return components;
}

function rustComponents(cargoMetadataPath) {
  if (!cargoMetadataPath || !fs.existsSync(cargoMetadataPath)) return [];
  const metadata = JSON.parse(fs.readFileSync(cargoMetadataPath, 'utf8'));
  const packages = Array.isArray(metadata.packages) ? metadata.packages : [];
  return packages
    .map((pkg) => ({
      type: 'library',
      name: pkg.name,
      version: pkg.version,
      purl: `pkg:cargo/${pkg.name}@${pkg.version}`,
      properties: [{ name: 'source', value: 'cargo-metadata' }],
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function generateProvenance(options) {
  const { projectRoot, artifactsDir, outputDir, cargoMetadataPath, extraManifest = {} } = options;
  fs.mkdirSync(outputDir, { recursive: true });
  const lock = readAioncoreLock(projectRoot);
  const artifactFiles = listReleaseFiles(artifactsDir).filter((filePath) => {
    const base = path.basename(filePath);
    return !['SHA256SUMS', 'BUILD-MANIFEST.json', 'sbom.cdx.json'].includes(base);
  });

  const checksumLines = [];
  for (const filePath of artifactFiles) {
    const digest = sha256File(filePath);
    const relative = path.relative(artifactsDir, filePath).split(path.sep).join('/');
    const sidecar = `${filePath}.sha256`;
    fs.writeFileSync(sidecar, `${digest}  ${path.basename(filePath)}\n`);
    checksumLines.push(`${digest}  ${relative}`);
  }
  checksumLines.sort();
  const sumsPath = path.join(outputDir, 'SHA256SUMS');
  fs.writeFileSync(sumsPath, checksumLines.length ? `${checksumLines.join('\n')}\n` : '');

  const bunLockPath = path.join(projectRoot, 'bun.lock');
  const manifest = {
    schemaVersion: 1,
    aionui: {
      commit: extraManifest.aionuiCommit || commandOutput('git', ['rev-parse', 'HEAD']),
      tag: extraManifest.aionuiTag || '',
      repository: extraManifest.githubRepository || '',
    },
    aioncore: {
      repository: lock.repository,
      commit: lock.revision,
      upstreamVersion: lock.upstreamVersion,
    },
    tools: {
      node: commandOutput('node', ['--version']),
      bun: commandOutput('bun', ['--version']),
      rustc: commandOutput('rustc', ['--version']),
      cargo: commandOutput('cargo', ['--version']),
    },
    locks: {
      bunLockSha256: fileExists(bunLockPath) ? sha256File(bunLockPath) : '',
    },
    platform: extraManifest.platform || `${process.platform}-${process.arch}`,
    runnerImage: extraManifest.runnerImage || '',
    buildTimestamp: extraManifest.buildTimestamp || new Date().toISOString(),
    githubRunId: extraManifest.githubRunId || process.env.GITHUB_RUN_ID || '',
    githubRepository: extraManifest.githubRepository || process.env.GITHUB_REPOSITORY || '',
    trustedTelemetryPolicy: {
      AIONUI_TELEMETRY_ENABLED: false,
      AIONUI_OFFICIAL_UPDATES_ENABLED: false,
    },
  };
  fs.writeFileSync(path.join(outputDir, 'BUILD-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const sbom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      timestamp: manifest.buildTimestamp,
      component: {
        type: 'application',
        name: 'AionUi',
        version: extraManifest.aionuiTag || manifest.aionui.commit,
      },
    },
    components: [...jsComponents(projectRoot), ...rustComponents(cargoMetadataPath)],
  };
  fs.writeFileSync(path.join(outputDir, 'sbom.cdx.json'), `${JSON.stringify(sbom, null, 2)}\n`);

  return { sumsPath, artifactCount: artifactFiles.length, manifest };
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function main() {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const artifactsDir = path.resolve(process.argv[2] || path.join(projectRoot, 'release-assets'));
  const outputDir = path.resolve(process.argv[3] || artifactsDir);
  const cargoMetadataPath = process.env.AIONCORE_CARGO_METADATA || '';
  generateProvenance({
    projectRoot,
    artifactsDir,
    outputDir,
    cargoMetadataPath,
    extraManifest: {
      aionuiCommit: process.env.AIONUI_GIT_SHA || '',
      aionuiTag: process.env.AIONUI_GIT_TAG || '',
      platform: process.env.AIONUI_BUILD_PLATFORM || '',
      runnerImage: process.env.ImageOS || '',
      githubRunId: process.env.GITHUB_RUN_ID || '',
      githubRepository: process.env.GITHUB_REPOSITORY || '',
    },
  });
  console.log(`[provenance] wrote checksums and manifest under ${outputDir}`);
}

if (require.main === module) {
  main();
}

module.exports = { generateProvenance, sha256File };
