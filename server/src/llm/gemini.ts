// Sets up single-step Google SDK transport for qualification and live chat.
import { createGoogle } from '@ai-sdk/google';
import { APICallError, isStepCount, streamText, tool } from 'ai';
import { z } from 'zod';
import { ModelFailure, type ModelProvider } from './provider.ts';

export const singleStep = { stopWhen: isStepCount(1), maxRetries: 0 };
export const candidates = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];
const searchInput = z.object({ query: z.string().trim().min(1).max(500), entity: z.string().trim().min(1).max(100) });
export const researchTools = {
  web_search: tool({ description: 'Search the current web for a query about a named entity or topic.', inputSchema: searchInput }),
};

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
    acceptsOmittedTools: (model) => model === 'gemini-3.5-flash-lite',
    async *research(input, signal) {
      try {
        signal.throwIfAborted();
        const result = streamText({
          ...singleStep, model: oneGoogleRequest(apiKey, input.model, request), system: input.system,
          messages: input.messages, abortSignal: signal, maxOutputTokens: 4096,
          ...(input.mode === 'omitted' ? {} : { tools: researchTools, toolChoice: input.mode }),
        });
        for await (const part of result.fullStream) {
          signal.throwIfAborted();
          if (part.type === 'error') throw modelFailure(part.error);
          if (part.type === 'text-delta' && part.text) yield part.text;
          if (part.type === 'tool-call') yield { activity: true };
        }
        signal.throwIfAborted();
        const [reason, calls, response] = await Promise.all([result.finishReason, result.toolCalls, result.response]);
        if (reason === 'content-filter') throw new ModelFailure('safety');
        if (reason === 'error') throw new ModelFailure('provider');
        yield {
          calls: calls.map((call) => {
            const parsed = call.toolName === 'web_search' ? searchInput.safeParse(call.input) : undefined;
            return { id: call.toolCallId, toolName: call.toolName,
              query: parsed?.success ? parsed.data.query : '', entity: parsed?.success ? parsed.data.entity : '' };
          }),
          messages: response.messages,
        };
      } catch (error) {
        signal.throwIfAborted();
        throw modelFailure(error);
      }
    },
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
