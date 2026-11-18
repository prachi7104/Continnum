import { localDate } from '../clock.ts';

const dayMs = 86_400_000;
const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const weekdays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const month = months.map((name) => name.length > 3 ? name.slice(0, 3) + '(?:' + name.slice(3) + ')?' : name).join('|');
const weekday = weekdays.join('|');
const amount = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];
export type Interval = { label: string; localStart: string; localEnd: string; startUtc: string; endUtc: string };
export type Resolution = { intervals: Interval[]; alternates: Interval[]; flags: ('sinceLast' | 'future')[]; rest: string };

export const civilDay = (date: Date, tz: string) => Date.parse(localDate(date, tz) + 'T00:00:00Z') / dayMs;
const isoDay = (day: number) => new Date(day * dayMs).toISOString().slice(0, 10);
const weekdayOf = (day: number) => new Date(day * dayMs).getUTCDay();

function boundary(day: number, tz: string) {
  // Find the first instant of the civil date, even when midnight is skipped or repeated.
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const target = isoDay(day);
  let left = (day - 2) * dayMs;
  let right = (day + 2) * dayMs;
  while (right - left > 1) {
    const mid = left + Math.floor((right - left) / 2);
    if (format.format(new Date(mid)) < target) left = mid;
    else right = mid;
  }
  return new Date(right).toISOString();
}

export function resolve(text: string, now: Date, tz: string): Resolution {
  const result: Resolution = { intervals: [], alternates: [], flags: [], rest: text };
  const today = civilDay(now, tz);
  const current = new Date(today * dayMs);
  const year = current.getUTCFullYear();
  const week = today - (weekdayOf(today) + 6) % 7;
  const since = /\bsince\b/i.test(text);
  const match = (pattern: RegExp) => {
    const found = pattern.exec(text);
    if (found) result.rest = text.slice(0, found.index) + ' ' + text.slice(found.index + found[0].length);
    return found;
  };
  const interval = (start: number, end: number): Interval => ({
    label: start === end ? isoDay(start) : isoDay(start) + ' to ' + isoDay(end),
    localStart: isoDay(start), localEnd: isoDay(end),
    startUtc: boundary(start, tz), endUtc: since ? now.toISOString() : boundary(end + 1, tz),
  });
  const finish = (start: number, end = start, alternate?: number) => {
    if (start > today) result.flags.push('future');
    else {
      const primary = interval(start, end);
      if (primary.startUtc < primary.endUtc) result.intervals.push(primary);
      if (alternate !== undefined) result.alternates.push(interval(alternate, alternate));
    }
    return result;
  };
  const civil = (y: number, m: number, d: number) => {
    const date = new Date(0);
    date.setUTCFullYear(y, m, d);
    return date.getTime() / dayMs;
  };
  const dayFor = (y: number, m: number, d: number) => {
    const value = civil(y, m, d);
    const parsed = new Date(value * dayMs);
    return parsed.getUTCMonth() === m && parsed.getUTCDate() === d ? value : undefined;
  };
  if (match(/\b(?:since\s+)?(?:(?:our|the)\s+)?last\s+(?:discussion|conversation|time)\b/i)) {
    result.flags.push('sinceLast');
    return result;
  }
  const absolute = match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (absolute) {
    const date = dayFor(+absolute[1], +absolute[2] - 1, +absolute[3]);
    return date === undefined ? result : finish(date);
  }
  const named = match(new RegExp('\\b(?:('+weekday+')\\s+)?(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+('+month+')|('+month+')\\s+(\\d{1,2})(?:st|nd|rd|th)?)(?:[,]?\\s+(\\d{4}))?\\b', 'i'));
  if (named) {
    const m = months.findIndex((name) => name.toLowerCase().startsWith((named[3] ?? named[4]).toLowerCase()));
    const d = +(named[2] ?? named[5]);
    if (named[6]) {
      const date = dayFor(+named[6], m, d);
      return date === undefined ? result : finish(date);
    }
    if (dayFor(2000, m, d) === undefined) return result;
    for (let y = year; y >= year - 8; y--) {
      const date = dayFor(y, m, d);
      if (date !== undefined && date <= today) return finish(date);
    }
  }
  const relative = match(new RegExp('\\b(\\d{1,6}|'+amount.join('|')+')\\s+(day|week)s?\\s+ago\\b', 'i'));
  if (relative) {
    const n = /^\d/.test(relative[1]) ? +relative[1] : amount.indexOf(relative[1].toLowerCase());
    return finish(today - n * (relative[2].toLowerCase() === 'week' ? 7 : 1));
  }
  const range = match(/\b(this|last)\s+(week|month)\b/i);
  if (range) {
    const previous = range[1].toLowerCase() === 'last';
    if (range[2].toLowerCase() === 'week') return previous ? finish(week - 7, week - 1) : finish(week, today);
    const first = civil(year, current.getUTCMonth(), 1);
    return previous ? finish(civil(year, current.getUTCMonth() - 1, 1), first - 1) : finish(first, today);
  }
  const namedMonth = match(new RegExp('\\b(?:in|during|since)\\s+('+month+')(?:\\s+(\\d{4}))?\\b', 'i'));
  if (namedMonth) {
    const m = months.findIndex((name) => name.toLowerCase().startsWith(namedMonth[1].toLowerCase()));
    const y = namedMonth[2] ? +namedMonth[2] : year - Number(m > current.getUTCMonth());
    return finish(civil(y, m, 1), Math.min(today, civil(y, m + 1, 1) - 1));
  }
  const day = match(/\b(today|yesterday)\b/i);
  if (day) return finish(today - Number(day[1].toLowerCase() === 'yesterday'));
  const compound = match(new RegExp('\\b(?:the\\s+)?('+weekday+')\\s+before\\s+(?:this\\s+one|last)\\b', 'i'));
  const namedWeekday = compound ?? match(new RegExp('\\b(last\\s+)?('+weekday+')\\b', 'i'));
  if (namedWeekday) {
    const target = weekdays.findIndex((name) => name.toLowerCase() === (compound ? compound[1] : namedWeekday[2]).toLowerCase());
    const delta = (weekdayOf(today) - target + 7) % 7;
    const last = !compound && Boolean(namedWeekday[1]);
    const date = today - (compound ? delta + 7 : last && delta === 0 ? 7 : delta);
    return finish(date, date, last && date >= week ? date - 7 : undefined);
  }
  return result;
}
