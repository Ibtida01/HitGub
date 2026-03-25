/**
 * Collaborator API configuration.
 * Suggested `.env`: VITE_API_URL, VITE_COLLAB_USE_MOCK
 */

export const COLLAB_USE_MOCK = import.meta.env.VITE_COLLAB_USE_MOCK !== 'false';

export const API_BASE =
  (import.meta.env.VITE_API_URL || '').replace(/\/$/, '') || 'http://localhost:8000';

export function getAuthToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token');
}

export function authHeaders() {
  const t = getAuthToken();
  const h = { 'Content-Type': 'application/json' };
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}
