// Drives deterministic model-directed research through the actual Hono SSE and SQLite path.
import { expect, test } from 'vitest';
import { serve } from '@hono/node-server';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { createApp } from '../../server/src/api/routes.ts';
import { LogicalClock, monotonic, wallClock } from '../../server/src/clock.ts';
import { Repo, DiagnosticDatabase } from '../../server/src/db/repo.ts';
import { ModelFailure, type ModelProvider, type ResearchRequest, type ToolCall } from '../../server/src/llm/provider.ts';
import { SearchFailure, type SearchProvider } from '../../server/src/search/provider.ts';
import { eventSchema } from '../../shared/events.ts';

function step(calls: ToolCall[]) {
  return { calls, messages: [{ role: 'assistant' as const, content: calls.map(({ id, entity, query }) => ({
    type: 'tool-call' as const, toolName: 'web_search', toolCallId: id, input: { query, entity },
  })) }] };
}
const query = (id: string, text = 'alpha prices', entity = 'Alpha') => ({ id, query: text, entity });
function scripted(run: NonNullable<ModelProvider['research']>): ModelProvider {
  return { name: 'fake', models: ['lite'], async *generate() { yield 'Hi there.'; },
    research: run, acceptsOmittedTools: (model) => model === 'lite' };
}
const sourceSearch: SearchProvider = { name: 'fake', async search(q) {
  if (q.includes('Beta')) throw new SearchFailure(432);
  return [{ url: 'https://alpha.com/price', title: 'Alpha pricing',
    content: 'Alpha costs $12 per month. Plans start here.', retrievedAt: wallClock.nowIso(), publishedAt: null, score: 1 }];
} };
function fixture(model: ModelProvider, search: SearchProvider | null = sourceSearch) {
  const dir = mkdtempSync(join(tmpdir(), 'continuum-research-'));
  const repo = new Repo(dir, true, wallClock);
  const app = createApp({ model, search, repo, wall: wallClock, logical: new LogicalClock(repo, wallClock), monotonic,
    deadlineMs: 30000, fakeMode: true, hasGeminiKey: false, hasTavilyKey: Boolean(search), labEnabled: false });
  const id = repo.create('live', wallClock.nowIso());
  const path = '/api/conversations/' + id + '/turns';
  const request = (text = 'What is the latest price?', key = 'test') => ({
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, tz: 'UTC', clientTurnId: key }),
  });
  return { app, repo, dir, id, path, request, close: () => { repo.close(); rmSync(dir, { recursive: true, force: true }); } };
}
async function read(response: Response) {
  expect(response.status).toBe(200);
  return (await response.text()).split(/\r?\n/).filter((line) => line.startsWith('data: ')).map((line) => eventSchema.parse(JSON.parse(line.slice(6))));
}
test('current research streams admitted progress, holds draft text, releases sourced text and reloads evidence over real HTTP', async () => {
  const requests: ResearchRequest[] = [];
  const model = scripted(async function* (input) {
    requests.push(input);
    if (input.mode === 'required') {
      yield 'Invented $99.';
      yield step([query('first'), query('duplicate', ' ALPHA   PRICES '), query('missing', 'Beta prices', 'Beta')]);
    } else {
      yield 'Alpha costs $12 [E1.1]. Alpha costs $99 [E1.1].';
      yield step([]);
    }
  });
  const db = fixture(model);
  const server = serve({ fetch: db.app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    await once(server, 'listening');
    const address = server.address();
    if (typeof address === 'string' || !address) throw Error('Missing test HTTP address');
    const base = 'http://127.0.0.1:' + address.port;
    const frames = await read(await fetch(base + db.path, db.request()));
    expect(frames.map((frame) => frame.type)).toContain('answer.withheld');
    expect(frames.filter((frame) => frame.type === 'search.started')).toHaveLength(3);
    expect(frames.filter((frame) => frame.type === 'answer.delta')).toHaveLength(0);
    expect(frames.at(-1)?.type).toBe('turn.completed');
    expect(requests.map(({ mode }) => mode)).toEqual(['required', 'auto']);
    expect(requests[1].messages.at(-1)).toMatchObject({ role: 'tool', content: [
      { toolCallId: 'first' }, { toolCallId: 'duplicate' }, { toolCallId: 'missing' },
    ] });
    const detail = await (await fetch(base + '/api/conversations/' + db.id)).json();
    const answer = detail.messages.at(-1);
    expect(answer.content).toContain('Alpha costs $12');
    expect(answer.content).not.toContain('$99');
    expect(answer.content).toContain("couldn't find current sources for Beta");
    expect(answer.evidence).toHaveLength(1);
    expect(answer.stats.coverage).toEqual([
      { entity: 'Alpha', queried: true, evidenceFound: true, supported: true },
      { entity: 'Beta', queried: true, evidenceFound: false, supported: false },
    ]);
    const sqlite = new DiagnosticDatabase(join(db.dir, 'continuum-fake.db'), { readOnly: true });
    try {
      expect(sqlite.prepare("SELECT count(*) AS n FROM attempts WHERE kind='search'").get()?.n).toBe(3);
      expect(sqlite.prepare('SELECT ref FROM citations').get()?.ref).toBe('E1.1');
    } finally { sqlite.close(); }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test('two rounds send results for budget skips and force a tool-disabled final generation', async () => {
  const modes: string[] = [];
  let lastHistory: ResearchRequest['messages'] = [];
  const db = fixture(scripted(async function* (input) {
    modes.push(input.mode); lastHistory = input.messages;
    if (modes.length < 3) {
      yield step(Array.from({ length: 8 }, (_, i) => query(modes.length + '-' + i, 'round ' + modes.length + ' query ' + i)));
    } else { yield 'Alpha costs $12 [E1.1].'; yield step([]); }
  }));
  try {
    const frames = await read(await db.app.request(db.path, db.request()));
    expect(modes).toEqual(['required', 'auto', 'none']);
    expect(frames.filter((item) => item.type === 'search.started')).toHaveLength(10);
    const results = lastHistory.at(-1);
    expect(results?.role).toBe('tool');
    expect(JSON.stringify(results)).toContain('budget');
    expect(frames.at(-1)).toMatchObject({ type: 'turn.completed', stats: { generations: 3, attempts: 3, rounds: 2, searches: 10, searchCredits: 10 } });
  } finally { db.close(); }
});

test('unexpected final calls allow one omitted-tools attempt only for a qualified model', async () => {
  const trace: string[] = [];
  const db = fixture(scripted(async function* ({ mode }) {
    trace.push(mode);
    if (trace.length <= 3) yield step([query('id-' + trace.length, 'Alpha query ' + trace.length)]);
    else { yield 'Alpha costs $12 [E1.1].'; yield step([]); }
  }));
  try {
    const frames = await read(await db.app.request(db.path, db.request()));
    expect(trace).toEqual(['required', 'auto', 'none', 'omitted']);
    expect(frames.filter((frame) => frame.type === 'search.started')).toHaveLength(2);
    expect(frames.at(-1)).toMatchObject({ type: 'turn.completed', stats: { generations: 3, attempts: 4 } });
  } finally { db.close(); }
});

test('unqualified omission, duplicate IDs and unavailable search fail honestly', async () => {
  for (const mode of ['stray', 'duplicate', 'unavailable'] as const) {
    let steps = 0;
    const model = { ...scripted(async function* () {
      steps++;
      yield 'Invented $99.';
      yield step(mode === 'duplicate' ? [query('a'), query('a')] : [query('id-' + steps, 'query ' + steps)]);
    }), acceptsOmittedTools: () => false };
    const db = fixture(model, mode === 'unavailable' ? { name: 'fake', async search() { throw new SearchFailure(432); } } : sourceSearch);
    try {
      const frames = await read(await db.app.request(db.path, db.request()));
      expect(frames.at(-1)).toMatchObject({ type: 'turn.error', code: mode === 'unavailable' ? 'SEARCH_UNAVAILABLE' : 'UNRESOLVED_TOOL_CALL' });
      expect(JSON.stringify(frames)).not.toContain('Invented');
      if (mode === 'stray') expect(frames.some((frame) => frame.type === 'sources')).toBe(true);
      if (mode === 'duplicate') expect(frames.some((frame) => frame.type === 'search.started')).toBe(false);
    } finally { db.close(); }
  }
});

test('small talk has zero searches, undecided discards draft when it searches, and held failures can fall back', async () => {
  let tools = 0;
  const model = { ...scripted(async function* ({ mode, model, messages }) {
    tools++;
    if (model === 'rate-limited') { yield 'Leaked draft.'; throw new ModelFailure('http', 429); }
    if (!messages.some((item) => item.role === 'tool')) {
      expect(mode).toBe('auto');
      yield 'Discarded draft.'; yield step([query('discover')]);
    } else { yield 'Alpha costs $12 [E1.1].'; yield step([]); }
  }), models: ['rate-limited', 'lite'] };
  const db = fixture(model);
  try {
    const chat = await read(await db.app.request(db.path, db.request('hello', 'chat')));
    expect(chat.some((item) => item.type === 'search.started')).toBe(false);
    expect(tools).toBe(0);
    const research = await read(await db.app.request(db.path, db.request('Tell me about Alpha.', 'open')));
    expect(research.at(-1)).toMatchObject({ type: 'turn.completed', stats: { route: 'undecided', attempts: 4, generations: 2 } });
    expect(JSON.stringify(research)).not.toMatch(/Leaked draft|Discarded draft/);
  } finally { db.close(); }
});

test('cancelling during search aborts the adapter and releases the conversation lock', async () => {
  const controller = new AbortController();
  let observed = false;
  const db = fixture(scripted(async function* () { yield step([query('cancel')]); }),
    { name: 'fake', async search(_query, signal) {
      try { await wait(2000, undefined, { signal }); }
      catch (error) { observed = signal.aborted; throw error; }
      return [];
    } });
  try {
    const response = await db.app.request(db.path, { ...db.request(), signal: controller.signal });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    while (!buffered.includes('search.started')) {
      const chunk = await reader.read();
      if (chunk.done) throw Error('Search never started');
      buffered += decoder.decode(chunk.value);
    }
    // Reading progress can race the dispatch microtask.
    await wait(25);
    controller.abort();
    await reader.cancel().catch(() => undefined);
    for (let i = 0; i < 100 && db.repo.activeTurn(db.id); i++) await wait(10);
    expect(observed).toBe(true);
    expect(db.repo.activeTurn(db.id)).toBeUndefined();
    expect(db.repo.detail(db.id)?.messages.at(-1)?.terminalCode).toBe('CANCELLED');
  } finally { db.close(); }
});
