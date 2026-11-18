import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { type Workspace, localDate } from '../clock.ts';
import { checkable } from '../evidence/release.ts';
import { civilDay, resolve, type Interval } from '../temporal/resolve.ts';

export type MemoryState = 'NOT_REQUESTED' | 'EMPTY_RANGE' | 'NO_CONFIDENT_MATCH' | 'AMBIGUOUS'
  | 'FOUND_NO_BASELINE' | 'FOUND_WITH_BASELINE' | 'ERROR';
export type Episode = {
  messageId: string; conversationId: string; title: string; logicalAt: string; origin: 'real' | 'sample' | 'fake';
  question: string; answerId: string | null; answer: string | null; status: string | null;
  answerOrigin: string | null; userRow: number; answerRow: number | null;
};
export type MemoryInput = {
  text: string; workspace: Workspace; conversationId: string; turnId: string;
  now: Date; tz: string; fakeMode: boolean; pinnedEpisodeId?: string; noDateFilter?: boolean;
};
export type Memory = {
  state: MemoryState; episodes: Episode[]; intervals: Interval[]; usedAlternate: boolean;
  nearest: string[]; topics: string[]; searched: number; truncated: boolean; synthesize: boolean; scanLimit?: number;
};
type Ranked = { episode: Episode; terms: Set<string>; relevance: number };

const stop = new Set(('a an about after again all anything are as at be before can changed changes compare compared comparison correct conclude ' +
  'conversation conversations did discuss discussed discussion do does earlier everything for found from has have how i in is it last looked me my no ' +
  'of on options or our previous recall recommendations remind right same say said search since so some still summarize summarise talk ' +
  'tell told than that the them then there these thing this those to up valid vs was we were what when where which who will ' +
  'with would you your answer answers ask asked asking advice mentioned monday tuesday wednesday thursday friday saturday sunday ' +
  'at noon midnight one ago today yesterday very now longer').split(/\s+/));
const memoryCue = /\b(?:remind me|recall|you (?:said|told|mentioned|found|looked up|compared)|did (?:i|we|you) (?:ask|discuss|talk|say|tell|conclude)|(?:we|i) (?:shortlisted|discussed|asked)|earlier|previous|discussion|that answer|answer (?:still|about)|still (?:correct|right|valid)|since|those|the .+ (?:thing|comparison))\b/i;
const singleReferent = /\b(?:still|changed|correct|valid|that answer)\b/i;
const currentDateQuestion = /\b(?:latest|current|news|released|announced|weather)\b/i;
const dayMs = 86_400_000;
export const baseline = (ep: Episode) => ep.status === 'complete' && ep.answerOrigin !== 'fake' && Boolean(ep.answer);
const checkableBaseline = (ep: Episode) => baseline(ep) && checkable.test(ep.answer!);

function terms(text: string) {
  // Query tokens are passed to the same Porter tokenizer as the indexed messages.
  return [...new Set((text.normalize('NFKC').toLowerCase().replace(/\brent(?:al)? pric(?:e|es|ing)\b/g, 'rent').match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => word.length > 1 && !stop.has(word) && !/^\d+$/.test(word)))].slice(0, 16);
}

export function eligibleEpisodes(db: DatabaseSync, input: MemoryInput, intervals: readonly Interval[] = [], pinned?: string) {
  const bounds: SQLInputValue[] = [input.workspace, input.now.toISOString(), input.turnId];
  const origin = input.fakeMode ? '' : "AND u.origin <> 'fake'";
  const sample = input.workspace === 'live' ? "AND u.origin <> 'sample'" : '';
  const dates = intervals.map(({ startUtc, endUtc }) => {
    bounds.push(startUtc, endUtc);
    return '(u.logical_at >= ? AND u.logical_at < ?)';
  });
  if (pinned) bounds.push(pinned);
  return db.prepare(`SELECT u.id AS messageId, u.conversation_id AS conversationId, c.title, u.logical_at AS logicalAt,
    u.origin, u.content AS question, a.id AS answerId, a.content AS answer, a.status, a.origin AS answerOrigin,
    u.rowid AS userRow, a.rowid AS answerRow
    FROM messages u JOIN conversations c ON c.id=u.conversation_id AND c.workspace=u.workspace
    LEFT JOIN messages a ON a.reply_to=u.id AND a.role='assistant' AND a.conversation_id=u.conversation_id
      AND a.workspace=u.workspace AND a.origin=u.origin
    WHERE u.workspace=? AND u.logical_at<? AND u.turn_id IS NOT ? AND u.role='user'
      AND c.origin=u.origin ${origin} ${sample} ${dates.length ? 'AND (' + dates.join(' OR ') + ')' : ''}
      ${pinned ? 'AND u.id=?' : ''}
    ORDER BY u.logical_at DESC, u.rowid DESC`).all(...bounds) as unknown as Episode[];
}

function lexical(db: DatabaseSync, episodes: Episode[], words: string[], scoped: boolean): Ranked[] {
  if (!episodes.length || !words.length) return [];
  const candidates = episodes.map((episode) => ({ episode, terms: new Set<string>(), relevance: 0 }));
  const byRow = new Map<number, Ranked>();
  for (const candidate of candidates) {
    byRow.set(candidate.episode.userRow, candidate);
    // Partial or stopped text can be displayed, but it cannot establish a match by itself.
    if (candidate.episode.status === 'complete' && candidate.episode.answerRow !== null) byRow.set(candidate.episode.answerRow, candidate);
  }
  const lookup = db.prepare(`SELECT rowid, -bm25(messages_fts) AS rel FROM messages_fts
    WHERE messages_fts MATCH ? AND rowid IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`);
  const ids = JSON.stringify([...byRow.keys()]);
  const aliases: Record<string, string> = {
    llm: '"large language model"', bandwidth: '"egress" OR "data transfer"',
    costs: '"price" OR "fee"', charges: '"fee"', flat: '"apartment"',
  };
  const rankedTerms = new Set<string>();
  for (const word of words) {
    // Collapse inflection variants when Porter produces the same eligible row matches.
    const rows = lookup.all('"' + word + '"' + (Object.hasOwn(aliases, word) ? ' OR ' + aliases[word] : ''), ids)
      .sort((a, b) => Number(a.rowid) - Number(b.rowid));
    const signature = rows.map((row) => row.rowid).join(',');
    if (signature && rankedTerms.has(signature) && rows.every((row) => {
      const content = byRow.get(Number(row.rowid))!.episode;
      return !new RegExp('\\b' + word + '\\b', 'iu').test(content.question + ' ' + (content.answer ?? ''));
    })) continue;
    if (signature) rankedTerms.add(signature);
    const best = new Map<Ranked, number>();
    for (const row of rows) {
      const candidate = byRow.get(Number(row.rowid))!;
      best.set(candidate, Math.max(best.get(candidate) ?? 0, Number(row.rel)));
    }
    for (const [candidate, score] of best) {
      candidate.relevance += score;
      candidate.terms.add(word);
    }
  }
  const need = scoped ? 1 : Math.ceil(words.length / 2) + Number(words.length === 2);
  return candidates.filter((entry) => entry.terms.size >= need)
    .sort((a, b) => b.terms.size - a.terms.size || b.relevance - a.relevance ||
      b.episode.logicalAt.localeCompare(a.episode.logicalAt));
}

function groups(hits: Ranked[], scoped: boolean) {
  const result: Ranked[][] = [];
  for (const hit of hits) {
    const matches = result.filter((group) => group.some((part) => scoped
      ? [...part.terms].some((word) => hit.terms.has(word))
      : part.episode.conversationId === hit.episode.conversationId));
    if (!matches.length) result.push([hit]);
    else {
      matches[0].push(hit);
      for (const extra of matches.slice(1)) {
        matches[0].push(...extra);
        result.splice(result.indexOf(extra), 1);
      }
    }
  }
  return result;
}

export function retrieve(db: DatabaseSync, input: MemoryInput): Memory {
  const output: Memory = { state: 'NOT_REQUESTED', episodes: [], intervals: [], usedAlternate: false,
    nearest: [], topics: [], searched: 0, truncated: false, synthesize: false };
  const found = (episodes: Episode[]) => {
    output.truncated = episodes.length > 6;
    output.episodes = episodes.slice(0, 6);
    output.state = output.episodes.some(checkableBaseline) ? 'FOUND_WITH_BASELINE' : 'FOUND_NO_BASELINE';
    return output;
  };
  const ambiguous = (episodes: Episode[]) => {
    output.episodes = episodes.slice(0, 4);
    output.state = 'AMBIGUOUS';
    return output;
  };
  try {
    if (input.pinnedEpisodeId) {
      const pinned = eligibleEpisodes(db, input, [], input.pinnedEpisodeId);
      return pinned.length ? found(pinned) : { ...output, state: 'NO_CONFIDENT_MATCH' };
    }
    const date = resolve(input.text, input.now, input.tz);
    const hasCue = memoryCue.test(input.text);
    const requested = date.intervals.length || date.flags.length;
    if (!hasCue && (!requested || currentDateQuestion.test(input.text))) return output;
    output.synthesize = /\b(?:summari[sz]e|synthesi[sz]e|combine)\b/i.test(input.text);
    const scope = input.noDateFilter ? [] : date.intervals;
    output.intervals = scope;
    const words = terms(date.rest);
    let episodes = eligibleEpisodes(db, input, scope);
    if (!episodes.length && !input.noDateFilter && date.alternates.length) {
      output.usedAlternate = true;
      output.intervals = date.alternates;
      episodes = eligibleEpisodes(db, input, date.alternates);
    }
    output.searched = episodes.length;
    if ((output.intervals.length && !episodes.length) || date.flags.includes('future')) {
      const nearestTo = Date.parse((output.intervals[0]?.localStart ?? localDate(input.now, input.tz)) + 'T00:00:00Z') / dayMs;
      output.nearest = [...new Set(eligibleEpisodes(db, input).map((ep) => localDate(new Date(ep.logicalAt), input.tz)))]
        .sort((left, right) => {
          const distance = (value: string) => Math.abs(Date.parse(value + 'T00:00:00Z') / dayMs - nearestTo);
          return distance(left) - distance(right) || left.localeCompare(right);
        }).slice(0, 3);
      output.state = 'EMPTY_RANGE';
      return output;
    }
    const anaphora = /\b(?:that answer|those|is it|does it)\b/i.test(input.text);
    if (!requested && !words.length && anaphora &&
        episodes.some((ep) => ep.conversationId === input.conversationId && ep.status === 'complete')) return output;
    if (/\bprevious recommendations\b/i.test(input.text) && !words.length) {
      const start = input.now.getTime() - 30 * dayMs;
      output.scanLimit = 5;
      const checkableEpisodes = episodes.filter((ep) => Date.parse(ep.logicalAt) >= start && checkableBaseline(ep));
      if (checkableEpisodes.length) return found(checkableEpisodes.slice(0, output.scanLimit));
      return { ...output, state: 'NO_CONFIDENT_MATCH' };
    }
    if (date.flags.includes('sinceLast')) {
      const completed = episodes.filter((ep) => ep.status === 'complete');
      const reference = words.length
        ? lexical(db, completed, words, false).map((hit) => hit.episode).sort((a, b) => b.logicalAt.localeCompare(a.logicalAt))
        : completed;
      const same = !words.length && reference.find((ep) => ep.conversationId === input.conversationId);
      const newest = same || reference[0];
      if (newest) {
        const newerDay = civilDay(new Date(newest.logicalAt), input.tz);
        const topic = new Set(terms(newest.question));
        const nearby = reference.filter((ep) => ep !== newest && ep.conversationId !== newest.conversationId &&
          Math.abs(Date.parse(newest.logicalAt) - Date.parse(ep.logicalAt)) <= dayMs);
        const unrelated = !same && !words.length && nearby.find((ep) => !terms(ep.question).some((word) => topic.has(word)));
        if (unrelated) return ambiguous([newest, unrelated]);
        output.intervals = [{ label: 'Since last discussion', startUtc: newest.logicalAt, endUtc: input.now.toISOString(),
          localStart: localDate(new Date(newest.logicalAt), input.tz), localEnd: localDate(input.now, input.tz) }];
        return found([newest, ...nearby.filter((ep) => civilDay(new Date(ep.logicalAt), input.tz) === newerDay &&
          terms(ep.question).some((word) => topic.has(word)))]);
      }
    } else if (!words.length && episodes.length) {
      if (!requested && singleReferent.test(input.text)) {
        const candidates: Episode[] = [];
        for (const episode of episodes) {
          if (!candidates.some((candidate) => candidate.conversationId === episode.conversationId)) candidates.push(episode);
          if (candidates.length === 4) break;
        }
        if (candidates.length > 1) return ambiguous(candidates);
      }
      return found(episodes);
    } else {
      const needsSingle = singleReferent.test(input.text);
      const ranked = lexical(db, episodes, words, output.intervals.length > 0);
      if (ranked.length) {
        if (!requested && anaphora && ranked[0].episode.conversationId === input.conversationId) return output;
        const arranged = groups(ranked, output.intervals.length > 0);
        if (needsSingle && arranged[0][0].terms.size === arranged[1]?.[0].terms.size) {
          return ambiguous(arranged.map((group) => group[0].episode));
        }
        const selected = arranged[0].map(({ episode }) => episode);
        if (selected.length === 1 && !needsSingle) {
          const inConversation = episodes.filter((ep) => ep.conversationId === selected[0].conversationId);
          const index = inConversation.indexOf(selected[0]);
          const adjacent = [inConversation[index - 1], inConversation[index + 1]].find((ep) =>
            ep && terms(ep.question).some((word) => words.includes(word)));
          if (adjacent) selected.push(adjacent);
        }
        return found(selected);
      }
    }
    output.state = 'NO_CONFIDENT_MATCH';
    output.topics = [...new Set(episodes.map((ep) => ep.title))].slice(0, 4);
    return output;
  } catch {
    return { ...output, state: 'ERROR', episodes: [] };
  }
}
