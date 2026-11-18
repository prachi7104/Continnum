// Streams visible test-only text with enough delay to exercise cancellation.
import { setTimeout } from 'node:timers/promises';
import type { ModelProvider } from './provider.ts';

export const fakeModel: ModelProvider = {
  name: 'fake', models: ['scripted-test'],
  acceptsOmittedTools: () => true,
  async *generate(input, signal) {
    const text = input.messages.at(-1)?.content ?? '';
    for (const delta of ['Scripted response. ', 'You wrote: ', text]) {
      await setTimeout(160, undefined, { signal });
      if (delta) yield delta;
    }
  },
  async *research(input, signal) {
    await setTimeout(160, undefined, { signal });
    if (input.mode === 'required') {
      const calls = [{ id: 'fake-search', query: 'Continuum release information', entity: 'Continuum' }];
      yield 'Unverified preliminary version 99.';
      yield { calls, messages: [{ role: 'assistant', content: calls.map(({ id, query, entity }) => ({
        type: 'tool-call', toolCallId: id, toolName: 'web_search', input: { query, entity },
      })) }] };
      return;
    }
    if (input.messages.some(({ role }) => role === 'tool')) {
      yield 'Continuum is described as a scripted research demo [E1.1].';
    } else {
      yield 'Here is a scripted explanation.';
    }
    yield { calls: [], messages: [] };
  },
};
