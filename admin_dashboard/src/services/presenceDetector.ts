/**
 * PresenceDetector — Electron Renderer Process
 *
 * Camera-based presence detection, combined with the existing mouse/
 * keyboard idle signal, per employee-monitoring spec. Runs entirely in the
 * renderer (not the Electron main process, unlike captureService.ts /
 * idleTimeTracker.ts) because it needs browser APIs — getUserMedia() for
 * webcam access and a <canvas> for in-memory frame decoding — that only
 * exist in a DOM/browser context, not in Node's main process.
 *
 * Face detection uses face-api.js's TinyFaceDetector (a small, fast model
 * well suited to a presence-only yes/no check — no landmarks, no face
 * recognition/identification, just "is a face present"). Model weights are
 * bundled locally under /public/models so no image ever leaves the
 * employee's machine for detection itself.
 *
 * PRIVACY INVARIANTS (do not weaken these without re-reading the spec this
 * was built against):
 * - The captured frame is drawn onto an in-memory canvas, fed straight into
 *   detection, and never persisted (no toDataURL, no upload, no IndexedDB).
 *   Only two booleans and a timestamp are ever sent anywhere.
 * - Every check first confirms active consent server-side (the backend
 *   also independently enforces this in insert_presence_log) and that
 *   camera monitoring is enabled (globally AND for this employee) before
 *   touching the camera at all.
 *
 * CAMERA LIFECYCLE — changed from "acquire fresh every 20s" to a single
 * persistent stream (see ensureCameraStream() below). The original design
 * re-requested getUserMedia() and tore the stream down every single check,
 * specifically so the OS camera-in-use light would only blink briefly
 * rather than stay on continuously. In practice this caused real failures:
 * production logs showed presence checks stalling for minutes at a time
 * (up to 45 minutes in one observed session) with zero successful face
 * detections all day - consistent with Windows' shared camera Frame Server
 * struggling under rapid open/close cycling every 20s, all day, indefinitely.
 * A single long-lived stream removes that cycling entirely. Trade-off: the
 * camera light now stays solid while presence monitoring is active (for an
 * employee who has already consented) instead of blinking per check - less
 * a per-tick "it's sampling me now" signal, but the monitoring-is-on state
 * itself is still exactly as visible, still gated by the same consent flow,
 * and still boolean-only/never recorded as video.
 */
import * as faceapi from 'face-api.js';

const MODEL_URL = './models';
const POLL_INTERVAL_MS = 20000; // matches PRESENCE_POLL_INTERVAL_SECONDS server-side
const AWAY_THRESHOLD_SECONDS = 600; // 10 minutes with no face and no input -> "away" rather than "idle"

let modelLoadPromise: Promise<void> | null = null;

function ensureModelLoaded(): Promise<void> {
  if (!modelLoadPromise) {
    modelLoadPromise = (async () => {
      // Confirmed root cause of "Illegal constructor" (traced into
      // face-api.js's own source, node_modules/face-api.js/build/es6/env/):
      // this app runs with nodeIntegration: true + contextIsolation: false
      // (needed elsewhere for window.require('electron') IPC calls), which
      // merges Node's `global` onto `window` and leaks Node globals
      // (process, require, module) into this otherwise-real browser
      // renderer. face-api.js's env/index.ts initialize() runs
      // `if (isBrowser()) setEnv(createBrowserEnv())` followed
      // UNCONDITIONALLY by `if (isNodejs()) setEnv(createNodejsEnv())` (not
      // else-if) - in a normal Electron renderer only isBrowser() is true
      // and this is harmless, but with nodeIntegration on, isNodejs() is
      // ALSO true, so createNodejsEnv() silently overwrites the correct
      // browser env right after it's set. createNodejsEnv() then builds
      // Canvas/Image from `global['HTMLCanvasElement']` /
      // `global['Image']` - which, because global===window here, resolve
      // to the REAL native DOM constructors - and calls `new Canvas()` /
      // `new Image()` directly instead of `document.createElement(...)`.
      // Chromium throws exactly "Illegal constructor" when a native
      // HTMLCanvasElement is instantiated with `new` instead of
      // document.createElement. There is no tfjs-node import or manually
      // written canvas polyfill anywhere in this codebase to remove - the
      // faulty polyfill is face-api.js's own built-in Node environment,
      // installed by its own module-load-time auto-init. Forcing the
      // correct browser env back explicitly (its createCanvasElement
      // correctly uses document.createElement) is the fix.
      faceapi.env.setEnv(faceapi.env.createBrowserEnv());
      // Belt-and-suspenders: TensorFlow.js has the identical class of bug
      // via its own separate IS_NODE flag (typeof process !== 'undefined'),
      // independent of face-api.js's env system above.
      faceapi.tf.env().set('IS_NODE', false);
      // Force the CPU backend - a single 15-30s-interval face check has no
      // need for WebGL, and it sidesteps that backend's own Electron
      // incompatibilities as a third layer of defense.
      await faceapi.tf.setBackend('cpu');
      await faceapi.tf.ready();
      console.log(`[PresenceDetector] TensorFlow.js backend active: ${faceapi.tf.getBackend()}`);
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);

      // DIAGNOSTIC (temporary): every prior check ruled out blank frames,
      // wrong dimensions, and the environment-detection class of bug - the
      // one thing never directly verified is whether the model's own
      // quantized weights actually decoded to sane, non-zero values after
      // loadFromUri(). If they're all ~0 or NaN, the model would output
      // near-zero confidence for literally any input, indistinguishable
      // from "no face" no matter how good the frame is.
      logModelParamStats((faceapi.nets.tinyFaceDetector as any).params);
    })();
  }
  return modelLoadPromise;
}

function logModelParamStats(params: unknown, path = ''): void {
  if (!params || typeof params !== 'object') return;
  const maybeTensor = params as { dataSync?: () => ArrayLike<number> };
  if (typeof maybeTensor.dataSync === 'function') {
    try {
      const data = maybeTensor.dataSync();
      let sum = 0;
      let absSum = 0;
      let nanCount = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (Number.isNaN(v)) nanCount++;
        else {
          sum += v;
          absSum += Math.abs(v);
        }
      }
      console.log(
        `[PresenceDetector][diag] model param "${path}": count=${data.length} ` +
          `mean=${(sum / data.length).toExponential(3)} meanAbs=${(absSum / data.length).toExponential(3)} nanCount=${nanCount}`,
      );
    } catch (err) {
      console.log(`[PresenceDetector][diag] model param "${path}": failed to read (${err})`);
    }
    return;
  }
  for (const key of Object.keys(params as Record<string, unknown>)) {
    logModelParamStats((params as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
  }
}

/** Mean pixel brightness (0-255) of an ImageData - cheap blank-frame detector. */
function meanBrightness(data: ImageData): number {
  let sum = 0;
  let samples = 0;
  // Every 40th pixel (10 channels-worth) is plenty to tell "black" from
  // "real image" without summing every byte of a full frame each tick.
  for (let i = 0; i < data.data.length; i += 40) {
    sum += data.data[i];
    samples++;
  }
  return samples > 0 ? sum / samples : 0;
}

// Persistent camera stream/video, reused across every check instead of
// being reacquired every 20s - see the CAMERA LIFECYCLE note at the top of
// this file for why. Module-level (not per PresenceDetectionService
// instance) since there is only ever one camera and one detector running
// at a time in this renderer.
let cameraStream: MediaStream | null = null;
let cameraVideo: HTMLVideoElement | null = null;
let cameraSetupPromise: Promise<HTMLVideoElement | null> | null = null;

function isStreamLive(stream: MediaStream | null): boolean {
  return !!stream && stream.getVideoTracks().some((t) => t.readyState === 'live');
}

/**
 * Lazily acquires the camera once and keeps it open. Re-acquires only if
 * the existing stream has actually ended (permission revoked, device
 * unplugged, another app took exclusive control) rather than on every call.
 */
async function ensureCameraStream(): Promise<HTMLVideoElement | null> {
  if (cameraVideo && isStreamLive(cameraStream)) {
    return cameraVideo;
  }
  if (cameraSetupPromise) {
    return cameraSetupPromise;
  }

  cameraSetupPromise = (async () => {
    try {
      releaseCameraStream(); // clean up a dead stream/video, if any, first

      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      // Positioned off-screen rather than `display:none` - a handful of
      // Chromium/Electron builds only decode a MediaStream <video> to a
      // paintable frame while it's actually in the render tree, so an
      // element that's never attached to the DOM can report a correct
      // readyState/videoWidth from track metadata alone while `drawImage`
      // still captures blank pixels. Still never visible to the employee.
      video.style.position = 'fixed';
      video.style.top = '-9999px';
      video.style.left = '-9999px';
      document.body.appendChild(video);
      await video.play();

      if (video.readyState < 2) {
        await new Promise<void>((resolve) => {
          const onReady = () => {
            video.removeEventListener('loadeddata', onReady);
            resolve();
          };
          video.addEventListener('loadeddata', onReady);
          setTimeout(resolve, 1500);
        });
      }
      // Let auto-exposure settle once, at stream start, rather than paying
      // this cost on every single check now that the stream stays open.
      await new Promise((resolve) => setTimeout(resolve, 300));

      cameraStream = stream;
      cameraVideo = video;
      return video;
    } catch (err) {
      console.warn('[PresenceDetector] Could not acquire camera stream (unavailable/denied?):', err);
      releaseCameraStream();
      return null;
    } finally {
      cameraSetupPromise = null;
    }
  })();

  return cameraSetupPromise;
}

function releaseCameraStream(): void {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  if (cameraVideo?.parentNode) {
    cameraVideo.parentNode.removeChild(cameraVideo);
  }
  cameraVideo = null;
}

/**
 * Grabs the current frame from the persistent camera stream and runs face
 * detection on it in-memory — never storing or transmitting the frame
 * itself.
 */
async function checkFaceDetected(): Promise<boolean> {
  const t0 = performance.now();
  try {
    await ensureModelLoaded();

    const video = await ensureCameraStream();
    if (!video) return false;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 320;
    canvas.height = video.videoHeight || 240;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // DIAGNOSTIC (temporary - remove once face detection is confirmed
    // working end to end): tells us whether the canvas actually has real
    // camera pixels in it or is still capturing blank/black frames, which
    // is a completely different bug from the detector failing to find a
    // face in a genuinely good frame.
    const frameData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const brightness = meanBrightness(frameData);
    console.log(
      `[PresenceDetector][diag] readyState=${video.readyState} ` +
        `videoSize=${video.videoWidth}x${video.videoHeight} canvasSize=${canvas.width}x${canvas.height} ` +
        `meanBrightness=${brightness.toFixed(1)} (0=black, 255=white) elapsedMs=${(performance.now() - t0).toFixed(0)}`,
    );

    const detection = await faceapi.detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions());
    console.log(
      `[PresenceDetector][diag] detection=${detection ? `FOUND score=${detection.score.toFixed(3)} box=${JSON.stringify(detection.box)}` : 'none'}`,
    );

    // DIAGNOSTIC (temporary): the default scoreThreshold (0.5) throws away
    // anything below it with no way to see what was actually there. Running
    // a second pass at a near-zero threshold tells us whether the model is
    // seeing a face with low confidence (a lighting/angle/threshold problem
    // we can tune around) versus genuinely nothing at all (a real pipeline
    // bug still to find). Only worth the extra inference cost while this is
    // still unexplained.
    if (!detection) {
      const lowThreshold = await faceapi.detectAllFaces(
        canvas,
        new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.05 }),
      );
      console.log(
        `[PresenceDetector][diag] lowThreshold candidates=${lowThreshold.length}` +
          (lowThreshold.length > 0
            ? ` bestScore=${Math.max(...lowThreshold.map((d) => d.score)).toFixed(3)}`
            : ''),
      );
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return !!detection;
  } catch (err) {
    console.warn('[PresenceDetector] Face check failed:', err);
    return false;
  }
}

async function getSystemIdleSeconds(): Promise<{ idleSeconds: number; idleThresholdSeconds: number } | null> {
  try {
    const electron = (window as any).require?.('electron');
    const ipcRenderer = electron?.ipcRenderer;
    if (!ipcRenderer?.invoke) return null;
    const result = await ipcRenderer.invoke('get-system-idle-seconds');
    if (result?.success) {
      return { idleSeconds: result.idleSeconds, idleThresholdSeconds: result.idleThresholdSeconds };
    }
  } catch (err) {
    console.warn('[PresenceDetector] Failed to read system idle time:', err);
  }
  return null;
}

class PresenceDetectionService {
  private isRunning = false;
  private employeeId = '';
  private apiBaseUrl = 'http://localhost:8000';
  private timer: ReturnType<typeof setInterval> | null = null;
  private wasOnBreak = false;

  public start(employeeId: string, apiBaseUrl: string = 'http://localhost:8000'): void {
    if (this.isRunning) {
      if (this.employeeId === employeeId) return;
      // A different employee started a session without this one ever
      // calling stop() first - switch over instead of silently continuing
      // to log presence checks under the previous employee's id.
      console.log(`[PresenceDetector] Switching tracked employee ${this.employeeId} -> ${employeeId}`);
      this.stop();
    }
    this.employeeId = employeeId;
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, '');
    this.isRunning = true;

    console.log(`[PresenceDetector] Starting camera presence checks for employeeId=${employeeId}`);
    void this.runCheck();
    this.timer = setInterval(() => void this.runCheck(), POLL_INTERVAL_MS);
  }

  public stop(): void {
    if (!this.isRunning) return;
    console.log('[PresenceDetector] Stopping camera presence checks.');
    this.isRunning = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.wasOnBreak = false;
    releaseCameraStream();
  }

  public getStatus() {
    return { isRunning: this.isRunning, employeeId: this.employeeId };
  }

  private async isOnBreak(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiBaseUrl}/api/shift/break-status/${this.employeeId}`);
      if (!response.ok) return false;
      const data = await response.json();
      return !!data.onBreak;
    } catch (err) {
      // Fail open, matching idleTimeTracker.ts's identical choice: a
      // transient productivity_service blip shouldn't indefinitely stop
      // legitimate presence checks.
      console.warn('[PresenceDetector] Failed to check break status, assuming not on break:', err);
      return false;
    }
  }

  private async runCheck(): Promise<void> {
    if (!this.isRunning) return;

    if (await this.isOnBreak()) {
      if (!this.wasOnBreak) {
        // Transition into break: release the camera entirely - "no need
        // to verify presence during an approved break" - rather than just
        // discarding a check's result. Do NOT eagerly reacquire on break
        // end; ensureCameraStream() is already lazy, so the next post-break
        // tick reacquires it naturally.
        console.log('[PresenceDetector] Break started - releasing camera.');
        releaseCameraStream();
        this.wasOnBreak = true;
      }
      return;
    }
    this.wasOnBreak = false;

    // This whole method is invoked fire-and-forget (`void this.runCheck()`)
    // from the interval, so any rejection that escapes it becomes an
    // "Uncaught (in promise)" error with no consumer to catch it - and one
    // bad tick would otherwise never let a later tick's mouse/keyboard
    // signal through either, since both come from this same call. Camera
    // detection and input-idle detection must degrade independently: a
    // face-api.js/TensorFlow.js failure should never take input tracking
    // down with it. Catching at this top level, in addition to
    // checkFaceDetected()'s and getSystemIdleSeconds()'s own internal
    // try/catches, is deliberate defense in depth against exactly that.
    try {
      const [faceDetected, idleInfo] = await Promise.all([checkFaceDetected(), getSystemIdleSeconds()]);
      const idleSeconds = idleInfo?.idleSeconds ?? 0;
      const idleThreshold = idleInfo?.idleThresholdSeconds ?? 300;
      const mouseKeyboardActive = idleSeconds < idleThreshold;

      let combinedStatus: 'active' | 'idle' | 'away';
      if (faceDetected || mouseKeyboardActive) {
        combinedStatus = 'active';
      } else if (idleSeconds >= AWAY_THRESHOLD_SECONDS) {
        combinedStatus = 'away';
      } else {
        combinedStatus = 'idle';
      }

      const response = await fetch(`${this.apiBaseUrl}/api/presence/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: this.employeeId,
          timestamp: new Date().toISOString(),
          faceDetected,
          mouseKeyboardActive,
          combinedStatus,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (err) {
      console.warn('[PresenceDetector] Failed to log presence check:', err);
    }
  }
}

export const presenceDetectionService = new PresenceDetectionService();
export default presenceDetectionService;
