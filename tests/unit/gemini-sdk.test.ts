// Verifies the pinned SDK's single-step mocking surface and disabled automatic retries.
import { expect, test } from 'vitest';
import { simulateReadableStream, streamText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { geminiModel, singleStep } from '../../server/src/llm/gemini.ts';

test('one streamText step consumes one mocked model stream', async () => {
  let requests = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => {
      requests++;
      return { stream: simulateReadableStream({ chunks: [
        { type: 'text-start', id: 'part' },
        { type: 'text-delta', id: 'part', delta: 'hello' },
        { type: 'text-end', id: 'part' },
        { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        } },
      ] }) };
    },
  });
  const result = streamText({ ...singleStep, model, prompt: 'Say hello' });
  expect(await result.text).toBe('hello');
  expect(await result.steps).toHaveLength(1);
  expect(singleStep.maxRetries).toBe(0);
  expect(requests).toBe(1);
});

test('live adapter emits Gemini text from one fetch and leaves search tools disabled', async () => {
  const model = 'gemini-3.5-flash-lite';
  let calls = 0;
  const adapter = geminiModel('test-key', [model], async (url, init) => {
    calls++;
    expect(String(url)).toContain('/models/' + model + ':streamGenerateContent');
    expect(init?.redirect).toBe('error');
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('tools');
    const events = [
      { candidates: [{ content: { role: 'model', parts: [{ text: 'Hello' }] } }] },
      { candidates: [{ content: { role: 'model', parts: [{ text: ' again' }] }, finishReason: 'STOP' }] },
    ];
    return new Response(events.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join(''), {
      headers: { 'content-type': 'text/event-stream' },
    });
  });
  const chunks: string[] = [];
  for await (const chunk of adapter.generate(
    { model, system: 'Respond briefly.', messages: [{ role: 'user', content: 'Hello' }] },
    new AbortController().signal,
  )) chunks.push(chunk);
  expect(chunks).toEqual(['Hello', ' again']);
  expect(calls).toBe(1);
});
