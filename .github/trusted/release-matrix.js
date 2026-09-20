const ALL = {
  include: [
    {
      platform: 'macos-arm64',
      os: 'macos-14',
      arch: 'arm64',
      electron_platform: 'darwin',
      command: 'node scripts/build-with-builder.js arm64 --mac --arm64',
      artifact: 'macos-build-arm64',
    },
    {
      platform: 'macos-x64',
      os: 'macos-14',
      arch: 'x64',
      electron_platform: 'darwin',
      command: 'node scripts/build-with-builder.js x64 --mac --x64',
      artifact: 'macos-build-x64',
    },
    {
      platform: 'windows-x64',
      os: 'windows-2022',
      arch: 'x64',
      electron_platform: 'win32',
      command: 'node scripts/build-with-builder.js x64 --win --x64',
      artifact: 'windows-build-x64',
    },
    {
      platform: 'windows-arm64',
      os: 'windows-11-arm',
      arch: 'arm64',
      electron_platform: 'win32',
      command: 'node scripts/build-with-builder.js arm64 --win --arm64',
      artifact: 'windows-build-arm64',
    },
    {
      platform: 'linux-x64',
      os: 'ubuntu-22.04',
      arch: 'x64',
      electron_platform: 'linux',
      command: 'node scripts/build-with-builder.js x64 --linux --x64',
      artifact: 'linux-build-x64',
    },
    {
      platform: 'linux-arm64',
      os: 'ubuntu-24.04-arm',
      arch: 'arm64',
      electron_platform: 'linux',
      command: 'node scripts/build-with-builder.js arm64 --linux --arm64',
      artifact: 'linux-build-arm64',
    },
  ],
};

const wanted = (process.argv[2] || 'all').trim();
const matrix = wanted === 'all' ? ALL : { include: ALL.include.filter((row) => row.platform === wanted) };
if (matrix.include.length === 0) {
  throw new Error(`Unknown trusted-release platform: ${wanted}`);
}
process.stdout.write(JSON.stringify(matrix));
