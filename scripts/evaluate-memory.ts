import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import corpus from '../eval/fixtures/corpus.json' with { type: 'json' };
import dates from '../eval/fixtures/resolver-cases.json' with { type: 'json' };
import queries from '../eval/fixtures/retrieval-queries.json' with { type: 'json' };
import { migrate } from '../server/src/db/migrate.ts';
import { retrieve } from '../server/src/memory/retrieve.ts';
import { resolve, type Interval } from '../server/src/temporal/resolve.ts';
import { localDate, type Workspace } from '../server/src/clock.ts';

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
migrate(db);
const insertConversation = db.prepare('INSERT INTO conversations VALUES (?,?,?,?,?,?)');
const insertMessage = db.prepare(`INSERT INTO messages
  (id,conversation_id,workspace,turn_id,role,content,status,origin,logical_at,recorded_at,tz,local_date,reply_to)
  VALUES (?,?,?,NULL,?,?,'complete',?,?,?,?,?,?)`);
for (const episode of corpus) {
  const origin = episode.workspace === 'lab' ? 'sample' : 'real';
  const date = localDate(new Date(episode.logicalAt), episode.tz);
  insertConversation.run(episode.id, episode.workspace, episode.topic, origin, episode.logicalAt, episode.logicalAt);
  insertMessage.run(episode.id, episode.id, episode.workspace, 'user', episode.question, origin, episode.logicalAt, episode.logicalAt, episode.tz, date, null);
  insertMessage.run(episode.id + '-answer', episode.id, episode.workspace, 'assistant', episode.answer, origin, episode.logicalAt, episode.logicalAt, episode.tz, date, episode.id);
}
const comparable = ({ localStart, localEnd, startUtc, endUtc }: Interval) => ({ localStart, localEnd, startUtc, endUtc });
const temporal = dates.map(({ id, text, now, tz, flags, intervals, alternates }) => {
  const resolved = resolve(text, new Date(now), tz);
  const actual = { intervals: resolved.intervals.map(comparable), alternates: resolved.alternates.map(comparable), flags: resolved.flags };
  return { id, pass: isDeepStrictEqual(intervals, actual.intervals) && isDeepStrictEqual(alternates, actual.alternates) &&
    isDeepStrictEqual(flags, actual.flags), actual };
});

function measure(noDateFilter: boolean) {
  const cases = queries.map((query) => {
    const now = new Date(query.now);
    const conversationId = randomUUID();
    const turnId = randomUUID();
    // Every evaluated turn already has an admitted user message. Retrieval must omit it.
    const workspace = query.workspace as Workspace;
    const origin = workspace === 'lab' ? 'sample' : 'real';
    insertConversation.run(conversationId, workspace, 'Evaluation request', origin, query.now, query.now);
    db.prepare(`INSERT INTO turns (id,conversation_id,workspace,client_turn_id,user_message_id,assistant_message_id,status,started_real)
      VALUES (?,?,?,?,?,?,'active',?)`).run(turnId, conversationId, workspace, turnId, turnId, randomUUID(), query.now);
    insertMessage.run(turnId, conversationId, workspace, 'user', query.text, origin, query.now, query.now, query.tz, localDate(now, query.tz), null);
    db.prepare('UPDATE messages SET turn_id=? WHERE id=?').run(turnId, turnId);
    const start = performance.now();
    const result = retrieve(db, { text: query.text, now, tz: query.tz, workspace, conversationId, turnId, fakeMode: false, noDateFilter });
    const ms = performance.now() - start;
    db.prepare('DELETE FROM conversations WHERE id=?').run(conversationId);
    const options = result.state === 'AMBIGUOUS' ? result.episodes.map((ep) => ep.messageId) : [];
    const episodes = result.state.startsWith('FOUND') ? result.episodes.map((ep) => ep.messageId) : [];
    const allowed = query.gold.match(/(C\d+) bonus/)?.[1];
    const required = query.required;
    const extras = episodes.filter((id) => !required.includes(id) && id !== allowed);
    const matched = required.filter((id) => episodes.includes(id)).length;
    const statePass = query.state.startsWith('FOUND*') ? result.state.startsWith('FOUND') : result.state === query.state;
    const expectedOptions = query.state === 'AMBIGUOUS' ? query.gold.match(/C\d+/g) ?? [] : [];
    const optionsPass = expectedOptions.every((id) => options.includes(id));
    return { id: query.id, state: result.state, statePass, expectedState: query.state, required, matched, episodes, options,
      optionsPass, extras, nearest: result.nearest, topics: result.topics, truncated: result.truncated,
      latencyMs: Number(ms.toFixed(3)), pass: statePass && optionsPass && matched === required.length && !extras.length };
  });
  const matched = cases.reduce((sum, item) => sum + item.matched, 0);
  const expected = cases.reduce((sum, item) => sum + item.required.length, 0);
  const extras = cases.reduce((sum, item) => sum + item.extras.length, 0);
  const para = cases.filter((item) => item.id.startsWith('P') && item.required.length);
  const absent = cases.filter((item) => !item.required.length && ['EMPTY_RANGE','NO_CONFIDENT_MATCH'].includes(item.expectedState));
  const durations = cases.map((item) => item.latencyMs).sort((a, b) => a - b);
  const middle = Math.floor(durations.length / 2);
  return { stateMatches: cases.filter((item) => item.statePass).length, count: cases.length,
    requiredEpisodes: expected, matchedEpisodes: matched, unexpectedEpisodes: extras,
    episodePrecision: matched / (matched + extras), episodeRecall: matched / expected,
    paraphrasesFound: para.filter((item) => item.matched === item.required.length).length, paraphrases: para.length,
    falseMemories: absent.filter((item) => item.episodes.length).length, absentCases: absent.length,
    isolated: !cases.find((item) => item.id === 'Q27')?.episodes.includes('C13'),
    ambiguityPassed: cases.filter((item) => item.expectedState === 'AMBIGUOUS').every((item) => item.statePass && item.optionsPass),
    medianMs: durations.length % 2 ? durations[middle] : (durations[middle - 1] + durations[middle]) / 2, maxMs: durations.at(-1),
    failures: cases.filter((item) => !item.pass).map((item) => item.id), cases };
}

const retrieval = measure(false);
const noDateFilter = measure(true);
db.close();
mkdirSync('eval/results', { recursive: true });
writeFileSync('eval/results/phase-3-resolver.json', JSON.stringify({
  count: temporal.length, passed: temporal.filter((item) => item.pass).length, cases: temporal,
}, null, 2) + '\n');
writeFileSync('eval/results/phase-3-retrieval.json', JSON.stringify({ corpusEpisodes: corpus.length, retrieval, noDateFilter }, null, 2) + '\n');
const summarize = (result: typeof retrieval) => Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'cases'));
console.log(JSON.stringify({ resolver: { count: temporal.length, failures: temporal.filter((item) => !item.pass).map((item) => item.id) },
  retrieval: summarize(retrieval), noDateFilter: summarize(noDateFilter) }, null, 2));
