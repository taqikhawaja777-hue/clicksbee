// Run with: npm test  (compiles the Electron sources, then node --test)
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../dist-electron/activityClassifier.js');

const NOW = 1_800_000_000_000;
const NOT_SUSPICIOUS = { suspicious: false, reason: null };

function tick(overrides) {
  return {
    idleSeconds: 5,
    foreground: { dialer: null, unproductive: false },
    micProcesses: [],
    threeCxContext: false,
    secondsSinceVoice: 3,
    pattern: NOT_SUSPICIOUS,
    secondsSinceCallEnded: null,
    lastCallDialer: null,
    ...overrides,
  };
}

/** n seconds of per-second samples ending at NOW. */
function samples(n, fn) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = NOW - i * 1000;
    out.push({ t, ...fn(n - 1 - i, t) });
  }
  return out;
}
const screensUnchanged = Array.from({ length: 21 }, (_, i) => ({ t: NOW - i * 30_000, changed: false }));

test('headset call: browser holds the mic in 3CX context, no mouse/keyboard -> ON_CALL (3CX)', () => {
  const r = c.classifyTick(tick({ idleSeconds: 900, micProcesses: ['chrome'], threeCxContext: true }));
  assert.deepEqual([r.state, r.dialer], ['ON_CALL', '3CX']);
});

test('Jabber holding the mic is a call even without browser context', () => {
  const r = c.classifyTick(tick({ idleSeconds: 400, micProcesses: ['ciscojabber'] }));
  assert.deepEqual([r.state, r.dialer], ['ON_CALL', 'Cisco Jabber']);
});

test('LOOPHOLE: 3CX left in front on an empty desk -> IDLE (no more free dialer time)', () => {
  const r = c.classifyTick(tick({ idleSeconds: 300, foreground: { dialer: '3CX', unproductive: false } }));
  assert.equal(r.state, 'IDLE');
});

test('LOOPHOLE: mic left open but silent both ways for 2+ min -> not a call', () => {
  const r = c.classifyTick(tick({ idleSeconds: 600, micProcesses: ['chrome'], threeCxContext: true, secondsSinceVoice: 200 }));
  assert.equal(r.state, 'IDLE');
});

test('browser using the mic WITHOUT 3CX context (e.g. Google Meet) is not dialer time', () => {
  const r = c.classifyTick(tick({ idleSeconds: 10, micProcesses: ['chrome'], threeCxContext: false }));
  assert.equal(r.state, 'OTHER_WORK');
});

test('level probe unavailable -> mic + dialer alone still counts as a call', () => {
  const r = c.classifyTick(tick({ idleSeconds: 600, micProcesses: ['msedge'], threeCxContext: true, secondsSinceVoice: null }));
  assert.equal(r.state, 'ON_CALL');
});

test('typing in 3CX between calls -> DIALING', () => {
  const r = c.classifyTick(tick({ foreground: { dialer: '3CX', unproductive: false } }));
  assert.deepEqual([r.state, r.dialer], ['DIALING', '3CX']);
});

test('notes in the CRM right after a call -> DIALING (after-call work), later -> OTHER_WORK', () => {
  const soon = c.classifyTick(tick({ secondsSinceCallEnded: 40, lastCallDialer: '3CX' }));
  assert.deepEqual([soon.state, soon.dialer], ['DIALING', '3CX']);
  const later = c.classifyTick(tick({ secondsSinceCallEnded: 300, lastCallDialer: '3CX' }));
  assert.equal(later.state, 'OTHER_WORK');
});

test('YouTube in front with real input -> UNPRODUCTIVE, even right after a call', () => {
  const r = c.classifyTick(tick({ foreground: { dialer: null, unproductive: true }, secondsSinceCallEnded: 30, lastCallDialer: '3CX' }));
  assert.equal(r.state, 'UNPRODUCTIVE');
});

test('LOOPHOLE: jiggler pattern -> SUSPICIOUS even though input keeps the PC awake', () => {
  const r = c.classifyTick(tick({ pattern: { suspicious: true, reason: 'x' } }));
  assert.equal(r.state, 'SUSPICIOUS');
});

test('pattern: tiny mouse jiggle for 10 min, nothing changes -> suspicious', () => {
  const s = samples(600, (i) => ({ input: i % 20 === 0, x: 500 + (i % 40 < 20 ? 0 : 2), y: 300 }));
  const r = c.analyzeInputPattern(s, screensUnchanged, [], NOW);
  assert.equal(r.suspicious, true);
  assert.match(r.reason, /jiggling/);
});

test('pattern: zero-move auto key-press every 30s -> suspicious', () => {
  const s = samples(600, (i) => ({ input: i % 30 === 0, x: 800, y: 450 }));
  const r = c.analyzeInputPattern(s, screensUnchanged, [], NOW);
  assert.equal(r.suspicious, true);
  assert.match(r.reason, /Automatic input/);
});

test('pattern: real work (screen changes) is never flagged', () => {
  const s = samples(600, (i) => ({ input: i % 3 === 0, x: 100 + (i * 7) % 900, y: 200 + (i * 3) % 500 }));
  const screens = screensUnchanged.map((x, i) => ({ ...x, changed: i % 4 === 0 }));
  assert.equal(c.analyzeInputPattern(s, screens, [], NOW).suspicious, false);
});

test('pattern: switching windows is never flagged', () => {
  const s = samples(600, (i) => ({ input: i % 20 === 0, x: 500 + (i % 2), y: 300 }));
  assert.equal(c.analyzeInputPattern(s, screensUnchanged, [NOW - 120_000], NOW).suspicious, false);
});

test('pattern: needs the full 10 minutes observed before judging', () => {
  const s = samples(200, (i) => ({ input: i % 20 === 0, x: 500 + (i % 2), y: 300 }));
  assert.equal(c.analyzeInputPattern(s, screensUnchanged, [], NOW).suspicious, false);
});

test('registry: only apps with Start > 0 and Stop = 0 are using the mic', () => {
  const out = [
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone',
    '    Value    REG_SZ    Allow',
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\5319275A.WhatsAppDesktop_cv1g1gvanyjgm',
    '    LastUsedTimeStart    REG_QWORD    0x1dce5e7852ea128',
    '    LastUsedTimeStop    REG_QWORD    0x1dce5e78911d353',
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged',
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged\\C:#Program Files#Google#Chrome#Application#chrome.exe',
    '    LastUsedTimeStart    REG_QWORD    0x1dce5e7852ea128',
    '    LastUsedTimeStop    REG_QWORD    0x0',
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged\\C:#Program Files#Microsoft#Edge#msedge.exe',
    '    LastUsedTimeStart    REG_QWORD    0x0',
    '    LastUsedTimeStop    REG_QWORD    0x0',
  ].join('\r\n');
  assert.deepEqual(c.parseMicrophoneRegistry(out), ['chrome']);
});

test('unproductive keyword match on title or process', () => {
  assert.equal(c.isUnproductiveWindow('Funny cats - YouTube - Google Chrome', 'chrome.exe', c.DEFAULT_UNPRODUCTIVE_KEYWORDS), true);
  assert.equal(c.isUnproductiveWindow('3CX Webclient - Google Chrome', 'chrome.exe', c.DEFAULT_UNPRODUCTIVE_KEYWORDS), false);
});

test('screen change threshold ignores a few changed pixels (clock) but catches real changes', () => {
  const a = new Uint8Array(64 * 36).fill(100);
  const clock = Uint8Array.from(a); for (let i = 0; i < 10; i++) clock[i] = 200;
  const page = Uint8Array.from(a); for (let i = 0; i < 300; i++) page[i] = 220;
  assert.equal(c.screenChanged(a, clock), false);
  assert.equal(c.screenChanged(a, page), true);
});

test('spreadsheet windows: Excel, Google Sheets, LibreOffice Calc, WPS - not other apps', () => {
  assert.equal(c.isSpreadsheetWindow('Leads March.xlsx - Excel', 'Microsoft Excel'), true);
  assert.equal(c.isSpreadsheetWindow('Book1', 'EXCEL.EXE'), true);
  assert.equal(c.isSpreadsheetWindow('Call list - Google Sheets - Google Chrome', 'Google Chrome'), true);
  assert.equal(c.isSpreadsheetWindow('Untitled 1 - LibreOffice Calc', 'soffice.bin'), true);
  assert.equal(c.isSpreadsheetWindow('Report.docx - Word', 'Microsoft Word'), false);
  assert.equal(c.isSpreadsheetWindow('data.csv - Notepad', 'Notepad'), false);
  assert.equal(c.isSpreadsheetWindow('Untitled 1 - LibreOffice Writer', 'soffice.bin'), false);
  assert.equal(c.isSpreadsheetWindow('Excel formulas tutorial - YouTube - Google Chrome', 'Google Chrome'), false);
});
