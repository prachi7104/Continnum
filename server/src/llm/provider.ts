// Shared streaming model contract and provider error classification.
export type ModelMessage = { role: 'user' | 'assistant'; content: string };
export type ModelRequest = { model: string; system: string; messages: ModelMessage[] };
export interface ModelProvider {
  readonly name: string;
  readonly models: readonly string[];
  generate(input: ModelRequest, signal: AbortSignal): AsyncIterable<string>;
}

export class ModelFailure extends Error {
  readonly kind: 'http' | 'network' | 'safety' | 'first_byte' | 'provider';
  readonly status?: number;
  constructor(kind: ModelFailure['kind'], status?: number) {
    super('Model attempt failed: ' + kind);
    this.kind = kind;
    this.status = status;
  }
}

export function canFallback(failure: unknown): boolean {
  if (!(failure instanceof ModelFailure)) return false;
  if (failure.kind === 'network' || failure.kind === 'first_byte') return true;
  return failure.kind === 'http' && (failure.status === 404 || failure.status === 429 ||
    (failure.status !== undefined && failure.status >= 500 && failure.status <= 599));
}
