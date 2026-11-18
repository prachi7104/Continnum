// Exposes local chat and conversation APIs with bounded JSON bodies and typed failures.
import { Hono } from 'hono';
import type { Context } from 'hono';
import { workspaceSchema, turnRequest, type ErrorCode } from '../../../shared/events.ts';
import { type LogicalClock, type Monotonic, type WallClock } from '../clock.ts';
import type { Repo } from '../db/repo.ts';
import { classify } from '../engine/route.ts';
import type { TurnLimits } from '../engine/budget.ts';
import { runTurn } from '../engine/turn.ts';
import type { ModelProvider } from '../llm/provider.ts';
import type { SearchProvider } from '../search/provider.ts';
import { turnStream } from './sse.ts';

const bodyLimit = 32 * 1024;
class BodyTooLarge extends Error {}

type AppOptions = {
  repo: Repo; logical: LogicalClock; wall: WallClock; monotonic: Monotonic; deadlineMs: number;
  model: ModelProvider | null; fakeMode: boolean; hasGeminiKey: boolean; hasTavilyKey: boolean;
  search?: SearchProvider | null;
  turnLimits?: TurnLimits;
  labEnabled: boolean;
};

function problem(c: Context, status: 400 | 404 | 409 | 413 | 422 | 500, code: ErrorCode,
  message: string, details = {}) {
  return c.json({ code, message, ...details }, status);
}

async function jsonBody(c: Context): Promise<unknown> {
  if (Number(c.req.header('Content-Length')) > bodyLimit) throw new BodyTooLarge();
  if (c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new Error('Expected application/json');
  }
  const reader = c.req.raw.body?.getReader();
  if (!reader) throw new Error('Missing request body');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let body = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > bodyLimit) {
        void reader.cancel().catch(() => undefined);
        throw new BodyTooLarge();
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(body + decoder.decode()) as unknown;
  } finally {
    reader.releaseLock();
  }
}

function invalidBody(c: Context, error: unknown) {
  return error instanceof BodyTooLarge
    ? problem(c, 413, 'BODY_TOO_LARGE', 'The body exceeds 32 KB.')
    : problem(c, 400, 'INVALID_REQUEST', 'Send a valid JSON request body.');
}

export function createApp(options: AppOptions) {
  const { repo, wall, logical, model, fakeMode, hasGeminiKey, hasTavilyKey, labEnabled } = options;
  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.onError((_error, c) => problem(c, 500, 'INTERNAL', 'Continuum could not complete this request.'));
  app.notFound((c) => problem(c, 404, 'NOT_FOUND', 'This endpoint does not exist.'));

  app.get('/api/health', (c) => c.json({
    ok: true, node: process.versions.node, db: 'ready',
    providers: { model: fakeMode ? 'fake' : model ? 'ready' : 'missing_key',
      search: fakeMode ? 'fake' : hasTavilyKey ? 'ready' : 'missing_key' },
    lab: { enabled: labEnabled }, fakeMode,
  }));

  app.get('/api/conversations', (c) => {
    const workspace = workspaceSchema.safeParse(c.req.query('workspace') ?? 'live');
    if (!workspace.success) return problem(c, 422, 'INVALID_REQUEST', 'Unknown workspace.');
    return c.json(repo.list(workspace.data));
  });

  app.post('/api/conversations', async (c) => {
    let value: unknown;
    try { value = await jsonBody(c); } catch (error) { return invalidBody(c, error); }
    const workspace = workspaceSchema.safeParse((value as { workspace?: unknown } | null)?.workspace);
    if (!workspace.success) return problem(c, 422, 'INVALID_REQUEST', 'Choose a workspace.');
    return c.json({ id: repo.create(workspace.data, logical.now(workspace.data).toISOString()) }, 201);
  });

  app.get('/api/conversations/:id', (c) => {
    const detail = repo.detail(c.req.param('id'));
    return detail ? c.json(detail) : problem(c, 404, 'NOT_FOUND', 'Conversation not found.');
  });

  app.delete('/api/conversations/:id', (c) => {
    const id = c.req.param('id');
    const result = repo.delete(id);
    if (result === 'missing') return problem(c, 404, 'NOT_FOUND', 'Conversation not found.');
    if (result === 'busy') return problem(c, 409, 'TURN_IN_PROGRESS', 'A turn is in progress.', { turnId: repo.activeTurn(id) });
    return c.body(null, 204);
  });

  app.post('/api/conversations/:id/turns', async (c) => {
    let value: unknown;
    try { value = await jsonBody(c); } catch (error) { return invalidBody(c, error); }
    const request = turnRequest.safeParse(value);
    if (!request.success) return problem(c, 422, 'INVALID_REQUEST', 'Enter a message within 8,000 characters and supply the client turn ID and time zone.');
    const { text, tz, clientTurnId, selection } = request.data;
    if (selection !== undefined) return problem(c, 422, 'INVALID_SELECTION', 'This conversation has no selectable clarification.');
    let formatter: Intl.DateTimeFormat;
    try {
      if (/^[+-]/.test(tz)) throw new Error('Use IANA zone');
      formatter = new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: tz });
    } catch {
      return problem(c, 422, 'INVALID_TZ', 'Use an IANA time zone such as Asia/Kolkata.');
    }
    const id = c.req.param('id');
    const conversation = repo.conversation(id);
    if (!conversation) return problem(c, 404, 'NOT_FOUND', 'Conversation not found.');
    const realNow = wall.nowIso();
    const logicalNow = logical.now(conversation.workspace, realNow);
    const route = classify(text, Number(formatter.format(logicalNow)));
    const admitted = repo.admit({ conversationId: id, clientTurnId, text, tz, route, logicalNow, realNow });
    if (admitted.kind === 'duplicate') return problem(c, 409, 'DUPLICATE_TURN', 'That turn was already submitted.', admitted.existing);
    if (admitted.kind === 'busy') return problem(c, 409, 'TURN_IN_PROGRESS', 'A turn is in progress.', { turnId: admitted.turnId });
    if (admitted.kind === 'missing') return problem(c, 404, 'NOT_FOUND', 'Conversation not found.');
    return turnStream(c, admitted.turn.id, (clientSignal, send) => runTurn(
      { ...options, unqualified: hasGeminiKey },
      { turn: admitted.turn, text, tz, route, logicalNow, realNow, clientSignal, send },
    ));
  });
  return app;
}
