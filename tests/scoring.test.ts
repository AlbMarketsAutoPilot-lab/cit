import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayOf,
  formatHalves,
  monthStart,
  pointsTable,
  probabilities,
  score,
  validScore,
  weekStart,
} from '../shared/scoring.ts';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('base rates when there is no table', () => {
  const p = probabilities(null, null);
  close(p.p1, 0.45);
  close(p.pX, 0.26);
  close(p.p2, 0.29);
  assert.deepEqual(probabilities(2, null), p);
});

test('probabilities always sum to 1 and stay above 0.08 before renormalising', () => {
  for (let h = 0; h <= 3; h += 0.25) {
    for (let a = 0; a <= 3; a += 0.25) {
      const p = probabilities(h, a);
      close(p.p1 + p.pX + p.p2, 1);
      assert.ok(p.p1 > 0.07 && p.pX > 0.07 && p.p2 > 0.07);
    }
  }
});

test('stronger home team is favoured', () => {
  const p = probabilities(2.5, 0.8);
  assert.ok(p.p1 > 0.6 && p.p2 < 0.2);
});

test('even match gives 2 for singles and 1 for doubles', () => {
  assert.deepEqual(pointsTable({ p1: 1 / 3, pX: 1 / 3, p2: 1 / 3 }), {
    '1': 4,
    X: 4,
    '2': 4,
    '1X': 2,
    X2: 2,
    '12': 2,
  });
});

test('plan example 50/27/23', () => {
  assert.deepEqual(pointsTable({ p1: 0.5, pX: 0.27, p2: 0.23 }), {
    '1': 3,
    X: 5,
    '2': 6,
    '1X': 2,
    X2: 3,
    '12': 2,
  });
});

test('clamps: singles 1–5, doubles 0.5–2.5', () => {
  const t = pointsTable({ p1: 0.84, pX: 0.08, p2: 0.08 });
  assert.equal(t['1'], 2);
  assert.equal(t.X, 10);
  assert.equal(t['2'], 10);
  assert.equal(t.X2, 5);
  assert.equal(t['1X'], 1);
});

test('exact score must agree with the pick', () => {
  assert.ok(validScore('1', null, null));
  assert.ok(validScore('1', 2, 1));
  assert.ok(!validScore('1', 1, 1));
  assert.ok(validScore('1X', 1, 1));
  assert.ok(validScore('12', 0, 3));
  assert.ok(!validScore('12', 2, 2));
  assert.ok(!validScore('X', 1, null));
  assert.ok(!validScore('X', 1.5, 1.5));
  assert.ok(!validScore('X', -1, -1));
});

test('scoring', () => {
  const t = pointsTable({ p1: 0.5, pX: 0.27, p2: 0.23 });
  assert.deepEqual(score(t, '1', null, null, 2, 1), { halves: 3, exact: false });
  assert.deepEqual(score(t, '1', 2, 1, 2, 1), { halves: 9, exact: true });
  assert.deepEqual(score(t, '1', 3, 1, 2, 1), { halves: 3, exact: false });
  assert.deepEqual(score(t, 'X2', 0, 0, 0, 0), { halves: 9, exact: true });
  assert.deepEqual(score(t, '12', null, null, 1, 1), { halves: 0, exact: false });
  assert.deepEqual(score(t, '2', 0, 1, 1, 0), { halves: 0, exact: false });
});

test('formatting halves', () => {
  assert.equal(formatHalves(4), '2');
  assert.equal(formatHalves(3), '1.5');
  assert.equal(formatHalves(0), '0');
});

test('UTC calendar helpers', () => {
  const sun = Date.UTC(2026, 9, 25, 23, 30); // Sunday 25 Oct 2026
  assert.equal(dayOf(sun), '2026-10-25');
  assert.equal(weekStart(sun), '2026-10-19');
  assert.equal(weekStart(Date.UTC(2026, 9, 26)), '2026-10-26');
  assert.equal(monthStart(sun), '2026-10-01');
  assert.equal(weekStart(Date.UTC(2026, 10, 1)), '2026-10-26');
});
