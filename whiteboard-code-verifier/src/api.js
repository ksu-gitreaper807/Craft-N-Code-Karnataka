import { readApiJson } from './api-response.js';
export { readApiJson };

// Only the public origin is embedded. Authentication travels in an HttpOnly cookie.
const origin = (import.meta.env.VITE_BOARDROOM_API_ORIGIN ?? '').replace(/\/$/, '');
// Remove the previous browser-readable credential during the cookie migration.
try { sessionStorage.removeItem('boardroom-api-token'); } catch { /* Storage may be blocked. */ }

export async function apiFetch(path, options = {}) {
  const response = await fetch(`${origin}${path}`, { ...options, credentials: 'include' });
  if (response.status === 401 && path !== '/api/session' && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('boardroom-auth-required'));
  }
  return response;
}

export async function connectApi(token) {
  const response = await apiFetch('/api/session', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  const data = await readApiJson(response);
  if (!response.ok) throw new Error(data.error ?? 'Could not sign in.');
  return data;
}

export async function disconnectApi() {
  const response = await apiFetch('/api/session', { method: 'DELETE' });
  const data = await readApiJson(response);
  if (!response.ok) throw new Error(data.error ?? 'Could not sign out.');
}
