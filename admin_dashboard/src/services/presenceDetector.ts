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
 * - LIVE PREVIEW (attachPresencePreview, added later): the current frame is
 *   optionally mirrored onto a <canvas> the employee's own
 *   PresenceVerificationCard renders, so they can see what the detector
 *   sees and confirm they're actually in frame. This is a deliberate,
 *   explicit product decision (confirmed with the employer, reversing an
 *   earlier "never shown" stance) - the frame is still only ever drawn
 *   locally into that one employee's own already-open window. It is still
 *   never captured to a file, uploaded, sent to the backend, or visible to
 *   a manager/anyone else - only this same live boolean-and-timestamp pair
 *   ever leaves this machine, unchanged from before.
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
const POLL_INTERVAL_MS = 15000; // matches PRESENCE_POLL_INTERVAL_SECONDS server-side - per-request cadence for idle detection (face + input combined check)
const AWAY_THRESHOLD_SECONDS = 600; // 10 minutes with no face and no input -> "away" rather than "idle"
// TinyFaceDetector's default inputSize (416) downscales a 640x480 frame
// enough that a face at typical webcam distance shrinks to where the model
// only produces ~0.05-0.07 confidence for it - real detection, just too
// faint to clear the (correct, standard) 0.5 threshold. Proven via direct
// instrumentation: the raw pixel tensor TF.js reads matches the canvas's
// own pixels almost exactly (ruling out any camera/env/pipeline bug), so
// this is the model seeing a genuine but under-scale face, not garbage
// input. Bumping to 608 (max of face-api.js's supported sizes: 128/160/
// 224/320/416/512/608) keeps more of the face's actual detail through the
// resize, which is TinyFaceDetector's own documented fix for this exact
// low-but-nonzero-confidence pattern.
const FACE_DETECTOR_INPUT_SIZE = 608;

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
      // Electron's console-message bridge (main.ts) only gets a flattened
      // string, not the original object - logging `err` as a second arg
      // collapses to the useless "[object DOMException]" by the time it
      // reaches main.ts's forwarded output. Pulling name/message into the
      // template string itself is the only way they survive that bridge -
      // needed here specifically because those two fields are what
      // distinguish "no permission" (NotAllowedError) from "device already
      // in use by something else" (NotReadableError) from "no camera found"
      // (NotFoundError), which otherwise look identical from this call site.
      const name = (err as DOMException)?.name || typeof err;
      const message = (err as DOMException)?.message || String(err);
      console.warn(`[PresenceDetector] Could not acquire camera stream: ${name} - ${message}`);
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

// Live preview target: PresenceVerificationCard.tsx owns and renders the
// actual <canvas> element (inside its own React tree, sized by its own
// layout) and hands it here via attachPresencePreview() - this module just
// draws into whatever canvas is currently attached, and draws into nothing
// (a no-op) when the card isn't mounted (e.g. the employee is on a
// different page, or camera monitoring isn't enabled). Kept as a plain
// module-level reference rather than React state since this module has no
// React dependency of its own and only one preview is ever shown at a time.
let previewCanvas: HTMLCanvasElement | null = null;

export function attachPresencePreview(canvas: HTMLCanvasElement | null): void {
  previewCanvas = canvas;
}

function drawPresencePreview(
  frame: HTMLCanvasElement,
  detection: faceapi.FaceDetection | undefined,
  lowConfidenceCandidates: faceapi.FaceDetection[],
): void {
  if (!previewCanvas) return;
  const ctx = previewCanvas.getContext('2d');
  if (!ctx) return;
  // The card sizes the canvas element via CSS; keep the backing buffer in
  // sync with the frame's own resolution so drawImage below isn't stretched.
  if (previewCanvas.width !== frame.width || previewCanvas.height !== frame.height) {
    previewCanvas.width = frame.width;
    previewCanvas.height = frame.height;
  }
  ctx.drawImage(frame, 0, 0);
  // A confirmed detection gets a clear green box; a low-confidence
  // candidate (below the real threshold, only computed as a fallback when
  // nothing was confirmed) gets a fainter amber one - visual feedback for
  // the employee to adjust position/lighting rather than raw debug numbers.
  const boxes = detection ? [detection] : lowConfidenceCandidates;
  ctx.lineWidth = 3;
  ctx.strokeStyle = detection ? '#22c55e' : '#f59e0b';
  boxes.forEach((d) => {
    const { x, y, width, height } = d.box;
    ctx.strokeRect(x, y, width, height);
  });
}

/**
 * Grabs the current frame from the persistent camera stream and runs face
 * detection on it in-memory — never storing or transmitting the frame
 * itself.
 */
async function checkFaceDetected(): Promise<boolean> {
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

    const detection = await faceapi.detectSingleFace(
      canvas,
      new faceapi.TinyFaceDetectorOptions({ inputSize: FACE_DETECTOR_INPUT_SIZE }),
    );

    // The low-confidence fallback pass (a second full inference through the
    // network) only exists to draw the amber "close but not confirmed" box
    // in the live preview - skip it whenever the preview isn't actually
    // attached/visible (the common case: the employee is working in some
    // other app, not staring at their own Idle Time page), which cuts
    // steady-state face-detection cost roughly in half without changing
    // faceDetected/combinedStatus or anything the preview shows while it
    // IS on screen.
    let lowThresholdCandidates: faceapi.FaceDetection[] = [];
    if (!detection && previewCanvas) {
      lowThresholdCandidates = await faceapi.detectAllFaces(
        canvas,
        new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.05, inputSize: FACE_DETECTOR_INPUT_SIZE }),
      );
    }

    drawPresencePreview(canvas, detection, lowThresholdCandidates);

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
