// Streams visible test-only text with enough delay to exercise cancellation.
import { setTimeout } from 'node:timers/promises';
import type { ModelProvider } from './provider.ts';

export const fakeModel: ModelProvider = {
  name: 'fake', models: ['scripted-test'],
  async *generate(input, signal) {
    const text = input.messages.at(-1)?.content ?? '';
    for (const delta of ['Scripted response. ', 'You wrote: ', text]) {
      await setTimeout(160, undefined, { signal });
      if (delta) yield delta;
    }
  },
};
