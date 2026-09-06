"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const captureService_1 = require("./captureService");
const productivityCapture_1 = require("./productivityCapture");
const idleTimeTracker_1 = require("./idleTimeTracker");
function createWindow() {
    const mainWindow = new electron_1.BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 720,
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false,
        },
    });
    if (process.env.NODE_ENV === 'development') {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173');
    }
    else {
        mainWindow.loadFile(path_1.default.join(__dirname, '../dist/index.html'));
    }
}
// Without an explicit handler, Electron has no default UI to answer a
// getUserMedia() camera/mic permission request (unlike a real browser) -
// on some versions the promise never resolves or rejects at all, it just
// hangs forever. Consent for the camera-presence feature is already
// gated by our own in-app modal (CameraConsentModal.tsx) before the
// renderer ever calls getUserMedia, so auto-granting the OS/Electron-level
// 'media' permission here isn't bypassing anything - it's completing the
// same decision the user already made.
electron_1.session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
});
electron_1.session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === 'media');
electron_1.app.whenReady().then(() => {
    (0, captureService_1.registerCaptureIpcHandlers)();
    (0, productivityCapture_1.registerProductivityCaptureIpcHandlers)();
    (0, idleTimeTracker_1.registerIdleTimeTrackerIpcHandlers)();
    createWindow();
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
