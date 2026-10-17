// Hosts can return HTML or plain text when a function fails before our handler
// responds. Never expose that body, or mistake it for the API's JSON contract.
export async function readApiJson(response) {
  const text = await response.text();
  let value;
  try { value = JSON.parse(text); }
  catch { throw responseError(response); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw responseError(response);
  return value;
}

function responseError(response) {
  let path = '';
  try { path = new URL(response.url).pathname; } catch {}
  const gemini = ['/api/ocr', '/api/pseudocode'].includes(path);
  const label = path === '/api/ocr' ? 'Handwriting recognition' : 'API request';
  const timeout = [408, 504].includes(response.status);
  const message = timeout
    ? `${label} timed out at the hosting service (HTTP ${response.status}). ${gemini ? 'Gemini token/quota status is unknown. ' : ''}Try again with a smaller selection.`
    : response.status === 413 ? 'The request is too large for the hosting service (HTTP 413). Select a smaller board region.'
      : `${label} returned a non-JSON response (HTTP ${response.status}${path ? `, ${path}` : ''}). Check the API deployment and try again.`;
  return Object.assign(new Error(message), { status: response.status, code: timeout ? 'api_timeout' : 'api_invalid_response',
    ...(gemini ? { diagnostic: { provider: 'gemini', reason: timeout ? 'host_timeout' : 'invalid_api_response',
      httpStatus: response.status, quotaStatus: 'unknown' } } : {}),
  });
}
