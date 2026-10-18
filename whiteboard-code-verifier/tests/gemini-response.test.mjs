import test from 'node:test';
import assert from 'node:assert/strict';
import { providerFailure } from '../server/gemini-response.mjs';

const quota = violations => [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations }];
const response = () => new Response('{}', { status: 429, headers: { 'Retry-After': '30' } });

test('quota diagnostics retain model limits while excluding messages, keys and project identifiers', () => {
  const privateKey = 'AIzaPrivateProviderKey1234567890';
  const evidence = providerFailure(response(), { error: { status: 'RESOURCE_EXHAUSTED', message: privateKey,
    details: quota([{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
      quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '0',
      quotaDimensions: { model: 'gemini-3.6-flash', project: 'private-project' }, subject: 'private-subject', description: privateKey },
    { quotaMetric: `generate_content_${privateKey}`, quotaId: privateKey }]),
  } });
  assert.equal(evidence.quotaReason, 'zero_quota');
  assert.equal(evidence.retryAfterSeconds, 30);
  assert.deepEqual(evidence.quotaViolations, [{
    metric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
    id: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', model: 'gemini-3.6-flash', limit: 0,
  }]);
  assert.ok(!JSON.stringify(evidence).includes(privateKey));
  assert.ok(!JSON.stringify(evidence).includes('private-project'));
});

test('extracts an explicit zero limit from Google messages when violation records omit quotaValue', () => {
  const evidence = providerFailure(response(), { error: { message:
    'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3.6-flash\nPrivate message must stay private.',
    details: quota([{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }]),
  } });
  assert.equal(evidence.quotaReason, 'zero_quota');
  assert.equal(evidence.quotaViolations[1].limit, 0);
  assert.equal(evidence.quotaViolations[1].model, 'gemini-3.6-flash');
  assert.ok(!JSON.stringify(evidence).includes('Private message'));
});

test('separates minute and daily limits without treating missing or invalid limits as zero', () => {
  for (const [id, reason] of [['GenerateRequestsPerMinutePerProjectPerModel', 'minute_limit'], ['GenerateRequestsPerDayPerProjectPerModel', 'daily_limit']]) {
    const evidence = providerFailure(response(), { error: { details: quota([{ quotaId: id, quotaValue: '' }]) } });
    assert.equal(evidence.quotaReason, reason);
    assert.equal(evidence.quotaViolations[0].limit, null);
  }
  assert.equal(providerFailure(response(), {}).quotaReason, 'unspecified');
});


test('understands flat interaction errors and records response type when an upstream limit has no quota detail', () => {
  const reply = new Response('{}', { status: 429, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  const evidence = providerFailure(reply, { code: 429, status: 'RESOURCE_EXHAUSTED', details: quota([{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel' }]) });
  assert.equal(evidence.providerStatus, 'RESOURCE_EXHAUSTED');
  assert.equal(evidence.quotaReason, 'minute_limit');
  assert.equal(evidence.responseType, 'application/json');
  const unknown = providerFailure(new Response('Busy', { status: 429, headers: { 'Content-Type': 'text/plain' } }));
  assert.equal(unknown.quotaReason, 'unspecified');
  assert.deepEqual(unknown.quotaViolations, []);
  assert.equal(unknown.responseType, 'text/plain');
});
