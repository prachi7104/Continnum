// Releases only structurally supported checkable sentences and strips invalid references.
import { sentenceSegmenter, type StoredSource } from './sources.ts';

const reference = /\b(?:E\d+(?:\.\d+)?|H[\da-f-]+\.\d+)\b/gi;
export const checkable = /[\p{N}\p{Sc}%]|\b(?:ceo|president|price|pricing|costs?|limits?|versions?|released?|today|yesterday|latest|january|february|march|april|june|july|august|september|october|november|december)\b/iu;
const canonical = (value: string) => value.normalize('NFKC').toLowerCase()
  .replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, '').replace(/\s*(?:percent|%)/g, '%').replace(/(\p{Sc})\s+/gu, '$1');
const values = (value: string): string[] => canonical(value).match(/[+-]?(?:\p{Sc})?\d+(?:\.\d+)*%?/gu) ?? [];
const terms = (value: string): string[] => (canonical(value).match(/\p{L}{3,}/gu) ?? [])
  .filter((word) => !['the', 'and', 'was', 'are', 'that', 'this', 'with', 'from', 'has', 'had', 'for'].includes(word));
const normalizeQuotation = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');

function chunks(text: string): string[] {
  const attached = text.replace(/([.!?])\s*((?:\[[EH][^\]\n]+\]\s*)+)/g, (_whole, mark: string, refs: string) => ' ' + refs.trim() + mark + ' ');
  return Array.from(sentenceSegmenter.segment(attached), ({ segment }) => segment.trim()).filter(Boolean);
}

export type Released = { text: string; refs: string[]; support: 'sourced' | 'no_source' };
export type HistoricalSource = { ref: string; entity: string; sentences: string[]; messageId: string };
export const unavailableText = "I couldn't search the web, so I can't confirm current facts.";

export function releaseAnswer(draft: string, sources: readonly StoredSource[], history?: readonly HistoricalSource[]) {
  const index = new Map((history ?? sources).flatMap((source) => source.sentences.map((sentence, i) => [
    source.ref + '.' + (i + 1), { sentence, entity: source.entity },
  ] as const)));
  const sentences: Released[] = [];
  const supported = new Set<string>();
  let withheld = 0;
  for (const line of chunks(draft)) {
    const refs = [...new Set((line.match(reference) ?? []).map((ref) => ref.startsWith('e') ? ref.toUpperCase() : ref).filter((ref) => index.has(ref)))];
    const text = line.replace(/\[(?:\s*[EH][\w.-]+[,;\s]*)+\]/gi, '').replace(reference, '').replace(/\[\s*[,;\s]*\]/g, '')
      .replace(/https?:\/\/[^\s<>]+/gi, '').replace(/\s+([.,!?])/g, '$1').trim();
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    const cited = refs.map((ref) => index.get(ref)!);
    if (history) {
      // Historical synthesis can select and order actual sentences. Exact matches
      // prevent a model from swapping entities or values within a cited sentence.
      const matching = refs.filter((ref) => normalizeQuotation(index.get(ref)!.sentence) === normalizeQuotation(text));
      if (!matching.length) { withheld++; continue; }
      matching.forEach((ref) => supported.add(index.get(ref)!.entity));
      sentences.push({ text, refs: matching, support: 'sourced' });
      continue;
    }
    const needed = values(text);
    const words = terms(text);
    const relevant = cited.filter(({ sentence }) => {
      const present = new Set(terms(sentence));
      return words.every((word) => present.has(word));
    });
    const supportedValue = needed.length
      ? needed.every((value) => relevant.some(({ sentence }) => values(sentence).includes(value)))
      : words.length > 0 && relevant.length > 0;
    if (checkable.test(text) && (!refs.length || !supportedValue)) { withheld++; continue; }
    cited.forEach(({ entity }) => supported.add(entity));
    sentences.push({ text, refs, support: refs.length ? 'sourced' : 'no_source' });
  }
  return { sentences, withheld, supported };
}
