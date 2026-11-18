// Tracks generation, search and retry bounds against one monotonic deadline.
import type { Monotonic } from '../clock.ts';

export const firstByteMs = 8000;
export const minimumFallbackMs = 6000;
export const maxGenerations = 3;
export const maxRounds = 2;
export const maxQueries = 10;
export const maxRoundQueries = 6;

const defaultLimits = { generations: maxGenerations, rounds: maxRounds, queries: maxQueries,
  roundQueries: maxRoundQueries, extraAttempts: 2, retrySearch: true };
export type TurnLimits = typeof defaultLimits;

export class TurnBudget {
  readonly started: number;
  attempts = 0;
  generations = 0;
  rounds = 0;
  searches = 0;
  credits = 0;
  private readonly clock: Monotonic;
  private readonly deadlineMs: number;
  constructor(clock: Monotonic, deadlineMs: number, readonly limits: TurnLimits = defaultLimits) {
    this.clock = clock;
    this.deadlineMs = deadlineMs;
    this.started = clock.ms();
  }
  elapsed() { return Math.max(0, Math.round(this.clock.ms() - this.started)); }
  remaining() { return Math.max(0, this.deadlineMs - (this.clock.ms() - this.started)); }
  canAttempt() { return this.attempts < this.generations + this.limits.extraAttempts; }
  canFallback() { return this.limits.extraAttempts > 0 && this.canAttempt() && this.remaining() >= minimumFallbackMs; }
  isFinal() {
    return this.generations >= this.limits.generations || this.rounds >= this.limits.rounds ||
      this.searches >= this.limits.queries || this.credits >= this.limits.queries || this.remaining() <= firstByteMs;
  }
}
