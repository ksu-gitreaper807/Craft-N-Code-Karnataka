export { readApiJson } from './api-response.js';

const origin = (import.meta.env.VITE_BOARDROOM_API_ORIGIN ?? '').replace(/\/$/, '');
// Retire the previous browser-readable credential when upgrading.
try { sessionStorage.removeItem('boardroom-api-token'); } catch { /* Optional storage. */ }

export function apiFetch(path, options = {}) {
  return fetch(`${origin}${path}`, { ...options, credentials: 'omit' });
}
