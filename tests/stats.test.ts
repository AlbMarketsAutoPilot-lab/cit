import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepDays, lastMonths, monthSeries, pickStats, type StatPick } from '../shared/stats.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 17, 12); // 2026-11-17
const p = (daysAgo: number, pick: string, hg: number, ag: number, sh: number | null = null, sa: number | null = null): StatPick => ({
  kickoff: NOW - daysAgo * DAY,
  pick,
  sh,
  sa,
  hg,
  ag,
});

test('keep days follow the cleanup tiers', () => {
  assert.deepEqual([0, 1, 2, 3, 9, -1, NaN].map(keepDays), [60, 30, 14, 7, 7, 60, 60]);
});

test('recent and previous periods, exact counted as right', () => {
  const s = pickStats(
    [
      p(1, '1', 2, 0, 2, 0), // exact
      p(2, 'X', 1, 1), // right
      p(3, '2', 1, 0), // wrong
      p(40, '1X', 0, 0), // previous, right
      p(45, '12', 0, 0), // previous, wrong
      p(70, '1', 1, 0), // outside 60 days: ignored
    ],
    NOW,
    60,
  );
  assert.equal(s.half, 30);
  assert.deepEqual(s.recent, { n: 3, right: 2, exact: 1 });
  assert.deepEqual(s.previous, { n: 2, right: 1, exact: 0 });
  assert.deepEqual(s.byPick['1'], { n: 1, right: 1 });
  assert.deepEqual(s.byPick['12'], { n: 1, right: 0 });
  assert.deepEqual(s.byPick['X2'], { n: 0, right: 0 });
});

test('streak counts back from the latest pick, whatever the input order', () => {
  const s = pickStats([p(5, '1', 0, 1), p(1, 'X', 2, 2), p(3, '2', 0, 3), p(2, '1X', 1, 0)], NOW, 60);
  assert.equal(s.streak, 3);
  assert.equal(pickStats([p(1, '1', 0, 1), p(2, '1', 1, 0)], NOW, 60).streak, 0);
  assert.equal(pickStats([], NOW, 60).streak, 0);
});

test('a smaller tier window shrinks both periods', () => {
  const s = pickStats([p(2, '1', 1, 0), p(5, '1', 1, 0), p(10, '1', 1, 0)], NOW, 7);
  assert.equal(s.half, 3);
  assert.equal(s.recent.n, 1);
  assert.equal(s.previous.n, 1);
  assert.equal(s.byPick['1'].n, 2);
});

test('bad picks and future kickoffs are ignored', () => {
  const s = pickStats([p(1, 'Z', 1, 0), p(-1, '1', 1, 0)], NOW, 60);
  assert.equal(s.recent.n, 0);
});

test('12 months, oldest first, zeros filled', () => {
  assert.deepEqual(lastMonths(NOW).slice(0, 2), ['2025-12', '2026-01']);
  assert.equal(lastMonths(NOW).at(-1), '2026-11');
  const m = monthSeries([{ m: '2026-10', h: 9 }, { m: '2024-01', h: 5 }], NOW);
  assert.equal(m.length, 12);
  assert.equal(m.find((x) => x.m === '2026-10')!.h, 9);
  assert.equal(m.reduce((a, x) => a + x.h, 0), 9);
});
