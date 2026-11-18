import { once } from 'node:events';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { expect, test } from 'vitest';
import { detailSchema, eventSchema } from '../../shared/events.ts';
import { createApp } from '../../server/src/api/routes.ts';
import { LogicalClock, monotonic, type Workspace } from '../../server/src/clock.ts';
import { DiagnosticDatabase, Repo } from '../../server/src/db/repo.ts';
import type { ModelProvider } from '../../server/src/llm/provider.ts';

const now = '2026-11-17T04:30:00.000Z';
const wall = { nowIso: () => now };

async function fixture(model: ModelProvider | null = null) {
  const dir = mkdtempSync(join(tmpdir(), 'continuum-memory-'));
  const repo = new Repo(dir, false, wall);
  const app = createApp({ repo, model, wall, logical: new LogicalClock(repo, wall), monotonic,
    deadlineMs: 10_000, fakeMode: false, labEnabled: false, hasGeminiKey: false, hasTavilyKey: false });
  const server = serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch }) as Server;
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing test listener');
  const url = 'http://127.0.0.1:' + address.port;
  let count = 0;
  function seed(question: string, answer: string, at = '2026-11-16T05:30:00.000Z', workspace: Workspace = 'live',
    status = 'complete', conversationId = repo.create(workspace, at)) {
    const admission = repo.admit({ conversationId, clientTurnId: 'seed' + count++, text: question, tz: 'Asia/Kolkata',
      route: 'chat_plain', logicalNow: new Date(at), realNow: now });
    if (admission.kind !== 'admitted') throw Error('Failed to seed');
    repo.append(admission.turn, answer);
    repo.finish(admission.turn, status === 'complete' ? 'COMPLETED' : 'CANCELLED', status, null);
    return admission.turn;
  }
  const submit = (id: string, text: string, selection?: unknown, tz = 'Asia/Kolkata') => fetch(url + '/api/conversations/' + id + '/turns', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, selection, tz, clientTurnId: 'post' + count++ }),
  });
  const detail = async (id: string) => detailSchema.parse(await (await fetch(url + '/api/conversations/' + id)).json());
  return { repo, dir, seed, submit, detail, fresh: () => repo.create('live', now),
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    } };
}

async function events(response: Response) {
  expect(response.status).toBe(200);
  return (await response.text()).split(/\r?\n/).filter((line) => line.startsWith('data: '))
    .map((line) => eventSchema.parse(JSON.parse(line.slice(6))));
}

test('keyless HTTP recall is scoped in UTC, preserves provenance and excludes other workspaces and cancelled claims', async () => {
  const f = await fixture();
  try {
    const old = f.seed('Alpha pricing question', 'Alpha costs $12.');
    f.seed('Same local day in India, later', 'Different California day.', '2026-11-16T11:30:00.000Z');
    f.seed('Lab-only history', 'Private workspace fixture.', '2026-11-16T05:30:00.000Z', 'lab');
    f.seed('Cancelled question', 'Unsupported $999.', '2026-11-16T05:45:00.000Z', 'live', 'cancelled');
    const id = f.fresh();
    const frames = await events(await f.submit(id, 'What did I ask yesterday?', undefined, 'America/Los_Angeles'));
    expect(frames.map(({ type }) => type)).toEqual(['turn.started', 'memory', 'answer.direct', 'turn.completed']);
    expect(frames[1]).toMatchObject({ episodes: [
      { preview: 'Cancelled question', eligible: false, refs: [] },
      { preview: 'Alpha pricing question', conversationId: old.conversationId, eligible: true, refs: ['H' + old.assistantMessageId + '.1'] },
    ] });
    expect(frames[3]).toMatchObject({ stats: { generations: 0, attempts: 0 } });
    const reloaded = (await f.detail(id)).messages.at(-1);
    expect(reloaded?.content).toContain('Stopped before finishing.');
    expect(reloaded?.content).not.toMatch(/999|Lab-only|Different California/);
    expect(reloaded?.stats?.memory?.episodes).toHaveLength(2);
    expect((await events(await f.submit(f.fresh(), 'What did I ask today?')))[1]).toMatchObject({ state: 'EMPTY_RANGE' });
    expect((await events(await f.submit(f.fresh(), 'What did we discuss?')))[1]).toMatchObject({
      state: 'FOUND_WITH_BASELINE', episodes: expect.arrayContaining([expect.objectContaining({ conversationId: old.conversationId })]),
    });
    const missing = await events(await f.submit(f.fresh(), 'What did I ask about volleyball yesterday?'));
    expect(missing[1]).toMatchObject({ state: 'NO_CONFIDENT_MATCH' });
    expect(missing[2]).toMatchObject({ text: expect.stringContaining('I found conversations') });
  } finally { await f.close(); }
});

test('one terminal clarification persists, accepts exactly one scoped choice and pins the selected episode', async () => {
  const f = await fixture();
  try {
    const alpha = f.seed('Explain ceramic glazing', 'A glaze can be glossy.');
    const beta = f.seed('Explain ceramic firing', 'Clay changes with heat.');
    const id = f.fresh();
    const frames = await events(await f.submit(id, 'Is the ceramic answer still correct?'));
    expect(frames.map(({ type }) => type)).toEqual(['turn.started', 'memory', 'clarify']);
    const choice = (await f.detail(id)).messages.at(-1)?.clarification;
    expect(choice?.options).toHaveLength(2);
    const selected = choice!.options.find((option) => option.label.includes('glazing'))!;
    const selection = { clarificationId: choice!.clarificationId, optionIndex: selected.index };
    expect((await f.submit(f.fresh(), 'Choice', selection)).status).toBe(422);
    const lab = f.repo.create('lab', now);
    expect((await f.submit(lab, 'Choice', selection)).status).toBe(422);
    const picked = await events(await f.submit(id, 'Client-supplied text', selection));
    expect(picked[1]).toMatchObject({ episodes: [{ conversationId: alpha.conversationId }] });
    expect(picked[1]).not.toMatchObject({ episodes: [{ conversationId: beta.conversationId }] });
    const reloaded = await f.detail(id);
    expect(reloaded.messages.at(-2)?.content).toBe('Selected: ' + selected.label);
    expect(reloaded.messages[1].clarification).toBeUndefined();
    expect((await f.submit(id, 'Choice again', selection)).status).toBe(422);
  } finally { await f.close(); }
});

test('recall synthesis uses exactly one buffered generation, validates H citations and persists only supported claims', async () => {
  let calls = 0;
  const model: ModelProvider = { name: 'fake', models: ['scripted'],
    async *generate(input) {
      calls++;
      const ref = input.system.match(/H[\w-]+\.1/)?.[0];
      expect(ref).toBeDefined();
      expect(input.system).not.toContain('Secret $999');
      yield 'Alpha costs $12 [' + ref + ']. Alpha costs $999 [' + ref + '].';
    } };
  const f = await fixture(model);
  try {
    const origin = f.seed('Alpha pricing', 'Alpha costs $12.');
    f.seed('Stopped answer', 'Secret $999.', '2026-11-16T07:30:00.000Z', 'live', 'cancelled');
    const id = f.fresh();
    const frames = await events(await f.submit(id, 'Summarise everything from yesterday'));
    expect(calls).toBe(1);
    expect(frames.some((event) => event.type === 'answer.delta')).toBe(false);
    expect(frames.at(-1)).toMatchObject({ stats: { route: 'recall_synth', generations: 1, attempts: 1, withheld: 1 } });
    expect((await f.detail(id)).messages.at(-1)?.content).not.toContain('$999');
    const db = new DiagnosticDatabase(join(f.dir, 'continuum.db'), { readOnly: true });
    try {
      expect(db.prepare('SELECT ref FROM citations').all()).toEqual([{ ref: 'H' + origin.assistantMessageId + '.1' }]);
    } finally { db.close(); }
  } finally { await f.close(); }
});
