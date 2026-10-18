import { createHash } from 'node:crypto';

const COOLDOWN_MS = 30_000;

// This queue is shared by OCR and code assistance within a single API process.
let nextKeyIndex = 0;
const coolingUntil = new Map();
const inFlight = new Set();
const keyId = (key) => createHash('sha256').update(key).digest('hex');

function chooseKey(keys, attempted) {
  const now = Date.now();
  for (let offset = 0; offset < keys.length; offset++) {
    const index = (nextKeyIndex + offset) % keys.length;
    const key = keys[index];
    const id = keyId(key);
    if (attempted.has(id) || inFlight.has(id) || (coolingUntil.get(id) ?? 0) > now) continue;
    nextKeyIndex = (index + 1) % keys.length;
    inFlight.add(id);
    // Set cooldown at dispatch so concurrent requests cannot reuse this key.
    coolingUntil.set(id, now + COOLDOWN_MS);
    return key;
  }
  return null;
}

function cooldownError(keys, attempted) {
  const now = Date.now();
  const candidates = keys.map(keyId).filter((id) => !attempted.has(id));
  const retryAfterSeconds = candidates.length
    ? Math.max(1, Math.ceil(Math.min(...candidates.map((id) => Math.max(0, (coolingUntil.get(id) ?? now) - now))) / 1000))
    : 30;
  return Object.assign(new Error(`All Gemini API keys are cooling down. Retry in ${retryAfterSeconds} seconds.`), {
    status: 503, code: 'gemini_keys_cooling', retryAfterSeconds,
  });
}

/** Send one Gemini request, rotating to another key for transient/key-specific failures. */
export async function requestWithGeminiKeyRotation(keys, send, { retryStatuses = [400, 401, 403, 429] } = {}) {
  const attempted = new Set();
  let lastResponse;
  let lastError;

  while (attempted.size < keys.length) {
    const key = chooseKey(keys, attempted);
    if (!key) {
      if (lastResponse) return lastResponse;
      if (lastError) throw lastError;
      throw cooldownError(keys, attempted);
    }
    attempted.add(keyId(key));
    try {
      const response = await send(key);
      if (response.ok || !retryStatuses.includes(response.status) || attempted.size >= keys.length) return response;
      lastResponse = response;
    } catch (error) {
      lastError = error;
    } finally {
      inFlight.delete(keyId(key));
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError ?? cooldownError(keys, attempted);
}

export const GEMINI_KEY_COOLDOWN_MS = COOLDOWN_MS;
