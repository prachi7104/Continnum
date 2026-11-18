// Supplies explicitly fake tool results for qualification and isolated tests.
import type { WallClock } from '../clock.ts';
import type { SearchProvider } from './provider.ts';
import { setTimeout as wait } from 'node:timers/promises';

export function fakeSearch(wall: WallClock): SearchProvider {
  return {
    name: 'fake',
    async search(query, signal) {
      await wait(380, undefined, { signal });
      return [{ url: 'https://example.com/qualification', title: 'Scripted research source',
        content: 'Continuum is a scripted research demo. Fake search fixture for: ' + query, score: 1, publishedAt: null, retrievedAt: wall.nowIso() }];
    },
  };
}
