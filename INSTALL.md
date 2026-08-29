# WorkTrackPro Agent — Windows Installer Guide (v1.0.0)

This document provides instructions for installing, mass-deploying, and uninstalling the **WorkTrackPro** desktop monitoring agent on Windows.

---

## 1. Deliverable Output

- **Installer Path**: `c:\Users\Aamir\Downloads\stitch_workforce_monitor_pro\admin_dashboard\build_dist\WorkTrackPro Setup 1.0.0.exe`
- **File Size**: 78.95 MB (`78,950,927 bytes`)
- **Target OS**: Windows 10 / 11 (x64)
- **Installer Engine**: NSIS (Nullsoft Scriptable Install System)

---

## 2. What the Installer Does

When executed, `WorkTrackPro Setup 1.0.0.exe`:
1. Prompts for custom installation directory selection (Defaults to `%LOCALAPPDATA%\Programs\WorkTrackPro`).
2. Copies compiled Electron main process, pre-packaged Node dependencies, and production web bundle (`dist/index.html`).
3. Creates a **Desktop Shortcut** (`WorkTrackPro Agent`).
4. Creates a **Start Menu Shortcut** under `WorkTrackPro Agent`.
5. Registers system uninstaller in Windows Control Panel / Settings.

---

## 3. Unsigned Build Disclosure (Windows SmartScreen Warning)

> [!WARNING]
> **Windows SmartScreen Warning Notice**:
> Because this executable is an unsigned build (built without a commercial $200+/year EV Code Signing Certificate from Sectigo/DigiCert), Windows Defender SmartScreen will display an **"Unknown Publisher" / "Windows protected your PC"** dialog on launch.
> 
> **How to Proceed**:
> 1. Click **More Info** on the SmartScreen dialog.
> 2. Click **Run Anyway**.
> 
> **Production Certificate Configuration**:
> To eliminate this warning for commercial deployment, set `cscLink` or `win.certificateFile` with your `.pfx` certificate in `package.json`.

---

## 4. IT / Enterprise Mass Deployment (Silent Install Switch)

For automated network deployment across company workstations via Active Directory GPO, SCCM, or Intune:

```cmd
"WorkTrackPro Setup 1.0.0.exe" /S /D=C:\Program Files\WorkTrackPro
```

- `/S`: Enables 100% silent installation mode (no GUI popups or user prompts).
- `/D=<path>`: Specifies custom destination installation path.

---

## 5. Clean-Machine Testing & Uninstallation

### Testing Checklist:
1. **Launch Installer**: Run `WorkTrackPro Setup 1.0.0.exe`.
2. **Shortcuts**: Verify `WorkTrackPro Agent` desktop and start menu shortcuts exist.
3. **App First Launch**: Launch application -> Verify full-screen non-dismissable **Consent Modal** appears.
4. **Login & Session**: Log in -> Verify Check-In, Work Session metrics, and silent screenshot capture operate cleanly without Node.js dev tooling present.

### Uninstallation Instructions:
1. Open Windows **Settings** (`Win + I`) -> **Apps** -> **Installed Apps** (or Control Panel -> Programs and Features).
2. Locate **WorkTrackPro**.
3. Click **Uninstall** and confirm.
4. The NSIS uninstaller cleanly removes desktop shortcuts, start menu links, and program binaries.
