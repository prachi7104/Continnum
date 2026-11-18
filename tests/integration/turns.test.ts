// Exercises application requests and proves abort behavior over a real HTTP socket.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { serve } from '@hono/node-server';
import { test } from '../test.ts';
import { createApp } from '../../server/src/api/routes.ts';
import { LogicalClock, monotonic, wallClock } from '../../server/src/clock.ts';
import { DiagnosticDatabase, Repo } from '../../server/src/db/repo.ts';
import { ModelFailure, type ModelProvider } from '../../server/src/llm/provider.ts';
import { eventSchema } from '../../shared/events.ts';

const basic: ModelProvider = { name: 'mock', models: ['one'], async *generate() { await Promise.resolve(); yield 'response'; } };
function setup(model: ModelProvider | null, deadlineMs = 1000) {
  const dir = mkdtempSync(join(tmpdir(), 'continuum-integration-'));
  const repo = new Repo(dir, false, wallClock);
  const clock = new LogicalClock(repo, wallClock);
  const id = repo.create('live', clock.now('live').toISOString());
  const app = createApp({ repo, model, logical: clock, wall: wallClock, monotonic, deadlineMs, fakeMode: false,
    hasGeminiKey: Boolean(model), hasTavilyKey: false, labEnabled: false });
  const path = '/api/conversations/' + id + '/turns';
  const input = (clientTurnId: string, text = 'hello', signal?: AbortSignal, tz = 'UTC') => ({
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, tz, clientTurnId }),
  });
  function attempts() {
    const db = new DiagnosticDatabase(join(dir, 'continuum.db'));
    try { return db.prepare('SELECT model, outcome, http_status AS status FROM attempts ORDER BY rowid').all().map(row => ({ ...row })); }
    finally { db.close(); }
  }
  return { app, id, repo, path, input, attempts, close: () => { repo.close(); rmSync(dir, { recursive: true, force: true }); } };
}
async function events(response: Response) {
  assert.equal(response.status, 200);
  return (await response.text()).split('\n').filter((line) => line.startsWith('data: '))
    .map((line) => eventSchema.parse(JSON.parse(line.slice(6))));
}
async function readPartial(response: Response) {
  const reader = response.body?.getReader();
  assert.ok(reader);
  let data = '';
  while (!data.includes('answer.delta')) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false, 'stream closed before answer');
    data += new TextDecoder().decode(chunk.value);
  }
  return reader;
}
async function awaitTerminal(repo: Repo, id: string) {
  for (let attempt = 0; attempt < 100 && repo.activeTurn(id); attempt++) await wait(10);
  assert.equal(repo.activeTurn(id), undefined, 'turn lock must be released');
}
function paused(onAbort: () => void): ModelProvider {
  return {
    ...basic,
    async *generate(input, signal) {
      if (input.messages.at(-1)?.content === 'hello again') { yield 'next'; return; }
      try {
        yield 'partial answer';
        await wait(10000, undefined, { signal });
      } finally {
        if (signal.aborted) onAbort();
      }
    },
  };
}

test('success persists text, warnings and monotonic stats in one terminal event', async () => {
  const db = setup(basic);
  try {
    const result = await events(await db.app.request(db.path, db.input('a', 'Latest Node version?')));
    assert.deepEqual(result.map((frame) => frame.type), ['turn.started', 'answer.delta', 'answer.delta', 'turn.completed']);
    assert.deepEqual(result.map((frame) => frame.seq), [1, 2, 3, 4]);
    assert.equal(new Set(result.map((frame) => frame.turnId)).size, 1);
    const terminal = result.at(-1);
    assert.ok(terminal?.type === 'turn.completed');
    const { attempts, generations, modelUsed, route, tFirstAnswerTextMs, tFirstProgressMs, tTotalMs } = terminal.stats;
    assert.deepEqual({ attempts, generations, modelUsed, route }, { attempts: 1, generations: 1, modelUsed: 'one', route: 'research' });
    assert.ok(tFirstProgressMs !== null && tFirstAnswerTextMs !== null && tFirstProgressMs <= tFirstAnswerTextMs && tFirstAnswerTextMs <= tTotalMs);
    const row = db.repo.detail(db.id)?.messages[1];
    assert.equal(row?.status, 'complete');
    assert.match(String(row?.content), /^Web research isn't built/);
    assert.deepEqual(row?.stats, terminal.stats);
  } finally { db.close(); }
});

test('active-turn and duplicate conflicts write no additional messages or provider attempts', async () => {
  const db = setup(paused(() => undefined));
  try {
    const stop = new AbortController();
    const first = await db.app.request(db.path, db.input('a', 'hello', stop.signal));
    const reader = await readPartial(first);
    for (const [key, code] of [['a', 'DUPLICATE_TURN'], ['b', 'TURN_IN_PROGRESS']]) {
      const conflict = await db.app.request(db.path, db.input(key));
      assert.equal(conflict.status, 409);
      assert.equal((await conflict.json()).code, code);
    }
    stop.abort();
    await reader.cancel();
    await awaitTerminal(db.repo, db.id);
    const duplicate = await db.app.request(db.path, db.input('a'));
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).status, 'done');
    assert.equal(db.repo.detail(db.id)?.messages.length, 2);
    assert.equal(db.attempts().length, 1);
  } finally { db.close(); }
});

test('request cancellation keeps streamed text, aborts the provider and admits the next turn', async () => {
  let aborted = false;
  const db = setup(paused(() => { aborted = true; }));
  try {
    const stop = new AbortController();
    const first = await db.app.request(db.path, db.input('a', 'hello', stop.signal));
    const reader = await readPartial(first);
    stop.abort();
    await reader.cancel();
    await awaitTerminal(db.repo, db.id);
    assert.equal(aborted, true);
    const row = db.repo.detail(db.id)?.messages[1];
    assert.equal(row?.status, 'cancelled');
    assert.equal(row?.terminalCode, 'CANCELLED');
    assert.equal(row?.content, 'partial answer');
    assert.equal((await events(await db.app.request(db.path, db.input('b', 'hello again')))).at(-1)?.type, 'turn.completed');
  } finally { db.close(); }
});

test('deadline yields one DEADLINE error and stores partial content', async () => {
  const db = setup(paused(() => undefined), 100);
  try {
    const frames = await events(await db.app.request(db.path, db.input('a')));
    const failure = frames.at(-1);
    assert.ok(failure?.type === 'turn.error');
    assert.equal(failure.code, 'DEADLINE');
    assert.equal(failure.partialSaved, true);
    assert.equal(db.repo.detail(db.id)?.messages[1]?.status, 'partial');
    assert.equal(db.repo.activeTurn(db.id), undefined);
  } finally { db.close(); }
});

test('keyless health and turn failure are explicit, persisted and provider-free', async () => {
  const db = setup(null);
  try {
    const health = await (await db.app.request('/api/health')).json();
    assert.equal(health.fakeMode, false);
    assert.equal(health.providers.model, 'missing_key');
    const frames = await events(await db.app.request(db.path, db.input('a')));
    assert.deepEqual(frames.map((event) => event.type), ['turn.started', 'turn.error']);
    const error = frames.at(-1);
    assert.ok(error?.type === 'turn.error');
    assert.equal(error.code, 'NOT_CONFIGURED');
    assert.equal(db.repo.detail(db.id)?.messages[1]?.content, '');
    assert.deepEqual(db.attempts(), []);
  } finally { db.close(); }
});

test('fallback records 429 and 404 before succeeding on the third model', async () => {
  const trace: string[] = [];
  const db = setup({
    ...basic, models: ['rate-limited', 'missing', 'working'],
    async *generate({ model }) {
      await Promise.resolve();
      trace.push(model);
      const reserved = db.attempts().at(-1);
      assert.equal(reserved?.model, model);
      assert.equal(reserved?.outcome, null);
      if (model === 'rate-limited') throw new ModelFailure('http', 429);
      if (model === 'missing') throw new ModelFailure('http', 404);
      yield 'valid';
    },
  }, 9000);
  try {
    const frames = await events(await db.app.request(db.path, db.input('a')));
    assert.equal(frames.at(-1)?.type, 'turn.completed');
    assert.deepEqual(trace, ['rate-limited', 'missing', 'working']);
    assert.deepEqual(db.attempts().map(({ status }) => status), [429, 404, null]);
  } finally { db.close(); }
});

test('fallback caps physical attempts at three and requires six seconds remaining', async () => {
  for (const [deadline, count] of [[9000, 3], [5000, 1]] as const) {
    const db = setup({ ...basic, models: ['one', 'two', 'three', 'four'], async *generate() {
      await Promise.resolve();
      throw new ModelFailure('network');
    } }, deadline);
    try {
      const failure = (await events(await db.app.request(db.path, db.input('a')))).at(-1);
      assert.ok(failure?.type === 'turn.error');
      assert.equal(failure.code, 'PROVIDER_UNAVAILABLE');
      assert.equal(db.attempts().length, count);
    } finally { db.close(); }
  }
});

test('bad input, authentication and safety failures never fall back', async () => {
  for (const [error, code] of [
    [new ModelFailure('http', 400), 'PROVIDER_UNAVAILABLE'], [new ModelFailure('http', 401), 'CONFIG_ERROR'],
    [new ModelFailure('http', 403), 'CONFIG_ERROR'], [new ModelFailure('safety'), 'PROVIDER_UNAVAILABLE'],
  ] as const) {
    const db = setup({ ...basic, models: ['one', 'two'], async *generate() {
      await Promise.resolve();
      throw error;
    } }, 9000);
    try {
      const failure = (await events(await db.app.request(db.path, db.input('a')))).at(-1);
      assert.ok(failure?.type === 'turn.error');
      assert.equal(failure.code, code);
      assert.equal(db.attempts().length, 1);
    } finally { db.close(); }
  }
});

test('a transient failure after the first visible delta preserves partial text and never switches models', async () => {
  const db = setup({ ...basic, models: ['one', 'two'], async *generate() {
    await Promise.resolve();
    yield 'first model only';
    throw new ModelFailure('http', 503);
  } }, 9000);
  try {
    const frames = await events(await db.app.request(db.path, db.input('a')));
    const last = frames.at(-1);
    assert.ok(last?.type === 'turn.error');
    assert.equal(last.partialSaved, true);
    assert.deepEqual(frames.filter((frame) => frame.type === 'answer.delta').map(({ text }) => text), ['first model only']);
    assert.equal(db.repo.detail(db.id)?.messages[1]?.content, 'first model only');
    assert.equal(db.attempts().length, 1);
  } finally { db.close(); }
});

test('validates time zones, rejects selection and caps buffered or chunked bodies', async () => {
  const db = setup(basic);
  try {
    const invalidZone = await db.app.request(db.path, db.input('a', 'hello', undefined, 'No/SuchZone'));
    assert.equal(invalidZone.status, 422);
    assert.equal((await invalidZone.json()).code, 'INVALID_TZ');
    const invalidSelection = await db.app.request(db.path, { ...db.input('b'), body: JSON.stringify({ text:'hello', tz:'UTC', clientTurnId:'b', selection: {} }) });
    assert.equal((await invalidSelection.json()).code, 'INVALID_SELECTION');
    const oversized = await db.app.request(db.path, db.input('c', 'z'.repeat(33 * 1024)));
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).code, 'BODY_TOO_LARGE');
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(33 * 1024)); controller.close(); } });
    const chunked = await db.app.request(new Request('http://localhost' + db.path, {
      body, method: 'POST', duplex: 'half', headers: { 'Content-Type': 'application/json' },
    } as RequestInit));
    assert.equal(chunked.status, 413);
    assert.equal(db.repo.detail(db.id)?.messages.length, 0);
  } finally { db.close(); }
});

test('a real HTTP disconnect aborts the provider, keeps partial text and releases the turn lock', async () => {
  let providerAborted = false;
  const db = setup(paused(() => { providerAborted = true; }));
  const server = serve({ fetch: db.app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    await once(server, 'listening');
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const url = 'http://127.0.0.1:' + addr.port + db.path;
    const socket = new AbortController();
    const response = await fetch(url, db.input('real-http', 'hello', socket.signal));
    const reader = await readPartial(response);
    socket.abort();
    await reader.cancel().catch(() => undefined);
    await awaitTerminal(db.repo, db.id);
    assert.equal(providerAborted, true);
    const row = db.repo.detail(db.id)?.messages[1];
    assert.equal(row?.status, 'cancelled');
    assert.equal(row?.terminalCode, 'CANCELLED');
    assert.equal(row?.content, 'partial answer');
    assert.equal((await events(await fetch(url, db.input('after', 'hello again')))).at(-1)?.type, 'turn.completed');
  } finally {
    if ('closeAllConnections' in server) server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});
