// Shared streaming chat and single-step research contracts.
import type { ModelMessage as SDKMessage } from 'ai';

export type ModelMessage = { role: 'user' | 'assistant'; content: string };
export type ModelRequest = { model: string; system: string; messages: ModelMessage[] };
export type ToolCall = { id: string; query: string; entity: string; toolName?: string };
export type ResearchChunk = string | { activity: true } | { calls: ToolCall[]; messages: SDKMessage[] };
export type ResearchMode = 'required' | 'auto' | 'none' | 'omitted';
export type ResearchRequest = Omit<ModelRequest, 'messages'> & { messages: SDKMessage[]; mode: ResearchMode };
export interface ModelProvider {
  readonly name: string;
  readonly models: readonly string[];
  generate(input: ModelRequest, signal: AbortSignal): AsyncIterable<string>;
  research?(input: ResearchRequest, signal: AbortSignal): AsyncIterable<ResearchChunk>;
  acceptsOmittedTools?(model: string): boolean;
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
