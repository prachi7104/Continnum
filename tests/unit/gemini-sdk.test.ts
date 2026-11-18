// Verifies the pinned SDK's single-step mocking surface and disabled automatic retries.
import { expect, test } from 'vitest';
import { simulateReadableStream, streamText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { singleStep } from '../../server/src/llm/gemini.ts';

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
