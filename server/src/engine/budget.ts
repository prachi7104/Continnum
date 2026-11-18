// Accounts for one Phase 1 generation and its physical attempts against a monotonic deadline.
import type { Monotonic } from '../clock.ts';

export const firstByteMs = 8000;
export const minimumFallbackMs = 6000;
export const maxAttempts = 3;

export class TurnBudget {
  readonly started: number;
  attempts = 0;
  private readonly clock: Monotonic;
  private readonly deadlineMs: number;
  constructor(clock: Monotonic, deadlineMs: number) {
    this.clock = clock;
    this.deadlineMs = deadlineMs;
    this.started = clock.ms();
  }
  elapsed() { return Math.max(0, Math.round(this.clock.ms() - this.started)); }
  remaining() { return Math.max(0, this.deadlineMs - (this.clock.ms() - this.started)); }
  canFallback() { return this.attempts < maxAttempts && this.remaining() >= minimumFallbackMs; }
}
