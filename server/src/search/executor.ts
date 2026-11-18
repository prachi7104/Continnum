// Admits distinct queries and executes only bounded, ledgered search work.
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { TurnEventBody } from '../../../shared/events.ts';
import type { TurnBudget } from '../engine/budget.ts';
import type { ToolCall } from '../llm/provider.ts';
import { SearchFailure, type SearchHit, type SearchProvider } from './provider.ts';

export const normalizeQuery = (query: string) => query.normalize('NFKC').trim().replace(/\s+/g, ' ');
type Result = { hits: SearchHit[]; error?: 'SEARCH_UNAVAILABLE'; skipped?: 'budget' | 'invalid'; queried?: true };
type Start = (query: string) => (outcome: string, status?: number) => void;

export class SearchExecutor {
  readonly queries = new Map<string, Promise<Result>>();
  private inRound = 0;
  constructor(private readonly provider: SearchProvider, private readonly budget: TurnBudget,
    private readonly signal: AbortSignal, private readonly send: (event: TurnEventBody) => Promise<void>, private readonly start: Start) {}

  nextRound() { this.inRound = 0; }

  async run(calls: readonly ToolCall[]): Promise<Result[]> {
    const work = calls.map(({ query, entity }): Promise<Result> => {
      query = normalizeQuery(query);
      const key = query.toLowerCase();
      if (!query || !entity.trim()) return Promise.resolve({ hits: [], skipped: 'invalid' });
      const cached = this.queries.get(key);
      if (cached) return cached;
      const { roundQueries, queries } = this.budget.limits;
      if (this.inRound >= roundQueries || this.budget.searches >= queries || this.budget.credits >= queries)
        return Promise.resolve({ hits: [], skipped: 'budget' });
      this.inRound++;
      this.budget.searches++;
      const request = this.dispatch(query, entity);
      this.queries.set(key, request);
      return request;
    });
    const results = await Promise.allSettled(work);
    this.signal.throwIfAborted();
    // Transport failures are handled by dispatch. A rejection here can only be a lifecycle/storage failure.
    return results.map((result) => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    });
  }

  private async dispatch(query: string, entity: string): Promise<Result> {
    const queryId = randomUUID();
    const began = this.budget.elapsed();
    const round = this.budget.rounds;
    // Reserve synchronously before the first await so other queries cannot take this slot.
    if (this.budget.credits >= this.budget.limits.queries) return { hits: [], skipped: 'budget' };
    this.budget.credits++;
    await this.send({ type: 'search.started', queryId, query, entity, round });
    let outcome: Result = { hits: [], error: 'SEARCH_UNAVAILABLE', queried: true };
    const maxAttempts = this.budget.limits.retrySearch ? 2 : 1;
    for (let index = 0; index < maxAttempts; index++) {
      this.signal.throwIfAborted();
      const finish = this.start(query);
      const timeout = AbortSignal.timeout(Math.max(1, Math.min(7000, Math.floor(this.budget.remaining()))));
      try {
        const hits = await this.provider.search(query, AbortSignal.any([this.signal, timeout]));
        this.signal.throwIfAborted();
        timeout.throwIfAborted();
        finish('ok');
        outcome = { hits, queried: true };
        break;
      } catch (error) {
        const failure = error instanceof SearchFailure ? error : undefined;
        finish(this.signal.aborted ? 'aborted' : timeout.aborted ? 'timeout' : 'search_error', failure?.status);
        this.signal.throwIfAborted();
        const delay = failure?.retryAfterMs;
        if (index + 1 >= maxAttempts || failure?.status !== 429 || delay === undefined || delay > 3000 || delay >= this.budget.remaining()) break;
        await sleep(delay, undefined, { signal: this.signal });
        if (this.budget.credits >= this.budget.limits.queries || this.budget.remaining() <= 0) break;
        this.budget.credits++;
      }
    }
    await this.send({ type: 'search.finished', queryId, resultCount: outcome.hits.length,
      ms: this.budget.elapsed() - began, ...(outcome.error ? { error: outcome.error } : {}) });
    return outcome;
  }
}
