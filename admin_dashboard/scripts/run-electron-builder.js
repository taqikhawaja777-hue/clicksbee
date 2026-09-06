/**
 * Runs electron-builder with electronDist pre-set on Windows (see
 * prepare-electron-dist.js for why). Any CLI args passed to this script
 * (e.g. `--win`) are forwarded to electron-builder as-is.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);

if (process.platform === 'win32') {
  const { prepareElectronDist } = require('./prepare-electron-dist');
  const distDir = prepareElectronDist();
  args.push(`-c.electronDist=${distDir}`);
}

const isWindows = process.platform === 'win32';
const electronBuilderBin = path.join(__dirname, '..', 'node_modules', '.bin', isWindows ? 'electron-builder.cmd' : 'electron-builder');
// .cmd files need shell:true on Windows - spawnSync can otherwise fail to
// launch them at all (silently, with no stdout/stderr of its own).
const result = spawnSync(electronBuilderBin, args, { stdio: 'inherit', shell: isWindows });
if (result.error) {
  console.error('Failed to launch electron-builder:', result.error);
  process.exit(1);
}
process.exit(result.status == null ? 1 : result.status);
