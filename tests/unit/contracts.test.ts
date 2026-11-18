// Covers typed wire validation and Tavily behavior through an injected HTTP mock.
import assert from 'node:assert/strict';
import { test } from '../test.ts';
import { eventSchema, turnRequest } from '../../shared/events.ts';
import { tavily } from '../../server/src/search/tavily.ts';
import { SearchFailure } from '../../server/src/search/provider.ts';

const clock = { nowIso: () => '2026-11-18T04:00:00.000Z' };
const signal = new AbortController().signal;
test('validates event ordering fields and rejects malformed deltas and turn inputs', () => {
  const turnId = '80cbc69c-fde9-44e2-9d9c-b458e797249e';
  assert.equal(eventSchema.safeParse({ type: 'answer.delta', turnId, seq: 1, text: 'ok' }).success, true);
  for (const input of [{ seq: 0 }, { turnId: 'wrong' }, { text: '' }, { type: 'answer.fake' }]) {
    assert.equal(eventSchema.safeParse({ type: 'answer.delta', turnId, seq: 1, text: 'ok', ...input }).success, false);
  }
  assert.equal(turnRequest.safeParse({ text: 'a'.repeat(8001), clientTurnId: 'x', tz: 'UTC' }).success, false);
});

test('Tavily maps basic results and counts exactly one explicit basic request', async () => {
  let calls = 0;
  const adapter = tavily('example', clock, async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.tavily.com/search');
    assert.equal(init?.signal, signal);
    assert.equal(init?.redirect, 'error');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      query: 'search term', search_depth: 'basic', max_results: 5, chunks_per_source: 3, include_published_date: true,
    });
    return Response.json({ results: [{ url: 'https://example.com', title: 'Title', content: '<chunk 1> Example.', score: 0.5,
      published_date: 'Tue, 11 Mar 2025 17:00:00 GMT' }] });
  });
  const result = await adapter.search('search term', signal);
  assert.equal(calls, 1);
  assert.equal(result[0]?.publishedAt, '2025-03-11T17:00:00.000Z');
  assert.equal(result[0]?.retrievedAt, clock.nowIso());
  assert.equal(result[0]?.content, '<chunk 1> Example.');
});

test('Tavily returns 429 metadata and maps 432 with no adapter retry', async () => {
  for (const [status, retry] of [[429, 2000], [432, undefined]] as const) {
    let calls = 0;
    const adapter = tavily('example', clock, async () => {
      calls++;
      return new Response(null, { status, headers: { 'Retry-After': '2' } });
    });
    await assert.rejects(adapter.search('term', signal), (error) =>
      error instanceof SearchFailure && error.status === status && error.code === 'SEARCH_UNAVAILABLE' && error.retryAfterMs === retry);
    assert.equal(calls, 1);
  }
});
