const fs = require('fs');
const path = require('path');

// Monkey patch fs.promises.rename to gracefully retry on Windows EPERM lock
const origRename = fs.promises.rename;
fs.promises.rename = async function (oldPath, newPath) {
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      return await origRename.call(fs.promises, oldPath, newPath);
    } catch (err) {
      if ((err.code === 'EPERM' || err.code === 'EBUSY') && attempt < 15) {
        console.log(`[Retry Handler] Rename locked (${err.code}). Retrying attempt ${attempt}/15 in 400ms...`);
        await new Promise((r) => setTimeout(r, 400));
      } else {
        // Fallback: try copy + delete if rename continues to be locked by OS
        if ((err.code === 'EPERM' || err.code === 'EBUSY') && fs.existsSync(oldPath)) {
          try {
            console.log(`[Fallback Handler] Performing cpSync fallback for ${oldPath} -> ${newPath}`);
            fs.cpSync(oldPath, newPath, { recursive: true });
            fs.rmSync(oldPath, { recursive: true, force: true });
            return;
          } catch (cpErr) {
            console.warn('[Fallback Handler] cpSync error:', cpErr.message);
          }
        }
        throw err;
      }
    }
  }
};

const builder = require('electron-builder');
const Platform = builder.Platform;

async function buildWindowsInstaller() {
  console.log('Building WorkTrackPro Windows NSIS .exe Installer with EPERM Retry Handler...');

  const outputDir = path.join(__dirname, 'build_dist');
  if (fs.existsSync(outputDir)) {
    try {
      fs.rmSync(outputDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('Warning clearing output directory:', e.message);
    }
  }

  try {
    const result = await builder.build({
      targets: Platform.WINDOWS.createTarget(['nsis'], builder.Arch.x64),
      config: {
        appId: 'com.stitchmonitor.worktrackpro',
        productName: 'WorkTrackPro',
        directories: {
          output: 'build_dist',
        },
        files: [
          'dist/**/*',
          'dist-electron/**/*',
          'package.json',
        ],
        win: {
          target: [
            {
              target: 'nsis',
              arch: ['x64'],
            },
          ],
        },
        nsis: {
          oneClick: false,
          allowToChangeInstallationDirectory: true,
          createDesktopShortcut: true,
          createStartMenuShortcut: true,
          shortcutName: 'WorkTrackPro Agent',
        },
        npmRebuild: false,
      },
    });

    console.log('BUILD SUCCESSFUL! Installer deliverable paths:', result);
  } catch (error) {
    console.error('Build Error:', error);
    process.exit(1);
  }
}

buildWindowsInstaller();
