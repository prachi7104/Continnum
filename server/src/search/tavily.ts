// Performs exactly one basic Tavily request and normalizes provider metadata.
import { z } from 'zod';
import type { WallClock } from '../clock.ts';
import { SearchFailure, type SearchProvider } from './provider.ts';

const schema = z.object({ results: z.array(z.object({
  url: z.httpUrl(), title: z.string(), content: z.string(),
  score: z.number(), published_date: z.string().nullish(),
})) });

function retryAfter(value: string | null, clock: WallClock) {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.parse(clock.nowIso())) : undefined;
}

export function tavily(key: string, wall: WallClock, request: typeof fetch = fetch): SearchProvider {
  return {
    name: 'tavily',
    async search(query, signal) {
      if (!key) throw new SearchFailure();
      try {
        const response = await request('https://api.tavily.com/search', {
          method: 'POST', signal, redirect: 'error',
          headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
          body: JSON.stringify({ query, search_depth: 'basic', max_results: 5, chunks_per_source: 3, include_published_date: true }),
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          throw new SearchFailure(response.status, response.status === 429 ? retryAfter(response.headers.get('retry-after'), wall) : undefined);
        }
        const { results } = schema.parse(await response.json());
        const retrievedAt = wall.nowIso();
        return results.map((hit) => {
          const date = hit.published_date ? Date.parse(hit.published_date) : NaN;
          return { url: hit.url, title: hit.title, content: hit.content, score: hit.score,
            publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : null, retrievedAt };
        });
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof SearchFailure) throw error;
        throw new SearchFailure();
      }
    },
  };
}
