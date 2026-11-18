// Sets up single-step Google SDK transport for provider qualification.
import { createGoogle } from '@ai-sdk/google';
import { APICallError, isStepCount } from 'ai';
import { ModelFailure } from './provider.ts';

export const singleStep = { stopWhen: isStepCount(1), maxRetries: 0 };
export const candidates = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];

export function oneGoogleRequest(apiKey: string, model: string) {
  let dispatched = false;
  return createGoogle({
    apiKey,
    fetch: async (input, options) => {
      if (dispatched) throw new ModelFailure('provider');
      dispatched = true;
      try {
        return await fetch(input, { ...options, redirect: 'error' });
      } catch (error) {
        options?.signal?.throwIfAborted();
        throw new ModelFailure(error instanceof TypeError ? 'network' : 'provider');
      }
    },
  })(model);
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
