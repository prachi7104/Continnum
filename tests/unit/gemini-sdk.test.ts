// Verifies the pinned SDK's single-step mocking surface and disabled automatic retries.
import { expect, test } from 'vitest';
import { simulateReadableStream, streamText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { geminiModel, singleStep } from '../../server/src/llm/gemini.ts';
import type { ResearchChunk } from '../../server/src/llm/provider.ts';

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

test('the Google adapter serializes the search result with the original call and explicit tool disabling', async () => {
  const model = 'gemini-3.6-flash';
  const args = { query: 'Alpha price', entity: 'Alpha' };
  const thoughtSignature = 'dGVzdA==';
  const bodies: unknown[] = [];
  const adapter = geminiModel('test-key', [model], async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    const part = bodies.length === 1 ? { functionCall: { name: 'web_search', args }, thoughtSignature } : { text: 'Alpha costs $12 [E1.1].' };
    return new Response('data: ' + JSON.stringify({ candidates: [{ content: { role: 'model', parts: [part] }, finishReason: 'STOP' }] }) + '\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    });
  });
  const signal = new AbortController().signal;
  const user = { role: 'user' as const, content: 'What is the current price of Alpha?' };
  const steps: ResearchChunk[] = [];
  for await (const chunk of adapter.research!({ model, system: 'Search reliable sources', messages: [user], mode: 'required' }, signal)) steps.push(chunk);
  const toolStep = steps.find((chunk) => typeof chunk === 'object' && 'calls' in chunk);
  if (!toolStep || !('calls' in toolStep)) throw new Error('The SDK did not return the search call.');
  expect(toolStep.calls).toEqual([{ id: expect.any(String), toolName: 'web_search', ...args }]);
  const output = { type: 'text' as const, value: '{"sourcesFound":1}' };
  const followUp = adapter.research!({ model, system: 'Use the supplied evidence', mode: 'none',
    messages: [user, ...toolStep.messages, { role: 'tool', content: [{ type: 'tool-result', toolCallId: toolStep.calls[0].id,
      toolName: 'web_search', output }] }],
  }, signal);
  const answer: ResearchChunk[] = [];
  for await (const chunk of followUp) answer.push(chunk);
  expect(answer.filter((chunk) => typeof chunk === 'string')).toEqual(['Alpha costs $12 [E1.1].']);
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toMatchObject({ toolConfig: { functionCallingConfig: { mode: 'ANY' } } });
  expect(bodies[1]).toMatchObject({
    toolConfig: { functionCallingConfig: { mode: 'NONE' } },
    tools: [{ functionDeclarations: [{ name: 'web_search' }] }],
    contents: [expect.anything(), { role: 'model', parts: [{ functionCall: { name: 'web_search', args }, thoughtSignature }] },
      { parts: [{ functionResponse: { name: 'web_search' } }] }],
  });
  expect(adapter.acceptsOmittedTools?.(model)).toBe(false);
});
