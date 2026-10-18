// Shared bounded parsing and safe provider diagnostics for Gemini requests.
export async function readLimited(response, limit = 256 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('Gemini response exceeded its size limit.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function providerFailure(response, data) {
  const error = data?.error;
  const rawStatus = error?.status ?? error?.code;
  const normalized = typeof rawStatus === 'string' ? rawStatus.toUpperCase() : '';
  const providerStatus = ['RESOURCE_EXHAUSTED', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'INVALID_ARGUMENT',
    'NOT_FOUND', 'UNAVAILABLE', 'DEADLINE_EXCEEDED', 'INTERNAL', 'FAILED_PRECONDITION'].includes(normalized) ? normalized : null;
  const details = Array.isArray(error?.details) ? error.details : [];
  const violations = details.filter((item) => item?.['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure')
    .flatMap((item) => Array.isArray(item.violations) ? item.violations : []);
  const tokenLimit = violations.some((item) => /token/i.test(`${item?.quotaMetric ?? ''} ${item?.quotaId ?? ''}`)) ||
    (typeof error?.message === 'string' && /quota[^.\n]*token|token[^.\n]*(?:quota|limit)|\bTP[MD]\b/i.test(error.message));
  const retryInfo = details.find((item) => item?.['@type'] === 'type.googleapis.com/google.rpc.RetryInfo');
  const bodyRetry = typeof retryInfo?.retryDelay === 'string' ? retryInfo.retryDelay.replace(/s$/, '') : null;
  const rawRetry = response.headers.get('retry-after') ?? bodyRetry;
  const seconds = Number(rawRetry);
  const retryAfterSeconds = rawRetry != null && Number.isFinite(seconds) && seconds >= 0 ? Math.min(86_400, Math.ceil(seconds)) : null;
  return { providerStatus, retryAfterSeconds,
    quotaStatus: response.status === 402 ? 'credits_exhausted' : response.status === 429 ?
      (tokenLimit ? 'token_limit_reached' : 'quota_or_rate_limit_reached') : 'unknown' };
}

export function tokenUsage(usage) {
  // Only copy known numeric counters, never arbitrary provider metadata.
  return Object.fromEntries(['total_input_tokens', 'total_output_tokens', 'total_thought_tokens', 'total_tokens']
    .filter((name) => Number.isSafeInteger(usage?.[name]) && usage[name] >= 0)
    .map((name) => [name, usage[name]]));
}

export function parseApiKeys(env = process.env) {
  const keys = [
    ...(env.GEMINI_API_KEYS ? env.GEMINI_API_KEYS.split(/[,;\n\r]+/) : []),
    ...(env.GEMINI_API_KEY ? env.GEMINI_API_KEY.split(/[,;\n\r]+/) : []),
    ...(env.GEMINI_FALLBACK_API_KEY ? env.GEMINI_FALLBACK_API_KEY.split(/[,;\n\r]+/) : []),
  ].map((k) => k.trim()).filter(Boolean);
  return [...new Set(keys)];
}

