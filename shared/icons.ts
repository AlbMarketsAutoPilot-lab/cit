// Team crests and competition emblems (task 10D). Phones load the images straight from football-data.org;
// the Worker only stores and passes on the links. Crest links live in matches (home_crest, away_crest);
// emblem links live in one meta row (k = 'emblems', JSON: competition code → link).

// Only plain https links are shown or stored; anything else counts as "no image".
export function iconUrl(v: unknown): string | null {
  return typeof v === 'string' && v.length <= 300 && /^https:\/\/[^\s"'<>]+$/.test(v) ? v : null;
}

// Emblem links from the matches of one import: competition code → link.
export function emblemsOf(list: { competition?: { code?: string; emblem?: string | null } }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of list) {
    const code = m.competition?.code;
    const url = iconUrl(m.competition?.emblem);
    if (code && url) out[code] = url;
  }
  return out;
}

// Merges new links into the stored ones; writes only when something changed (usually 0 rows a day).
export const EMBLEMS_SQL = `INSERT INTO meta (k, v)
  VALUES ('emblems', json_patch(COALESCE((SELECT v FROM meta WHERE k = 'emblems'), '{}'), ?1))
  ON CONFLICT (k) DO UPDATE SET v = excluded.v WHERE meta.v IS NOT excluded.v`;

// The stored meta value → a clean map (bad JSON or bad links are dropped).
export function parseEmblems(v: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const o = JSON.parse(v ?? '{}') as Record<string, unknown>;
    for (const [k, u] of Object.entries(o ?? {})) {
      const url = iconUrl(u);
      if (url && /^[A-Z0-9]{2,4}$/.test(k)) out[k] = url;
    }
  } catch {
    // no emblems: chips and headers show text only
  }
  return out;
}
