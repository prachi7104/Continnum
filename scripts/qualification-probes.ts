// Exercises the frozen Gemini streaming, tool-history, structured-output and abort contract.
import { Output, streamText, tool, type ModelMessage } from 'ai';
import { z } from 'zod';
import { monotonic, wallClock } from '../server/src/clock.ts';
import { modelFailure, oneGoogleRequest, singleStep } from '../server/src/llm/gemini.ts';
import { ModelFailure } from '../server/src/llm/provider.ts';
import { fakeSearch } from '../server/src/search/fake.ts';

const searchInput = z.object({ query: z.string().min(1), entity: z.string().min(1) });
const tools = {
  web_search: tool({
    description: 'Search the web for a query concerning an entity.',
    inputSchema: searchInput,
  }),
};
const structuredOutput = Output.array({ element: z.object({ name: z.string() }) });
const search = fakeSearch(wallClock);
type GoogleModel = ReturnType<typeof oneGoogleRequest>;

export async function plain(model: GoogleModel, signal: AbortSignal) {
  const started = monotonic.ms();
  const result = streamText({
    ...singleStep, model, abortSignal: signal, prompt: 'Write two short sentences about a blue sky.',
  });
  let firstMs: number | null = null;
  for await (const frame of result.fullStream) {
    if (frame.type === 'error') throw modelFailure(frame.error);
    if (frame.type === 'text-delta' && frame.text) firstMs ??= Math.round(monotonic.ms() - started);
  }
  signal.throwIfAborted();
  if (firstMs === null || await result.finishReason === 'content-filter') throw new ModelFailure('provider');
  return { firstMs, totalMs: Math.round(monotonic.ms() - started) };
}

export async function toolHistory(model: GoogleModel, signal: AbortSignal): Promise<ModelMessage[]> {
  const messages: ModelMessage[] = [{
    role: 'user', content: 'In one step, call web_search twice in parallel: once for the parks in Boston and once for the museums in Seattle. Use Boston and Seattle as the respective entities.',
  }];
  const result = streamText({
    ...singleStep, model, abortSignal: signal, messages, tools, toolChoice: 'required',
  });
  for await (const frame of result.fullStream) if (frame.type === 'error') throw modelFailure(frame.error);
  signal.throwIfAborted();
  const [steps, calls, results, response] = await Promise.all([result.steps, result.toolCalls, result.toolResults, result.response]);
  const inputs = calls.map((call) => {
    if (call.toolName !== 'web_search') throw new ModelFailure('provider');
    const parsed = searchInput.safeParse(call.input);
    if (!parsed.success) throw new ModelFailure('provider');
    return { toolCallId: call.toolCallId, ...parsed.data };
  });
  const distinct = new Set(inputs.map(({ entity }) => entity.trim().toLowerCase()).filter(Boolean));
  if (steps.length !== 1 || calls.length < 2 || distinct.size < 2 || results.length) {
    throw new ModelFailure('provider');
  }
  const content = await Promise.all(inputs.map(async ({ toolCallId, query }) => ({
    type: 'tool-result' as const, toolCallId, toolName: 'web_search',
    output: { type: 'text' as const, value: JSON.stringify(await search.search(query, signal)) },
  })));
  return [...messages, ...response.messages, { role: 'tool', content }];
}

export async function finalGeneration(model: GoogleModel, signal: AbortSignal, history: ModelMessage[], mode: 'none' | 'omitted') {
  const result = streamText({
    ...singleStep, model, abortSignal: signal, messages: history,
    ...(mode === 'none' ? { tools, toolChoice: 'none' as const } : {}),
  });
  let hasText = false;
  for await (const frame of result.fullStream) {
    if (frame.type === 'error') throw modelFailure(frame.error);
    if (frame.type === 'text-delta' && frame.text.trim()) hasText = true;
    if (frame.type === 'tool-call') throw new ModelFailure('provider');
  }
  signal.throwIfAborted();
  if (!hasText || await result.finishReason === 'content-filter') throw new ModelFailure('provider');
}

export async function outputArray(model: GoogleModel, signal: AbortSignal) {
  const result = streamText({
    ...singleStep, model, abortSignal: signal, output: structuredOutput,
    prompt: 'Return two objects, each with a name field containing a different common color.',
  });
  let count = 0;
  for await (const element of result.elementStream) if (element.name.trim()) count++;
  signal.throwIfAborted();
  if (count !== 2 || (await result.output).length !== 2) throw new ModelFailure('provider');
}

export async function cancellation(model: GoogleModel, timeout: AbortSignal) {
  const controller = new AbortController();
  const signal = AbortSignal.any([timeout, controller.signal]);
  let observed = false;
  let deltas = 0;
  const result = streamText({
    ...singleStep, model, abortSignal: signal,
    prompt: 'Write a 500-word story about a day on a farm.',
    onAbort: () => { observed = true; },
  });
  try {
    for await (const frame of result.fullStream) {
      if (frame.type === 'error' && !controller.signal.aborted) throw modelFailure(frame.error);
      if (frame.type === 'text-delta' && frame.text) {
        deltas++;
        if (deltas === 1) controller.abort();
      }
    }
  } catch (error) {
    if (!(controller.signal.aborted && error instanceof Error && error.name === 'AbortError')) throw error;
  }
  timeout.throwIfAborted();
  if (!observed || deltas !== 1) throw new ModelFailure('provider');
}
