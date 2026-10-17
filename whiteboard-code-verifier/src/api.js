// Vite embeds only the public API origin. The teacher enters the private token at runtime.
const origin = (import.meta.env.VITE_BOARDROOM_API_ORIGIN ?? '').replace(/\/$/, '');
const tokenKey = 'boardroom-api-token';

export function hasApiToken() {
  try { return Boolean(sessionStorage.getItem(tokenKey)); } catch { return false; }
}

export function setApiToken(token) {
  if (token) sessionStorage.setItem(tokenKey, token);
  else sessionStorage.removeItem(tokenKey);
}

export function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers);
  if (hasApiToken()) headers.set('Authorization', `Bearer ${sessionStorage.getItem(tokenKey)}`);
  return fetch(`${origin}${path}`, { ...options, headers });
}
