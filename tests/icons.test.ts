// Team crests and competition emblems (task 10D): link checks and the emblem meta row, run on SQLite
// with the real worker/schema.sql.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { EMBLEMS_SQL, emblemsOf, iconUrl, parseEmblems } from '../shared/icons.ts';

test('only plain https links count as images', () => {
  assert.equal(iconUrl('https://crests.football-data.org/57.png'), 'https://crests.football-data.org/57.png');
  assert.equal(iconUrl('http://crests.football-data.org/57.png'), null);
  assert.equal(iconUrl('javascript:alert(1)'), null);
  assert.equal(iconUrl('https://x.org/a"onerror="x'), null);
  assert.equal(iconUrl(null), null);
  assert.equal(iconUrl(''), null);
});

test('emblems come from the imported matches, bad or missing links skipped', () => {
  assert.deepEqual(
    emblemsOf([
      { competition: { code: 'PL', emblem: 'https://crests.football-data.org/PL.png' } },
      { competition: { code: 'DED', emblem: null } },
      { competition: { code: 'SA', emblem: 'ftp://x' } },
      { competition: { code: 'PL', emblem: 'https://crests.football-data.org/PL.png' } },
    ]),
    { PL: 'https://crests.football-data.org/PL.png' },
  );
});

test('stored emblems: bad JSON or bad links give no emblem', () => {
  assert.deepEqual(parseEmblems(undefined), {});
  assert.deepEqual(parseEmblems('not json'), {});
  assert.deepEqual(parseEmblems('{"PL":"https://a.org/PL.png","x y":"https://a.org/b.png","SA":"http://a"}'), {
    PL: 'https://a.org/PL.png',
  });
});

test('the emblem row merges new links and writes nothing when unchanged', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../worker/schema.sql', import.meta.url), 'utf8'));
  const write = (o: Record<string, string>) => Number(db.prepare(EMBLEMS_SQL).run(JSON.stringify(o)).changes);
  const read = () => parseEmblems((db.prepare(`SELECT v FROM meta WHERE k = 'emblems'`).get() as { v: string }).v);
  assert.equal(write({ PL: 'https://a.org/PL.png' }), 1);
  assert.equal(write({ SA: 'https://a.org/SA.png' }), 1);
  assert.deepEqual(read(), { PL: 'https://a.org/PL.png', SA: 'https://a.org/SA.png' });
  assert.equal(write({ PL: 'https://a.org/PL.png' }), 0); // unchanged: no row written
  assert.equal(write({ PL: 'https://a.org/PL2.png' }), 1); // a changed link replaces the old one
  assert.deepEqual(read(), { PL: 'https://a.org/PL2.png', SA: 'https://a.org/SA.png' });
});
