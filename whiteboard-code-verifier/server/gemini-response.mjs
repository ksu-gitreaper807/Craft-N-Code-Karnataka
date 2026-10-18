// Shared bounded parsing and safe provider diagnostics for Gemini requests.
export const GEMINI_REQUEST_BUDGET_MS = 45_000;

export function remainingGeminiRequestMs(deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new DOMException('Gemini request budget elapsed.', 'TimeoutError');
  return remaining;
}

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
  const error = data?.error && typeof data.error === 'object' ? data.error : data;
  const rawStatus = error?.status ?? error?.code ?? (typeof error?.error === 'string' ? error.error : undefined);
  const normalized = typeof rawStatus === 'string' ? rawStatus.toUpperCase() : '';
  const providerStatus = ['RESOURCE_EXHAUSTED', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'INVALID_ARGUMENT',
    'NOT_FOUND', 'UNAVAILABLE', 'DEADLINE_EXCEEDED', 'INTERNAL', 'FAILED_PRECONDITION'].includes(normalized) ? normalized : null;
  const details = Array.isArray(error?.details) ? error.details : [];
  const violations = details.filter((item) => item?.['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure')
    .flatMap((item) => Array.isArray(item.violations) ? item.violations : []);
  // Keep bounded quota evidence, never raw provider messages or project identifiers.
  const messageViolations = typeof error?.message === 'string' ? Array.from(error.message.matchAll(
    /Quota exceeded for metric:\s*((?:generativelanguage\.googleapis\.com\/)?(?:generate_|interactions_|concurrent_)[A-Za-z0-9_./-]{1,180}),\s*limit:\s*(\d+)(?:,\s*model:\s*(gemini-[A-Za-z0-9._-]{1,100}))?/gi,
  ), match => ({ quotaMetric: match[1], quotaValue: match[2], quotaDimensions: { model: match[3] } })) : [];
  const quotaViolations = [...violations, ...messageViolations].slice(0, 12).map(item => {
    const metric = typeof item?.quotaMetric === 'string' && /^(?:generativelanguage\.googleapis\.com\/)?(?:generate_|interactions_|concurrent_)[A-Za-z0-9_./-]{1,180}$/.test(item.quotaMetric) && !item.quotaMetric.includes('AIza') ? item.quotaMetric : null;
    const id = typeof item?.quotaId === 'string' && /^(?:Generate|Interactions|Concurrent)[A-Za-z0-9_-]{1,180}$/.test(item.quotaId) && !item.quotaId.includes('AIza') ? item.quotaId : null;
    const model = typeof item?.quotaDimensions?.model === 'string' && /^gemini-\d[A-Za-z0-9._-]{0,99}$/.test(item.quotaDimensions.model) && !item.quotaDimensions.model.includes('AIza') ? item.quotaDimensions.model : null;
    const rawLimit = item?.quotaValue;
    const limit = (typeof rawLimit === 'number' || typeof rawLimit === 'string' && /^\d+$/.test(rawLimit)) && Number.isSafeInteger(Number(rawLimit)) && Number(rawLimit) >= 0 ? Number(rawLimit) : null;
    return { metric, id, model, limit };
  }).filter(item => item.metric || item.id);
  const quotaReason = quotaViolations.some(item => item.limit === 0) ? 'zero_quota' :
    quotaViolations.some(item => /PerDay|per_day/i.test(`${item.id} ${item.metric}`)) ? 'daily_limit' :
    quotaViolations.some(item => /PerMinute|per_minute/i.test(`${item.id} ${item.metric}`)) ? 'minute_limit' : 'unspecified';
  const tokenLimit = violations.some((item) => /token/i.test(`${item?.quotaMetric ?? ''} ${item?.quotaId ?? ''}`)) ||
    (typeof error?.message === 'string' && /quota[^.\n]*token|token[^.\n]*(?:quota|limit)|\bTP[MD]\b/i.test(error.message));
  const retryInfo = details.find((item) => item?.['@type'] === 'type.googleapis.com/google.rpc.RetryInfo');
  const bodyRetry = typeof retryInfo?.retryDelay === 'string' ? retryInfo.retryDelay.replace(/s$/, '') : null;
  const rawRetry = response.headers.get('retry-after') ?? bodyRetry;
  const seconds = Number(rawRetry);
  const retryAfterSeconds = rawRetry != null && Number.isFinite(seconds) && seconds >= 0 ? Math.min(86_400, Math.ceil(seconds)) : null;
  const mime = response.headers.get('content-type')?.split(';')[0].trim();
  const responseType = ['application/json', 'text/plain', 'text/html'].includes(mime) ? mime : null;
  return { providerStatus, retryAfterSeconds, quotaReason, quotaViolations, responseType,
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

