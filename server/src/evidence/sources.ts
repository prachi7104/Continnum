// Selects bounded evidence across entities and serializes it as untrusted prompt data.
import { parse } from 'tldts';
import type { EvidenceSource } from '../../../shared/events.ts';
import type { SearchHit } from '../search/provider.ts';

export type FoundSource = SearchHit & { query: string; entity: string };
export type StoredSource = EvidenceSource & { query: string };
export const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

export function normalizeUrl(raw: string): URL | undefined {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    url.hash = '';
    return url;
  } catch { return undefined; }
}

export function domainMatch(hostname: string, entity: string): EvidenceSource['domainMatch'] {
  // Registrable domain only. A matching label is not evidence of ownership.
  const { domainWithoutSuffix } = parse(hostname, { allowPrivateDomains: true });
  const name = entity.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
  const label = domainWithoutSuffix?.replace(/-/g, '');
  // Refuse spelling transformations other than ordinary case/spacing in the entity.
  return label && domainWithoutSuffix === label && name && label === name ? 'exact' : 'none';
}

const stopWords = new Set('a an and are as at based by can could did for from how in is it of on or per should the this to was were what when where which who will with would you'.split(' '));
const boilerplate = /^(?:skip to (?:main )?content|jump to (?:main )?content|home|menu|search|navigation|sign (?:in|up)|log in|contact us|privacy policy|cookie (?:policy|settings)|terms of (?:use|service)|read more|learn more|all rights reserved|intro(?:duction)?|overview|product overview)[.!]?$/i;
const acknowledgement = /^(?:thanks to|thank you (?:to|for)|we want to express (?:our )?(?:thanks|appreciation))\b/i;
const separator = /^[\s|:—–-]+$/u;

function keywords(text: string) {
  const words = text.normalize('NFKC').toLowerCase().replace(/\b(?:site|inurl|intitle):\S+|https?:\/\/\S+/g, '')
    .match(/[\p{L}\p{N}]+(?:\.[\p{N}]+)*/gu) ?? [];
  return new Set(words.filter((word) => word.length > 1 && !stopWords.has(word))
    .map((word) => word.replace(/([a-z]{3,}[^s])s$/u, '$1')));
}

type Passage = { text: string; heading?: number };

function candidates(content: string): Passage[] {
  const lines = content.slice(0, 7000).split(/\r?\n/).map((line) => line.trim());
  const passages: Passage[] = [];
  let heading: number | undefined;
  let tableHeader: string | undefined;
  for (const [index, line] of lines.entries()) {
    if (line.includes('|') && !separator.test(line) && separator.test(lines[index + 1] ?? '')) {
      tableHeader = line;
      continue;
    }
    if (separator.test(line)) continue;
    if (line.includes('|') && tableHeader) {
      // Keep column labels with their original row. A value on its own can lose its unit or scope.
      const tableRow = tableHeader + '\n' + line;
      if (tableRow.length <= 900) passages.push({ text: tableRow, heading });
      continue;
    }
    tableHeader = undefined;
    if (!line) continue;
    if (/^#{1,6}\s/.test(line)) {
      heading = undefined;
      if (!boilerplate.test(line.replace(/^#+\s*/, ''))) {
        heading = passages.length;
        passages.push({ text: line });
      }
      continue;
    }
    for (const { segment } of sentenceSegmenter.segment(line)) {
      const text = segment.trim();
      if (/[\p{L}\p{N}]/u.test(text) && !/^[A-Z]{1,2}$/.test(text) && !boilerplate.test(text) && !acknowledgement.test(text)) {
        passages.push({ text, heading });
      }
    }
  }
  return passages;
}

function selectPassages(passages: Passage[], query: string, question: string, cap: number): string[] {
  const wanted = keywords(question);
  const search = keywords(query);
  const ranked = passages.map(({ text }, index) => {
    const words = keywords(text);
    let score = 0;
    for (const word of words) {
      if (wanted.has(word)) score += 2;
      if (search.has(word)) score++;
    }
    return { index, score };
  }).sort((left, right) => right.score - left.score || left.index - right.index);
  const best = ranked[0];
  if (!best) return [];
  // Avoid filling the citation budget with weakly related phrases when a stronger match exists.
  const selected = new Set<number>([best.index]);
  const heading = passages[best.index].heading;
  if (heading !== undefined) selected.add(heading);
  for (const item of ranked) {
    if (selected.size >= cap || item.score < best.score * 0.75) break;
    selected.add(item.index);
  }
  return [...selected].sort((left, right) => left - right).map((index) => passages[index].text.slice(0, 900));
}

export function selectSources(hits: readonly FoundSource[], entities: readonly string[], question = ''): StoredSource[] {
  const ranked = hits.flatMap((hit) => {
    const url = normalizeUrl(hit.url);
    const passages = candidates(hit.content);
    return url && passages.length ? [{ hit, url, passages }] : [];
  }).sort((a, b) => b.hit.score - a.hit.score);
  const cap = Math.min(12, Math.max(8, entities.length));
  const seen = new Set<string>();
  const selected: typeof ranked = [];
  const add = (item: typeof ranked[number]) => {
    const key = item.hit.entity + '\0' + item.url.href;
    if (selected.length < cap && !seen.has(key)) { selected.push(item); seen.add(key); }
  };
  for (const count of [1, 2]) {
    for (const entity of entities) {
      const alternatives = ranked.filter((item) => item.hit.entity === entity &&
        !seen.has(entity + '\0' + item.url.href));
      if (alternatives.length && selected.filter((item) => item.hit.entity === entity).length < count) add(alternatives[0]);
    }
  }
  for (const item of ranked) add(item);
  return selected.map(({ hit, url, passages }, index) => ({
    ref: 'E' + (index + 1), url: url.href, domain: url.hostname,
    title: hit.title.trim().slice(0, 250) || url.hostname, entity: hit.entity,
    domainMatch: domainMatch(url.hostname, hit.entity), sentences: selectPassages(passages, hit.query, question, selected.length > 8 ? 2 : 3),
    retrievedAt: hit.retrievedAt, publishedAt: hit.publishedAt, query: hit.query,
  }));
}

function escape(value: string) {
  return value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]!);
}

export function sourceContext(sources: readonly StoredSource[]) {
  return sources.map((source) => '<untrusted_source id="' + source.ref + '">\n' +
    escape(source.title + '\n' + source.sentences.map((sentence, i) => source.ref + '.' + (i + 1) + ' ' + sentence).join('\n')) +
    '\n</untrusted_source>').join('\n');
}
