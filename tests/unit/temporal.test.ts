import { expect, test } from 'vitest';
import fixtures from '../../eval/fixtures/resolver-cases.json' with { type: 'json' };
import { resolve } from '../../server/src/temporal/resolve.ts';

test.each(fixtures)('$id resolves the frozen civil-time interval', ({ text, now, tz, intervals, alternates, flags }) => {
  const result = resolve(text, new Date(now), tz);
  expect(result.intervals).toEqual(intervals.map((date) => expect.objectContaining(date)));
  expect(result.alternates).toEqual(alternates.map((date) => expect.objectContaining(date)));
  expect(result.flags).toEqual(flags);
});

test('spring-forward days are 23 hours, invalid dates do not roll, and leap-day year inference works', () => {
  const now = new Date('2026-11-17T04:30:00.000Z');
  const spring = resolve('2026-03-08', now, 'America/Los_Angeles').intervals[0];
  expect(Date.parse(spring.endUtc) - Date.parse(spring.startUtc)).toBe(23 * 3_600_000);
  expect(resolve('2026-02-29', now, 'UTC').intervals).toEqual([]);
  expect(resolve('on February 29', now, 'UTC').intervals[0].localStart).toBe('2024-02-29');
  expect(resolve('last month', new Date('2026-01-04T00:00:00.000Z'), 'UTC').intervals[0]).toMatchObject({
    localStart: '2025-12-01', startUtc: '2025-12-01T00:00:00.000Z', endUtc: '2026-01-01T00:00:00.000Z',
  });
});
