// Called It! app: one page, three tabs (Matches, Groups, Me). PLAN §7.
import { EXACT_BONUS, formatHalves, isPick, score, validScore, type Pick, type PointsTable } from '../../shared/scoring.ts';
import {
  api,
  ApiError,
  loadAuth,
  saveAuth,
  type Auth,
  type GroupData,
  type HistoryRow,
  type Home,
  type Match,
  type SavedPick,
} from './api.ts';

declare const WEB_URL: string;
declare const PRIVACY_HTML: string;

// The Android app adds this bridge (MainActivity.Bridge); the web version has none.
interface Bridge {
  share(text: string): void;
  login(id: string): void;
  logout(): void;
  push(): void;
  hasPrivacy(): boolean;
  privacy(): void;
}
const bridge = (window as unknown as { CalledIt?: Bridge }).CalledIt;

const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.calledit.app';
const COMPS: Record<string, string> = {
  CL: 'Champions League',
  PL: 'Premier League',
  ELC: 'Championship',
  PD: 'LaLiga',
  SA: 'Serie A',
  BL1: 'Bundesliga',
  FL1: 'Ligue 1',
  DED: 'Eredivisie',
  PPL: 'Primeira Liga',
  BSA: 'Brasileirão',
  WC: 'World Cup',
  EC: 'European Championship',
};
const PICK_ORDER: Pick[] = ['1', 'X', '2', '1X', 'X2', '12'];

type Tab = 'matches' | 'groups' | 'me';
type Period = 'week' | 'month' | 'total';
interface Draft {
  pick: Pick | null;
  sh: number | null;
  sa: number | null;
}

const state = {
  auth: loadAuth(),
  home: null as Home | null,
  loadedAt: 0,
  tab: 'matches' as Tab,
  day: '',
  drafts: new Map<number, Draft>(),
  group: null as GroupData | null,
  period: 'week' as Period,
  history: null as HistoryRow[] | null,
  modal: '' as string,
  busy: false,
  welcome: 'start' as 'start' | 'recover',
  pendingJoin: '',
};

const app = document.getElementById('app')!;

// ---------- helpers ----------

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function toast(msg: string): void {
  const t = document.getElementById('toast')!;
  t.textContent = msg;
  t.className = 'toast show';
  clearTimeout((toast as unknown as { timer?: number }).timer);
  (toast as unknown as { timer?: number }).timer = window.setTimeout(() => (t.className = 'toast'), 3200);
}

function fail(e: unknown): void {
  if (e instanceof ApiError && e.status === 401 && state.auth) {
    state.auth = { id: '', key: '', nick: state.auth.nick, recovery: state.auth.recovery };
    saveAuth(state.auth);
    state.welcome = 'recover';
  }
  toast(e instanceof Error ? e.message : 'Something went wrong.');
  render();
}

const signedIn = () => !!(state.auth?.id && state.auth.key);

function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(day: string): string {
  const today = localDay(Date.now());
  const off = (n: number) => localDay(Date.now() + n * 86_400_000);
  if (day === today) return 'Today';
  if (day === off(1)) return 'Tomorrow';
  if (day === off(-1)) return 'Yesterday';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

function tableOf(m: Match): PointsTable {
  return { '1': m.h1, X: m.hx, '2': m.h2, '1X': m.h1x, X2: m.hx2, '12': m.h12 };
}

const isOpen = (m: Match) => m.kickoff > Date.now() && (m.status === 'SCHEDULED' || m.status === 'TIMED');

function savedPick(id: number): SavedPick | undefined {
  return state.home?.picks.find((p) => p.m === id);
}

function current(id: number): Draft {
  const d = state.drafts.get(id);
  if (d) return d;
  const s = savedPick(id);
  return { pick: s && isPick(s.pick) ? s.pick : null, sh: s?.sh ?? null, sa: s?.sa ?? null };
}

function badScore(d: Draft): boolean {
  return d.pick !== null && ((d.sh === null) !== (d.sa === null) || !validScore(d.pick, d.sh, d.sa));
}

function statusText(m: Match): string {
  if (m.status === 'FINISHED') return m.hg !== null ? `FT ${m.hg}–${m.ag}` : 'FT';
  if (m.status === 'IN_PLAY' || m.status === 'PAUSED') return 'Live';
  if (m.status === 'POSTPONED') return 'Postponed';
  if (m.status === 'SUSPENDED') return 'Suspended';
  if (m.status === 'CANCELLED') return 'Cancelled';
  return m.kickoff > Date.now() ? timeOf(m.kickoff) : 'Started';
}

// Points earned on a settled match, or a short state.
function resultText(m: Match, p: { pick: string; sh: number | null; sa: number | null }): { text: string; cls: string } {
  if (m.settled === 2) return { text: 'Void', cls: 'void' };
  if (m.settled !== 1 || m.hg === null || m.ag === null || !isPick(p.pick)) {
    return m.status === 'FINISHED' ? { text: 'Points soon', cls: 'wait' } : { text: '', cls: '' };
  }
  const s = score(tableOf(m), p.pick, p.sh, p.sa, m.hg, m.ag);
  return s.halves > 0
    ? { text: `+${formatHalves(s.halves)}${s.exact ? ' · exact!' : ''}`, cls: s.exact ? 'exact' : 'win' }
    : { text: '0', cls: 'lose' };
}

// ---------- data ----------

async function loadHome(): Promise<void> {
  state.home = await api<Home>(state.auth, 'GET', '/v1/home');
  state.loadedAt = Date.now();
  if (state.auth && state.home.me.nick !== state.auth.nick) {
    state.auth.nick = state.home.me.nick;
    saveAuth(state.auth);
  }
  const days = matchDays();
  if (!days.includes(state.day)) {
    const today = localDay(Date.now());
    state.day = days.find((d) => d >= today) ?? days[days.length - 1] ?? today;
  }
}

function matchDays(): string[] {
  const set = new Set((state.home?.matches ?? []).map((m) => localDay(m.kickoff)));
  set.add(localDay(Date.now()));
  return [...set].sort();
}

async function start(): Promise<void> {
  if (!signedIn()) return render();
  bridge?.login(state.auth!.id);
  try {
    await loadHome();
    if (state.pendingJoin) await joinGroup(state.pendingJoin);
  } catch (e) {
    return fail(e);
  }
  render();
}

// ---------- actions ----------

async function signUp(nick: string): Promise<void> {
  const r = await api<Auth & { recovery: string }>(null, 'POST', '/v1/users', { nick });
  state.auth = r;
  saveAuth(r);
  state.modal = 'recovery';
  bridge?.login(r.id);
  await start();
}

async function recoverAccount(nick: string, recovery: string): Promise<void> {
  const r = await api<Auth>(null, 'POST', '/v1/recover', { nick, recovery });
  state.auth = { ...r, recovery: recovery.toUpperCase() };
  saveAuth(state.auth);
  toast(`Welcome back, ${r.nick}!`);
  await start();
}

async function savePicks(): Promise<void> {
  const list: SavedPick[] = [];
  for (const [m, d] of state.drafts) {
    if (!d.pick) continue;
    if ((d.sh === null) !== (d.sa === null) || !validScore(d.pick, d.sh, d.sa)) {
      throw new ApiError(400, 'Fix the exact score: fill both sides and match your pick.');
    }
    list.push({ m, pick: d.pick, sh: d.sh, sa: d.sa });
  }
  if (!list.length) return;
  const r = await api<{ picks: SavedPick[] }>(state.auth, 'PUT', '/v1/predictions', { picks: list });
  const home = state.home!;
  for (const p of r.picks) {
    home.picks = home.picks.filter((x) => x.m !== p.m).concat(p);
  }
  const missed = list.filter((d) => {
    const s = r.picks.find((p) => p.m === d.m);
    return !s || s.pick !== d.pick || s.sh !== d.sh || s.sa !== d.sa;
  }).length;
  state.drafts.clear();
  toast(missed ? `Saved. ${missed} could not change (started or edit limit).` : 'Picks saved. Good luck!');
  try {
    if (bridge && !localStorage.getItem('calledit.pushAsked')) {
      localStorage.setItem('calledit.pushAsked', '1');
      bridge.push();
    }
  } catch {}
}

async function openGroup(id: string): Promise<void> {
  state.group = await api<GroupData>(state.auth, 'GET', `/v1/groups/${id}`);
}

async function joinGroup(code: string): Promise<void> {
  state.pendingJoin = '';
  const r = await api<{ group: { id: string } }>(state.auth, 'POST', '/v1/groups/join', { code });
  await loadHome();
  state.tab = 'groups';
  await openGroup(r.group.id);
}

function invite(name: string, code: string): void {
  const text = `Join my group "${name}" on Called It! Predict football matches with friends.\nGroup code: ${code}\nAndroid: ${PLAY_URL}\nWeb: ${WEB_URL}?join=${code}`;
  if (bridge) return bridge.share(text);
  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
    return;
  }
  copy(text, 'Invite copied. Paste it to your friends.');
}

function copy(text: string, done: string): void {
  navigator.clipboard?.writeText(text).then(
    () => toast(done),
    () => toast(text),
  );
}

// ---------- views ----------

function render(): void {
  app.innerHTML = signedIn() ? shell() : welcome();
  const modal = document.getElementById('modal')!;
  modal.innerHTML = state.modal ? modalView() : '';
  modal.className = state.modal ? 'modal show' : 'modal';
  updateBar();
}

// The save bar lives outside #app so typing a score never re-renders (and blurs) the input.
function updateBar(): void {
  const bar = document.getElementById('savebar') as HTMLButtonElement;
  const n = [...state.drafts.values()].filter((d) => d.pick).length;
  const show = signedIn() && state.tab === 'matches' && n > 0;
  bar.hidden = !show;
  bar.disabled = state.busy;
  bar.textContent = `Save ${n} ${n === 1 ? 'pick' : 'picks'}`;
}

function welcome(): string {
  const a = state.auth;
  if (state.welcome === 'recover') {
    return `<section class="welcome">
      <h1 class="logo">Called It!</h1>
      <p class="tag">Restore your account with your nickname and recovery code.</p>
      <form data-form="recover">
        <input name="nick" placeholder="Nickname" autocomplete="username" value="${esc(a?.nick)}" required>
        <input name="recovery" placeholder="Recovery code (XXXX-XXXX-XXXX)" value="${esc(a?.recovery)}" required>
        <button class="primary" ${state.busy ? 'disabled' : ''}>Restore account</button>
      </form>
      <button class="link" data-act="welcome" data-v="start">New here? Create an account</button>
    </section>`;
  }
  return `<section class="welcome">
    <h1 class="logo">Called It!</h1>
    <p class="tag">Predict today's football. Beat your friends.</p>
    <ul class="how">
      <li><b>1 · X · 2</b> or a safer double <b>1X · X2 · 12</b></li>
      <li>Underdog picks are worth more points</li>
      <li>Call the exact score for <b>+${EXACT_BONUS / 2}</b></li>
    </ul>
    <form data-form="signup">
      <input name="nick" placeholder="Choose a nickname" maxlength="16" autocomplete="off" required>
      <button class="primary" ${state.busy ? 'disabled' : ''}>Start playing</button>
    </form>
    <p class="small">Free to play. No money, no bets, no prizes.</p>
    <button class="link" data-act="welcome" data-v="recover">I already have an account</button>
  </section>`;
}

function shell(): string {
  const body = !state.home ? '<p class="empty">Loading…</p>' : state.tab === 'matches' ? matchesView() : state.tab === 'groups' ? groupsView() : meView();
  const tab = (t: Tab, label: string) => `<button class="${state.tab === t ? 'on' : ''}" data-act="tab" data-v="${t}">${label}</button>`;
  return `<header class="top"><span class="logo small">Called It!</span>
      <span class="pts">${state.home ? `${formatHalves(state.home.me.total)} pts` : ''}</span></header>
    <main class="content">${body}</main>
    <nav class="tabs">${tab('matches', 'Matches')}${tab('groups', 'Groups')}${tab('me', 'Me')}</nav>`;
}

function matchesView(): string {
  const home = state.home!;
  const days = matchDays();
  const chips = days
    .map((d) => `<button class="chip ${d === state.day ? 'on' : ''}" data-act="day" data-v="${d}">${esc(dayLabel(d))}</button>`)
    .join('');
  const list = home.matches.filter((m) => localDay(m.kickoff) === state.day);
  let html = `<div class="chips">${chips}</div>
    <button class="link rules" data-act="modal" data-v="rules">How points work</button>`;
  if (!list.length) return html + '<p class="empty">No matches on this day. Try another day.</p>';
  let comp = '';
  for (const m of list) {
    if (m.comp !== comp) {
      comp = m.comp;
      html += `<h3 class="comp">${esc(COMPS[m.comp] ?? m.comp)}</h3>`;
    }
    html += matchCard(m);
  }
  return html;
}

function matchCard(m: Match): string {
  const open = isOpen(m);
  const d = current(m.id);
  const t = tableOf(m);
  const buttons = PICK_ORDER.map(
    (p) =>
      `<button class="pk ${d.pick === p ? 'sel' : ''}" ${open ? '' : 'disabled'} data-act="pick" data-m="${m.id}" data-v="${p}">${p}<small>${formatHalves(t[p])}</small></button>`,
  ).join('');
  const bad = badScore(d);
  const num = (side: 'sh' | 'sa', v: number | null) =>
    `<input class="goal" type="number" inputmode="numeric" min="0" max="20" ${open ? '' : 'disabled'} data-m="${m.id}" data-side="${side}" value="${v ?? ''}" aria-label="${side === 'sh' ? 'Home goals' : 'Away goals'}">`;
  const saved = savedPick(m.id);
  const res = saved ? resultText(m, saved) : { text: '', cls: '' };
  const foot = open
    ? `<div class="exact ${bad ? 'bad' : ''}"><span>Exact score <b>+${EXACT_BONUS / 2}</b></span>${num('sh', d.sh)}<span>–</span>${num('sa', d.sa)}</div>
       <p class="warn" ${bad ? '' : 'hidden'}>Exact score must agree with your pick.</p>`
    : `<div class="result">${saved ? `You: <b>${esc(saved.pick)}</b>${saved.sh !== null ? ` · ${saved.sh}–${saved.sa}` : ''}` : 'No pick'}
       <span class="res ${res.cls}">${esc(res.text)}</span></div>`;
  return `<article class="match ${open ? '' : 'locked'} ${state.drafts.has(m.id) ? 'dirty' : ''}">
    <div class="teams"><span class="home">${esc(m.home)}</span><span class="st">${esc(statusText(m))}</span><span class="away">${esc(m.away)}</span></div>
    <div class="picks">${buttons}</div>${foot}</article>`;
}

function groupsView(): string {
  const g = state.group;
  if (g) return groupView(g);
  const groups = state.home!.groups;
  const list = groups.length
    ? groups
        .map(
          (x) =>
            `<button class="row" data-act="group" data-v="${esc(x.id)}"><span>${esc(x.name)}</span><small>${x.n} ${x.n === 1 ? 'player' : 'players'}</small></button>`,
        )
        .join('')
    : '<p class="empty">No groups yet. Create one and invite your friends, or join with a code.</p>';
  return `<h2>Your groups</h2>${list}
    <form data-form="create" class="inline"><input name="name" placeholder="New group name" maxlength="30" required><button class="primary">Create</button></form>
    <form data-form="join" class="inline"><input name="code" placeholder="Group code" maxlength="8" autocapitalize="characters" required><button>Join</button></form>`;
}

function groupView(g: GroupData): string {
  const me = state.home!.me.id;
  const key: Period = state.period;
  const rows = [...g.board].sort((a, b) => b[key] - a[key] || b.exact - a.exact || a.nick.localeCompare(b.nick));
  const seg = (p: Period, label: string) => `<button class="${key === p ? 'on' : ''}" data-act="period" data-v="${p}">${label}</button>`;
  let rank = 0;
  let prev = -1;
  const board = rows
    .map((r, i) => {
      if (r[key] !== prev) rank = i + 1;
      prev = r[key];
      return `<tr class="${r.id === me ? 'me' : ''}"><td>${rank}</td><td>${esc(r.nick)}</td><td class="num">${formatHalves(r[key])}</td></tr>`;
    })
    .join('');
  const started = state.home!.matches.filter((m) => m.kickoff <= Date.now()).sort((a, b) => b.kickoff - a.kickoff);
  const reveal = started
    .map((m) => {
      const picks = g.reveal.filter((p) => p.m === m.id);
      if (!picks.length) return '';
      const items = picks
        .map((p) => {
          const r = resultText(m, p);
          return `<li><span>${esc(p.nick)}</span><b>${esc(p.pick)}${p.sh !== null ? ` ${p.sh}–${p.sa}` : ''}</b><span class="res ${r.cls}">${esc(r.text)}</span></li>`;
        })
        .join('');
      return `<div class="reveal"><div class="rt">${esc(m.home)} <span>${esc(statusText(m))}</span> ${esc(m.away)}</div><ul>${items}</ul></div>`;
    })
    .join('');
  return `<button class="link" data-act="back">‹ All groups</button>
    <h2>${esc(g.group.name)}</h2>
    <div class="code">Code <b>${esc(g.group.code)}</b> · ${g.group.n} ${g.group.n === 1 ? 'player' : 'players'}
      <button class="primary" data-act="invite">Invite</button></div>
    <div class="seg">${seg('week', 'This week')}${seg('month', 'This month')}${seg('total', 'All time')}</div>
    <table class="board"><tbody>${board}</tbody></table>
    <h3>Picks revealed at kickoff</h3>
    ${reveal || '<p class="empty">Picks appear here once a match starts.</p>'}
    <button class="link danger" data-act="modal" data-v="leave">Leave group</button>`;
}

function meView(): string {
  const h = state.home!;
  const hist = state.history;
  const rows = hist
    ? hist.length
      ? hist
          .map((r) => {
            const res = resultText(r, r);
            return `<li><span>${esc(r.home)} – ${esc(r.away)}<small>${esc(new Date(r.kickoff).toLocaleDateString())} · ${esc(statusText(r))}</small></span>
              <b>${esc(r.pick)}${r.sh !== null ? ` ${r.sh}–${r.sa}` : ''}</b><span class="res ${res.cls}">${esc(res.text)}</span></li>`;
          })
          .join('')
      : '<li class="empty">No picks in the last 30 days.</li>'
    : '<li class="empty">Loading…</li>';
  return `<h2>${esc(h.me.nick)}</h2>
    <div class="stats"><div><b>${formatHalves(h.me.total)}</b><small>points</small></div><div><b>${h.me.exact}</b><small>exact scores</small></div></div>
    <h3>Last 30 days</h3><ul class="history">${rows}</ul>
    <div class="menu">
      ${bridge ? '<button data-act="push">Match reminders</button>' : ''}
      ${state.auth?.recovery ? '<button data-act="modal" data-v="recovery">Recovery code</button>' : ''}
      <button data-act="modal" data-v="rules">How points work</button>
      ${bridge?.hasPrivacy() ? '<button data-act="adprivacy">Ad privacy settings</button>' : ''}
      <button data-act="modal" data-v="privacy">Privacy policy</button>
      <button data-act="modal" data-v="about">About</button>
      <button class="danger" data-act="modal" data-v="delete">Delete account</button>
    </div>`;
}

function modalView(): string {
  const close = '<button class="primary" data-act="close">OK</button>';
  switch (state.modal) {
    case 'recovery':
      return `<div class="sheet"><h2>Your recovery code</h2>
        <p>Save this code. With your nickname it restores your account on a new phone.</p>
        <p class="bigcode">${esc(state.auth?.recovery ?? '')}</p>
        <button data-act="copyrec">Copy code</button>${close}</div>`;
    case 'rules':
      return `<div class="sheet"><h2>How points work</h2>
        <p>Pick the result: <b>1</b> home win, <b>X</b> draw, <b>2</b> away win, or a double: <b>1X</b>, <b>X2</b>, <b>12</b>.</p>
        <p>Each button shows its points. Less likely results are worth more: an even match gives 2 for a single and 1 for a double; an underdog can give up to 5.</p>
        <p>Add the exact score for <b>+${EXACT_BONUS / 2}</b> if it is right. It must agree with your pick.</p>
        <p>Results count after 90 minutes plus stoppage time (no extra time or penalties). Cancelled matches are void.</p>
        <p>You can change picks until kickoff. Your friends see your pick when the match starts.</p>${close}</div>`;
    case 'privacy':
      return `<div class="sheet scroll">${PRIVACY_HTML}${close}</div>`;
    case 'about':
      return `<div class="sheet"><h2>Called It!</h2>
        <p>A free football prediction game for friends. No real money, no bets, no prizes.</p>
        <p>Football data provided by football-data.org.</p>${close}</div>`;
    case 'delete':
      return `<div class="sheet"><h2>Delete account?</h2>
        <p>Your nickname, picks, points and group memberships are deleted for good.</p>
        <button class="danger" data-act="delete">Delete my account</button><button data-act="close">Cancel</button></div>`;
    case 'leave':
      return `<div class="sheet"><h2>Leave this group?</h2>
        <p>You can join again later with the code.</p>
        <button class="danger" data-act="leave">Leave group</button><button data-act="close">Cancel</button></div>`;
  }
  return '';
}

// ---------- events ----------

async function act(el: HTMLElement): Promise<void> {
  const v = el.dataset.v ?? '';
  switch (el.dataset.act) {
    case 'tab':
      state.tab = v as Tab;
      state.group = null;
      if (state.tab === 'me') {
        render();
        state.history = (await api<{ rows: HistoryRow[] }>(state.auth, 'GET', '/v1/history')).rows;
      }
      break;
    case 'day':
      state.day = v;
      break;
    case 'pick': {
      const m = Number(el.dataset.m);
      state.drafts.set(m, { ...current(m), pick: v as Pick });
      break;
    }
    case 'save':
      state.busy = true;
      render();
      try {
        await savePicks();
      } finally {
        state.busy = false;
      }
      break;
    case 'group':
      await openGroup(v);
      break;
    case 'back':
      state.group = null;
      break;
    case 'period':
      state.period = v as Period;
      break;
    case 'invite':
      if (state.group) invite(state.group.group.name, state.group.group.code);
      return;
    case 'leave':
      if (state.group) await api(state.auth, 'DELETE', `/v1/groups/${state.group.group.id}/me`);
      state.group = null;
      state.modal = '';
      await loadHome();
      break;
    case 'modal':
      state.modal = v;
      break;
    case 'close':
      state.modal = '';
      break;
    case 'copyrec':
      copy(state.auth?.recovery ?? '', 'Recovery code copied.');
      return;
    case 'push':
      bridge?.push();
      return;
    case 'adprivacy':
      bridge?.privacy();
      return;
    case 'welcome':
      state.welcome = v as 'start' | 'recover';
      break;
    case 'delete':
      await api(state.auth, 'DELETE', '/v1/me');
      bridge?.logout();
      state.auth = null;
      saveAuth(null);
      state.home = null;
      state.modal = '';
      state.welcome = 'start';
      toast('Your account was deleted.');
      break;
    default:
      return;
  }
  render();
}

document.addEventListener('click', (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!el || (el as HTMLButtonElement).disabled) return;
  ev.preventDefault();
  act(el).catch(fail);
});

document.addEventListener('input', (ev) => {
  const el = ev.target as HTMLInputElement;
  if (!el.dataset.side) return;
  const m = Number(el.dataset.m);
  const raw = el.value.trim();
  const n = raw === '' ? null : Math.max(0, Math.min(20, Math.floor(Number(raw))));
  const d = { ...current(m), [el.dataset.side]: Number.isFinite(n) ? n : null } as Draft;
  state.drafts.set(m, d);
  // Update the card in place: a re-render would drop focus while moving to the other goal box.
  const card = el.closest('.match');
  card?.classList.add('dirty');
  card?.querySelector('.exact')?.classList.toggle('bad', badScore(d));
  const warn = card?.querySelector<HTMLElement>('.warn');
  if (warn) warn.hidden = !badScore(d);
  updateBar();
});

document.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const form = ev.target as HTMLFormElement;
  const f = new FormData(form);
  const val = (k: string) => String(f.get(k) ?? '').trim();
  const run = async () => {
    switch (form.dataset.form) {
      case 'signup':
        return signUp(val('nick'));
      case 'recover':
        return recoverAccount(val('nick'), val('recovery'));
      case 'create': {
        const r = await api<{ group: { id: string } }>(state.auth, 'POST', '/v1/groups', { name: val('name') });
        await loadHome();
        await openGroup(r.group.id);
        return;
      }
      case 'join':
        return joinGroup(val('code'));
    }
  };
  state.busy = true;
  run()
    .then(() => {
      state.busy = false;
      render();
    })
    .catch((e) => {
      state.busy = false;
      fail(e);
    });
});

// Android back button (MainActivity): close what is open; false lets the app close.
(window as unknown as { citBack: () => boolean }).citBack = () => {
  if (state.modal) state.modal = '';
  else if (state.group) state.group = null;
  else if (signedIn() && state.tab !== 'matches') state.tab = 'matches';
  else return false;
  render();
  return true;
};

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && signedIn() && Date.now() - state.loadedAt > 120_000) {
    loadHome().then(render, () => {});
  }
});

const join = new URLSearchParams(location.search).get('join');
if (join) state.pendingJoin = join.toUpperCase().replace(/[^A-Z0-9]/g, '');
if (state.auth && !signedIn()) state.welcome = 'recover';
start();
