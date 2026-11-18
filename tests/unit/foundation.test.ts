// Exercises clock separation, persistence, cascade, fake isolation and budget reservation.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from '../test.ts';
import { LogicalClock, localDate, type WallClock } from '../../server/src/clock.ts';
import { DiagnosticDatabase, Repo } from '../../server/src/db/repo.ts';
import { reserve, readLedger, recordOutcome } from '../../scripts/budget-ledger.ts';
import { classify } from '../../server/src/engine/route.ts';
import { canFallback, ModelFailure } from '../../server/src/llm/provider.ts';

const instant = '2026-11-18T04:00:00.000Z';
const wall: WallClock = { nowIso: () => instant };
const initialLedger = { gemini: { cap: 24, used: 0 }, tavily: { cap: 5, used: 0 }, groq: { cap: 0, used: 0 }, entries: [] };
const admit = (repo: Repo, id: string, key: string) => repo.admit({
  conversationId: id, clientTurnId: key, text: 'Word runners', tz: 'UTC', route: 'undecided',
  logicalNow: new Date(instant), realNow: instant,
});

test('recovers an interrupted turn, retains partial text, releases lock and recreates a removed database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'continuum-recovery-'));
  try {
    let repo = new Repo(dir, false, wall);
    const id = repo.create('live', instant);
    const admission = admit(repo, id, 'first');
    assert.equal(admission.kind, 'admitted');
    repo.append(admission.turn, 'partial text');
    repo.close();

    repo = new Repo(dir, false, wall);
    const history = repo.detail(id)?.messages;
    assert.equal(history?.[1]?.status, 'partial');
    assert.equal(history?.[1]?.terminalCode, 'INTERRUPTED');
    assert.equal(history?.[1]?.content, 'partial text');
    assert.equal(admit(repo, id, 'second').kind, 'admitted');
    repo.close();

    rmSync(join(dir, 'continuum.db'));
    repo = new Repo(dir, false, wall);
    assert.equal(repo.list('live').length, 0);
    repo.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('cascades conversation deletion through every owned table and its FTS index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'continuum-cascade-'));
  const repo = new Repo(dir, false, wall);
  const db = new DiagnosticDatabase(join(dir, 'continuum.db'));
  try {
    db.exec('PRAGMA foreign_keys=ON');
    const id = repo.create('live', instant);
    const admission = admit(repo, id, 'first');
    assert.equal(admission.kind, 'admitted');
    const { turn } = admission;
    assert.throws(() => db.prepare(`INSERT INTO clarifications
      VALUES ('bad', ?, ?, 'lab', 'text', '[]', 0)`).run(turn.id, id), /FOREIGN KEY/);
    db.prepare(`INSERT INTO clarifications VALUES ('good', ?, ?, 'live', 'text', '[]', 0)`).run(turn.id, id);
    db.prepare(`INSERT INTO evidence (id,message_id,ordinal,query,url,domain,domain_match,sentences_json,retrieved_at,provider)
      VALUES ('e',?,1,'search','https://example.com','example.com','none','[]',?,'test')`).run(turn.assistantMessageId, instant);
    db.prepare("INSERT INTO citations VALUES (?, 'E1.1')").run(turn.assistantMessageId);
    db.prepare("INSERT INTO comparisons VALUES (?, '[]', '[]', '[]', '{}')").run(turn.assistantMessageId);
    repo.startAttempt(turn, 'fake', 'fixture');
    repo.append(turn, 'Returned result for runners');
    assert.equal(repo.delete(id), 'busy');
    assert.equal(repo.finish(turn, 'COMPLETED', 'complete', {}), true);
    assert.equal(repo.finish(turn, 'CANCELLED', 'cancelled', {}), false);
    assert.equal(repo.delete(id), 'deleted');
    for (const table of ['conversations', 'turns', 'messages', 'evidence', 'citations', 'comparisons', 'attempts', 'clarifications']) {
      assert.equal(db.prepare('SELECT count(*) AS n FROM ' + table).get()?.n, 0, table);
    }
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    db.exec("INSERT INTO messages_fts(messages_fts, rank) VALUES('integrity-check', 1)");
    assert.equal(db.prepare("SELECT count(*) AS n FROM messages_fts WHERE messages_fts MATCH 'running'").get()?.n, 0);
  } finally { db.close(); repo.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('lab logical time advances independently and reset deletes only lab data and increments epoch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'continuum-clock-'));
  let real = instant;
  const motion = { nowIso: () => real };
  const repo = new Repo(dir, false, motion);
  try {
    const clock = new LogicalClock(repo, motion);
    clock.setStart(new Date('2026-11-03T18:00:00.000Z'));
    real = '2026-11-18T05:00:00.000Z';
    assert.equal(clock.now('lab').toISOString(), '2026-11-03T19:00:00.000Z');
    assert.equal(localDate(clock.now('lab'), 'Asia/Kolkata'), '2026-11-04');
    assert.equal(clock.now('live').toISOString(), real);
    const lab = repo.create('lab', clock.now('lab').toISOString());
    const live = repo.create('live', real);
    const turn = repo.admit({ conversationId: lab, clientTurnId: 'x', text: 'Example', tz: 'UTC', route: 'undecided', logicalNow: clock.now('lab'), realNow: real });
    assert.equal(turn.kind, 'admitted');
    const message = repo.detail(lab)?.messages[0];
    assert.equal(message?.logicalAt, '2026-11-03T19:00:00.000Z');
    assert.equal(message?.recordedAt, real);
    assert.throws(() => clock.setStart(new Date(instant)), /not empty/);
    assert.throws(() => clock.advance(new Date('2026-11-02T18:00:00.000Z')), /forward/);
    clock.advance(new Date('2026-11-05T18:00:00.000Z'));
    assert.equal(repo.labAnchor().epoch, 0);
    clock.reset();
    assert.equal(repo.labAnchor().epoch, 1);
    assert.equal(repo.conversation(lab), undefined);
    assert.ok(repo.conversation(live));
    assert.equal(repo.finish(turn.turn, 'COMPLETED', 'complete', {}), false);
  } finally { repo.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('fake database stays separate and a real boot rejects fake rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'continuum-fake-'));
  try {
    const fake = new Repo(dir, true, wall);
    const id = fake.create('live', instant);
    assert.equal(admit(fake, id, 'fake').kind, 'admitted');
    assert.equal(fake.conversation(id)?.origin, 'fake');
    assert.ok(fake.detail(id)?.messages.every((message) => message.origin === 'fake'));
    fake.close();
    assert.equal(existsSync(join(dir, 'continuum.db')), false);
    cpSync(join(dir, 'continuum-fake.db'), join(dir, 'continuum.db'));
    assert.throws(() => new Repo(dir, false, wall), /Fake rows found/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ledger counts failed and pending reservations, rejects Groq and fails closed at the cap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'continuum-ledger-'));
  const path = join(dir, 'ledger.json');
  try {
    writeFileSync(path, JSON.stringify(initialLedger));
    assert.throws(() => reserve('groq', null, 'denied', path), /exhausted/);
    const first = reserve('gemini', 'example', 'first', path);
    assert.equal(readLedger(path).entries[0]?.outcome, 'pending');
    recordOutcome(first, 'http_429', path);
    for (let i = 1; i < 24; i++) reserve('gemini', 'example', 'remaining', path);
    assert.throws(() => reserve('gemini', 'example', 'overflow', path), /exhausted/);
    for (let i = 0; i < 5; i++) reserve('tavily', null, 'remaining', path);
    assert.throws(() => reserve('tavily', null, 'overflow', path), /exhausted/);
    assert.equal(readLedger(path).gemini.used, 24);
    assert.equal(readLedger(path).tavily.used, 5);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('two independent processes cannot both reserve the final request', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'continuum-race-'));
  const path = join(dir, 'ledger.json');
  const source = new URL('../../scripts/budget-ledger.ts', import.meta.url).href;
  const script = "import{reserve}from " + JSON.stringify(source) + ";try{reserve('gemini','race','last',process.argv[1]);}catch{process.exitCode=7;}";
  const worker = () => new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, path], { stdio: 'ignore' });
    child.once('exit', resolve);
    child.once('error', reject);
  });
  try {
    writeFileSync(path, JSON.stringify(initialLedger));
    for (let i = 0; i < 23; i++) reserve('gemini', 'example', 'preload', path);
    const exits = await Promise.all([worker(), worker()]);
    assert.deepEqual(exits.sort(), [0, 7]);
    assert.equal(readLedger(path).gemini.used, 24);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('classifier current cues take precedence over social text and old dates remain undecided', () => {
  for (const text of ['hi, how are you?', 'thanks!', 'Who are you?']) assert.equal(classify(text, 2026), 'chat_plain');
  for (const text of ['hi, latest price?', 'Released this week?', 'Is that still true?', 'What about 2025?', 'Who is CEO?']) {
    assert.equal(classify(text, 2026), 'research', text);
  }
  for (const text of ['Explain a B-tree.', 'Describe 2020.', 'bonjour']) assert.equal(classify(text, 2026), 'undecided');
});

test('fallback admits only the frozen error classes', () => {
  for (const status of [404, 429, 500, 503, 599]) assert.equal(canFallback(new ModelFailure('http', status)), true);
  for (const status of [400, 401, 403, 408, 432]) assert.equal(canFallback(new ModelFailure('http', status)), false);
  assert.equal(canFallback(new ModelFailure('safety')), false);
  assert.equal(canFallback(new ModelFailure('network')), true);
  assert.equal(canFallback(new ModelFailure('first_byte')), true);
});
