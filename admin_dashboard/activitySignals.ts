/**
 * Live signal readers for the activity classifier (Electron main process):
 *  - which processes are using the microphone (Windows' privacy record)
 *  - voice LOUDNESS on the mic and per-app speaker output (a PowerShell
 *    helper reading Windows' audio peak meters - nothing is recorded)
 *  - per-second input + cursor samples (mouse-jiggler detection)
 *  - a tiny 64x36 screen thumbnail every 30s to know if anything changed
 * Each reader fails soft: if one is unavailable the classifier just works
 * with the others.
 */
import { desktopCapturer, powerMonitor, screen } from 'electron';
import { execFile, spawn, ChildProcess } from 'child_process';
import {
  InputSample,
  ScreenSample,
  MIC_VOICE_THRESHOLD,
  SPEAKER_VOICE_THRESHOLD,
  isCallAudioProcess,
  parseMicrophoneRegistry,
  screenChanged,
  toGrayscale,
} from './activityClassifier';

const MIC_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';

/** Processes using the microphone right now (lower-case, no ".exe"). Empty on error / non-Windows. */
export function readMicrophoneUsers(): Promise<string[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile('reg', ['query', MIC_KEY, '/s'], { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      // reg.exe exits 1 when it hits an unreadable subkey but still prints the rest.
      resolve(stdout ? parseMicrophoneRegistry(stdout) : []);
      if (err && !stdout) console.warn('[ActivitySignals] Could not read microphone usage:', err.message);
    });
  });
}

// ---- voice level probe -----------------------------------------------------

const AUDIO_PROBE_SCRIPT = String.raw`
param([int]$ParentPid = 0)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
namespace WtpAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] public class MMDeviceEnumeratorCom {}
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceEnumerator { [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices); }
  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceCollection { [PreserveSig] int GetCount(out int count); [PreserveSig] int Item(int index, out IMMDevice device); }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDevice { [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object iface); }
  [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioSessionManager2 {
    [PreserveSig] int GetAudioSessionControl(IntPtr a, int b, out IntPtr c);
    [PreserveSig] int GetSimpleAudioVolume(IntPtr a, int b, out IntPtr c);
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator e);
  }
  [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioSessionEnumerator { [PreserveSig] int GetCount(out int count); [PreserveSig] int GetSession(int index, out IAudioSessionControl2 s); }
  [Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioSessionControl2 {
    [PreserveSig] int GetState(out int state);
    [PreserveSig] int GetDisplayName(out IntPtr n);
    [PreserveSig] int SetDisplayName(IntPtr a, IntPtr b);
    [PreserveSig] int GetIconPath(out IntPtr p);
    [PreserveSig] int SetIconPath(IntPtr a, IntPtr b);
    [PreserveSig] int GetGroupingParam(out Guid g);
    [PreserveSig] int SetGroupingParam(IntPtr a, IntPtr b);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr a);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr a);
    [PreserveSig] int GetSessionIdentifier(out IntPtr a);
    [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr a);
    [PreserveSig] int GetProcessId(out int pid);
  }
  [Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioMeterInformation { [PreserveSig] int GetPeakValue(out float peak); }

  public static class Probe {
    static Dictionary<int, string> names = new Dictionary<int, string>();
    static string Name(int pid) {
      string n;
      if (names.TryGetValue(pid, out n)) return n;
      try { n = Process.GetProcessById(pid).ProcessName.ToLowerInvariant(); } catch { n = "pid" + pid; }
      names[pid] = n;
      return n;
    }
    public static string Sample() {
      var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
      var render = new Dictionary<string, float>();
      float capture = 0f;
      Guid iidSm = typeof(IAudioSessionManager2).GUID;
      Guid iidMeter = typeof(IAudioMeterInformation).GUID;
      IMMDeviceCollection col;
      int count;
      if (en.EnumAudioEndpoints(0, 1, out col) == 0 && col.GetCount(out count) == 0) {
        for (int i = 0; i < count; i++) {
          IMMDevice dev; object o;
          if (col.Item(i, out dev) != 0 || dev.Activate(ref iidSm, 23, IntPtr.Zero, out o) != 0) continue;
          IAudioSessionEnumerator se; int sc;
          if (((IAudioSessionManager2)o).GetSessionEnumerator(out se) != 0 || se.GetCount(out sc) != 0) continue;
          for (int j = 0; j < sc; j++) {
            IAudioSessionControl2 s; int state, pid; float peak = 0f;
            if (se.GetSession(j, out s) != 0 || s.GetState(out state) != 0 || state != 1) continue;
            s.GetProcessId(out pid);
            try { ((IAudioMeterInformation)s).GetPeakValue(out peak); } catch { }
            string n = Name(pid); float prev;
            if (!render.TryGetValue(n, out prev) || peak > prev) render[n] = peak;
          }
        }
      }
      var micUsers = new List<string>();
      if (en.EnumAudioEndpoints(1, 1, out col) == 0 && col.GetCount(out count) == 0) {
        for (int i = 0; i < count; i++) {
          IMMDevice dev; object o; float peak = 0f;
          if (col.Item(i, out dev) != 0) continue;
          if (dev.Activate(ref iidMeter, 23, IntPtr.Zero, out o) == 0) {
            ((IAudioMeterInformation)o).GetPeakValue(out peak);
            if (peak > capture) capture = peak;
          }
          // Programs with an ACTIVE capture session = using the microphone right now.
          object so; IAudioSessionEnumerator se; int sc;
          if (dev.Activate(ref iidSm, 23, IntPtr.Zero, out so) != 0) continue;
          if (((IAudioSessionManager2)so).GetSessionEnumerator(out se) != 0 || se.GetCount(out sc) != 0) continue;
          for (int j = 0; j < sc; j++) {
            IAudioSessionControl2 s; int state, pid;
            if (se.GetSession(j, out s) != 0 || s.GetState(out state) != 0 || state != 1) continue;
            s.GetProcessId(out pid);
            string n = Name(pid);
            if (pid != 0 && !micUsers.Contains(n)) micUsers.Add(n);
          }
        }
      }
      var sb = new StringBuilder("{\"capture\":");
      sb.Append(capture.ToString("0.####", CultureInfo.InvariantCulture)).Append(",\"mic\":[");
      for (int k = 0; k < micUsers.Count; k++) {
        if (k > 0) sb.Append(',');
        sb.Append('"').Append(micUsers[k].Replace("\"", "")).Append('"');
      }
      sb.Append("],\"render\":{");
      bool first = true;
      foreach (var kv in render) {
        if (!first) sb.Append(',');
        first = false;
        sb.Append('"').Append(kv.Key.Replace("\"", "")).Append("\":").Append(kv.Value.ToString("0.####", CultureInfo.InvariantCulture));
      }
      return sb.Append("}}").ToString();
    }
  }
}
'@
[Console]::Out.WriteLine('{"ready":true}')
while ($true) {
  if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit 0 }
  try { [Console]::Out.WriteLine([WtpAudio.Probe]::Sample()) } catch { [Console]::Out.WriteLine('{"error":"probe"}') }
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 1000
}
`;

/**
 * Keeps a PowerShell helper running that prints mic + per-app speaker peak
 * levels once a second. Only "when was voice last heard" is kept.
 */
export class AudioLevelProbe {
  private child: ChildProcess | null = null;
  private buffer = '';
  private lastSampleAt = 0;
  private lastCaptureVoiceAt = 0;
  private lastRenderVoiceAt = new Map<string, number>();
  private readyAt = 0;
  private restarts = 0;
  private stopped = true;
  private micUsers: string[] = [];

  start(): void {
    if (process.platform !== 'win32' || this.child) return;
    this.stopped = false;
    try {
      // Passed as -EncodedCommand, not a .ps1 file: a company "no scripts"
      // execution policy blocks script files but not commands.
      const script = AUDIO_PROBE_SCRIPT.replace('param([int]$ParentPid = 0)', `$ParentPid = ${process.pid}`);
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.child = child;
      child.stdout?.setEncoding('utf-8');
      child.stdout?.on('data', (chunk: string) => this.onData(chunk));
      child.stderr?.on('data', (d) => {
        const text = String(d).trim();
        // PowerShell's serialized progress records ("#< CLIXML <Objs...>") are noise.
        if (text && !text.startsWith('#< CLIXML') && !text.startsWith('<Objs')) {
          console.warn('[AudioLevelProbe]', text.slice(0, 300));
        }
      });
      child.on('exit', (code) => {
        this.child = null;
        if (this.stopped) return;
        console.warn(`[AudioLevelProbe] helper exited (${code}); voice check unavailable until restart`);
        if (this.restarts++ < 5) setTimeout(() => this.start(), 30_000 * this.restarts);
      });
    } catch (err) {
      console.warn('[AudioLevelProbe] could not start:', err);
    }
  }

  stop(): void {
    this.stopped = true;
    this.child?.kill();
    this.child = null;
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        const now = Date.now();
        if (msg.ready) {
          this.readyAt = now;
          console.log('[AudioLevelProbe] voice level probe ready');
          continue;
        }
        if (msg.error) continue;
        this.lastSampleAt = now;
        this.micUsers = Array.isArray(msg.mic) ? msg.mic.map((n: unknown) => String(n).toLowerCase()) : [];
        if (Number(msg.capture) >= MIC_VOICE_THRESHOLD) this.lastCaptureVoiceAt = now;
        for (const [name, peak] of Object.entries(msg.render || {})) {
          if (Number(peak) >= SPEAKER_VOICE_THRESHOLD) this.lastRenderVoiceAt.set(name, now);
        }
      } catch {
        // partial / non-JSON line
      }
    }
  }

  /**
   * Seconds since voice was last heard on the mic, or on the speaker output
   * of the program(s) holding the mic (the call app - not, say, a video
   * playing in another browser). null = probe not running / no fresh
   * samples (the classifier then trusts the mic signal alone).
   */
  secondsSinceVoice(callProcesses: string[], now: number = Date.now()): number | null {
    if (!this.readyAt || now - this.lastSampleAt > 10_000) return null;
    const callApps = new Set(callProcesses.map((p) => p.toLowerCase().replace(/\.exe$/, '')).filter(isCallAudioProcess));
    let last = Math.max(this.lastCaptureVoiceAt, this.readyAt);
    this.lastRenderVoiceAt.forEach((t, name) => {
      if (callApps.has(name)) last = Math.max(last, t);
    });
    return Math.max(0, (now - last) / 1000);
  }

  /** Last raw reading, for the diagnostics/test tool. */
  isRunning(): boolean {
    return !!this.child && !!this.readyAt;
  }

  /**
   * Programs with an active microphone capture session, straight from the
   * Windows audio engine. null = probe not running / stale (fall back to
   * the privacy-registry reader).
   */
  getMicUsers(now: number = Date.now()): string[] | null {
    if (!this.readyAt || now - this.lastSampleAt > 10_000) return null;
    return [...this.micUsers];
  }
}

// ---- input + cursor sampler --------------------------------------------------

const INPUT_BUFFER_SECONDS = 11 * 60;

/** Once a second: was there input in that second (Windows idle time reset) and where is the cursor. */
export class InputSampler {
  private timer: NodeJS.Timeout | null = null;
  readonly samples: InputSample[] = [];

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        const p = screen.getCursorScreenPoint();
        this.samples.push({ t: Date.now(), input: powerMonitor.getSystemIdleTime() === 0, x: p.x, y: p.y });
        if (this.samples.length > INPUT_BUFFER_SECONDS) this.samples.splice(0, this.samples.length - INPUT_BUFFER_SECONDS);
      } catch {
        // screen not ready
      }
    }, 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.samples.length = 0;
  }
}

// ---- screen change sampler ---------------------------------------------------

const SCREEN_INTERVAL_MS = 30_000;

/** Every 30s, a 64x36 thumbnail per screen (never saved) to know whether anything on screen changed. */
export class ScreenChangeSampler {
  private timer: NodeJS.Timeout | null = null;
  private previous: Uint8Array | null = null;
  readonly samples: ScreenSample[] = [];

  start(): void {
    if (this.timer) return;
    const run = () => void this.sample();
    this.timer = setInterval(run, SCREEN_INTERVAL_MS);
    run();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.previous = null;
    this.samples.length = 0;
  }

  private async sample(): Promise<void> {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 64, height: 36 } });
      const parts = sources.map((s) => toGrayscale(new Uint8Array(s.thumbnail.toBitmap())));
      const total = parts.reduce((n, p) => n + p.length, 0);
      const gray = new Uint8Array(total);
      let offset = 0;
      for (const p of parts) {
        gray.set(p, offset);
        offset += p.length;
      }
      if (gray.length === 0) return;
      const changed = screenChanged(this.previous, gray);
      this.previous = gray;
      this.samples.push({ t: Date.now(), changed });
      if (this.samples.length > 40) this.samples.splice(0, this.samples.length - 40);
    } catch {
      // capture not available (locked screen, no permission) - pattern check then stays neutral
    }
  }
}
