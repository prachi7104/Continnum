// Owns attempt admission, fallback, incremental persistence and one terminal transition.
import type { ErrorCode, Route, Stats, TurnEventBody } from '../../../shared/events.ts';
import type { Monotonic } from '../clock.ts';
import type { Repo, Turn } from '../db/repo.ts';
import { canFallback, ModelFailure, type ModelProvider } from '../llm/provider.ts';
import { researchPrefix, systemPrompt } from '../llm/prompts.ts';
import { firstByteMs, TurnBudget } from './budget.ts';

type TurnInput = {
  turn: Turn; text: string; tz: string; route: Route; logicalNow: Date; realNow: string;
  clientSignal: AbortSignal; send: (event: TurnEventBody) => Promise<void>;
};
type Options = { repo: Repo; model: ModelProvider | null; monotonic: Monotonic; deadlineMs: number; unqualified: boolean };
const messages: Partial<Record<ErrorCode, string>> = {
  NOT_CONFIGURED: 'Live AI is not configured. Add GEMINI_API_KEY to the server environment.',
  CONFIG_ERROR: 'Live AI configuration needs attention. Check the key and qualified model order.',
  PROVIDER_UNAVAILABLE: 'The model could not finish this response.',
  CANCELLED: 'The response was stopped.',
  DEADLINE: 'The response reached its time limit.',
  INTERNAL: 'Continuum could not finish this turn.',
};

function untilAbort<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return operation();
    }).then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort);
    }).catch(reject);
  });
}

export async function runTurn(options: Options, input: TurnInput) {
  const { repo, model, monotonic, deadlineMs } = options;
  const { turn, logicalNow, realNow, route, tz, send, clientSignal } = input;
  const budget = new TurnBudget(monotonic, deadlineMs);
  const deadline = AbortSignal.timeout(deadlineMs);
  const signal = AbortSignal.any([clientSignal, deadline]);
  const stats: Stats = {
    generations: 0, attempts: 0, modelUsed: null, route,
    tFirstProgressMs: null, tFirstAnswerTextMs: null, tTotalMs: 0,
  };
  let partial = false;
  let code: ErrorCode | 'COMPLETED' = 'INTERNAL';
  const checkDeadline = () => {
    signal.throwIfAborted();
    if (!budget.remaining()) throw new Error('Deadline reached');
  };
  const emitDelta = async (text: string) => {
    checkDeadline();
    repo.append(turn, text);
    partial = true;
    stats.tFirstAnswerTextMs ??= budget.elapsed();
    await untilAbort(() => send({ type: 'answer.delta', text }), signal);
  };

  try {
    checkDeadline();
    stats.tFirstProgressMs = budget.elapsed();
    await untilAbort(() => send({ type: 'turn.started', userMessageId: turn.userMessageId, assistantMessageId: turn.assistantMessageId,
      workspace: turn.workspace, logicalNow: logicalNow.toISOString(), realNow, tz, route }), signal);
    checkDeadline();

    if (!model || !model.models.length) {
      code = options.unqualified ? 'CONFIG_ERROR' : 'NOT_CONFIGURED';
    } else {
      stats.generations = 1;
      const context = repo.recent(turn);
      context.push({ role: 'user', content: input.text });
      const system = systemPrompt(logicalNow, tz);

      for (const name of model.models) {
        checkDeadline();
        const began = monotonic.ms();
        const attempt = repo.startAttempt(turn, model.name, name);
        budget.attempts += 1;
        stats.attempts = budget.attempts;
        const firstByte = new AbortController();
        const timer = setTimeout(() => firstByte.abort(new ModelFailure('first_byte')), firstByteMs);
        const attemptSignal = AbortSignal.any([signal, firstByte.signal]);
        let iterator: AsyncIterator<string> | undefined;
        let received = false;
        let outcome = 'provider_error';
        let httpStatus: number | undefined;
        try {
          iterator = model.generate({ model: name, system, messages: context }, attemptSignal)[Symbol.asyncIterator]();
          for (;;) {
            const attemptIterator = iterator;
            const chunk = await untilAbort(() => attemptIterator.next(), attemptSignal);
            checkDeadline();
            if (chunk.done) break;
            if (!chunk.value) continue;
            if (!received) {
              clearTimeout(timer);
              if (monotonic.ms() - began >= firstByteMs) throw new ModelFailure('first_byte');
              received = true;
              stats.modelUsed = name;
              if (route !== 'chat_plain') await emitDelta(researchPrefix);
            }
            await emitDelta(chunk.value);
          }
          if (!received) throw new ModelFailure('provider');
          outcome = 'ok';
          code = 'COMPLETED';
          break;
        } catch (failure) {
          const error = firstByte.signal.aborted ? firstByte.signal.reason as unknown : failure;
          httpStatus = error instanceof ModelFailure ? error.status : undefined;
          if (clientSignal.aborted) outcome = 'CANCELLED';
          else if (deadline.aborted || !budget.remaining()) outcome = 'DEADLINE';
          else if (error instanceof ModelFailure) outcome = error.kind;
          checkDeadline();
          if (!received && canFallback(error) && budget.canFallback()) continue;
          code = error instanceof ModelFailure && error.kind === 'http' && [401, 403].includes(error.status ?? 0)
            ? 'CONFIG_ERROR' : 'PROVIDER_UNAVAILABLE';
          break;
        } finally {
          clearTimeout(timer);
          void iterator?.return?.().catch(() => undefined);
          repo.finishAttempt(attempt, outcome, Math.max(0, monotonic.ms() - began), httpStatus);
        }
      }
      checkDeadline();
      if (code === 'INTERNAL') code = 'PROVIDER_UNAVAILABLE';
    }
  } catch {
    code = clientSignal.aborted ? 'CANCELLED' : deadline.aborted || !budget.remaining() ? 'DEADLINE' : 'INTERNAL';
  } finally {
    const status = code === 'COMPLETED' ? 'complete' : code === 'CANCELLED' ? 'cancelled'
      : code === 'DEADLINE' ? 'partial' : 'error';
    stats.tTotalMs = budget.elapsed();
    if (repo.finish(turn, code, status, stats) && !clientSignal.aborted) {
      await send(code === 'COMPLETED'
        ? { type: 'turn.completed', assistantMessageId: turn.assistantMessageId, stats }
        : { type: 'turn.error', code, message: messages[code] ?? messages.INTERNAL!, partialSaved: partial });
    }
  }
}
