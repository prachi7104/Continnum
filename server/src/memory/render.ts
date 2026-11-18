import type { MemoryView } from '../../../shared/events.ts';
import { sentenceSegmenter } from '../evidence/sources.ts';
import type { HistoricalSource } from '../evidence/release.ts';
import { baseline, type Episode, type Memory } from './retrieve.ts';

export function historySources(episodes: Episode[]): HistoricalSource[] {
  return episodes.flatMap((episode) => {
    if (!baseline(episode) || !episode.answerId) return [];
    const sentences = [...sentenceSegmenter.segment(episode.answer!)].map(({ segment }) => segment.trim())
      .filter((line) => line && Buffer.byteLength(line) <= 800).slice(0, 2);
    return [{ ref: 'H' + episode.answerId, entity: episode.title, sentences, messageId: episode.messageId }];
  });
}

export function memoryView(memory: Memory, tz: string): MemoryView {
  const byEpisode = new Map(historySources(memory.episodes).map((source) => [source.messageId, source]));
  return { state: memory.state, intervals: memory.intervals, usedAlternate: memory.usedAlternate, truncated: memory.truncated, tz,
    episodes: memory.episodes.map((episode) => {
      const source = byEpisode.get(episode.messageId);
      return { messageId: episode.messageId, conversationId: episode.conversationId, title: episode.title, logicalAt: episode.logicalAt,
        preview: episode.question.slice(0, 320), origin: episode.origin, eligible: baseline(episode),
        refs: source?.sentences.map((_, index) => source.ref + '.' + (index + 1)) ?? [] };
    }) };
}

export const clarificationQuestion = 'Which past conversation did you mean?';
const literal = (value: string) => value.replace(/[\\`*_{}\[\]()#+.!<>|~]/g, '\\$&').replace(/\s+/g, ' ');

export function recallText(memory: Memory, tz: string) {
  if (memory.state === 'ERROR') return 'My memory lookup failed.';
  if (memory.state === 'EMPTY_RANGE') {
    const range = memory.intervals.map((interval) => interval.label).join(', ');
    return (range ? 'I have no conversations from ' + range + '.' : 'I have no conversations in the requested date range.') +
      (memory.nearest.length ? ' Nearest active days: ' + memory.nearest.join(', ') + '.' : '');
  }
  if (memory.state === 'NO_CONFIDENT_MATCH') {
    return memory.intervals.length
      ? "I found conversations in that period, but couldn't identify a matching topic." +
        (memory.topics.length ? ' Topics in that period: ' + memory.topics.map(literal).join('; ') + '.' : '')
      : memory.scanLimit ? "I couldn't find a checkable earlier answer in the past 30 days." :
        "I couldn't find a matching past conversation (searched " + memory.searched + ').';
  }
  const format = new Intl.DateTimeFormat('en', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' });
  const excerpts = new Map(historySources(memory.episodes).map((source) => [source.messageId, source.sentences]));
  return memory.episodes.map((episode) => {
    const answer = excerpts.get(episode.messageId)?.join(' ');
    const note = !baseline(episode) ? (episode.origin === 'fake' && episode.status === 'complete'
      ? 'Scripted answer, excluded as a factual baseline.' : 'Stopped before finishing.') : 'No short excerpt available.';
    return format.format(new Date(episode.logicalAt)) + ' (' + tz + ') — You asked: ' + literal(episode.question.slice(0, 600)) +
      '\n\n' + (answer ? 'Earlier answer: ' + literal(answer) : note);
  }).join('\n\n') + (memory.truncated ? '\n\nOnly six matching episodes are shown.' : '') +
    (memory.scanLimit ? '\n\nThis scan covers up to ' + memory.scanLimit + ' checkable answers from the past 30 days.' : '') +
    (memory.usedAlternate ? '\n\nI used the alternate date.' : '') +
    (memory.state === 'FOUND_NO_BASELINE' ? '\n\nI found the earlier discussion, but no checkable completed answer to use as a baseline.' : '');
}

export function historyContext(sources: HistoricalSource[]) {
  return sources.map(({ ref, sentences }) => '<untrusted_source id="' + ref + '">\n' +
    sentences.map((line, index) => ref + '.' + (index + 1) + ' ' + line.replace(/[&<>]/g, (char) =>
      char === '&' ? '&amp;' : char === '<' ? '&lt;' : '&gt;')).join('\n') + '\n</untrusted_source>').join('\n');
}
