import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { runPhase2Smoke } from '../../scripts/phase2-smoke.ts';

const keys = { gemini: 'fixture', tavily: 'fixture' };
const args = { query: 'site:nodejs.org latest Node.js 24.x release', entity: 'Node.js' };
function sse(part: unknown) {
  return new Response('data: ' + JSON.stringify({
    candidates: [{ content: { role: 'model', parts: [part] }, finishReason: 'STOP' }],
  }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
}

test('one-shot smoke uses one search, a tool-disabled final request and official persisted evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'continuum-smoke-test-'));
  const original = join(root, 'phase2-live-smoke');
  const dir = join(root, 'phase2-live-smoke-02');
  const physical: string[] = [];
  const mock: typeof fetch = async (input) => {
    const url = new URL(String(input));
    physical.push(url.hostname);
    if (url.hostname === 'api.tavily.com') return Response.json({ results: [{
      url: 'https://nodejs.org/en/blog/release/v24.99.1', title: 'Node.js release',
      content: 'The latest Node.js release in this series is 24.99.1.', score: 0.99,
    }] });
    return physical.length === 1
      ? sse({ functionCall: { name: 'web_search', args }, thoughtSignature: 'dGVzdA==' })
      : sse({ text: 'The latest Node.js release in this series is 24.99.1 [E1.1].' });
  };
  try {
    mkdirSync(original);
    const originalReceipt = join(original, 'result.json');
    writeFileSync(originalReceipt, 'original failed receipt');
    expect(await runPhase2Smoke(dir, keys, mock)).toEqual({ passed: true, failure: '', counts: { gemini: 2, tavily: 1, groq: 0 } });
    await expect(runPhase2Smoke(dir, keys, mock)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(readFileSync(originalReceipt, 'utf8')).toBe('original failed receipt');
    expect(physical).toEqual([
      'generativelanguage.googleapis.com', 'api.tavily.com', 'generativelanguage.googleapis.com',
    ]);
    const journal = readFileSync(join(dir, 'attempts.jsonl'), 'utf8');
    expect(journal).toContain('final-tools-disabled');
    expect(journal).not.toContain('fixture');
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('a sourced historical release with a durable citation does not pass the latest-version check', async () => {
  const root = mkdtempSync(join(tmpdir(), 'continuum-smoke-test-'));
  const dir = join(root, 'run');
  let callCount = 0;
  const historical = 'Node.js release 24.11.0 was published.';
  try {
    const result = await runPhase2Smoke(dir, keys, async (input) => {
      callCount++;
      if (new URL(String(input)).hostname === 'api.tavily.com') return Response.json({ results: [{
        url: 'https://nodejs.org/en/blog/release/v24.11.0', title: 'Node.js 24.11.0 (LTS)',
        content: historical, score: 0.99,
      }] });
      return callCount === 1
        ? sse({ functionCall: { name: 'web_search', args }, thoughtSignature: 'dGVzdA==' })
        : sse({ text: 'Node.js release 24.11.0 was published [E1.1].' });
    });
    const receipt = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'));
    expect(receipt.result.checks).toMatchObject({
      orderedProgress: true, sourcedAnswerAfterSearch: true, officialVersionAfterReload: false, persistedCitation: true,
    });
    expect(result).toEqual({
      passed: false, failure: 'Failed checks: officialVersionAfterReload', counts: { gemini: 2, tavily: 1, groq: 0 },
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('one-shot smoke does not retry a 429 or issue synthesis without search', async () => {
  const root = mkdtempSync(join(tmpdir(), 'continuum-smoke-test-'));
  const physical: string[] = [];
  try {
    const result = await runPhase2Smoke(join(root, 'run'), keys, async (input) => {
      const host = new URL(String(input)).hostname;
      physical.push(host);
      return host === 'api.tavily.com'
        ? new Response(null, { status: 429, headers: { 'retry-after': '0' } })
        : sse({ functionCall: { name: 'web_search', args } });
    });
    expect(result).toEqual({ passed: false, failure: 'SEARCH_UNAVAILABLE', counts: { gemini: 1, tavily: 1, groq: 0 } });
    expect(physical).toHaveLength(2);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('ordered search progress remains valid when the release gate withholds the only claim', async () => {
  const root = mkdtempSync(join(tmpdir(), 'continuum-smoke-test-'));
  const dir = join(root, 'run');
  let callCount = 0;
  try {
    // The live draft was not retained. This invented draft uses the recorded
    // release heading to make a latest-version claim it cannot support.
    const result = await runPhase2Smoke(dir, keys, async (input) => {
      callCount++;
      if (new URL(String(input)).hostname === 'api.tavily.com') return Response.json({ results: [{
        url: 'https://nodejs.org/en/blog/release/v24.11.0', title: 'Node.js 24.11.0 (LTS)',
        content: 'Skip to content\n# Node.js 24.11.0 (LTS)\nRL', score: 0.99,
      }] });
      return callCount === 1
        ? sse({ functionCall: { name: 'web_search', args }, thoughtSignature: 'dGVzdA==' })
        : sse({ text: 'The latest Node.js 24.x version is 24.11.0 [E1.1].' });
    });
    const receipt = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'));
    expect(receipt.events.map((event: { type: string }) => event.type)).toEqual([
      'turn.started', 'search.started', 'search.finished', 'sources', 'answer.withheld', 'turn.completed',
    ]);
    expect(receipt.result.checks.orderedProgress).toBe(true);
    expect(receipt.result.checks).toMatchObject({
      completed: true, sourcedAnswerAfterSearch: false, officialVersionAfterReload: false, persistedCitation: false,
    });
    expect(receipt.result.citations).toEqual([]);
    expect(receipt.result.detail.messages.at(-1).content).not.toContain('24.11.0');
    expect(receipt.diagnostics.synthesisText).toBe('The latest Node.js 24.x version is 24.11.0 [E1.1].');
    expect(receipt.diagnostics.searchHits).toMatchObject([{ content: 'Skip to content\n# Node.js 24.11.0 (LTS)\nRL' }]);
    expect(result.passed).toBe(false);
    expect(result.counts).toEqual({ gemini: 2, tavily: 1, groq: 0 });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
