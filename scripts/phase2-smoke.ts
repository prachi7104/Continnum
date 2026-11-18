// Runs one research turn with a durable, one-shot provider budget.
import { serve } from '@hono/node-server';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { detailSchema, eventSchema } from '../shared/events.ts';
import { createApp } from '../server/src/api/routes.ts';
import { LogicalClock, monotonic, wallClock } from '../server/src/clock.ts';
import { DiagnosticDatabase, Repo } from '../server/src/db/repo.ts';
import { geminiModel } from '../server/src/llm/gemini.ts';
import { normalizeQuery } from '../server/src/search/executor.ts';
import type { SearchHit } from '../server/src/search/provider.ts';
import { tavily } from '../server/src/search/tavily.ts';

export const smokeModel = 'gemini-3.5-flash-lite';
export const smokePrompt = 'What is the latest released Node.js 24.x version according to the official Node.js website?';
const googleUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' + smokeModel + ':streamGenerateContent?alt=sse';
const tavilyUrl = 'https://api.tavily.com/search';
const latest = /\b(?:latest|newest|most recent)\b/i;
const uncertainLatest = /\b(?:not|cannot|could not|can't|may be|might be|was (?:the )?latest|previously)\b/i;

function releaseVersions(text: string) {
  return new Set(Array.from(text.matchAll(/\bv?(24\.\d+\.\d+)\b(?!\.\d)/gi), (match) => match[1]));
}
const googleRequest = z.object({
  tools: z.array(z.object({ functionDeclarations: z.array(z.object({ name: z.literal('web_search') })).length(1) })).length(1),
  toolConfig: z.object({ functionCallingConfig: z.object({ mode: z.enum(['ANY', 'NONE']) }) }),
  contents: z.array(z.object({ role: z.string(), parts: z.array(z.object({
    functionCall: z.object({ name: z.string(), args: z.object({ query: z.string() }) }).optional(),
    functionResponse: z.object({ name: z.string() }).optional(),
  })) })),
});
const tavilyRequest = z.object({ search_depth: z.literal('basic'), query: z.string().min(1),
  max_results: z.literal(5), chunks_per_source: z.literal(3), include_published_date: z.literal(true) }).strict();
type Stage = 'tool-selection' | 'basic-search' | 'final-tools-disabled';

export function smokeTransport(record: (stage: Stage, event: 'dispatch' | 'response' | 'failed', status?: number) => void,
  request: typeof fetch) {
  const counts = { gemini: 0, tavily: 0, groq: 0 };
  let searchSucceeded = false;
  let query = '';
  const transport: typeof fetch = async (input, init) => {
    const url = String(input);
    const body: unknown = JSON.parse(String(init?.body));
    if (init?.method?.toUpperCase() !== 'POST' || init.redirect !== 'error') throw new Error('Unexpected request method or redirect policy');
    init.signal?.throwIfAborted();
    let stage: Stage;
    if (url === googleUrl && counts.gemini < 2) {
      const parsed = googleRequest.parse(body);
      const mode = parsed.toolConfig.functionCallingConfig.mode;
      if (counts.gemini === 0 && mode === 'ANY') {
        stage = 'tool-selection';
      } else if (counts.gemini === 1 && searchSucceeded && mode === 'NONE') {
        const parts = parsed.contents.flatMap(({ parts }) => parts);
        const call = parts.findIndex(({ functionCall }) => functionCall?.name === 'web_search' &&
          normalizeQuery(functionCall.args.query) === query);
        if (call < 0 || !parts.slice(call + 1).some(({ functionResponse }) => functionResponse?.name === 'web_search')) {
          throw new Error('Final generation is missing matching tool history');
        }
        stage = 'final-tools-disabled';
      } else {
        throw new Error('Unexpected Gemini generation');
      }
    } else if (url === tavilyUrl && counts.gemini === 1 && counts.tavily === 0) {
      query = tavilyRequest.parse(body).query;
      stage = 'basic-search';
    } else {
      throw new Error('Smoke transport refused an unallocated request');
    }
    record(stage, 'dispatch');
    if (stage === 'basic-search') counts.tavily++;
    else counts.gemini++;
    let response: Response;
    try {
      response = await request(input, init);
    } catch (error) {
      record(stage, 'failed');
      throw error;
    }
    if (stage === 'basic-search') searchSucceeded = response.ok;
    record(stage, 'response', response.status);
    return response;
  };
  return { transport, counts };
}

export async function runPhase2Smoke(dir: string, keys: { gemini: string; tavily: string }, request = fetch) {
  if (!keys.gemini || !keys.tavily) throw new Error('Both provider keys are required');
  // Exclusive creation also prevents a concurrent invocation or restart from reusing the allocation.
  mkdirSync(dir);
  const ledger = join(dir, 'attempts.jsonl');
  const gate = smokeTransport((stage, event, status) => {
    appendFileSync(ledger, JSON.stringify({ at: wallClock.nowIso(), stage, event, status }) + '\n', { flush: true });
  }, request);
  const repo = new Repo(dir, false, wallClock);
  const model = geminiModel(keys.gemini, [smokeModel], gate.transport);
  const search = tavily(keys.tavily, wallClock, gate.transport);
  const diagnostics: { searchHits: SearchHit[]; synthesisText: string } = { searchHits: [], synthesisText: '' };
  const app = createApp({ repo,
    model: { ...model, async *research(input, signal) {
      for await (const chunk of model.research!(input, signal)) {
        if (input.mode === 'none' && typeof chunk === 'string') diagnostics.synthesisText += chunk;
        yield chunk;
      }
    } },
    search: { ...search, async search(query, signal) {
      const hits = await search.search(query, signal);
      diagnostics.searchHits = hits;
      return hits;
    } },
    wall: wallClock, logical: new LogicalClock(repo, wallClock), monotonic, deadlineMs: 30000,
    turnLimits: { generations: 2, rounds: 1, queries: 1, roundQueries: 1, extraAttempts: 0, retrySearch: false },
    fakeMode: false, labEnabled: false, hasGeminiKey: true, hasTavilyKey: true });
  const id = repo.create('live', wallClock.nowIso());
  const conversation = '/api/conversations/' + id;
  const path = conversation + '/turns';
  let submitted = false;
  const server = serve({ hostname: '127.0.0.1', port: 0, fetch: (incoming) => {
    const url = new URL(incoming.url);
    if (incoming.method === 'POST' && url.pathname === path && !submitted) {
      submitted = true;
      return app.fetch(incoming);
    }
    if (incoming.method === 'GET' && url.pathname === conversation) return app.fetch(incoming);
    return new Response(null, { status: 404 });
  } });
  const events: ReturnType<typeof eventSchema.parse>[] = [];
  let result: unknown;
  let passed = false;
  let failure = '';
  try {
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Loopback listener has no TCP address');
    const base = 'http://127.0.0.1:' + address.port;
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: smokePrompt, clientTurnId: 'phase2-live-smoke', tz: 'Asia/Kolkata' }),
      signal: AbortSignal.timeout(35000) });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('text/event-stream')) throw new Error('No successful SSE response');
    const lines = (await response.text()).split(/\r?\n/).filter((line) => line.startsWith('data: '));
    for (const line of lines) events.push(eventSchema.parse(JSON.parse(line.slice(6))));
    const terminal = events.at(-1);
    const reload = await fetch(base + conversation, { signal: AbortSignal.timeout(4000) });
    const detail = detailSchema.parse(await reload.json());
    const answer = detail.messages.at(-1);
    const releases = events.filter((event) => event.type === 'answer.sentence').filter((event) => event.support === 'sourced');
    const hasOfficialVersion = releases.some(({ text, refs }) => {
      const versions = releaseVersions(text);
      const [version] = versions;
      if (versions.size !== 1 || !latest.test(text) || uncertainLatest.test(text) ||
          !answer || !releaseVersions(answer.content).has(version)) return false;
      return refs.some((ref) => {
        const [sourceId, row] = ref.split('.');
        const source = answer.evidence?.find((entry) => entry.ref === sourceId);
        const passage = source?.sentences[Number(row) - 1];
        if (!source || !passage || !latest.test(passage) || uncertainLatest.test(passage)) return false;
        const url = new URL(source.url);
        const supportedVersions = releaseVersions(passage);
        return url.protocol === 'https:' && ['nodejs.org', 'www.nodejs.org'].includes(url.hostname) &&
          supportedVersions.size === 1 && supportedVersions.has(version) && answer.content.includes(ref);
      });
    });
    const start = events.find((event) => event.type === 'search.started');
    const finish = events.find((event) => event.type === 'search.finished');
    const searchOutcome = events.find((event) => event.type === 'sources' ||
      event.type === 'answer.sentence' || event.type === 'answer.withheld');
    const database = new DiagnosticDatabase(join(dir, 'continuum.db'), { readOnly: true });
    let attempts;
    let citations;
    try {
      attempts = database.prepare('SELECT kind, provider, model, outcome, http_status, latency_ms FROM attempts ORDER BY rowid').all();
      citations = database.prepare('SELECT ref FROM citations ORDER BY ref').all();
    } finally {
      database.close();
    }
    const releasedRefs = new Set(releases.flatMap(({ refs }) => refs));
    const storedRefs = new Set(citations.map(({ ref }) => ref));
    const checks = {
      completed: terminal?.type === 'turn.completed' && answer?.terminalCode === 'COMPLETED',
      budget: terminal?.type === 'turn.completed' && terminal.stats.generations === 2 &&
        terminal.stats.attempts === 2 && terminal.stats.rounds === 1 && terminal.stats.searchCredits === 1 &&
        gate.counts.gemini === 2 && gate.counts.tavily === 1,
      orderedProgress: Boolean(events[0]?.type === 'turn.started' && start?.round === 1 && start.seq > events[0].seq &&
        finish?.queryId === start.queryId && finish.seq > start.seq && finish.resultCount > 0 &&
        searchOutcome && searchOutcome.seq > finish.seq && terminal && terminal.seq > searchOutcome.seq),
      sourcedAnswerAfterSearch: Boolean(finish && releases.some((event) => event.seq > finish.seq)),
      officialVersionAfterReload: Boolean(hasOfficialVersion),
      persistedAttempts: attempts.map(({ provider }) => provider).join(',') === 'gemini,tavily,gemini',
      persistedCitation: releasedRefs.size > 0 && [...releasedRefs].every((ref) => storedRefs.has(ref)),
    };
    const missing = Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => name);
    passed = missing.length === 0;
    failure = passed ? '' : terminal?.type === 'turn.error' ? terminal.code : 'Failed checks: ' + missing.join(', ');
    result = { detail, attempts, citations, checks };
  } catch {
    failure = 'Local HTTP, SSE, or reload verification failed';
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    repo.close();
    writeFileSync(join(dir, 'result.json'), JSON.stringify({ passed, failure, counts: gate.counts, events, result, diagnostics }, null, 2) + '\n');
  }
  return { passed, failure, counts: gate.counts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--run-once-02') {
      throw new Error('The authorized retest requires --run-once-02.');
    }
    const head = execFileSync('git', ['log', '-1', '--format=%s'], { encoding: 'utf8' }).trim();
    const changed = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
    if (head !== 'feat: add bounded evidence-grounded web research' || changed) {
      throw new Error('Run the retest from the clean Phase 2 implementation commit.');
    }
    const dir = resolve('tmp/phase2-live-smoke-02');
    mkdirSync(resolve('tmp'), { recursive: true });
    const result = await runPhase2Smoke(dir, {
      gemini: process.env.GEMINI_API_KEY?.trim() ?? '', tavily: process.env.TAVILY_API_KEY?.trim() ?? '',
    });
    console.log(JSON.stringify(result));
    process.exitCode = result.passed ? 0 : 1;
  } catch {
    console.error('Smoke stopped before completion. Check the retest flag, clean Phase 2 commit, both keys, and the tmp/phase2-live-smoke-02 reservation.');
    process.exitCode = 1;
  }
}
