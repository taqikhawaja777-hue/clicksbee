/**
 * Backend/productivity-service URLs for MAIN-PROCESS code
 * (captureService.ts, productivityCapture.ts, idleTimeTracker.ts). Renderer
 * code uses Vite's VITE_API_BASE_URL/VITE_SOCKET_URL/VITE_PRODUCTIVITY_API_URL
 * env vars instead (see .env.production) - these must point at the same
 * deployed servers as this file, since main-process code and renderer code
 * talk to the same backend.
 *
 * Switches on NODE_ENV rather than a bundler env-injection mechanism
 * (main-process files are compiled by plain tsc, not Vite, so
 * import.meta.env isn't available here) - the same NODE_ENV convention
 * main.ts already uses to pick loadURL (dev) vs loadFile (prod). Set by
 * `cross-env NODE_ENV=development` in the electron:dev script; unset
 * (falsy) in a real electron-builder production build.
 */
const isDev = process.env.NODE_ENV === 'development';

export const BACKEND_URL = isDev ? 'http://localhost:3000' : 'https://clicksbee-backend.onrender.com';
export const PRODUCTIVITY_SERVICE_URL = isDev
  ? 'http://localhost:8000'
  : 'https://clicksbee-productivity.onrender.com';
