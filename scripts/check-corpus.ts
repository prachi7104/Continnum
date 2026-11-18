// Checks the frozen IDs, corpus isolation and paraphrase authoring constraints.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

type Identified = { id: string };
type Episode = Identified & { workspace: string; logicalAt: string; question: string; answer: string };
function load<T>(name: string): T {
  return JSON.parse(readFileSync(new URL('../eval/fixtures/' + name + '.json', import.meta.url), 'utf8')) as T;
}
function ids(rows: Identified[], prefix: string, count: number) {
  assert.deepEqual(rows.map(({ id }) => id), Array.from({ length: count }, (_, i) => prefix + String(i + 1).padStart(2, '0')));
}
const corpus = load<Episode[]>('corpus');
ids(corpus, 'C', 20);
ids(load<Identified[]>('resolver-cases'), 'T', 28);
const queries = load<Identified[]>('retrieval-queries');
ids(queries.slice(0, 33), 'Q', 33);
ids(queries.slice(33), 'P', 15);
const live = load<{ scenarios: Identified[]; minimum: { continuum: string[]; bothBaselineContexts: string[] } }>('live-scenarios');
ids(live.scenarios, 'L', 24);
assert.equal(live.minimum.continuum.length, 8);
assert.equal(live.minimum.bothBaselineContexts.length, 4);
const required: Record<string, RegExp[]> = {
  C04: [/\bNode\b/i, /\bversion\b/i], C10: [/\bGPU\b/i, /\bpricing\b/i],
  C11: [/\bGitHub\b/i, /\bCEO\b/i], C14: [/large language model/i, /\bGemini\b/i],
  C15: [/egress fees/i], C17: [/\bNode\b/i, /startup time/i],
  C18: [/\bapartment\b/i, /\brent\b/i, /\bBengaluru\b/i],
  C19: [/\bNetlify\b/i, /\bVercel\b/i, /free tier/i, /static site/i],
  C20: [/\bcook\b/i, /dal makhani/i],
};
const prohibited: Record<string, RegExp> = {
  C14: /\bLLM\b/i, C15: /\b(bandwidth|charges)\b/i,
  C16: /\b(transactional|services)\b/i, C17: /\b(version|boot|JS|JavaScript)\b/i,
  C18: /\b(flat|Bangalore)\b/i, C20: /\bbiryani\b/i,
};
for (const episode of corpus) {
  const { id } = episode;
  const text = episode.question + '\n' + episode.answer;
  assert.doesNotMatch(text, /\b(Kafka|Kubernetes|Heroku)\b/i, id);
  if (id !== 'C02' && id !== 'C05') assert.doesNotMatch(text, /\bPostgres\b/i, id);
  if (id !== 'C05') assert.doesNotMatch(text, /\b(pool|pooling)\b/i, id);
  for (const pattern of required[id] ?? []) assert.match(text, pattern, id);
  if (prohibited[id]) assert.doesNotMatch(text, prohibited[id], id);
  assert.equal(episode.workspace, id === 'C13' ? 'live' : 'lab');
  assert.match(episode.logicalAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
}
console.log('PASS frozen fixture IDs and corpus authoring constraints');
