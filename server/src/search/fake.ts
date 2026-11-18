// Supplies explicitly fake tool results for qualification and isolated tests.
import type { WallClock } from '../clock.ts';
import type { SearchProvider } from './provider.ts';

export function fakeSearch(wall: WallClock): SearchProvider {
  return {
    name: 'fake',
    async search(query, signal) {
      signal.throwIfAborted();
      return [{ url: 'https://example.com/qualification', title: 'Scripted qualification fixture',
        content: 'Fake search fixture for: ' + query, score: 1, publishedAt: null, retrievedAt: wall.nowIso() }];
    },
  };
}
