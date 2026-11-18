// Sets up single-step Google SDK transport for qualification and live chat.
import { createGoogle } from '@ai-sdk/google';
import { APICallError, isStepCount, streamText } from 'ai';
import { ModelFailure, type ModelProvider } from './provider.ts';

export const singleStep = { stopWhen: isStepCount(1), maxRetries: 0 };
export const candidates = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];

export function oneGoogleRequest(apiKey: string, model: string, request: typeof fetch = fetch) {
  let dispatched = false;
  return createGoogle({
    apiKey,
    fetch: async (input, options) => {
      if (dispatched) throw new ModelFailure('provider');
      dispatched = true;
      try {
        return await request(input, { ...options, redirect: 'error' });
      } catch (error) {
        options?.signal?.throwIfAborted();
        throw new ModelFailure(error instanceof TypeError ? 'network' : 'provider');
      }
    },
  })(model);
}

export function geminiModel(apiKey: string, models: readonly string[], request: typeof fetch = fetch): ModelProvider {
  return {
    name: 'gemini',
    models,
    async *generate(input, signal) {
      try {
        signal.throwIfAborted();
        const result = streamText({
          ...singleStep,
          model: oneGoogleRequest(apiKey, input.model, request),
          system: input.system,
          messages: input.messages,
          abortSignal: signal,
        });
        for await (const part of result.fullStream) {
          signal.throwIfAborted();
          if (part.type === 'error') throw modelFailure(part.error);
          if (part.type === 'text-delta' && part.text) yield part.text;
        }
        signal.throwIfAborted();
        const reason = await result.finishReason;
        if (reason === 'content-filter') throw new ModelFailure('safety');
        if (reason === 'error') throw new ModelFailure('provider');
      } catch (error) {
        signal.throwIfAborted();
        throw modelFailure(error);
      }
    },
  };
}

export function modelFailure(error: unknown): ModelFailure {
  if (error instanceof ModelFailure) return error;
  if (APICallError.isInstance(error)) {
    if (error.statusCode !== undefined) return new ModelFailure('http', error.statusCode);
    if (error.cause instanceof ModelFailure) return error.cause;
    if (error.cause instanceof TypeError) return new ModelFailure('network');
  }
  return new ModelFailure('provider');
}
