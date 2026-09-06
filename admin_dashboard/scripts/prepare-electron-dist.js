/**
 * Pre-extracts the cached Electron distribution zip into a project-local
 * folder and prints its path, for use as electron-builder's `electronDist`
 * config (`-c.electronDist=<path>`).
 *
 * Why this exists: electron-builder's own extract-then-rename step
 * (app-builder-lib's extractArchive, called during `electron-builder --win`)
 * reproducibly fails on this machine with EPERM renaming
 * `win-unpacked.tmp` -> `win-unpacked`, 100% of the time, regardless of
 * Windows Defender exclusions, real-time protection being off, or which
 * output directory is used — see the retry-with-backoff patch in
 * patches/app-builder-lib+*.patch, which was NOT sufficient on its own
 * (failed after 10 retries over ~25s). Pre-extracting once via
 * PowerShell's native Expand-Archive and pointing electron-builder at the
 * result (a plain directory copy, not extract+rename) reliably avoids the
 * broken code path entirely.
 *
 * Safe to delete `.electron-dist/` any time — it's just a cache, rebuilt
 * automatically from the already-downloaded zip in @electron/get's own
 * cache (~/AppData/Local/electron/Cache).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function prepareElectronDist() {
  const electronVersion = require('electron/package.json').version;
  const platform = process.platform === 'win32' ? 'win32' : process.platform;
  const arch = process.arch;
  const zipName = `electron-v${electronVersion}-${platform}-${arch}.zip`;
  const destDir = path.join(__dirname, '..', '.electron-dist');
  const markerFile = path.join(destDir, '.extracted-' + electronVersion);

  if (fs.existsSync(markerFile)) {
    return destDir;
  }

  if (process.platform !== 'win32') {
    throw new Error(`prepare-electron-dist.js only implements the Windows workaround; on ${process.platform}, pass no electronDist override.`);
  }

  const cacheRoot = path.join(os.homedir(), 'AppData', 'Local', 'electron', 'Cache');
  let zipPath = null;
  if (fs.existsSync(cacheRoot)) {
    for (const hashDir of fs.readdirSync(cacheRoot)) {
      const candidate = path.join(cacheRoot, hashDir, zipName);
      if (fs.existsSync(candidate)) {
        zipPath = candidate;
        break;
      }
    }
  }

  if (!zipPath) {
    throw new Error(`Could not find cached ${zipName} under ${cacheRoot}. Run "npx electron-builder --win" once (it will fail at the rename step, but by then it will have downloaded and cached the zip), then re-run.`);
  }

  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`,
  ]);
  fs.writeFileSync(markerFile, '');

  return destDir;
}

module.exports = { prepareElectronDist };

if (require.main === module) {
  try {
    console.log(prepareElectronDist());
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
