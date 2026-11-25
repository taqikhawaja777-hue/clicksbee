/**
 * Pure decision logic for "what was the employee really doing" - no Electron
 * imports, so it is unit-tested directly (tests/activityClassifier.test.cjs).
 *
 * Every poll is classified from several independent signals instead of
 * "any mouse/keyboard input in the last 2 minutes = active":
 *   - microphone in use, and by which process (Windows' own record)
 *   - voice level on the mic / the call app's speaker output (loudness only)
 *   - the window in front (dialer / unproductive / anything else)
 *   - the input pattern (real work vs. a mouse jiggler / auto-input)
 *   - whether anything on screen changed
 * Faking one signal (wiggling the mouse, leaving 3CX open) no longer earns
 * active or dialer time.
 */

export type ActivityState = 'ON_CALL' | 'DIALING' | 'OTHER_WORK' | 'UNPRODUCTIVE' | 'IDLE' | 'SUSPICIOUS';
export type DialerLabel = 'Cisco Jabber' | '3CX' | 'Yeastar Linkus Lite';

export const IDLE_THRESHOLD_SECONDS = 120;
/** Typing notes / dialing the next number right after a call still counts as call work. */
export const AFTER_CALL_WORK_SECONDS = 90;
/** Mic off-and-on again within this gap is the same call (transfer, re-dial of the same line). */
export const CALL_MERGE_GAP_SECONDS = 20;
/** A browser using the mic counts as a 3CX call only if 3CX was in front this recently. */
export const DIALER_CONTEXT_SECONDS = 15 * 60;
/** Mic open but no voice either way for this long = not a real call (mic left open). */
export const SILENT_CALL_SECONDS = 120;
/** "No call for 15 minutes" alert during working time. */
export const NO_CALL_ALERT_SECONDS = 15 * 60;
/** Window the input-pattern check looks back over. */
export const PATTERN_WINDOW_SECONDS = 10 * 60;
/**
 * Peak level (0-1) above which sound counts as voice. Measured on a laptop:
 * idle mic reads 0, an open mic in a quiet room ~0.06 typical (speaker
 * bleed + room), normal speech 0.1+. The call app's own speaker output
 * (the caller's voice / ringback) is clean, so a lower bar works there.
 */
export const MIC_VOICE_THRESHOLD = 0.05;
export const SPEAKER_VOICE_THRESHOLD = 0.02;

/** Default list, used until a manager saves their own in Settings. */
export const DEFAULT_UNPRODUCTIVE_KEYWORDS = [
  'youtube', 'netflix', 'facebook', 'instagram', 'tiktok', 'snapchat', 'twitter', 'reddit',
  'prime video', 'hotstar', 'dailymotion', 'twitch', 'spotify', 'steam', 'epic games',
  'roblox', 'minecraft', 'pubg', 'free fire', 'solitaire', 'candy crush',
];

const BROWSER_PROCESS = /^(chrome|msedge|firefox|brave|opera|opera_gx|vivaldi|iexplore)$/i;
const DIALER_PROCESS: Array<[DialerLabel, RegExp]> = [
  ['Cisco Jabber', /^(ciscojabber|jabber|ciscocollabhost)$/i],
  ['3CX', /^(3cxdesktopapp|3cxwin8phone|3cx.*)$/i],
  ['Yeastar Linkus Lite', /^(linkus.*|yeastar.*)$/i],
];

/** Which dialer a process using the mic belongs to. A browser counts only in 3CX context. */
export function dialerForMicProcess(processName: string, threeCxContext: boolean): DialerLabel | null {
  const name = processName.toLowerCase().replace(/\.exe$/, '');
  for (const [label, re] of DIALER_PROCESS) if (re.test(name)) return label;
  if (BROWSER_PROCESS.test(name) && threeCxContext) return '3CX';
  return null;
}

/** Process names that matter for the speaker-voice check of a call. */
export function isCallAudioProcess(processName: string): boolean {
  const name = processName.toLowerCase().replace(/\.exe$/, '');
  return BROWSER_PROCESS.test(name) || DIALER_PROCESS.some(([, re]) => re.test(name));
}

// Spreadsheet apps: Excel (desktop or online), Google Sheets, LibreOffice Calc, WPS.
const SPREADSHEET_OWNERS = /^(excel(\.exe)?|microsoft excel|scalc(\.exe)?|et(\.exe)?|wps spreadsheets)$/i;
const SPREADSHEET_TITLES = /( - excel$|excel online| - google sheets|libreoffice calc|wps spreadsheets)/i;

/** True when the window in front is a spreadsheet (Excel, Google Sheets, LibreOffice Calc, WPS). */
export function isSpreadsheetWindow(title: string, owner: string): boolean {
  return SPREADSHEET_OWNERS.test((owner || '').trim()) || SPREADSHEET_TITLES.test((title || '').trim());
}

/** Spreadsheet time needs real use: mouse or keyboard within this many seconds. */
export const SPREADSHEET_INPUT_SECONDS = 60;

export function isUnproductiveWindow(title: string, owner: string, keywords: string[]): boolean {
  const haystack = `${title || ''} ${owner || ''}`.toLowerCase();
  return keywords.some((k) => k && haystack.includes(k.toLowerCase()));
}

/**
 * Parses `reg query HKCU\...\CapabilityAccessManager\ConsentStore\microphone /s`.
 * An app is using the mic right now when LastUsedTimeStart > 0 and
 * LastUsedTimeStop is 0. Returns lower-case process names without ".exe"
 * (packaged Store apps keep their package name).
 */
export function parseMicrophoneRegistry(output: string): string[] {
  const inUse = new Set<string>();
  let current: { name: string; start: bigint; stop: bigint | null } | null = null;
  const flush = () => {
    if (current && current.start > BigInt(0) && current.stop === BigInt(0)) inUse.add(current.name);
    current = null;
  };
  for (const raw of (output || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (/^HKEY_/i.test(line)) {
      flush();
      const leaf = line.split('\\').pop() || '';
      if (/^(microphone|NonPackaged)$/i.test(leaf)) continue;
      const exe = leaf.includes('#') ? leaf.split('#').pop() || leaf : leaf;
      current = { name: exe.toLowerCase().replace(/\.exe$/, ''), start: BigInt(0), stop: null };
      continue;
    }
    if (!current) continue;
    const m = /^(LastUsedTimeStart|LastUsedTimeStop)\s+REG_QWORD\s+(0x[0-9a-f]+)/i.exec(line);
    if (m) {
      const value = BigInt(m[2]);
      if (/start/i.test(m[1])) current.start = value;
      else current.stop = value;
    }
  }
  flush();
  return [...inUse];
}

// ---- input pattern (mouse jiggler / auto-input detection) -----------------

/** One per second: did any input happen in that second, and where was the cursor. */
export interface InputSample {
  t: number; // ms epoch
  input: boolean;
  x: number;
  y: number;
}

/** One per screen check: did the (tiny) screen thumbnail change since the previous check. */
export interface ScreenSample {
  t: number;
  changed: boolean;
}

export interface PatternResult {
  suspicious: boolean;
  reason: string | null;
}

const NOT_SUSPICIOUS: PatternResult = { suspicious: false, reason: null };

/**
 * Looks at the last PATTERN_WINDOW_SECONDS. Flags only when NOTHING real
 * happened: no window/title change, nothing on screen changed, yet input
 * kept the PC "awake". Real work (typing, clicking through apps, scrolling)
 * always changes the screen or the window, so it is never flagged.
 */
export function analyzeInputPattern(
  samples: InputSample[],
  screens: ScreenSample[],
  foregroundChangeTimes: number[],
  now: number,
  windowSeconds: number = PATTERN_WINDOW_SECONDS,
): PatternResult {
  const from = now - windowSeconds * 1000;
  const recent = samples.filter((s) => s.t >= from && s.t <= now);
  // Need (nearly) the whole window observed before judging.
  if (recent.length < windowSeconds * 0.9 || recent[0].t > from + windowSeconds * 100) return NOT_SUSPICIOUS;

  const screenRecent = screens.filter((s) => s.t >= from && s.t <= now);
  if (screenRecent.length < Math.floor(windowSeconds / 60)) return NOT_SUSPICIOUS; // screen checks unavailable
  if (screenRecent.some((s) => s.changed)) return NOT_SUSPICIOUS;
  if (foregroundChangeTimes.some((t) => t >= from && t <= now)) return NOT_SUSPICIOUS;

  let moveInputs = 0;
  let stillInputs = 0;
  const stillTimes: number[] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < recent.length; i++) {
    const s = recent[i];
    minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
    minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
    if (!s.input) continue;
    const prev = recent[i - 1];
    const moved = prev ? Math.abs(s.x - prev.x) + Math.abs(s.y - prev.y) > 0 : false;
    if (moved) moveInputs++;
    else {
      stillInputs++;
      stillTimes.push(s.t);
    }
  }

  // Mouse moving (any size) but no click/key and nothing changes anywhere.
  if (moveInputs >= 20 && stillInputs <= 2) {
    const tiny = maxX - minX <= 30 && maxY - minY <= 30;
    return {
      suspicious: true,
      reason: tiny
        ? 'Mouse jiggling: only tiny cursor movements for 10 minutes, nothing else changed'
        : 'Mouse moving for 10 minutes while nothing on screen changed',
    };
  }

  // Input with the cursor perfectly still, at regular intervals (zero-move jiggler / key-presser).
  if (stillInputs >= 8 && moveInputs === 0 && maxX === minX && maxY === minY) {
    const gaps = stillTimes.slice(1).map((t, i) => (t - stillTimes[i]) / 1000);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
    if (mean >= 5 && sd / mean < 0.15) {
      return { suspicious: true, reason: `Automatic input every ~${Math.round(mean)}s with nothing on screen changing` };
    }
  }
  return NOT_SUSPICIOUS;
}

// ---- one poll -> one state -------------------------------------------------

export interface TickInput {
  /** Seconds since the last mouse/keyboard input (Windows). */
  idleSeconds: number;
  /** Dialer in front (null if none) and whether the window in front is on the unproductive list. */
  foreground: { dialer: DialerLabel | null; unproductive: boolean };
  /** Processes using the microphone right now. */
  micProcesses: string[];
  /** 3CX window was in front within DIALER_CONTEXT_SECONDS. */
  threeCxContext: boolean;
  /** Seconds since voice was last heard on the mic or the call app's speaker; null = level probe unavailable. */
  secondsSinceVoice: number | null;
  pattern: PatternResult;
  /** Seconds since the last call ended (null = no call yet / break reset). */
  secondsSinceCallEnded: number | null;
  lastCallDialer: DialerLabel | null;
}

export interface TickResult {
  state: ActivityState;
  /** Dialer the time is credited to (ON_CALL / DIALING). */
  dialer: DialerLabel | null;
  reason?: string | null;
}

export function classifyTick(t: TickInput): TickResult {
  // 1. A real call: dialer holds the mic AND there is voice (unless the level probe is unavailable).
  const callDialer = t.micProcesses.map((p) => dialerForMicProcess(p, t.threeCxContext)).find((d) => !!d) || null;
  if (callDialer) {
    const silent = t.secondsSinceVoice !== null && t.secondsSinceVoice >= SILENT_CALL_SECONDS;
    if (!silent) return { state: 'ON_CALL', dialer: callDialer };
  }

  // 2. No input at all -> idle, whatever is in front (3CX open on an empty desk included).
  if (t.idleSeconds >= IDLE_THRESHOLD_SECONDS) return { state: 'IDLE', dialer: null };

  // 3. Input, but fake (jiggler / auto-input / frozen screen) -> counted as idle, flagged.
  if (t.pattern.suspicious) return { state: 'SUSPICIOUS', dialer: null, reason: t.pattern.reason };

  // 4. Real input in the dialer (dialing the next number), or right after a call (notes).
  if (t.foreground.dialer) return { state: 'DIALING', dialer: t.foreground.dialer };
  if (
    t.secondsSinceCallEnded !== null &&
    t.secondsSinceCallEnded <= AFTER_CALL_WORK_SECONDS &&
    !t.foreground.unproductive &&
    t.lastCallDialer
  ) {
    return { state: 'DIALING', dialer: t.lastCallDialer };
  }

  // 5. Everything else with real input.
  if (t.foreground.unproductive) return { state: 'UNPRODUCTIVE', dialer: null };
  return { state: 'OTHER_WORK', dialer: null };
}

/** States that count as active time / idle time in reports (UNPRODUCTIVE is neither). */
export const ACTIVE_STATES: ActivityState[] = ['ON_CALL', 'DIALING', 'OTHER_WORK'];
export const IDLE_STATES: ActivityState[] = ['IDLE', 'SUSPICIOUS'];

// ---- screen thumbnail comparison --------------------------------------------

/** BGRA bitmap -> grayscale bytes. */
export function toGrayscale(bgra: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.floor(bgra.length / 4));
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    out[p] = (bgra[i] * 29 + bgra[i + 1] * 150 + bgra[i + 2] * 77) >> 8;
  }
  return out;
}

/** Changed = more than 1% of pixels differ noticeably (a ticking taskbar clock alone stays below that). */
export function screenChanged(prev: Uint8Array | null, next: Uint8Array): boolean {
  if (!prev || prev.length !== next.length) return true;
  let differing = 0;
  for (let i = 0; i < next.length; i++) if (Math.abs(next[i] - prev[i]) > 16) differing++;
  return differing / next.length > 0.01;
}
