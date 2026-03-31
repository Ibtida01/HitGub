/**
 * Collaborator API configuration.
 * Suggested `.env`: VITE_API_URL, VITE_COLLAB_USE_MOCK
 */

export const COLLAB_USE_MOCK = import.meta.env.VITE_COLLAB_USE_MOCK !== 'false';

export const API_BASE =
  (import.meta.env.VITE_API_URL || '').replace(/\/$/, '') || 'http://localhost:8000';

function getStorage() {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function setAuthSession(token, username) {
  const s = getStorage();
  if (!s) return;
  if (token) {
    s.setItem('auth_token', token);
  }
  if (username) {
    s.setItem('auth_username', username);
  }

  // Clear old tab-scoped keys after switching back to shared auth behavior.
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem('auth_token');
    window.sessionStorage.removeItem('auth_username');
  }
}

export function setAuthUsername(username) {
  const s = getStorage();
  if (!s) return;
  if (username) {
    s.setItem('auth_username', username);
  }
}

export function clearAuthSession() {
  const s = getStorage();
  if (s) {
    s.removeItem('auth_token');
    s.removeItem('auth_username');
  }

  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem('auth_token');
    window.sessionStorage.removeItem('auth_username');
  }
}

export function getAuthToken() {
  const s = getStorage();
  if (!s) return null;

  const sharedToken = s.getItem('auth_token');
  if (sharedToken) return sharedToken;

  // Migrate old tab-scoped token (from previous build) to shared storage.
  const tabToken = typeof window !== 'undefined'
    ? window.sessionStorage.getItem('auth_token')
    : null;
  if (tabToken) {
    s.setItem('auth_token', tabToken);
    window.sessionStorage.removeItem('auth_token');
  }
  return tabToken;
}

export function getAuthUsername() {
  const s = getStorage();
  if (!s) return null;

  const sharedUsername = s.getItem('auth_username');
  if (sharedUsername) return sharedUsername;

  // Migrate old tab-scoped username (from previous build) to shared storage.
  const tabUsername = typeof window !== 'undefined'
    ? window.sessionStorage.getItem('auth_username')
    : null;
  if (tabUsername) {
    s.setItem('auth_username', tabUsername);
    window.sessionStorage.removeItem('auth_username');
  }
  return tabUsername;
}

export function authHeaders() {
  const t = getAuthToken();
  const h = { 'Content-Type': 'application/json' };
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}
