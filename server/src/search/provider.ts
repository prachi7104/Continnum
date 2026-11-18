// Defines normalized basic-search hits and typed failures for the adapter and future executor.
export type SearchHit = { url: string; title: string; content: string; score: number; publishedAt: string | null; retrievedAt: string };
export interface SearchProvider {
  readonly name: string;
  search(query: string, signal: AbortSignal): Promise<SearchHit[]>;
}
export class SearchFailure extends Error {
  readonly code = 'SEARCH_UNAVAILABLE';
  readonly status?: number;
  readonly retryAfterMs?: number;
  constructor(status?: number, retryAfterMs?: number) {
    super('Search is unavailable');
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}
