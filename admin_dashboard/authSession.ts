/**
 * The signed-in user's login token, handed from the app window (which owns
 * the login) to this background process, so tracking uploads are sent as
 * that user. Apps that don't send it yet use the server's legacy mode.
 */
import { ipcMain } from 'electron';

interface AuthSession {
  token: string | null;
  userId: string | null;
  category: string | null;
}

const session: AuthSession = { token: null, userId: null, category: null };
const listeners: Array<(s: AuthSession) => void> = [];

export function getAuthSession(): AuthSession {
  return { ...session };
}

/** Authorization header when signed in, otherwise nothing (legacy mode). */
export function authHeaders(): Record<string, string> {
  return session.token ? { Authorization: `Bearer ${session.token}` } : {};
}

/** Called when the user (or their category) changes - starts/stops background tracking. */
export function onSessionUserChanged(listener: (s: AuthSession) => void): void {
  listeners.push(listener);
}

export function registerAuthSessionIpcHandlers(): void {
  // Every new/refreshed access token (login, 15-min refresh, app start).
  ipcMain.handle('auth-token-updated', (_event, token: string | null) => {
    session.token = token || null;
    return { success: true };
  });

  // Who is signed in and their access category; null user = signed out.
  ipcMain.handle('set-session-user', (_event, user: { userId: string; category: string } | null) => {
    const changed = (user?.userId || null) !== session.userId || (user?.category || null) !== session.category;
    session.userId = user?.userId || null;
    session.category = user?.category || null;
    if (!user) session.token = null;
    if (changed) listeners.forEach((l) => l(getAuthSession()));
    return { success: true };
  });
}
