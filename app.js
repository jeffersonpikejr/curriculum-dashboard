// ============================================================================
// app.js — Application logic, rendering, state, events
//
// Loaded after data.js. All curriculum data is read from globals defined in
// data.js (T, BOOK_PROGRESS, SYNTOPIC_CLUSTERS, weekKey, etc.).
//
// State (sessions, page progress, leverage log, completed deliverables)
// persists to browser localStorage under STORAGE_KEY.
// Use the Data button in the action bar to export/import state as JSON.
// ============================================================================

'use strict';

// ── VERSION ──
// Auto-bumped by commit.ps1 on every commit. Visible as a small footer badge,
// so you can hard-refresh after a commit and confirm the new code deployed
// (if the version doesn't change, the commit didn't fire or your browser
// served a cached file). DO NOT EDIT MANUALLY — commit.ps1 regex-replaces this
// line; manual edits will be overwritten on the next commit.
const APP_VERSION = 'v26 | 2026-07-03 autobalance';

// ── STATE & PERSISTENCE ──
let S = { tab:"this-week", zoom:"monthly", tier:"all", detail:3, viewDate: null /* 'YYYY-MM-DD' or null = today */, bookOverlay: true, topicFilter: null /* null = all topics; otherwise Set<number> */, topicFilterOpen: false };

// ── VIEWING DATE (header nav + backdated log default) ──
// Local-time "YYYY-MM-DD" key. Use this everywhere we bucket sessions or
// activity into days. Do NOT use toISOString().slice(0,10) — that's UTC and
// silently misattributes evening EDT activity to the next day. The Log tab
// renders with toLocaleDateString (local), so any UTC-based bucketing
// elsewhere disagrees with what the user sees there.
function localDayKey(dateOrTs) {
  const d = dateOrTs instanceof Date ? dateOrTs : new Date(dateOrTs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayIso() { return localDayKey(new Date()); }
function getViewingDate() {
  // Returns a Date object representing the currently-viewed day (noon local)
  const iso = S.viewDate || todayIso();
  return new Date(iso + 'T12:00:00');
}
function getViewingIso() { return S.viewDate || todayIso(); }
function isViewingToday() { return !S.viewDate || S.viewDate === todayIso(); }
function shiftViewingDate(days) {
  const d = getViewingDate();
  d.setDate(d.getDate() + days);
  S.viewDate = localDayKey(d);
  if (S.viewDate === todayIso()) S.viewDate = null;
}
function formatViewingHeader() {
  const d = getViewingDate();
  const wkOfMonth = dateToWeekOfMonth(d);
  const monthIdx = dateToMonthIdx(d);
  const monthLabel = MF[monthIdx] || d.toLocaleString('en-US', { month: 'short' });
  const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
  return `${dayName}, ${monthLabel} ${d.getDate()} · W${wkOfMonth} of ${monthLabel}`;
}
const DETAIL_DESC = {1:"Topics only",2:"+ Sub-topic bars",3:"+ Current resource",4:"+ Deliverables",5:"+ Week-by-week"};

const STORAGE_KEY = 'curriculum_v4_state';
const GIST_DESCRIPTION = 'Curriculum Dashboard State (do not delete)';
const SYNC_DEBOUNCE_MS = 2000;

// Persistent state: book progress, completed deliverables, session log, leverage log,
// custom start/end weeks (overrides over data.js BOOK_PROGRESS defaults)
const DEFAULT_PERSISTENT = {
  bookProgress: {},
  bookStartOverrides: {},
  bookEndOverrides: {},
  bookCompleted: {},
  deliverablesDone: {},
  sessions: [],
  leverageLog: [],
  // P4 #14: append-only audit trail of schedule overrides.
  // Each entry: {ts, bookKey, field: 'startWeek' | 'endWeek', from, to}
  // Written by the edit-book save handler and the reset-overrides handler.
  scheduleLog: [],
  customNotes: {},
  // P1 autobalance: capacity-fit rebalancer config + last-run record.
  // pinned books never move during a rebalance; dismissedUntilIdx suppresses
  // the behind banner until the given global week index (re-arms on the next
  // curriculum week rather than a wall-clock delay).
  autobalance: {
    capacityMode: 'auto',    // 'auto' (measured median) | 'manual'
    manualCapacity: null,    // pp/wk number when manual
    pinned: {},              // {bookKey: true} — persisted pins
    dismissedUntilIdx: null, // global week idx; banner hidden while curIdx < this
    lastRunTs: null,         // ms epoch of last Apply
    lastRun: null,           // {ts, capacity, capacitySource, changes:[{bookKey, from, to}]}
  },
  sync: {
    token: null,        // GitHub PAT with gist scope
    gistId: null,       // ID of the curriculum gist
    lastPushAt: null,   // ms timestamp of last successful push
    lastPullAt: null,
    lastError: null,    // last error message, if any
    status: 'idle',     // 'idle' | 'syncing' | 'error'
  },
};

let P = loadPersistent();

function loadPersistent() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneDefault();
    const parsed = JSON.parse(raw);
    const merged = {...cloneDefault(), ...parsed};
    if (!merged.bookProgress || typeof merged.bookProgress !== 'object') merged.bookProgress = {};
    if (!merged.bookStartOverrides || typeof merged.bookStartOverrides !== 'object') merged.bookStartOverrides = {};
    if (!merged.bookEndOverrides || typeof merged.bookEndOverrides !== 'object') merged.bookEndOverrides = {};
    if (!merged.bookCompleted || typeof merged.bookCompleted !== 'object') merged.bookCompleted = {};
    if (!merged.deliverablesDone || typeof merged.deliverablesDone !== 'object') merged.deliverablesDone = {};
    if (!Array.isArray(merged.sessions)) merged.sessions = [];
    if (!Array.isArray(merged.leverageLog)) merged.leverageLog = [];
    if (!Array.isArray(merged.scheduleLog)) merged.scheduleLog = [];
    if (!merged.customNotes || typeof merged.customNotes !== 'object') merged.customNotes = {};
    if (!merged.autobalance || typeof merged.autobalance !== 'object') merged.autobalance = cloneDefault().autobalance;
    if (!merged.sync || typeof merged.sync !== 'object') merged.sync = cloneDefault().sync;
    return merged;
  } catch (e) {
    console.warn("Failed to load state:", e);
    return cloneDefault();
  }
}

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_PERSISTENT));
}

function savePersistent() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(P));
    scheduleAutoSync();
  } catch (e) {
    console.warn("Failed to save state:", e);
  }
}

// Same as savePersistent but skips auto-sync — used by sync internals to avoid recursion
function savePersistentLocalOnly() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(P));
  } catch (e) {
    console.warn("Failed to save state:", e);
  }
}

function getCurrentPage(bookKey) {
  if (P.bookProgress[bookKey] !== undefined) return P.bookProgress[bookKey];
  return BOOK_PROGRESS[bookKey] ? BOOK_PROGRESS[bookKey].currentPage : 0;
}

function getStartWeek(bookKey) {
  if (P.bookStartOverrides[bookKey]) return P.bookStartOverrides[bookKey];
  return BOOK_PROGRESS[bookKey] ? BOOK_PROGRESS[bookKey].startWeek : null;
}

function getEndWeek(bookKey) {
  if (P.bookEndOverrides[bookKey]) return P.bookEndOverrides[bookKey];
  return BOOK_PROGRESS[bookKey] ? BOOK_PROGRESS[bookKey].endWeek : null;
}

function hasScheduleOverride(bookKey) {
  return !!(P.bookStartOverrides[bookKey] || P.bookEndOverrides[bookKey] || hasCustomNoteOverride(bookKey));
}

function resetScheduleOverride(bookKey) {
  delete P.bookStartOverrides[bookKey];
  delete P.bookEndOverrides[bookKey];
  delete P.customNotes[bookKey];
}

// P3 #12: per-book free-text note override. Default note lives on
// BOOK_PROGRESS[k].note (hand-written authorial context like "Priority
// chapters only · full book is 537 pp"). User override replaces the default
// in any UI surface that displays it (currently the Reading List author
// line via renderBookProgress).
function getBookNote(bookKey) {
  if (Object.prototype.hasOwnProperty.call(P.customNotes, bookKey)) {
    return P.customNotes[bookKey];
  }
  return (BOOK_PROGRESS[bookKey] && BOOK_PROGRESS[bookKey].note) || '';
}

function hasCustomNoteOverride(bookKey) {
  return Object.prototype.hasOwnProperty.call(P.customNotes, bookKey);
}

// P4 #14: append an audit entry when a schedule field changes. Caller is
// responsible for capturing the "from" value BEFORE writing the override and
// the "to" value AFTER. Skips no-op transitions so the log only records real
// edits. Newest-first via unshift to match leverageLog conventions.
// P1: optional `source` tag ('autobalance' | 'autobalance-undo') distinguishes
// automated writes from manual edits in the audit trail. Spread only when
// truthy so manual entries keep their pre-P1 shape (backward compatible —
// old clients round-trip unknown fields through the gist unharmed).
function logScheduleChange(bookKey, field, from, to, source) {
  if (from === to) return;
  P.scheduleLog.unshift({
    ts: Date.now(),
    bookKey,
    field,
    from: from || null,
    to:   to   || null,
    ...(source ? { source } : {})
  });
}

// ── WEEK INDEX HELPERS (P1 #1.1) ──
// Global week index = monthIdx*4 + weekOfMonth — the same m*4+w convention
// as the inline pacing math in renderThisWeek / renderBookProgress (P3 #3.1
// migrates those sites here). Domain: "0-W1" (May 2026 W1) = 1 through
// "13-W4" (Jun 2027 W4) = 56 = MAX_WEEK_IDX, matching generateWeekOptions.
const MAX_WEEK_IDX = 14 * 4; // "13-W4" — end of the curriculum horizon

function weekIdx(wk) {
  if (!wk || typeof wk !== 'string') return null;
  const [m, w] = wk.split('-W').map(Number);
  if (isNaN(m) || isNaN(w)) return null;
  return m * 4 + w;
}

// Inverse of weekIdx. Caller guarantees idx is in [1, MAX_WEEK_IDX].
function idxToWeekKey(idx) {
  const m = Math.floor((idx - 1) / 4);
  const w = idx - m * 4;
  return weekKey(m, w);
}

// The curriculum "now" (CURRENT_MONTH_IDX / CURRENT_WEEK_OF_MONTH / CURRENT_WEEK_KEY)
// is frozen in data.js at page load. A tab left open across a week boundary
// therefore shows stale pacing everywhere. P2 #2.6: detect that drift so the
// UI can prompt a reload; the autobalance apply path uses the same check to
// abort a write against a phantom week.
function liveWeekIdx() {
  const d = new Date();
  return dateToMonthIdx(d) * 4 + dateToWeekOfMonth(d);
}
function isWeekStale() {
  return liveWeekIdx() !== CURRENT_MONTH_IDX * 4 + CURRENT_WEEK_OF_MONTH;
}

// ── AUTOBALANCE STATE ACCESSORS (P1 #1.1) ──
// pullFromGist and importState rebuild P via {...cloneDefault(), ...parsed}
// WITHOUT the per-field type guards in loadPersistent, so a malformed remote
// autobalance object can land in P as-is. All reads go through this
// normalizing accessor; writers call ensureAutobalanceState() first so the
// write target is always well-formed.
function getAutobalanceConfig() {
  const d = cloneDefault().autobalance;
  const raw = (P.autobalance && typeof P.autobalance === 'object') ? P.autobalance : {};
  return {
    capacityMode: raw.capacityMode === 'manual' ? 'manual' : d.capacityMode,
    manualCapacity: (typeof raw.manualCapacity === 'number' && isFinite(raw.manualCapacity) && raw.manualCapacity > 0)
      ? raw.manualCapacity : d.manualCapacity,
    pinned: (raw.pinned && typeof raw.pinned === 'object') ? raw.pinned : {},
    dismissedUntilIdx: (typeof raw.dismissedUntilIdx === 'number' && isFinite(raw.dismissedUntilIdx))
      ? raw.dismissedUntilIdx : d.dismissedUntilIdx,
    lastRunTs: (typeof raw.lastRunTs === 'number') ? raw.lastRunTs : d.lastRunTs,
    lastRun: (raw.lastRun && typeof raw.lastRun === 'object') ? raw.lastRun : d.lastRun,
  };
}

function ensureAutobalanceState() {
  P.autobalance = getAutobalanceConfig();
  return P.autobalance;
}

// ── BOOK SCHEDULE → TIMELINE OVERLAY HELPERS ──
// These derive "live" schedule coverage for the timeline overlay. They read
// through getStartWeek/getEndWeek so any user-edited overrides are reflected.
// Completed books are excluded — the overlay is meant to show *upcoming/active*
// work, not history.

function getTopicBookActiveMonths(topicId) {
  const months = new Set();
  Object.entries(BOOK_PROGRESS).forEach(([k, b]) => {
    if (!b || b.topic !== topicId) return;
    if (isBookComplete(k)) return;
    const startWeek = getStartWeek(k);
    const endWeek = getEndWeek(k);
    if (!startWeek || !endWeek) return;
    try {
      const sm = +startWeek.split('-W')[0];
      const em = +endWeek.split('-W')[0];
      if (isNaN(sm) || isNaN(em)) return;
      for (let m = sm; m <= em; m++) months.add(m);
    } catch {}
  });
  return months;
}

function getTopicBookActiveWeekKeys(topicId) {
  const weeks = new Set();
  Object.entries(BOOK_PROGRESS).forEach(([k, b]) => {
    if (!b || b.topic !== topicId) return;
    if (isBookComplete(k)) return;
    const startWeek = getStartWeek(k);
    const endWeek = getEndWeek(k);
    if (!startWeek || !endWeek) return;
    try {
      const [sm, sw] = startWeek.split('-W').map(Number);
      const [em, ew] = endWeek.split('-W').map(Number);
      if ([sm, sw, em, ew].some(isNaN)) return;
      for (let m = sm; m <= em; m++) {
        const wStart = m === sm ? sw : 1;
        const wEnd   = m === em ? ew : 4;
        for (let w = wStart; w <= wEnd; w++) weeks.add(weekKey(m, w));
      }
    } catch {}
  });
  return weeks;
}

function isBookComplete(bookKey) {
  return P.bookCompleted[bookKey] === true;
}

function deliverableKey(topicId, subLetter, weekId) {
  return `${topicId}-${subLetter}-${weekId}`;
}

// P3 #13: small helper to find a week object by (topicId, subLetter, weekId)
// without walking the whole T tree at every call site. Used by
// isDeliverableDone to read the static `done:true` default that replaced
// the old inline ✓ glyphs in del strings.
function findWeek(topicId, subLetter, weekId) {
  const topic = T.find(t => t && t.id === topicId);
  if (!topic) return null;
  const sub = (topic.subs || []).find(s => s && s.l === subLetter);
  if (!sub) return null;
  return (sub.weeks || []).find(w => w && w.wk === weekId) || null;
}

// Three-state truth table:
//   P.deliverablesDone[k] === true   → user-checked
//   P.deliverablesDone[k] === false  → user-explicitly-unchecked (overrides data default)
//   key not in P.deliverablesDone    → fall back to data-side `done` flag
// Why three states: stripping inline ✓ from data.js would lose historical
// completion markers; the data flag preserves them while letting the user
// override either way going forward.
function isDeliverableDone(topicId, subLetter, weekId) {
  const k = deliverableKey(topicId, subLetter, weekId);
  if (Object.prototype.hasOwnProperty.call(P.deliverablesDone, k)) {
    return P.deliverablesDone[k] === true;
  }
  const w = findWeek(topicId, subLetter, weekId);
  return !!(w && w.done === true);
}

function toggleDeliverable(topicId, subLetter, weekId) {
  // Explicit set (not delete) so an explicit "unchecked" survives the
  // data-side default. Prior implementation used delete-vs-set which
  // can't represent "user unchecked a default-done item".
  const k = deliverableKey(topicId, subLetter, weekId);
  P.deliverablesDone[k] = !isDeliverableDone(topicId, subLetter, weekId);
  savePersistent();
}

// ── SESSION LOGGING ──
function logSession(bookKey, pagesRead, durationMin, notes, isoDate) {
  // Default to now; if an ISO date (YYYY-MM-DD) is provided, anchor the session
  // to noon local time on that day so backdated logs slot cleanly into the streak.
  let ts;
  if (isoDate && /^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    const d = new Date(isoDate + 'T12:00:00');
    ts = isNaN(d.getTime()) ? Date.now() : d.getTime();
  } else {
    ts = Date.now();
  }
  const pages = Math.max(0, +pagesRead || 0);
  const dur = Math.max(0, +durationMin || 0);
  const safeBookKey = (bookKey && BOOK_PROGRESS[bookKey]) ? bookKey : '';
  P.sessions.push({ ts, bookKey: safeBookKey, pagesRead: pages, durationMin: dur, notes: notes || '' });
  if (safeBookKey && pages > 0) {
    const book = BOOK_PROGRESS[safeBookKey];
    const cur = getCurrentPage(safeBookKey);
    const total = book.totalPages || 999;
    const newPage = Math.min(total, cur + pages);
    P.bookProgress[safeBookKey] = newPage;
    if (newPage >= total) {
      P.bookCompleted[safeBookKey] = true;
    }
  }
  savePersistent();
}

function deleteSession(idx) {
  const session = P.sessions[idx];
  if (session && session.bookKey && session.pagesRead) {
    const cur = getCurrentPage(session.bookKey);
    P.bookProgress[session.bookKey] = Math.max(0, cur - session.pagesRead);
    if (P.bookCompleted[session.bookKey] && P.bookProgress[session.bookKey] < (BOOK_PROGRESS[session.bookKey]?.totalPages || 0)) {
      delete P.bookCompleted[session.bookKey];
    }
  }
  P.sessions.splice(idx, 1);
  savePersistent();
}

function addLeverageEntry(text) {
  if (!text || !text.trim()) return;
  const today = localDayKey(new Date());
  P.leverageLog.unshift({ date: today, text: text.trim() });
  savePersistent();
}

// ── STATS ──
function getSessionsInRange(daysBack) {
  const cutoff = Date.now() - daysBack * 86400000;
  return P.sessions.filter(s => s.ts >= cutoff);
}

// P1 #1.3: measured weekly capacity — median pages per curriculum week over
// the last 6 COMPLETED weeks (idx in [cIdx-6, cIdx-1]) that contain at least
// one logged session, scaled by 0.9 as a sustainability haircut. Median over
// session-containing weeks only: a vacation week doesn't drag the estimate
// down (the month-gap scenario), while a single binge week doesn't inflate
// it (the mean would). Requires ≥2 qualifying weeks; otherwise returns
// {value: null} and the caller shows an honestly-labeled default.
// Only READING sessions count: a notes/duration-only session (0 pages) does
// not make its week a "reading week", so it never enters the median — else a
// week of pure reflection notes would count as a 0 and drag measured pace
// toward zero (which would floor the plan at 10 pp/wk and over-compress it).
// Pages coerced to a number (a corrupted import/gist could carry a string;
// app-logged sessions are already numeric). Weeks bucket via the SAME
// quartile anchor as cIdx (dateToMonthIdx*4 + dateToWeekOfMonth) rather than
// dateToWeekKey's nearest-midpoint snap, so a late-month session can't leak
// into the next month's W1. Date methods are local-time, honoring the
// app.js:31 local-day invariant (never toISOString).
function getMeasuredCapacity() {
  const cIdx = CURRENT_MONTH_IDX * 4 + CURRENT_WEEK_OF_MONTH;
  const sums = {};
  P.sessions.forEach(s => {
    if (!s || typeof s.ts !== 'number') return;
    const pages = +s.pagesRead || 0;
    if (pages <= 0) return; // notes/duration-only session — not a reading week
    const d = new Date(s.ts);
    const idx = dateToMonthIdx(d) * 4 + dateToWeekOfMonth(d);
    sums[idx] = (sums[idx] || 0) + pages;
  });
  const qualifying = [];
  for (let i = Math.max(1, cIdx - 6); i <= cIdx - 1; i++) {
    if (Object.prototype.hasOwnProperty.call(sums, i)) qualifying.push(sums[i]);
  }
  if (qualifying.length < 2) {
    return { value: null, weeksUsed: qualifying.length, reason: 'insufficient-history' };
  }
  const sorted = [...qualifying].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const value = Math.round(0.9 * median);
  // `low` cues the modal to suggest a manual number instead of trusting a
  // very thin measured pace (< 25 pp/wk).
  return { value, weeksUsed: qualifying.length, low: value < 25 };
}

function getStreakDays() {
  if (P.sessions.length === 0) return 0;
  const dayKeys = new Set(P.sessions.map(s => localDayKey(s.ts)));
  let streak = 0;
  let d = new Date();
  while (true) {
    const k = localDayKey(d);
    if (dayKeys.has(k)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      // Allow one-day gap from today (haven't logged yet today)
      if (streak === 0) {
        d.setDate(d.getDate() - 1);
        const k2 = localDayKey(d);
        if (dayKeys.has(k2)) continue;
      }
      break;
    }
  }
  return streak;
}

function getPagesByDay(daysBack) {
  const result = {};
  const cutoff = Date.now() - daysBack * 86400000;
  P.sessions.forEach(s => {
    if (s.ts < cutoff) return;
    const k = localDayKey(s.ts);
    result[k] = (result[k] || 0) + (s.pagesRead || 0);
  });
  return result;
}

// ── EXPORT / IMPORT ──
function exportState() {
  const data = JSON.stringify(P, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `curriculum-state-${localDayKey(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('State exported');
}

function importState(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      const preservedSync = P.sync;
      P = {...cloneDefault(), ...parsed, sync: preservedSync};
      savePersistent();
      render();
      toast('State imported');
    } catch (err) {
      toast('Invalid file', true);
    }
  };
  reader.readAsText(file);
}

function resetState() {
  if (!confirm('Reset all progress, sessions, and notes? This cannot be undone.')) return;
  const preservedSync = P.sync; // don't nuke sync config on reset
  P = {...cloneDefault(), sync: preservedSync};
  savePersistent();
  render();
  toast('State reset');
}

// ── GITHUB GIST SYNC ──
//
// Mirrors P (minus the sync config itself) to a private gist on the user's
// GitHub account. Push is auto-debounced 2s after any state change.
// Pull is manual or on connect.
//
// Token is stored in localStorage (per-device). User can paste the same PAT
// on another device to sync.

let _syncDebounce = null;

function syncEnabled() {
  return !!(P.sync && P.sync.token);
}

function scheduleAutoSync() {
  if (!syncEnabled()) return;
  clearTimeout(_syncDebounce);
  _syncDebounce = setTimeout(() => { pushToGist().catch(() => {}); }, SYNC_DEBOUNCE_MS);
}

async function gistFetch(url, opts = {}) {
  if (!P.sync?.token) throw new Error('Not connected');
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': `token ${P.sync.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error('Invalid token (401) — regenerate PAT with gist scope');
    if (res.status === 404) throw new Error('Gist not found (404) — may have been deleted');
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

async function findExistingGist() {
  // GitHub returns up to 30 per page; the curriculum gist will be near the top
  // unless the user has many gists. Check first 100.
  for (let page = 1; page <= 4; page++) {
    const list = await gistFetch(`https://api.github.com/gists?per_page=30&page=${page}`);
    const match = list.find(g => g.description === GIST_DESCRIPTION);
    if (match) return match.id;
    if (list.length < 30) break;
  }
  return null;
}

function statePayload() {
  // Strip sync config — each device manages its own connection
  const {sync, ...rest} = P;
  return rest;
}

// Build the drafts payload pushed to the gist (mirrors the localStorage shape)
function draftsPayload() {
  const payload = { entries: draftEntries, books: {}, topics: [] };
  draftEntries.forEach(d => {
    if (d.kind === 'book' && BOOK_PROGRESS[d.key]) {
      payload.books[d.key] = BOOK_PROGRESS[d.key];
    } else if (d.kind === 'topic') {
      const t = T.find(x => x.id === d.key);
      if (t) payload.topics.push(t);
    }
  });
  return payload;
}

// Apply a drafts payload (from gist) into runtime + localStorage
function applyDraftsPayload(payload) {
  if (!payload || !Array.isArray(payload.entries)) return;
  // Clear current drafts so we don't leave stale entries when remote shrinks
  [...draftEntries].forEach(d => {
    if (d.kind === 'book') delete BOOK_PROGRESS[d.key];
    if (d.kind === 'topic') {
      const i = T.findIndex(t => t.id === d.key);
      if (i >= 0) T.splice(i, 1);
    }
  });
  draftEntries = [];
  // Restore topics first
  (payload.topics || []).forEach(t => {
    if (!T.find(x => x.id === t.id)) T.push(t);
  });
  // Restore books
  Object.entries(payload.books || {}).forEach(([k, b]) => {
    if (!BOOK_PROGRESS[k]) BOOK_PROGRESS[k] = b;
  });
  draftEntries = payload.entries;
  try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(payload)); } catch (_) {}
}

async function pushToGist() {
  if (!syncEnabled()) return;
  P.sync.status = 'syncing';
  P.sync.lastError = null;
  updateSyncBadge();
  try {
    const stateContent  = JSON.stringify(statePayload(), null, 2);
    const draftsContent = JSON.stringify(draftsPayload(), null, 2);
    const files = {
      'state.json':  { content: stateContent },
      'drafts.json': { content: draftsContent },
    };
    let result;
    if (P.sync.gistId) {
      // Update existing
      result = await gistFetch(`https://api.github.com/gists/${P.sync.gistId}`, {
        method: 'PATCH',
        body: JSON.stringify({ description: GIST_DESCRIPTION, files }),
      });
    } else {
      // Create new
      result = await gistFetch('https://api.github.com/gists', {
        method: 'POST',
        body: JSON.stringify({ description: GIST_DESCRIPTION, public: false, files }),
      });
      P.sync.gistId = result.id;
    }
    P.sync.lastPushAt = Date.now();
    P.sync.status = 'idle';
    savePersistentLocalOnly();
    updateSyncBadge();
  } catch (e) {
    P.sync.status = 'error';
    P.sync.lastError = e.message;
    savePersistentLocalOnly();
    updateSyncBadge();
    throw e;
  }
}

async function pullFromGist() {
  if (!syncEnabled()) return;
  if (!P.sync.gistId) {
    const found = await findExistingGist();
    if (found) P.sync.gistId = found;
    else throw new Error('No gist found — push first to create one');
  }
  P.sync.status = 'syncing';
  P.sync.lastError = null;
  updateSyncBadge();
  try {
    const data = await gistFetch(`https://api.github.com/gists/${P.sync.gistId}`);
    const stateFile = data.files && data.files['state.json'];
    if (!stateFile) throw new Error('Gist missing state.json');
    const readFile = async f => {
      if (f.truncated && f.raw_url) {
        const raw = await fetch(f.raw_url);
        return raw.text();
      }
      return f.content;
    };
    const stateContent = await readFile(stateFile);
    const remote = JSON.parse(stateContent);
    const preservedSync = P.sync;
    P = {...cloneDefault(), ...remote, sync: preservedSync};
    P.sync.lastPullAt = Date.now();
    P.sync.status = 'idle';
    savePersistentLocalOnly();

    // Drafts file is optional — older gists may not have it
    const draftsFile = data.files && data.files['drafts.json'];
    if (draftsFile) {
      try {
        const draftsContent = await readFile(draftsFile);
        applyDraftsPayload(JSON.parse(draftsContent));
      } catch (e) { console.warn('drafts pull failed:', e); }
    }

    render();
    toast('Pulled latest state');
  } catch (e) {
    P.sync.status = 'error';
    P.sync.lastError = e.message;
    savePersistentLocalOnly();
    updateSyncBadge();
    throw e;
  }
}

async function connectSync(token) {
  if (!token || !token.trim()) {
    toast('Token is empty', true);
    return;
  }
  P.sync = {
    token: token.trim(),
    gistId: null,
    lastPushAt: null,
    lastPullAt: null,
    lastError: null,
    status: 'syncing',
  };
  savePersistentLocalOnly();
  updateSyncBadge();
  try {
    // Look for an existing curriculum gist on this account
    const existingId = await findExistingGist();
    if (existingId) {
      P.sync.gistId = existingId;
      savePersistentLocalOnly();
      await pullFromGist();
      toast('Connected — pulled existing state');
    } else {
      // No gist yet — create one with current local state
      await pushToGist();
      toast('Connected — created new gist');
    }
    render();
  } catch (e) {
    P.sync.status = 'error';
    P.sync.lastError = e.message;
    savePersistentLocalOnly();
    toast('Sync failed: ' + e.message, true);
    render();
  }
}

function disconnectSync() {
  P.sync = cloneDefault().sync;
  savePersistentLocalOnly();
  toast('Disconnected from GitHub');
  render();
}

function updateSyncBadge() {
  const el = document.getElementById('sync-badge');
  if (!el) return;
  el.textContent = syncBadgeText();
  el.className = 'sync-badge ' + syncBadgeClass();
}

function syncBadgeText() {
  if (!syncEnabled()) return 'Local only';
  if (P.sync.status === 'syncing') return 'Syncing…';
  if (P.sync.status === 'error') return 'Sync error';
  if (P.sync.lastPushAt) {
    const secs = Math.floor((Date.now() - P.sync.lastPushAt) / 1000);
    if (secs < 60) return `Synced ${secs}s ago`;
    if (secs < 3600) return `Synced ${Math.floor(secs/60)}m ago`;
    return `Synced ${Math.floor(secs/3600)}h ago`;
  }
  return 'Synced';
}

function syncBadgeClass() {
  if (!syncEnabled()) return 'local';
  if (P.sync.status === 'syncing') return 'syncing';
  if (P.sync.status === 'error') return 'error';
  return 'ok';
}

// ── INTAKE / DRAFT ENTRIES ──
// New resources/topics added via the "+ Add" modal.
// They mutate BOOK_PROGRESS / T directly so the dashboard's existing pacing
// math picks them up on the next render. Persisted to localStorage under
// DRAFTS_KEY so they survive page reloads — committing back to data.js
// (via the patch button) is optional but recommended for portability.
const MEDIA_TYPES = [
  { id: 'book',     label: 'Book',                 icon: '📕' },
  { id: 'paper',    label: 'Paper / Article',      icon: '📄' },
  { id: 'guidance', label: 'Guidance / Reg doc',   icon: '📋' },
  { id: 'course',   label: 'Course',               icon: '🎓' },
  { id: 'video',    label: 'Video',                icon: '🎬' },
  { id: 'podcast',  label: 'Podcast',              icon: '🎧' },
];
function getMediaType(id) { return MEDIA_TYPES.find(m => m.id === id) || MEDIA_TYPES[0]; }

const DRAFTS_KEY = 'curriculum_v4_drafts';
let draftEntries = []; // { kind:'book'|'topic', key }

function saveDrafts() {
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(draftsPayload()));
    scheduleAutoSync(); // push drafts to gist if connected
  } catch (e) { console.warn('saveDrafts failed:', e); }
}

function loadDrafts() {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) return;
    const payload = JSON.parse(raw);
    if (!payload || !Array.isArray(payload.entries)) return;
    // Restore topics first (so book→topic refs resolve)
    (payload.topics || []).forEach(t => {
      if (!T.find(x => x.id === t.id)) T.push(t);
    });
    // Restore books
    Object.entries(payload.books || {}).forEach(([k, b]) => {
      if (!BOOK_PROGRESS[k]) BOOK_PROGRESS[k] = b;
    });
    draftEntries = payload.entries;
  } catch (e) { console.warn('loadDrafts failed:', e); }
}

function clearAllDrafts() {
  // Snapshot then remove (mutates BOOK_PROGRESS / T)
  [...draftEntries].forEach(d => {
    if (d.kind === 'book') delete BOOK_PROGRESS[d.key];
    if (d.kind === 'topic') {
      const i = T.findIndex(t => t.id === d.key);
      if (i >= 0) T.splice(i, 1);
    }
  });
  draftEntries = [];
  try { localStorage.removeItem(DRAFTS_KEY); } catch (_) {}
  scheduleAutoSync(); // propagate the clear to gist
}

// Snap an ISO date (YYYY-MM-DD) to the nearest curriculum week.
// Curriculum weeks: each month divided into 4 quartiles (day 1, 8, 15, 22).
function dateToWeekKey(isoDate) {
  if (!isoDate) return null;
  try {
    const target = new Date(isoDate + 'T00:00:00');
    if (isNaN(target.getTime())) return null;
    const MONTH_NAME_IDX = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    let best = null, bestDiff = Infinity;
    for (let m = 0; m < 14; m++) {
      const mNum = MONTH_NAME_IDX[MF[m]];
      for (let w = 1; w <= 4; w++) {
        const d = new Date(MY[m], mNum, (w - 1) * 7 + 4); // midpoint of week
        const diff = Math.abs(target - d);
        if (diff < bestDiff) { bestDiff = diff; best = weekKey(m, w); }
      }
    }
    return best;
  } catch { return null; }
}

function weekKeyToLabel(wk) {
  if (!wk) return '—';
  const [m, w] = wk.split('-W').map(Number);
  if (isNaN(m) || isNaN(w) || m < 0 || m >= MF.length) return wk;
  return `${MF[m]} ${MY[m]} W${w}`;
}

// Approximate ISO date for the start of a curriculum week (for date-input defaults)
function weekKeyToDate(wk) {
  if (!wk) return '';
  const [m, w] = wk.split('-W').map(Number);
  if (isNaN(m) || isNaN(w)) return '';
  const MONTH_NAME_IDX = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
  const d = new Date(MY[m], MONTH_NAME_IDX[MF[m]], (w - 1) * 7 + 1);
  return localDayKey(d);
}

function nextFreeTopicId() {
  const taken = new Set(T.map(t => t.id));
  for (let i = 1; i < 100; i++) if (!taken.has(i)) return i;
  return T.length + 1;
}

function addDraftBook({ title, author, mediaType, topicId, totalPages, startWeek, endWeek, note }) {
  const slug = (title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const safeKey = `${slug}-${Date.now().toString(36).slice(-4)}`;
  BOOK_PROGRESS[safeKey] = {
    title, author: author || '',
    totalPages: Math.max(1, +totalPages || 1), currentPage: 0,
    startWeek, endWeek,
    topic: +topicId,
    mediaType,
    note: note || `Draft · ${getMediaType(mediaType).label}`,
  };
  draftEntries.push({ kind: 'book', key: safeKey });
  saveDrafts();
  return safeKey;
}

function addDraftTopic({ title, color }) {
  const id = nextFreeTopicId();
  T.push({
    id, title,
    color: color || 'var(--text-secondary)',
    bg: 'rgba(148,163,184,0.15)',
    scope: 'Draft topic — added via intake',
    tf: '—', burn: '—', practice: '', notes: '',
    subs: [],
  });
  draftEntries.push({ kind: 'topic', key: id });
  saveDrafts();
  return id;
}

function removeDraft(kind, key) {
  draftEntries = draftEntries.filter(d => !(d.kind === kind && d.key === key));
  if (kind === 'book') delete BOOK_PROGRESS[key];
  if (kind === 'topic') {
    const i = T.findIndex(t => t.id === key);
    if (i >= 0) T.splice(i, 1);
  }
  saveDrafts();
}

function generatePatch() {
  const bookSnippets = draftEntries.filter(d => d.kind === 'book').map(d => {
    const b = BOOK_PROGRESS[d.key];
    if (!b) return '';
    const sw = b.startWeek.split('-W').map(Number);
    const ew = b.endWeek.split('-W').map(Number);
    return `  ${JSON.stringify(d.key)}: {
    title: ${JSON.stringify(b.title)}, author: ${JSON.stringify(b.author || '')},
    totalPages: ${b.totalPages}, currentPage: 0,
    startWeek: weekKey(${sw[0]}, ${sw[1]}),
    endWeek:   weekKey(${ew[0]}, ${ew[1]}),
    topic: ${b.topic},
    mediaType: ${JSON.stringify(b.mediaType)},
    note: ${JSON.stringify(b.note || '')},
  },`;
  }).filter(Boolean).join('\n');

  const topicSnippets = draftEntries.filter(d => d.kind === 'topic').map(d => {
    const t = T.find(x => x.id === d.key);
    if (!t) return '';
    return `  {id: ${t.id}, title: ${JSON.stringify(t.title)}, color: ${JSON.stringify(t.color)}, bg: ${JSON.stringify(t.bg)},
   scope: ${JSON.stringify(t.scope)}, tf: ${JSON.stringify(t.tf)}, burn: ${JSON.stringify(t.burn)},
   practice: ${JSON.stringify(t.practice)}, notes: ${JSON.stringify(t.notes)},
   subs: []},`;
  }).filter(Boolean).join('\n');

  let patch = '// === Curriculum data.js patch ===\n';
  patch += '// Generated ' + new Date().toISOString() + '\n';
  patch += '// Paste each block into the matching section of data.js, then reload.\n\n';
  if (topicSnippets) patch += '// ── New topics: append inside the T = [ ... ] array ──\n' + topicSnippets + '\n\n';
  if (bookSnippets)  patch += '// ── New resources: append inside the BOOK_PROGRESS = { ... } object ──\n' + bookSnippets + '\n';
  if (!topicSnippets && !bookSnippets) patch += '// (no draft entries)\n';
  return patch;
}

// ── MODAL ──
let modalState = null;

function openModal(type, context) {
  modalState = { type, context };
  render();
}

function closeModal() {
  modalState = null;
  render();
}

// ── TOAST ──
function toast(msg, isError) {
  const el = document.createElement('div');
  el.className = 'toast';
  if (isError) el.style.background = 'var(--accent-bad)';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

// ── SESSION TIMER ──
let timerState = { running: false, paused: false, startTs: 0, elapsedSec: 0, pausedAt: 0 };
let timerInterval = null;

function startTimer() {
  if (timerState.running) return;
  timerState.running = true;
  timerState.paused = false;
  timerState.startTs = Date.now() - timerState.elapsedSec * 1000;
  timerInterval = setInterval(updateTimerDisplay, 1000);
  updateTimerDisplay();
}
function pauseTimer() {
  if (!timerState.running) return;
  timerState.paused = !timerState.paused;
  if (timerState.paused) {
    clearInterval(timerInterval);
    timerState.elapsedSec = Math.floor((Date.now() - timerState.startTs) / 1000);
  } else {
    timerState.startTs = Date.now() - timerState.elapsedSec * 1000;
    timerInterval = setInterval(updateTimerDisplay, 1000);
  }
  updateTimerDisplay();
}
function resetTimer() {
  clearInterval(timerInterval);
  timerState = { running: false, paused: false, startTs: 0, elapsedSec: 0, pausedAt: 0 };
  updateTimerDisplay();
}
function updateTimerDisplay() {
  const el = document.getElementById('timer-display');
  if (!el) return;
  let sec;
  if (timerState.running && !timerState.paused) {
    sec = Math.floor((Date.now() - timerState.startTs) / 1000);
    timerState.elapsedSec = sec;
  } else {
    sec = timerState.elapsedSec;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  el.className = 'timer-display ' + (timerState.paused ? 'paused' : (timerState.running ? 'running' : ''));
}

// ── RENDER ──
function isViewportNarrow() {
  try { return window.innerWidth <= 600; } catch (_) { return false; }
}
function applyMobileBodyClasses() {
  // Mobile layout is purely viewport-driven now; the manual PC/Mobile toggle
  // was removed. body.view-mobile (phone-frame chrome) is no longer applied.
  document.body.classList.toggle('mobile-active', isViewportNarrow());
}
function render() {
  try {
    applyMobileBodyClasses();
    const a = document.getElementById("app");
    a.innerHTML = `
      ${isWeekStale() ? `
        <div class="stale-week-banner">
          <span>⏳ This tab has been open since <strong>${escapeHtml(weekLabel(CURRENT_WEEK_KEY))}</strong> — the calendar has moved to <strong>${escapeHtml(weekLabel(idxToWeekKey(liveWeekIdx())))}</strong>. Pacing and due-date math are stale.</span>
          <button class="btn btn-small" id="stale-reload">↻ Reload</button>
        </div>
      ` : ''}
      <div class="header">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:0;">
            <h1><span class="desktop-only">Personal Learning Curriculum</span><span class="mobile-only">Curriculum</span></h1>
            <div class="date-nav" role="group" aria-label="Viewing date">
              <button class="dn-btn" id="dn-prev" title="Previous day" aria-label="Previous day">‹</button>
              <button class="dn-label ${isViewingToday() ? 'is-today' : (getViewingIso() > todayIso() ? 'is-future' : 'is-past')}" id="dn-label" title="${isViewingToday() ? 'Viewing today' : 'Click to return to today'}">
                <span class="dn-date">${formatViewingHeader()}</span>
                ${!isViewingToday() ? `<span class="dn-back">↻ Today</span>` : ''}
              </button>
              <button class="dn-btn" id="dn-next" title="Next day" aria-label="Next day">›</button>
              <button class="dn-btn dn-picker" id="dn-picker" title="Pick a date" aria-label="Open calendar">⋯</button>
              <input type="date" id="dn-date-input" value="${getViewingIso()}" aria-hidden="true" tabindex="-1">
            </div>
            <div class="sub desktop-only">Obsidian + Anki + morning block · 10 topics · syntopic clusters where applicable</div>
          </div>
          <button id="sync-badge" class="sync-badge ${syncBadgeClass()}" data-modal="sync" title="Click to manage GitHub sync">${syncBadgeText()}</button>
        </div>
        <div class="action-bar" style="margin-top:12px;margin-bottom:0;">
          <span class="action-bar-label">Quick Actions</span>
          <button class="btn btn-primary" data-modal="log-session">+ Log Session</button>
          <button class="btn" data-modal="add-resource">+ Add Resource</button>
          <button class="btn" data-modal="leverage"><span class="desktop-only">+ Leverage Note</span><span class="mobile-only">+ Note</span></button>
          <button class="btn" data-modal="timer">⏱ <span class="desktop-only">Timer</span></button>
          <button class="btn" data-modal="autobalance" title="Fit end dates to your measured weekly capacity">⚖ <span class="desktop-only">Rebalance</span></button>
          <span style="flex:1;"></span>
          <button class="btn btn-ghost btn-small" data-modal="sync">Sync</button>
          <button class="btn btn-ghost btn-small" data-modal="data">Data</button>
        </div>
        ${draftEntries.length ? `
          <div class="draft-banner">
            <span>📝 <strong>${draftEntries.length}</strong> draft ${draftEntries.length===1?'entry':'entries'} saved locally — view patch when ready to commit to data.js</span>
            <button class="btn btn-small" data-modal="patch">View patch</button>
          </div>
        ` : ''}
      </div>
      <div class="tabs">
        <button class="tab ${S.tab==='this-week'?'active':''}" data-tab="this-week">This Week</button>
        <button class="tab ${S.tab==='timeline'?'active':''}" data-tab="timeline">Timeline</button>
        <button class="tab ${S.tab==='log'?'active':''}" data-tab="log">Log</button>
        ${T.map(t=>`<button class="tab ${S.tab==='t'+t.id?'active':''}" data-tab="t${t.id}"><span class="dot" style="background:${t.color}"></span>#${t.id}</button>`).join("")}
      </div>
      <div id="content"></div>
      ${modalState ? renderModal() : ''}
      <div class="app-version-footer" title="Auto-stamped by commit.ps1. Hard-refresh after a commit to confirm deploy.">${escapeHtml(APP_VERSION)}</div>
    `;

    const content = document.getElementById("content");
    if (S.tab === 'this-week') content.innerHTML = renderThisWeek();
    else if (S.tab === 'timeline') content.innerHTML = renderTimeline();
    else if (S.tab === 'log') content.innerHTML = renderLog();
    else {
      const topic = T.find(t => 't'+t.id === S.tab);
      if (topic) content.innerHTML = renderTopicPanel(topic);
    }

    bind();
  } catch (e) {
    console.error("Render error:", e);
    document.getElementById("app").innerHTML = `<div style="padding:20px;color:#ef4444;font-family:monospace;">Render error: ${e.message}</div>`;
  }
}

// ── ACTIVITY ROLL (heuristic random selection) ──
//
// Scores each active book on four signals and weighted-random picks from
// the top 3. Designed to feel like dice while still nudging toward
// syntopic batching and weekly goal completion.
function suggestRandomActivity() {
  const activeBooks = Object.entries(BOOK_PROGRESS).filter(([k, b]) => {
    if (isBookComplete(k)) return false;
    const startWeek = getStartWeek(k);
    const endWeek = getEndWeek(k);
    if (!startWeek || !endWeek) return false;
    try {
      const [sm, sw] = startWeek.split('-W').map(Number);
      const [em, ew] = endWeek.split('-W').map(Number);
      if ([sm, sw, em, ew].some(isNaN)) return false;
      const sIdx = sm * 4 + sw;
      const cIdx = CURRENT_MONTH_IDX * 4 + CURRENT_WEEK_OF_MONTH;
      // P3 #11: include overdue (cIdx > eIdx, not yet complete). Dropping
      // the upper bound makes the dice eligible to surface a past-target
      // book — appropriate, since unfinished overdue work is more urgent
      // than fresh on-pace reading.
      return cIdx >= sIdx;
    } catch { return false; }
  });

  if (activeBooks.length === 0) return null;

  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  const last4h = P.sessions.filter(s => now - s.ts < 4 * HOUR);
  const last48h = P.sessions.filter(s => now - s.ts < 48 * HOUR);
  // Most recent session within 48h — drives syntopic batching
  const recent = last48h.length
    ? last48h.reduce((a, b) => a.ts > b.ts ? a : b)
    : null;
  const recentBook = recent ? BOOK_PROGRESS[recent.bookKey] : null;
  const recentTopic = recentBook ? recentBook.topic : null;

  const scored = activeBooks.map(([k, b]) => {
    let score = 0;
    const reasons = [];

    // Pacing math
    const cur = getCurrentPage(k);
    let weeklyTarget = 0;
    let wkRem = 1;
    try {
      const [em, ew] = getEndWeek(k).split('-W').map(Number);
      const endIdx = em * 4 + ew;
      const curIdx = CURRENT_MONTH_IDX * 4 + CURRENT_WEEK_OF_MONTH;
      wkRem = Math.max(1, endIdx - curIdx + 1);
      weeklyTarget = Math.ceil(Math.max(0, b.totalPages - cur) / wkRem);
    } catch {}

    const pagesThisWeek = P.sessions
      .filter(s => s.bookKey === k && (now - s.ts) < 7 * 24 * HOUR)
      .reduce((sum, s) => sum + (s.pagesRead || 0), 0);
    const gap = Math.max(0, weeklyTarget - pagesThisWeek);
    const gapRatio = weeklyTarget > 0 ? Math.min(1, gap / weeklyTarget) : 0;

    // 1. Weekly target deficit (0-50)
    score += gapRatio * 50;
    if (gap > 0) reasons.push(`${gap} pp short of weekly target (${weeklyTarget})`);
    else if (weeklyTarget > 0 && pagesThisWeek > 0) reasons.push(`On pace this week`);

    // 2. Syntopic batch — same topic as recent session (0 or 30)
    if (recentTopic != null && b.topic === recentTopic && recent.bookKey !== k) {
      score += 30;
      const topic = T.find(t => t.id === b.topic);
      reasons.push(`Syntopic batch — same topic as recent (#${b.topic}${topic ? ' ' + topic.title.split(' ')[0] : ''})`);
    }

    // 3. Schedule pressure (0-20) — closer deadline = higher
    const pressureScore = Math.max(0, (8 - wkRem)) * 2.5;
    score += pressureScore;
    if (wkRem <= 2) reasons.push(`${wkRem} week${wkRem === 1 ? '' : 's'} to deadline`);

    // 4. Recency penalty — read in last 4 hours (-20)
    if (last4h.some(s => s.bookKey === k)) {
      score -= 20;
      reasons.push(`Just read — encouraging variety`);
    }

    // 5. Random jitter (0-15) — keeps dice feeling like dice
    score += Math.random() * 15;

    return { key: k, book: b, score, reasons, weeklyTarget, pagesThisWeek, gap, wkRem };
  });

  scored.sort((a, b) => b.score - a.score);

  // Weighted random over top 3
  const topN = scored.slice(0, Math.min(3, scored.length));
  const totalScore = topN.reduce((s, x) => s + Math.max(1, x.score), 0);
  let pick = Math.random() * totalScore;
  for (const cand of topN) {
    pick -= Math.max(1, cand.score);
    if (pick <= 0) return cand;
  }
  return topN[topN.length - 1];
}

// ── THIS WEEK ──

// P1 #1.2: the active-book predicate, extracted from renderThisWeek so the
// autobalance solver partitions books with the exact same rule the UI uses.
// P3 #11 semantics preserved: include overdue (cIdx > eIdx, not yet
// complete). Without this the This Week panel silently drops past-target
// books, hiding the very state the OVERDUE pill is supposed to surface.
function getActiveBookEntries() {
  const cIdx = CURRENT_MONTH_IDX * 4 + CURRENT_WEEK_OF_MONTH;
  return Object.entries(BOOK_PROGRESS).filter(([k, b]) => {
    if (!b) return false;
    if (isBookComplete(k)) return false;
    const sIdx = weekIdx(getStartWeek(k));
    const eIdx = weekIdx(getEndWeek(k));
    if (sIdx === null || eIdx === null) return false;
    return cIdx >= sIdx;
  });
}

// P1 #1.2: shared weekly-demand calculator — the weeklyTarget reduce from
// renderThisWeek, extracted verbatim so the autobalance solver's objective
// is bit-identical to the displayed load pill BY CONSTRUCTION rather than
// by copy discipline (this would otherwise have become the 9th inline copy
// of the pacing math). Same ceil(remaining / weeksRem) with the same
// weeksRemaining floor of 1 that renderBookProgress uses.
function getWeeklyDemand() {
  const cIdx = CURRENT_MONTH_IDX * 4 + CURRENT_WEEK_OF_MONTH;
  const perBook = {};
  let total = 0;
  getActiveBookEntries().forEach(([k, b]) => {
    const eIdx = weekIdx(getEndWeek(k));
    if (eIdx === null) return;
    const weeksRem = Math.max(1, eIdx - cIdx + 1);
    const ppw = Math.ceil(Math.max(0, (b.totalPages || 0) - getCurrentPage(k)) / weeksRem);
    perBook[k] = ppw;
    total += ppw;
  });
  return { total, perBook };
}

// ── AUTOBALANCE SOLVER (P1 #1.4) ──
// Pure and deterministic: no Date.now(), no randomness, no writes.
//
// Model: every surface displays even-spread-from-today pacing
// (pagesPerWeek = remaining / (endWeek - today)), so every active book's
// window contains the CURRENT week and the current week's load is exactly
// the sum of all active rates. The solver therefore WATER-FILLS the weekly
// capacity across active books as rates, then DERIVES each end week from
// its allocated rate — rather than scanning candidate end weeks against a
// per-week load test. (A scan degenerates: one pinch week created by
// unmovable books rejects every window that crosses it and cascades the
// whole pool to the horizon with bogus "doesn't fit" verdicts. Allocation
// cannot cascade — a book's end moves exactly as far as its priority-fair
// share of capacity dictates, no further.)
//
// Allocation, in deterministic priority order (tier asc, earlier live end,
// larger remaining, bookKey tiebreak):
//   pass 1 — reserve every book's minimum viable rate (remaining/horizon:
//            the rate below which it cannot finish by Jun 2027);
//   pass 2 — distribute the remainder by priority, each book capped at
//            min(rateCap, live rate, remaining):
//            · rateCap = ceil(capacity/2) when 2+ books are active — no
//              single book eats more than half a week (weeks stay realistic
//              in COMPOSITION, not just aggregate volume);
//            · live rate as ceiling IS never-shrink expressed as a rate — a
//              book can never be asked to finish EARLIER than its live end,
//              so manual push-outs and ahead books are untouchable;
//            · remaining, because a rate above "finish this week" is waste.
//
// Guarantees:
// - Fitted current-week load ≤ capacity (the This Week pill and the
//   behind-banner trigger measure exactly this).
// - IDEMPOTENT: post-apply every live end equals its derived end, so a
//   rerun re-derives the identical allocation and returns an empty plan
//   ("Already balanced").
// - UNRESOLVED means genuine saturation — the capacity ran out before the
//   book's minimum viable rate could be reserved. "Doesn't fit by Jun 2027"
//   is then literally true, never a pinch artifact.
// - Future weeks are NOT hard-capped: pre-charged unmovables (pins, a fat
//   upcoming book) can make a future week run hot. That is surfaced via
//   peakWeek/peakWeekLoad instead of poisoning the plan — the weekly
//   rolling re-run (banner refires when demand jumps) is the corrective
//   loop, and P2 start-slides address it structurally.
//
// locks: Set<bookKey> (session locks ∪ persisted pins). Locked and upcoming
// (not-yet-started) books never move but PRE-CHARGE their even-spread load —
// a locked ACTIVE book consumes current-week budget before allocation, so
// pinning an overdue monster honestly starves everything else.
function computeRebalancePlan(opts) {
  const capacity = Math.round(+((opts && opts.capacity)) || 0);
  const capacitySource = (opts && opts.capacitySource) || 'manual';
  const lockSet = (opts && opts.locks instanceof Set) ? opts.locks : new Set();
  if (!isFinite(capacity) || capacity < 10) {
    return { error: 'capacity-too-low', capacity, capacitySource, changes: [], unresolved: [], markDone: [], invalid: [], locked: [], unchanged: [], asOf: CURRENT_WEEK_KEY };
  }
  const cIdx = CURRENT_MONTH_IDX * 4 + CURRENT_WEEK_OF_MONTH;

  // POOL — every non-complete book, via the live accessors (draft books
  // participate through the same BOOK_PROGRESS iteration as everywhere else).
  const pool = [], markDone = [], invalid = [];
  Object.entries(BOOK_PROGRESS).forEach(([k, b]) => {
    if (!b || isBookComplete(k)) return;
    const sIdx = weekIdx(getStartWeek(k));
    const eIdx = weekIdx(getEndWeek(k));
    if (sIdx === null || eIdx === null) {
      // Mirrors the "⚠ Invalid scheduling" card path — excluded but listed.
      invalid.push({ bookKey: k, title: b.title || k });
      return;
    }
    const remaining = Math.max(0, (b.totalPages || 0) - getCurrentPage(k));
    if (remaining === 0) {
      // Finished reading but checkbox not ticked. Completion is the
      // checkbox's job (P3 #13) — never write bookCompleted from here.
      markDone.push({ bookKey: k, title: b.title || k });
      return;
    }
    pool.push({ k, b, sIdx, eIdx, remaining, tier: tierOf(b.topic) });
  });

  const locked   = pool.filter(x => lockSet.has(x.k));
  const upcoming = pool.filter(x => !lockSet.has(x.k) && x.sIdx > cIdx);
  const active   = pool.filter(x => !lockSet.has(x.k) && x.sIdx <= cIdx); // == getActiveBookEntries predicate

  // PRE-CHARGE — locked + upcoming books consume capacity but never move.
  const load = new Array(MAX_WEEK_IDX + 1).fill(0);
  locked.concat(upcoming).forEach(x => {
    const w0 = Math.max(x.sIdx, cIdx);
    const w1 = Math.min(Math.max(x.eIdx, w0), MAX_WEEK_IDX);
    const rate = x.remaining / (w1 - w0 + 1);
    for (let t = w0; t <= w1; t++) load[t] += rate;
  });

  // ALLOCATE — water-fill the current week's remaining budget across active
  // books in deterministic priority order (same state → same proposal).
  active.sort((a, b) =>
    a.tier - b.tier || a.eIdx - b.eIdx || b.remaining - a.remaining || (a.k < b.k ? -1 : 1));
  const t0 = cIdx;
  const rateCap = active.length >= 2 ? Math.ceil(capacity * 0.5) : capacity;
  const EPS = 1e-6; // float tolerance
  const horizonWeeks = MAX_WEEK_IDX - t0 + 1;
  const minRate = x => x.remaining / horizonWeeks;
  const maxRate = x => {
    const liveWindow = x.eIdx - t0 + 1; // ≤ 0 when overdue → no live ceiling
    const liveRate = liveWindow > 0 ? x.remaining / liveWindow : Infinity;
    // max(minRate, …): a monster book whose minimum viable rate exceeds
    // rateCap must still be allowed to fit by the horizon.
    return Math.max(minRate(x), Math.min(rateCap, liveRate, x.remaining));
  };
  // Locked ACTIVE books already pre-charged the current week — they consume
  // budget before allocation (upcoming pre-charges never overlap t0).
  let budget = Math.max(0, capacity - load[t0]);
  const alloc = new Map();
  // pass 1 — minimum viable reservations, priority order
  active.forEach(x => {
    const r = Math.min(minRate(x), budget);
    alloc.set(x.k, r);
    budget -= r;
  });
  // pass 2 — distribute the remainder by priority, up to each book's cap
  active.forEach(x => {
    if (budget <= EPS) return;
    const bump = Math.min(maxRate(x) - alloc.get(x.k), budget);
    if (bump > 0) { alloc.set(x.k, alloc.get(x.k) + bump); budget -= bump; }
  });

  // DERIVE — end week from allocated rate; commit even-spread load.
  const changes = [], unresolved = [], unchanged = [];
  active.forEach(x => {
    const r = alloc.get(x.k);
    const starved = r + EPS < minRate(x); // budget ran out below minimum viable
    let eFinal;
    if (starved) {
      eFinal = MAX_WEEK_IDX; // clamp to horizon, flagged honestly below
      unresolved.push({
        bookKey: x.k, title: x.b.title || x.k,
        needsPagesPerWeek: Math.ceil(minRate(x)),
      });
    } else {
      eFinal = Math.min(MAX_WEEK_IDX, t0 + Math.ceil(x.remaining / r) - 1);
      eFinal = Math.max(eFinal, x.eIdx, t0); // never-shrink (ceil-edge safety)
    }
    const commitRate = x.remaining / (eFinal - t0 + 1);
    for (let t = t0; t <= eFinal; t++) load[t] += commitRate;
    if (eFinal !== x.eIdx) {
      changes.push({
        bookKey: x.k, title: x.b.title || x.k, topic: x.b.topic, tier: x.tier,
        remaining: x.remaining,
        from: idxToWeekKey(x.eIdx), to: idxToWeekKey(eFinal),
        // oldRate matches the OVERDUE floor semantics the pace pills display
        oldRate: Math.ceil(x.remaining / Math.max(1, x.eIdx - cIdx + 1)),
        newRate: Math.ceil(commitRate),
        deltaWeeks: eFinal - x.eIdx,
      });
    } else {
      unchanged.push({ bookKey: x.k, title: x.b.title || x.k });
    }
  });

  // Peak committed week — surfaced so the modal can be honest about pinch
  // weeks that run hot (cumulative feasibility allows them; see header note).
  let peakLoad = 0, peakIdx = cIdx;
  for (let t = cIdx; t <= MAX_WEEK_IDX; t++) {
    if (load[t] > peakLoad) { peakLoad = load[t]; peakIdx = t; }
  }

  return {
    changes, unresolved, markDone, invalid, unchanged,
    locked: locked.map(x => ({ bookKey: x.k, title: x.b.title || x.k })),
    before: getWeeklyDemand().total,
    after: Math.round(load[cIdx]),
    peakWeekLoad: Math.round(peakLoad),
    peakWeek: idxToWeekKey(peakIdx),
    capacity, capacitySource,
    asOf: CURRENT_WEEK_KEY,
  };
}

// Load-band thresholds — single source for the This Week pill and the
// autobalance modal footer (same numbers previously inlined in
// renderThisWeek).
function loadBand(weeklyTarget) {
  if (weeklyTarget < 80)  return { label: 'LIGHT',      cls: 'on-track' };
  if (weeklyTarget < 140) return { label: 'MODERATE',   cls: 'on-track' };
  if (weeklyTarget < 180) return { label: 'HEAVY',      cls: 'behind' };
  return { label: 'OVERLOAD ⚠', cls: 'behind' };
}

// Effective capacity from the modal's context — clamped [10, 400]; falls
// back to measured, then the honest default (120, labeled as such in the UI).
function abEffectiveCapacity(ctx) {
  let v = Math.round(+ctx.capacityInput);
  if (isNaN(v) || v <= 0) v = (ctx.measured && ctx.measured.value != null) ? ctx.measured.value : 120;
  return Math.max(10, Math.min(400, v));
}

// ── AUTOBALANCE APPLY (P1 #1.5) ──
// The ONLY write path for autobalance. Follows the save-edit discipline
// (app.js save-edit handler): capture prev via accessor BEFORE mutating,
// write-or-DELETE-when-equal-to-default so ◆ drift badges and
// hasScheduleOverride stay truthful, one audit entry per real change
// (source-tagged), ONE savePersistent() per batch → one debounced gist push.
// `prefs` ({capacityMode, manualCapacity, pinned}) persists the modal's
// capacity choice and pins alongside a SUCCESSFUL apply only.
function applyRebalancePlan(plan, prefs) {
  if (!plan || !Array.isArray(plan.changes) || plan.changes.length === 0) {
    toast('Nothing to apply');
    return;
  }
  // Week-drift abort: the plan was computed against the page-load week
  // anchor (CURRENT_* frozen in data.js). If the real week rolled over while
  // the tab sat open, every pace number on screen is stale — reload rather
  // than write against a phantom week. (P2 #2.6: same check the banner uses.)
  if (isWeekStale()) {
    toast('Week changed since page load — reload before applying', true);
    return;
  }
  const applied = [];
  let skipped = 0;
  plan.changes.forEach(ch => {
    const book = BOOK_PROGRESS[ch.bookKey];
    if (!book || isBookComplete(ch.bookKey)) { skipped++; return; }
    const prev = getEndWeek(ch.bookKey);
    // Per-change staleness guard: a gist pull or second-tab edit under the
    // open modal degrades to partial-apply-with-explanation, never a blind
    // overwrite of state the user hasn't seen.
    if (prev !== ch.from) { skipped++; return; }
    if (ch.to === book.endWeek) delete P.bookEndOverrides[ch.bookKey];
    else P.bookEndOverrides[ch.bookKey] = ch.to;
    logScheduleChange(ch.bookKey, 'endWeek', prev, getEndWeek(ch.bookKey), 'autobalance');
    applied.push({ bookKey: ch.bookKey, from: ch.from, to: ch.to });
  });
  const ab = ensureAutobalanceState();
  if (prefs) {
    ab.capacityMode = prefs.capacityMode === 'manual' ? 'manual' : 'auto';
    if (prefs.capacityMode === 'manual' && typeof prefs.manualCapacity === 'number') {
      ab.manualCapacity = prefs.manualCapacity;
    }
    if (prefs.pinned && typeof prefs.pinned === 'object') ab.pinned = prefs.pinned;
  }
  ab.lastRunTs = Date.now();
  ab.lastRun = { ts: ab.lastRunTs, capacity: plan.capacity, capacitySource: plan.capacitySource, changes: applied };
  savePersistent();
  closeModal(); // closes + re-renders: every surface re-derives via the accessors
  const parts = [`⚖ Rebalanced ${applied.length} ${applied.length === 1 ? 'book' : 'books'}`];
  if (skipped) parts.push(`${skipped} skipped (state changed)`);
  if (plan.unresolved.length) parts.push(`${plan.unresolved.length} can't fit by Jun 2027`);
  toast(parts.join(' · '));
}

function renderThisWeek() {
  // Reading progress for current week (P1 #1.2: shared predicate)
  const activeBooks = getActiveBookEntries();

  // Upcoming books (start within next 4 weeks)
  const upcomingBooks = Object.entries(BOOK_PROGRESS).filter(([k,b]) => {
    if (isBookComplete(k)) return false;
    const startWeek = getStartWeek(k);
    if (!startWeek) return false;
    try {
      const [sm,sw] = startWeek.split('-W').map(Number);
      const sIdx = sm * 4 + sw;
      const cIdx = CURRENT_MONTH_IDX * 4 + CURRENT_WEEK_OF_MONTH;
      return sIdx > cIdx && sIdx <= cIdx + 4;
    } catch { return false; }
  });

  // Stats
  const last7 = getSessionsInRange(7);
  const last30 = getSessionsInRange(30);
  const pagesThisWeek = last7.reduce((sum,s) => sum + (s.pagesRead || 0), 0);
  const minThisWeek = last7.reduce((sum,s) => sum + (s.durationMin || 0), 0);
  const sessionsThisWeek = last7.length;
  const streak = getStreakDays();

  // Weekly target total (P1 #1.2: shared calculator — same math, one home)
  const weeklyTarget = getWeeklyDemand().total;

  // Load assessment (P1 #1.5: shared thresholds via loadBand)
  const { label: loadLabel, cls: loadClass } = loadBand(weeklyTarget);

  // P1 #1.6: capacity-relative behind detection. Computed fresh on every
  // render, never stored, never auto-fires — the banner only OFFERS the
  // rebalance. Capacity-relative predicate adapts to the actual reader
  // (demand > 1.25× measured pace); the OVERLOAD band stays as an absolute
  // backstop when there's no measured pace to compare against. Snooze is a
  // week index, not a wall-clock delay — it re-arms next curriculum week.
  const abConf = getAutobalanceConfig();
  const abMeasured = getMeasuredCapacity();
  const abCap = (abConf.capacityMode === 'manual' && abConf.manualCapacity) ? abConf.manualCapacity : abMeasured.value;
  const curIdxNow = CURRENT_MONTH_IDX * 4 + CURRENT_WEEK_OF_MONTH;
  const overdueCount = activeBooks.reduce((n, [k]) => {
    const e = weekIdx(getEndWeek(k));
    return n + (e !== null && curIdxNow > e ? 1 : 0);
  }, 0);
  const behind = overdueCount > 0 || (abCap != null && weeklyTarget > abCap * 1.25) || weeklyTarget >= 180;
  const snoozed = abConf.dismissedUntilIdx !== null && curIdxNow < abConf.dismissedUntilIdx;
  const showRebalanceBanner = behind && !snoozed && activeBooks.length > 0;

  // Suggestion — uses the SAME per-week target metric as the book progress card
  // for consistency. Books with no remaining-page deficit show "on pace" rather
  // than picking a "behind" book.
  let suggestion = null;
  let mostBehindWeeklyGap = 0;
  activeBooks.forEach(([k,b]) => {
    const cur = getCurrentPage(k);
    const startWeek = getStartWeek(k);
    const endWeek = getEndWeek(k);
    try {
      const [em,ew] = endWeek.split('-W').map(Number);
      const [sm,sw] = startWeek.split('-W').map(Number);
      if ([em,ew,sm,sw].some(isNaN)) return;
      const endIdx = em * 4 + ew;
      const startIdx = sm * 4 + sw;
      const curIdx = CURRENT_MONTH_IDX * 4 + CURRENT_WEEK_OF_MONTH;
      if (curIdx < startIdx) return; // not started yet
      const remaining = Math.max(0, b.totalPages - cur);
      const weeksRemaining = Math.max(1, endIdx - curIdx + 1);
      const pagesPerWeek = Math.ceil(remaining / weeksRemaining);
      // Pages logged this week for THIS book
      const pagesThisWeekForBook = getSessionsInRange(7)
        .filter(s => s.bookKey === k)
        .reduce((sum,s) => sum + (s.pagesRead || 0), 0);
      const weeklyGap = Math.max(0, pagesPerWeek - pagesThisWeekForBook);
      if (weeklyGap > mostBehindWeeklyGap) {
        mostBehindWeeklyGap = weeklyGap;
        suggestion = { key: k, book: b, currentPage: cur, pagesPerWeek, pagesThisWeekForBook, weeklyGap };
      }
    } catch {}
  });
  if (!suggestion && activeBooks.length > 0) {
    // No deficit — suggest the book with most pages remaining
    const best = activeBooks.reduce((bestEntry, curr) => {
      const remCur = curr[1].totalPages - getCurrentPage(curr[0]);
      const remBest = bestEntry[1].totalPages - getCurrentPage(bestEntry[0]);
      return remCur > remBest ? curr : bestEntry;
    });
    const [k,b] = best;
    const cur = getCurrentPage(k);
    try {
      const [em,ew] = getEndWeek(k).split('-W').map(Number);
      const endIdx = em*4+ew;
      const curIdx = CURRENT_MONTH_IDX*4+CURRENT_WEEK_OF_MONTH;
      const weeksRemaining = Math.max(1, endIdx - curIdx + 1);
      const pagesPerWeek = Math.ceil(Math.max(0, b.totalPages - cur) / weeksRemaining);
      suggestion = { key: k, book: b, currentPage: cur, pagesPerWeek, pagesThisWeekForBook: 0, weeklyGap: 0 };
    } catch {}
  }

  return `
    <div class="dice-row">
      <button class="dice-button" data-modal="roll" title="Roll for a study activity">
        <span class="dice-face">🎲</span>
        <span class="dice-text"><span class="desktop-only">Roll for activity</span><span class="mobile-only">Roll activity</span></span>
      </button>
    </div>
    ${suggestion ? `
      <div class="suggestion-card">
        <div class="suggestion-label">▶ Read Now</div>
        <div class="suggestion-title">${escapeHtml(suggestion.book.title)} — p.${suggestion.currentPage + 1}</div>
        <div class="suggestion-detail">
          <span class="desktop-only">Weekly target: </span><span class="mobile-only">Target: </span><strong>${suggestion.pagesPerWeek} pp</strong>${suggestion.pagesThisWeekForBook > 0 ? ` · <span class="desktop-only">logged this week: </span><span class="mobile-only">done: </span>${suggestion.pagesThisWeekForBook} pp` : ''}${suggestion.weeklyGap > 0 ? ` · <span style="color:var(--accent-warn);">${suggestion.weeklyGap} pp short</span>` : ' · on pace'}
        </div>
        <button class="btn btn-primary btn-small" data-modal="log-session" data-book="${suggestion.key}"><span class="desktop-only">+ Log Session for This</span><span class="mobile-only">+ Log This</span></button>
      </div>
    ` : ''}

    ${showRebalanceBanner ? `
      <div class="rebalance-banner">
        <div class="rebalance-banner-text">
          <strong>Plan asks ${weeklyTarget} pp/wk</strong>${abCap != null ? ` · your measured pace is ~${abCap} pp/wk` : ' · no measured pace yet'}${overdueCount ? ` · ${overdueCount} overdue` : ''}
        </div>
        <div class="rebalance-banner-actions">
          <button class="btn btn-small btn-primary" data-modal="autobalance">⚖ Rebalance</button>
          <button class="btn btn-small btn-ghost" id="ab-snooze" title="Hide until next curriculum week">Snooze</button>
        </div>
      </div>
    ` : ''}

    <div class="stats-strip">
      <div class="stat-card">
        <div class="stat-label">Streak</div>
        <div class="stat-value">${streak}<span style="font-size:12px;color:var(--text-muted);font-weight:400;"> days</span></div>
        <div class="stat-sub desktop-only">consecutive study days</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Pages · 7d</div>
        <div class="stat-value">${pagesThisWeek}<span style="font-size:11px;color:var(--text-muted);font-weight:400;"> / ~${weeklyTarget}</span></div>
        <div class="stat-sub"><span class="desktop-only">target this week · </span><span class="rp-pace ${loadClass}" style="padding:1px 5px;font-size:9px;">${loadLabel}</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Sessions · 7d</div>
        <div class="stat-value">${sessionsThisWeek}</div>
        <div class="stat-sub">${minThisWeek} min<span class="desktop-only"> total</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Books Active</div>
        <div class="stat-value">${activeBooks.length}</div>
        <div class="stat-sub"><span class="desktop-only">${Object.keys(P.bookCompleted).length} completed · ${upcomingBooks.length} upcoming</span><span class="mobile-only">${Object.keys(P.bookCompleted).length}✓ · ${upcomingBooks.length}↗</span></div>
      </div>
    </div>

    <div class="streak-wrap">
      <div class="streak-head">
        <div style="font-size:11px;font-family:'DM Mono',monospace;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">Last 35 Days</div>
        <div style="font-size:10px;color:var(--text-muted);font-family:'DM Mono',monospace;">${last30.reduce((s,x)=>s+(x.pagesRead||0),0)} pages logged</div>
      </div>
      ${renderStreakGrid()}
    </div>

    <div class="sec-title"><span class="desktop-only">Active Reading — This Week's Pace</span><span class="mobile-only">Active Reading</span></div>
    ${activeBooks.length === 0 ? `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;border:1px dashed var(--border);border-radius:6px;">No active books this week. ${upcomingBooks.length ? 'See upcoming books below.' : ''}</div>` : activeBooks.map(([k,b]) => renderBookProgress(k, b)).join('')}

    ${upcomingBooks.length > 0 ? `
      <div class="sec-title"><span class="desktop-only">Upcoming — Starts in Next 4 Weeks</span><span class="mobile-only">Upcoming (4 wks)</span></div>
      ${upcomingBooks.map(([k,b]) => renderBookProgress(k, b)).join('')}
    ` : ''}

    <div class="sec-title"><span class="desktop-only">Syntopic Reading Clusters — Active</span><span class="mobile-only">Active Clusters</span></div>
    ${getActiveClusters().map(({c, color}) => renderCluster(c, color)).join('')}
  `;
}

// Parse a syntopic-cluster span string into curriculum-month indices.
// Handles all current shapes:
//   "May–Jul 2026"        → both months 2026 (left inherits right year)
//   "Jul W3–Dec 2026"     → W-suffix on left ignored for month resolution
//   "Sep 2026–Feb 2027"   → year wraps; both halves carry explicit years
//   "May–Jun 2026"        → short shared-year form
// Tolerant of en-dash (U+2013) and ASCII hyphen. Returns
// {startMonthIdx, endMonthIdx} as positions in the MF/MY arrays, or null
// if the span can't be resolved (caller treats null clusters as inactive).
//
// Why this replaces substring matching: the old getActiveClusters did
// c.span.includes(MF[cur]) which silently fails on year wraps (e.g. a
// Nov 2026 cur month never appears literally in "Sep 2026–Feb 2027" so
// that cluster was incorrectly hidden). Parsing once at activation time
// is O(clusters) per render — negligible.
function parseClusterSpan(span) {
  if (!span || typeof span !== 'string') return null;
  const parts = span.replace(/–/g, '-').split('-');
  if (parts.length !== 2) return null;
  const monthRe = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/;
  const yearRe  = /(20\d{2})/;
  const parseHalf = (s) => ({
    month: (monthRe.exec(s) || [])[1] || null,
    year:  (yearRe.exec(s)  || [])[1] ? +(yearRe.exec(s)[1]) : null
  });
  const L = parseHalf(parts[0]);
  const R = parseHalf(parts[1]);
  if (!L.month || !R.month) return null;
  const lYear = (L.year !== null) ? L.year : R.year;
  const rYear = (R.year !== null) ? R.year : L.year;
  if (lYear === null || rYear === null) return null;
  const findIdx = (name, year) => {
    for (let i = 0; i < MF.length; i++) {
      if (MF[i] === name && MY[i] === year) return i;
    }
    return -1;
  };
  const startMonthIdx = findIdx(L.month, lYear);
  const endMonthIdx   = findIdx(R.month, rYear);
  if (startMonthIdx < 0 || endMonthIdx < 0) return null;
  if (endMonthIdx < startMonthIdx) return null;
  return { startMonthIdx, endMonthIdx };
}

function getActiveClusters() {
  // A cluster is "active" when its parsed month range overlaps the
  // current-month + next-two-months window. Window matches the prior
  // behavior; the difference is overlap-vs-substring, which now correctly
  // surfaces clusters that wrap across the year boundary.
  const cur = CURRENT_MONTH_IDX;
  const windowEnd = cur + 2;
  const result = [];
  Object.entries(SYNTOPIC_CLUSTERS).forEach(([tid, clusters]) => {
    const topic = T.find(t => t.id === +tid);
    const color = topic ? topic.color : 'var(--text-muted)';
    clusters.forEach(c => {
      const range = parseClusterSpan(c.span);
      if (!range) return;
      if (range.startMonthIdx <= windowEnd && range.endMonthIdx >= cur) {
        result.push({c, color});
      }
    });
  });
  return result;
}

function renderStreakGrid() {
  const pagesByDay = getPagesByDay(35);
  const today = new Date();
  today.setHours(0,0,0,0);
  let cells = '';
  for (let i = 34; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const k = localDayKey(d);
    const pages = pagesByDay[k] || 0;
    let level = '';
    if (pages > 0) {
      if (pages < 5) level = 'l1';
      else if (pages < 15) level = 'l2';
      else if (pages < 30) level = 'l3';
      else level = 'l4';
    }
    const isToday = i === 0;
    cells += `<div class="streak-cell ${level} ${isToday?'today':''}" title="${k}: ${pages} pp"></div>`;
  }
  return `<div class="streak-grid">${cells}</div>`;
}

// Progress-state color ramp: light gray (early) → deep green (complete).
// Hue fixed at the green family; saturation and lightness interpolate so the
// bar reads as "fading in" toward completion. Replaces the old topic-color
// fill so the bar carries progress signal rather than topic identity (the
// topic color still lives on the card's left border and the timeline).
function progressBarColor(pct) {
  const t = Math.max(0, Math.min(1, (pct || 0) / 100));
  const sat   = 5  + (60 - 5)  * t;
  const light = 80 - (80 - 35) * t;
  return `hsl(140, ${sat.toFixed(1)}%, ${light.toFixed(1)}%)`;
}

function renderBookProgress(bookKey, book) {
  // Defensive guards
  if (!book || !bookKey) return '';
  const totalPages = Math.max(1, book.totalPages || 1);
  const currentPage = Math.max(0, Math.min(totalPages, getCurrentPage(bookKey)));
  const endWeek = getEndWeek(bookKey) || book.endWeek;
  const startWeek = getStartWeek(bookKey) || book.startWeek;

  // Parse weeks safely
  let endIdx, startIdx;
  try {
    const [em,ew] = endWeek.split('-W').map(Number);
    const [sm,sw] = startWeek.split('-W').map(Number);
    if (isNaN(em)||isNaN(ew)||isNaN(sm)||isNaN(sw)) throw new Error('bad week');
    endIdx = em * 4 + ew;
    startIdx = sm * 4 + sw;
  } catch (e) {
    return `<div class="reading-progress">⚠ Invalid scheduling for ${escapeHtml(book.title || bookKey)}</div>`;
  }

  const isComplete = isBookComplete(bookKey);
  const pct = (currentPage / totalPages * 100);
  const remaining = Math.max(0, totalPages - currentPage);

  const curIdx = CURRENT_MONTH_IDX * 4 + CURRENT_WEEK_OF_MONTH;
  const weeksRemaining = Math.max(1, endIdx - curIdx + 1);
  const pagesPerWeek = Math.ceil(remaining / weeksRemaining);

  const totalWeeks = Math.max(1, endIdx - startIdx + 1);
  const weeksElapsed = curIdx - startIdx + 1;
  const expectedPage = Math.round((weeksElapsed / totalWeeks) * totalPages);
  const hasStarted = weeksElapsed >= 1;
  // P3 #11: explicit "past target" state. Without this, weeksRemaining
  // floors to 1 forever and the pace label keeps showing "N PG BEHIND"
  // with the same expected denominator — useful telemetry but invisible
  // to the eye. Surface OVERDUE distinctly so it can't blend in.
  const weeksOverdue = (hasStarted && !isComplete) ? Math.max(0, curIdx - endIdx) : 0;
  const isOverdue = weeksOverdue > 0;

  let paceLabel, paceClass;
  if (isComplete) {
    paceLabel = 'COMPLETE ✓';
    paceClass = 'ahead';
  } else if (!hasStarted) {
    paceLabel = 'UPCOMING';
    paceClass = 'on-track';
  } else if (isOverdue) {
    paceLabel = `OVERDUE · ${weeksOverdue} WK${weeksOverdue === 1 ? '' : 'S'} PAST TARGET`;
    paceClass = 'overdue';
  } else if (currentPage === 0 && weeksElapsed <= 1) {
    paceLabel = 'STARTING';
    paceClass = 'on-track';
  } else if (currentPage >= expectedPage - 5) {
    paceLabel = currentPage > expectedPage + 10 ? 'AHEAD' : 'ON TRACK';
    paceClass = currentPage > expectedPage + 10 ? 'ahead' : 'on-track';
  } else {
    const behind = expectedPage - currentPage;
    paceLabel = `${behind} PG BEHIND`;
    paceClass = 'behind';
  }

  const topicColor = `var(--t${book.topic || 2})`;
  const scheduleLabel = isOverdue
    ? `Past target · ended ${weekLabel(endWeek)}`
    : hasStarted ? `Active · ends ${weekLabel(endWeek)}` : `Starts ${weekLabel(startWeek)}`;

  const goalText = isComplete ? 'Done — pick the next book.'
    : !hasStarted ? `Begins ${weekLabel(startWeek)} (${diffWeeks(curIdx, startIdx)} weeks from now)`
    : isOverdue ? `${remaining} pp left past target — finish ASAP or push the end week`
    : `read ~${pagesPerWeek} pages (${remaining} pp over ${weeksRemaining} weeks)`;

  const priorityNote = book.priorityChapters && book.priorityChapters.length ? `
    <div style="margin-top:8px;padding:8px 10px;background:var(--bg-card);border-radius:4px;border-left:2px solid ${topicColor};">
      <details>
        <summary style="cursor:pointer;font-size:10px;font-family:'DM Mono',monospace;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.06em;">
          Priority cut · ${book.priorityChapters.length} ch · ${book.priorityTotalPages || totalPages} pp${book.skipChapters ? ` · ${book.skipChapters.length} skipped` : ''}
        </summary>
        <div style="margin-top:6px;display:flex;flex-direction:column;gap:3px;">
          ${book.priorityChapters.map(c => `
            <div style="display:flex;justify-content:space-between;gap:8px;font-size:10px;font-family:'DM Mono',monospace;color:var(--text-secondary);">
              <span>Ch.${c.ch} ${escapeHtml(c.name)}</span>
              <span style="color:var(--text-muted);">pp.${escapeHtml(c.pages)} · ${c.count}</span>
            </div>
          `).join('')}
          ${book.secondaryChapters && book.secondaryChapters.length ? `
            <div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);font-size:9px;font-family:'DM Mono',monospace;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.05em;">Optional / deferred</div>
            ${book.secondaryChapters.map(c => `
              <div style="display:flex;justify-content:space-between;gap:8px;font-size:10px;font-family:'DM Mono',monospace;color:var(--text-dim);">
                <span>Ch.${c.ch} ${escapeHtml(c.name)}</span>
                <span>pp.${escapeHtml(c.pages)} · ${c.count}</span>
              </div>
            `).join('')}
          ` : ''}
        </div>
      </details>
    </div>
  ` : '';

  return `
    <div class="reading-progress" style="border-left:3px solid ${topicColor};${isComplete?'opacity:0.7;':''}">
      <div class="rp-head">
        <div>
          <div class="rp-title">${escapeHtml(book.title)}</div>
          <div class="rp-author">${escapeHtml(book.author || '')}${(() => {
            const liveNote = getBookNote(bookKey);
            if (!liveNote) return '';
            const drifted = hasCustomNoteOverride(bookKey) && liveNote !== (book.note || '');
            const driftMark = drifted ? ` <span class="when-drift" title="Default: ${escapeHtml(book.note || '(none)')}">◆</span>` : '';
            return ' · ' + escapeHtml(liveNote) + driftMark;
          })()}</div>
          <div style="font-size:9px;font-family:'DM Mono',monospace;color:var(--text-muted);margin-top:2px;">${scheduleLabel}</div>
        </div>
        <div class="rp-stats">${currentPage} / ${totalPages} pp · ${Math.round(pct)}%</div>
      </div>
      ${(() => {
        // Weekly target overlay: a chunk inside the bar starting at the
        // current % and spanning the next pagesPerWeek's worth of pages.
        // Skip if not started or already complete — nothing to project.
        // For overdue books the chunk legitimately stretches to 100% (the
        // floored weeksRemaining=1 makes pagesPerWeek = all remaining).
        const showTarget = hasStarted && !isComplete && remaining > 0 && pagesPerWeek > 0;
        if (!showTarget) {
          return `<div class="rp-bar"><div class="rp-bar-fill" style="width:${pct}%;background:${progressBarColor(pct)};"></div></div>`;
        }
        const chunkPct = Math.min(100 - pct, (pagesPerWeek / totalPages) * 100);
        const targetTitle = `Weekly target: ${pagesPerWeek} pp (this week's chunk)`;
        return `<div class="rp-bar">
          <div class="rp-bar-fill" style="width:${pct}%;background:${progressBarColor(pct)};"></div>
          <div class="rp-bar-target" style="left:${pct}%;width:${chunkPct.toFixed(2)}%;" title="${targetTitle}"></div>
        </div>`;
      })()}
      <div class="rp-week-goal" title="Weekly target = remaining pages ÷ weeks remaining until target end date. Edit the book to push the end date if pace shifts.">
        <span><strong>This week:</strong> ${goalText}</span>
        <span class="rp-pace ${paceClass}">${paceLabel}</span>
      </div>
      ${priorityNote}
      <div class="rp-actions">
        ${!isComplete ? `<button class="btn btn-small btn-primary" data-modal="log-session" data-book="${bookKey}">+ Log Pages</button>` : ''}
        <button class="btn btn-small" data-modal="edit-book" data-book="${bookKey}">Edit</button>
        ${!isComplete ? `<button class="btn btn-small btn-ghost" data-mark-complete="${bookKey}">Mark Done</button>` : `<button class="btn btn-small btn-ghost" data-mark-incomplete="${bookKey}">Reopen</button>`}
      </div>
    </div>
  `;
}

function weekLabel(wk) {
  if (!wk) return '—';
  try {
    const [m,w] = wk.split('-W').map(Number);
    if (isNaN(m)||isNaN(w)||m<0||m>=MF.length) return wk;
    return `${MF[m]} ${MY[m]} W${w}`;
  } catch { return wk; }
}

function diffWeeks(curIdx, targetIdx) {
  return Math.max(0, targetIdx - curIdx);
}

// Format a tracked book's schedule as a human-readable range, using the live
// (override-aware) accessors. Returns { text, drifted } where `drifted` is
// true iff the user has edited the start or end week away from the data.js
// default. Callers fall back to the hand-written r.when string if this
// returns null (unknown bookKey).
function formatBookSchedule(bookKey) {
  const book = BOOK_PROGRESS[bookKey];
  if (!book) return null;
  const liveStart = getStartWeek(bookKey);
  const liveEnd   = getEndWeek(bookKey);
  if (!liveStart || !liveEnd) return null;
  const drifted = (liveStart !== book.startWeek) || (liveEnd !== book.endWeek);
  const text = (liveStart === liveEnd)
    ? weekLabel(liveStart)
    : `${weekLabel(liveStart)} – ${weekLabel(liveEnd)}`;
  return { text, drifted };
}

// Derive a topic's actual timeframe from the union of (a) its tracked books'
// live start/end weeks and (b) its sub-topics' declared month ranges. Returns
// { text } as a "May 2026 – Dec 2026" style string, or null if neither data
// source has anything to contribute (in which case the caller falls back to
// the hand-written t.tf string).
//
// Why both sources: some topics (e.g. Health) track only one book per quarter
// but have sub-topics spanning many months without books. Books alone would
// understate the span; sub-topic months alone would miss user-edited book
// pushes. Union gives the most honest range.
function getDerivedTopicTimeframe(t) {
  if (!t) return null;
  let minIdx = null, maxIdx = null;
  const updateRange = (sIdx, eIdx) => {
    if (minIdx === null || sIdx < minIdx) minIdx = sIdx;
    if (maxIdx === null || eIdx > maxIdx) maxIdx = eIdx;
  };

  // (a) Books belonging to this topic — use live (override-aware) accessors.
  Object.entries(BOOK_PROGRESS).forEach(([k, b]) => {
    if (!b || b.topic !== t.id) return;
    const sw = getStartWeek(k);
    const ew = getEndWeek(k);
    if (!sw || !ew) return;
    try {
      const [sm, swk] = sw.split('-W').map(Number);
      const [em, ewk] = ew.split('-W').map(Number);
      if ([sm, swk, em, ewk].some(isNaN)) return;
      updateRange(sm * 4 + swk, em * 4 + ewk);
    } catch {}
  });

  // (b) Sub-topic declared month ranges (s.mo). Use month-start (W1) and
  // month-end (W4) for the first/last active month respectively.
  const subs = Array.isArray(t.subs) ? t.subs : [];
  subs.forEach(s => {
    if (!s) return;
    const sMo = Array.isArray(s.mo) ? s.mo : [];
    if (sMo.length === 0) return;
    const firstM = sMo[0];
    const lastM  = sMo[sMo.length - 1];
    if (isNaN(firstM) || isNaN(lastM)) return;
    updateRange(firstM * 4 + 1, lastM * 4 + 4);
  });

  if (minIdx === null || maxIdx === null) return null;
  const startM = Math.floor((minIdx - 1) / 4);
  const endM   = Math.floor((maxIdx - 1) / 4);
  if (startM < 0 || startM >= MF.length || endM < 0 || endM >= MF.length) return null;
  const startLabel = `${MF[startM]} ${MY[startM]}`;
  const endLabel   = `${MF[endM]} ${MY[endM]}`;
  const text = (startM === endM) ? startLabel : `${startLabel} – ${endLabel}`;
  return { text };
}

// Derive the union of declared topic months (t.mo) and months covered by the
// topic's live book schedules. Used by the Active Months mini-calendar on
// topic tabs to surface override-driven schedule drift without losing the
// declared baseline. Months added by the book schedule but absent from t.mo
// are rendered outlined (not filled); declared months keep the solid swatch.
//
// Returns:
//   declared : Set of t.mo month indices
//   fromBooks: Set of month indices covered by live book schedules
//   added    : fromBooks minus declared (the "derived-only" months)
//   drifted  : true when added.size > 0
function getDerivedTopicActiveMonths(t) {
  const declared = new Set(Array.isArray(t && t.mo) ? t.mo : []);
  const fromBooks = (t && t.id) ? getTopicBookActiveMonths(t.id) : new Set();
  const added = new Set();
  fromBooks.forEach(m => { if (!declared.has(m)) added.add(m); });
  return { declared, fromBooks, added, drifted: added.size > 0 };
}

function renderCluster(cluster, color) {
  return `
    <div class="cluster-box" style="border-left:3px solid ${color};">
      <div class="cluster-title" style="color:${color};">${cluster.title}</div>
      <div class="cluster-desc">${cluster.desc} <span style="color:var(--text-dim);">· ${cluster.span}</span></div>
      <div class="cluster-items">
        ${cluster.items.map(i => `
          <div class="cluster-item">
            <span class="cluster-item-title">${i.title}</span>
            <span class="cluster-item-meta">${i.meta}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ── TIMELINE ──
function renderTimeline() {
  const selectedTopics = (S.topicFilter instanceof Set) ? S.topicFilter : null;
  const totalTopics = T.length;
  const selectedCount = selectedTopics ? selectedTopics.size : totalTopics;
  const filterLabel = selectedTopics ? `${selectedCount}/${totalTopics}` : 'All';
  return `
    <div class="controls">
      <div class="control-group"><span class="control-label">Zoom</span><div class="toggle-group">
        <button class="toggle-btn ${S.zoom==='monthly'?'active':''}" data-z="monthly">Month</button>
        <button class="toggle-btn ${S.zoom==='weekly'?'active':''}" data-z="weekly">Week</button>
      </div></div>
      <div class="control-group"><span class="control-label">Focus</span><div class="toggle-group">
        ${["all","1","2","3","4"].map(v=>`<button class="toggle-btn ${S.tier===v?'active':''}" data-f="${v}">${v==='all'?'All':TIER[v]}</button>`).join("")}
      </div></div>
      <div class="control-group"><span class="control-label">Detail</span>
        <div class="toggle-group">
          ${[1,2,3,4,5].map(v=>`<button class="toggle-btn ${S.detail===v?'active':''}" data-detail="${v}" title="${DETAIL_DESC[v]}">${v}</button>`).join("")}
        </div>
        <span class="detail-desc">${DETAIL_DESC[S.detail]}</span>
      </div>
      <div class="control-group"><span class="control-label">Overlay</span><div class="toggle-group">
        <button class="toggle-btn ${S.bookOverlay?'active':''}" data-overlay="books" title="Show live book schedules (from current start/end, reflects edits)">📚 Books</button>
      </div></div>
      <div class="control-group"><span class="control-label">Topics</span>
        <details class="topic-filter" id="topic-filter-details"${S.topicFilterOpen ? ' open' : ''}>
          <summary class="toggle-btn" title="Choose which topics to show in the Gantt">${filterLabel} ▾</summary>
          <div class="topic-filter-menu">
            <div class="topic-filter-actions">
              <button type="button" class="btn btn-small btn-ghost" data-topic-filter-action="all">Select all</button>
              <button type="button" class="btn btn-small btn-ghost" data-topic-filter-action="none">Clear all</button>
            </div>
            ${T.map(t => {
              const isOn = !selectedTopics || selectedTopics.has(t.id);
              return `<label class="topic-filter-row">
                <input type="checkbox" data-topic-filter="${t.id}" ${isOn ? 'checked' : ''}>
                <span class="topic-filter-dot" style="background:${t.color};"></span>
                <span class="topic-filter-id">${t.id}</span>
                <span class="topic-filter-title">${escapeHtml(t.title || '')}</span>
              </label>`;
            }).join('')}
          </div>
        </details>
      </div>
    </div>
    ${gantt()}
  `;
}

function gantt() {
  let fT = S.tier==='all' ? T : T.filter(t=>String(tierOf(t.id))===S.tier);
  // Topic filter (null = all). Layered after the tier filter so the two
  // controls compose: e.g. Focus=Tier 1 + manually deselect a single topic.
  if (S.topicFilter instanceof Set) {
    fT = fT.filter(t => S.topicFilter.has(t.id));
  }
  if (S.zoom === 'weekly') return weeklyGantt(fT);
  return monthlyGantt(fT);
}

function monthlyGantt(fT) {
  try {
    const extraCols = [];
    if (S.detail >= 2) extraCols.push({label:'Sub'});
    if (S.detail >= 3) extraCols.push({label:'Resource'});
    if (S.detail >= 4) extraCols.push({label:'Deliverable'});

    const yrCols = `<th class="yr" colspan="8">2026</th><th class="yr" colspan="6">2027</th>`;
    let yrRow = `<tr><th class="g-label" style="z-index:3;"></th>${extraCols.map(()=>'<th></th>').join('')}${yrCols}</tr>`;
    let hdRow = `<tr><th class="g-label" style="z-index:3;">Topic</th>${extraCols.map(c=>`<th class="g-label">${c.label}</th>`).join('')}`;
    for (let i = 0; i < 14; i++) hdRow += `<th class="g-cell ${i===CURRENT_MONTH_IDX?'g-today':''}">${ML[i]||'?'}</th>`;
    hdRow += '</tr>';

    let bodyRows = '';
    fT.forEach(t => {
      if (!t || !Array.isArray(t.subs) || t.subs.length === 0) return;
      const subs = t.subs;
      const tTitle = escapeHtml(t.title || '');
      const tMo = Array.isArray(t.mo) ? t.mo : [];
      // Topic-scoped live book-schedule coverage (reflects start/end overrides).
      // Null when overlay is off so the cell loop skips the work entirely.
      const bookMonths = S.bookOverlay ? getTopicBookActiveMonths(t.id) : null;

      if (S.detail === 1) {
        let row = `<tr><td class="g-label topic" data-tab="t${t.id}" style="z-index:2;">
          <span style="color:${t.color};margin-right:4px;font-family:'DM Mono',monospace;">${t.id}</span>${tTitle}</td>`;
        for (let m = 0; m < 14; m++) {
          const act = tMo.includes(m);
          const bookHere = bookMonths && bookMonths.has(m);
          const bar = act ? `<div class="g-bar" style="background:${t.color}"></div>` : '';
          const overlay = bookHere ? `<div class="g-bar-book" style="background:${t.color}"></div>` : '';
          row += `<td class="g-cell ${m===CURRENT_MONTH_IDX?'g-today':''}">${bar}${overlay}</td>`;
        }
        bodyRows += row + '</tr>';
      } else if (S.detail <= 4) {
        subs.forEach((s, si) => {
          if (!s) return;
          const sMo = Array.isArray(s.mo) ? s.mo : [];
          bodyRows += '<tr>';
          if (si === 0) {
            bodyRows += `<td class="g-label topic" rowspan="${subs.length}" data-tab="t${t.id}" style="z-index:2;">
              <span style="color:${t.color};margin-right:4px;font-family:'DM Mono',monospace;">${t.id}</span>${tTitle}</td>`;
          }
          bodyRows += `<td class="g-label sub">${escapeHtml(s.l||'')}) ${escapeHtml(s.n||'')}</td>`;
          if (S.detail >= 3) {
            bodyRows += `<td class="g-label sub">${escapeHtml(truncate(getCurrentResource(s), 40))}</td>`;
          }
          if (S.detail >= 4) {
            bodyRows += `<td class="g-label sub">${escapeHtml(truncate(getCurrentDeliverable(s), 35))}</td>`;
          }
          // Topic-scoped overlay shows on the FIRST sub-topic row only — same
          // info repeated on every row of a topic would be visual noise.
          const showOverlayHere = bookMonths && si === 0;
          for (let m = 0; m < 14; m++) {
            const act = sMo.includes(m);
            const bookHere = showOverlayHere && bookMonths.has(m);
            const bar = act ? `<div class="g-bar" style="background:${t.color}"></div>` : '';
            const overlay = bookHere ? `<div class="g-bar-book" style="background:${t.color}"></div>` : '';
            bodyRows += `<td class="g-cell ${m===CURRENT_MONTH_IDX?'g-today':''}">${bar}${overlay}</td>`;
          }
          bodyRows += '</tr>';
        });
      } else {
        // Level 5: sub-topic header rows + individual week rows
        // Compute total rows precisely
        let totalRows = 0;
        subs.forEach(s => {
          if (!s) return;
          const weeks = Array.isArray(s.weeks) ? s.weeks : [];
          totalRows += 1 + weeks.length;
        });
        if (totalRows === 0) return;

        let topicCellAdded = false;
        subs.forEach((s, si) => {
          if (!s) return;
          const sMo = Array.isArray(s.mo) ? s.mo : [];
          const weeks = Array.isArray(s.weeks) ? s.weeks : [];

          // Sub-topic header row
          bodyRows += '<tr>';
          if (!topicCellAdded) {
            bodyRows += `<td class="g-label topic" rowspan="${totalRows}" data-tab="t${t.id}" style="z-index:2;">
              <span style="color:${t.color};margin-right:4px;font-family:'DM Mono',monospace;">${t.id}</span>${tTitle}</td>`;
            topicCellAdded = true;
          }
          bodyRows += `<td class="g-label sub" style="font-weight:600;color:${t.color};">${escapeHtml(s.l||'')}) ${escapeHtml(s.n||'')}</td>`;
          bodyRows += `<td class="g-label sub" style="font-style:italic;font-size:10px;">${escapeHtml(s.f||'')}</td>`;
          const moStart = sMo.length ? (MF[sMo[0]] || '?') : '?';
          const moEnd = sMo.length ? (MF[sMo[sMo.length-1]] || '?') : '?';
          bodyRows += `<td class="g-label sub" style="font-size:9px;font-family:'DM Mono',monospace;color:var(--text-muted);">${moStart} – ${moEnd}</td>`;
          // Show book overlay only on the FIRST sub-topic header row of the topic
          // (si === 0). Per-week rows below skip the overlay — it would just
          // smear a topic-scoped indicator across every individual week.
          const showOverlayHere = bookMonths && si === 0;
          for (let m = 0; m < 14; m++) {
            const act = sMo.includes(m);
            const bookHere = showOverlayHere && bookMonths.has(m);
            const bar = act ? `<div class="g-bar" style="background:${t.color}"></div>` : '';
            const overlay = bookHere ? `<div class="g-bar-book" style="background:${t.color}"></div>` : '';
            bodyRows += `<td class="g-cell ${m===CURRENT_MONTH_IDX?'g-today':''}">${bar}${overlay}</td>`;
          }
          bodyRows += '</tr>';

          // Individual week rows
          weeks.forEach(wk => {
            if (!wk || !wk.wk) return;
            const isCurrent = wk.wk === CURRENT_WEEK_KEY;
            let wkMonth;
            try {
              wkMonth = +wk.wk.split('-W')[0];
              if (isNaN(wkMonth)) wkMonth = -1;
            } catch { wkMonth = -1; }

            bodyRows += `<tr style="${isCurrent ? 'background:rgba(16,185,129,0.05);' : ''}">`;
            bodyRows += `<td class="g-label sub" style="padding-left:28px!important;font-family:'DM Mono',monospace;font-size:9px;color:${isCurrent?'var(--accent-good)':'var(--text-dim)'};">${escapeHtml(wk.w||'')}${isCurrent ? ' ◀' : ''}</td>`;
            bodyRows += `<td class="g-label sub" style="font-size:10px;">${escapeHtml(truncate(wk.res||'', 40))}</td>`;
            bodyRows += `<td class="g-label sub" style="font-size:10px;">${escapeHtml(truncate(wk.del||'', 35))}</td>`;
            for (let m = 0; m < 14; m++) {
              const act = m === wkMonth;
              bodyRows += `<td class="g-cell ${m===CURRENT_MONTH_IDX?'g-today':''}">${act?`<div class="g-bar" style="background:${t.color};height:6px;opacity:0.5;"></div>`:''}</td>`;
            }
            bodyRows += '</tr>';
          });
        });
      }
    });

    return `<div class="gantt-wrap"><table class="gantt"><thead>${yrRow}${hdRow}</thead><tbody>${bodyRows}</tbody></table></div>`;
  } catch (e) {
    console.error('monthlyGantt error:', e);
    return `<div style="padding:16px;color:var(--accent-bad);font-family:monospace;font-size:11px;">Timeline render error at detail level ${S.detail}: ${escapeHtml(e.message)}. <button class="btn btn-small" onclick="S.detail=Math.max(1,S.detail-1);render()">Reduce Detail</button></div>`;
  }
}

function weeklyGantt(fT) {
  try {
    // P2 #2.5: dynamic month window instead of a hardcoded 6-month cap. Span
    // from curriculum start (month 0) through the last month with content for
    // the filtered topics — declared t.mo / sub-topic mo, plus live book
    // schedules when the overlay is on (this is what surfaces rebalanced ends
    // pushed past Oct 2026, which the old m<6 cap silently clipped). Floor of
    // 5 keeps the original ≥6-month width; ceiling 13 is the domain end.
    let maxM = 5;
    const bumpMax = m => { if (Number.isInteger(m) && m > maxM) maxM = m; };
    fT.forEach(t => {
      if (!t) return;
      (Array.isArray(t.mo) ? t.mo : []).forEach(bumpMax);
      (Array.isArray(t.subs) ? t.subs : []).forEach(s => (Array.isArray(s && s.mo) ? s.mo : []).forEach(bumpMax));
      if (S.bookOverlay) getTopicBookActiveWeekKeys(t.id).forEach(wk => bumpMax(+wk.split('-W')[0]));
    });
    maxM = Math.min(13, Math.max(5, maxM));
    let weeks = [];
    for (let m = 0; m <= maxM; m++) for (let w = 1; w <= 4; w++) weeks.push({m, w});

    const extraCols = [];
    if (S.detail >= 2) extraCols.push('Sub');
    if (S.detail >= 3) extraCols.push('Resource');
    if (S.detail >= 4) extraCols.push('Deliverable');

    let monthCounts = {};
    weeks.forEach(w => { monthCounts[w.m] = (monthCounts[w.m] || 0) + 1; });

    let mRow = `<tr><th class="g-label" style="z-index:3;"></th>${extraCols.map(()=>'<th></th>').join('')}`;
    Object.keys(monthCounts).forEach(m => {
      mRow += `<th class="yr" colspan="${monthCounts[m]}">${MF[m]||'?'} ${MY[m]||''}</th>`;
    });
    mRow += '</tr>';

    let wRow = `<tr><th class="g-label" style="z-index:3;">Topic</th>${extraCols.map(c=>`<th class="g-label">${c}</th>`).join('')}`;
    weeks.forEach(w => {
      const isCur = w.m === CURRENT_MONTH_IDX && w.w === CURRENT_WEEK_OF_MONTH;
      wRow += `<th class="g-cell ${isCur?'g-today':''}" style="min-width:24px;font-size:8px;">W${w.w}</th>`;
    });
    wRow += '</tr>';

    let bodyRows = '';
    fT.forEach(t => {
      if (!t || !Array.isArray(t.subs) || t.subs.length === 0) return;
      const tTitle = escapeHtml(t.title || '');
      const tMo = Array.isArray(t.mo) ? t.mo : [];
      // Topic-scoped live book-schedule coverage at week granularity. Reflects
      // any user-edited start/end overrides.
      const bookWeeks = S.bookOverlay ? getTopicBookActiveWeekKeys(t.id) : null;

      if (S.detail === 1) {
        bodyRows += `<tr><td class="g-label topic" data-tab="t${t.id}" style="z-index:2;"><span style="color:${t.color};margin-right:4px;font-family:'DM Mono',monospace;">${t.id}</span>${tTitle}</td>`;
        weeks.forEach(w => {
          const act = tMo.includes(w.m);
          const isCur = w.m === CURRENT_MONTH_IDX && w.w === CURRENT_WEEK_OF_MONTH;
          const wkK = weekKey(w.m, w.w);
          const bookHere = bookWeeks && bookWeeks.has(wkK);
          const bar = act ? `<div class="g-bar" style="background:${t.color};height:10px;"></div>` : '';
          const overlay = bookHere ? `<div class="g-bar-book" style="background:${t.color}"></div>` : '';
          bodyRows += `<td class="g-cell ${isCur?'g-today':''}">${bar}${overlay}</td>`;
        });
        bodyRows += '</tr>';
      } else {
        t.subs.forEach((s, si) => {
          if (!s) return;
          const sMo = Array.isArray(s.mo) ? s.mo : [];
          const sWeeks = Array.isArray(s.weeks) ? s.weeks : [];
          bodyRows += '<tr>';
          if (si === 0) {
            bodyRows += `<td class="g-label topic" rowspan="${t.subs.length}" data-tab="t${t.id}" style="z-index:2;"><span style="color:${t.color};margin-right:4px;font-family:'DM Mono',monospace;">${t.id}</span>${tTitle}</td>`;
          }
          bodyRows += `<td class="g-label sub">${escapeHtml(s.l||'')}) ${escapeHtml(s.n||'')}</td>`;
          if (S.detail >= 3) bodyRows += `<td class="g-label sub">${escapeHtml(truncate(getCurrentResource(s), 40))}</td>`;
          if (S.detail >= 4) bodyRows += `<td class="g-label sub">${escapeHtml(truncate(getCurrentDeliverable(s), 35))}</td>`;
          // Overlay on first sub-row only (topic-scoped info, avoid repetition).
          const showOverlayHere = bookWeeks && si === 0;
          weeks.forEach(w => {
            const act = sMo.includes(w.m);
            const wkK = weekKey(w.m, w.w);
            const isThisWk = sWeeks.some(x => x && x.wk === wkK);
            const isCur = w.m === CURRENT_MONTH_IDX && w.w === CURRENT_WEEK_OF_MONTH;
            const bookHere = showOverlayHere && bookWeeks.has(wkK);
            const bar = act ? `<div class="g-bar" style="background:${t.color};height:${isThisWk?12:8}px;opacity:${isThisWk?0.9:0.4};"></div>` : '';
            const overlay = bookHere ? `<div class="g-bar-book" style="background:${t.color}"></div>` : '';
            bodyRows += `<td class="g-cell ${isCur?'g-today':''}">${bar}${overlay}</td>`;
          });
          bodyRows += '</tr>';
        });
      }
    });

    return `<div class="gantt-wrap"><table class="gantt"><thead>${mRow}${wRow}</thead><tbody>${bodyRows}</tbody></table></div>`;
  } catch (e) {
    console.error('weeklyGantt error:', e);
    return `<div style="padding:16px;color:var(--accent-bad);font-family:monospace;font-size:11px;">Weekly view error: ${escapeHtml(e.message)}. <button class="btn btn-small" onclick="S.zoom='monthly';render()">Switch to Month View</button></div>`;
  }
}

function getCurrentResource(sub) {
  if (!sub) return '—';
  const weeks = Array.isArray(sub.weeks) ? sub.weeks : [];
  const cw = weeks.find(w => w && w.wk === CURRENT_WEEK_KEY);
  if (cw) return cw.res || '—';
  const cm = weeks.find(w => w && typeof w.wk === 'string' && w.wk.startsWith(CURRENT_MONTH_IDX + '-'));
  if (cm) return cm.res || '—';
  return (weeks[0] && weeks[0].res) ? weeks[0].res : '—';
}

function getCurrentDeliverable(sub) {
  if (!sub) return '—';
  const weeks = Array.isArray(sub.weeks) ? sub.weeks : [];
  const cw = weeks.find(w => w && w.wk === CURRENT_WEEK_KEY);
  if (cw) return cw.del || '—';
  const cm = weeks.find(w => w && typeof w.wk === 'string' && w.wk.startsWith(CURRENT_MONTH_IDX + '-'));
  if (cm) return cm.del || '—';
  return (weeks[0] && weeks[0].del) ? weeks[0].del : '—';
}

function truncate(s, n) {
  if (s === null || s === undefined) return '';
  const str = String(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

// ── TOPIC PANEL ──
function renderTopicPanel(t) {
  try {
    if (!t || !t.id) return `<div style="padding:20px;color:var(--accent-bad);">Topic not found.</div>`;
    const clusters = SYNTOPIC_CLUSTERS[t.id];
    const subs = Array.isArray(t.subs) ? t.subs : [];
    const readings = Array.isArray(t.readings) ? t.readings : [];

    // Derived "Timeframe" — computed from live book schedules + sub-topic mo
    // ranges. Fall back to hand-written t.tf if nothing to derive.
    const derivedTf  = getDerivedTopicTimeframe(t);
    const tfText     = derivedTf ? derivedTf.text : (t.tf || '');
    const tfTooltip  = (derivedTf && t.tf && derivedTf.text !== t.tf)
      ? ` title="Declared: ${escapeHtml(t.tf)}"` : '';

    // Derived Active Months — declared t.mo months render filled with the
    // topic color; months added by the live book schedule render outlined
    // (transparent bg, inset 1px topic-color rim) so the user can see drift.
    const dam = getDerivedTopicActiveMonths(t);
    const moDriftMark = dam.drifted
      ? `<span class="when-drift" title="Book schedule covers months beyond declared t.mo">◆</span>`
      : '';

    return `
      <div class="topic-head">
        <div class="topic-num" style="color:${t.color};">${t.id}</div>
        <div class="topic-meta">
          <h2>${escapeHtml(t.title || '')}</h2>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:1px;">${escapeHtml(t.scope || '')}</div>
          <div class="badges">
            <span class="badge" style="background:${t.bg};color:${t.color};border:1px solid ${t.color}33;">${TIER[tierOf(t.id)] || ''}</span>
            <span class="badge" style="background:var(--bg-card);color:var(--text-secondary);border:1px solid var(--border);">${escapeHtml(t.burn || '')}</span>
          </div>
        </div>
      </div>

      <div class="info-grid">
        <div class="info-box"><div class="lb">Timeframe</div><div class="vl"${tfTooltip}>${escapeHtml(tfText)}</div></div>
        <div class="info-box"><div class="lb">Active Months ${moDriftMark}</div><div class="vl" style="display:flex;gap:2px;flex-wrap:wrap;">
          ${ML.map((m,i)=>{
            const curOutline = (i === CURRENT_MONTH_IDX) ? 'outline:1px solid var(--accent-good);' : '';
            let bg, fg, extra = '', title = '';
            if (dam.declared.has(i)) {
              bg = t.color; fg = '#fff';
            } else if (dam.added.has(i)) {
              bg = 'transparent'; fg = t.color;
              extra = `box-shadow:inset 0 0 0 1px ${t.color}99;`;
              title = ' title="Added by live book schedule"';
            } else {
              bg = 'var(--bg-card)'; fg = 'var(--text-dim)';
            }
            return `<span${title} style="display:inline-block;width:20px;height:20px;line-height:20px;text-align:center;border-radius:2px;font-size:9px;font-family:'DM Mono',monospace;background:${bg};color:${fg};${extra}${curOutline}">${m||'?'}</span>`;
          }).join("")}
        </div></div>
      </div>

      ${clusters && clusters.length ? `
        <div class="sec-title" style="color:${t.color}">Syntopic Reading Clusters</div>
        ${clusters.map(c => renderCluster(c, t.color)).join('')}
      ` : ''}

      <div class="sec-title" style="color:${t.color}">Sub-Topics & Timeline</div>
      ${subs.map(s=>{
        if (!s) return '';
        const sMo = Array.isArray(s.mo) ? s.mo : [];
        const startMo = sMo.length ? (MF[sMo[0]] || '?') : '?';
        const startYr = sMo.length ? (MY[sMo[0]] || '') : '';
        const endMo = sMo.length > 1 ? (MF[sMo[sMo.length-1]] || '?') : '';
        const endYr = sMo.length > 1 ? (MY[sMo[sMo.length-1]] || '') : '';
        return `
        <div class="sub-item" style="border-left-color:${t.color};">
          <div class="sub-letter" style="color:${t.color};">${escapeHtml(s.l || '')}</div>
          <div style="flex:1;">
            <div class="sub-name">${escapeHtml(s.n || '')}</div>
            <div class="sub-focus">${escapeHtml(s.f || '')}</div>
            <div class="sub-timing">${startMo} ${startYr}${sMo.length>1?' – '+endMo+' '+endYr:''}</div>
          </div>
        </div>
      `;}).join("")}

      ${readings.some(r => r.progressKey) ? `
        <div class="sec-title" style="color:${t.color}">Reading Progress</div>
        ${readings.filter(r => r.progressKey && BOOK_PROGRESS[r.progressKey]).map(r => renderBookProgress(r.progressKey, BOOK_PROGRESS[r.progressKey])).join('')}
      ` : ''}

      <div class="sec-title" style="color:${t.color}">Study Plan</div>
      <div class="plan-wrap">
      <table class="plan-table">
        <thead><tr><th style="width:36px;">✓</th><th style="width:90px;">When</th><th style="width:50px;">Sub</th><th>Focus</th><th>Resource</th><th style="width:80px;">Pages</th><th>Deliverable</th></tr></thead>
        <tbody>
          ${subs.map(s=>{
            if (!s) return '';
            const weeks = Array.isArray(s.weeks) ? s.weeks : [];
            return weeks.map(w=>{
              if (!w) return '';
              const done = isDeliverableDone(t.id, s.l, w.wk);
              return `
              <tr class="${w.wk === CURRENT_WEEK_KEY ? 'current-week' : ''}" style="${done?'opacity:0.55;':''}">
                <td style="text-align:center;"><input type="checkbox" ${done?'checked':''} data-deliverable="${t.id}|${escapeHtml(s.l||'')}|${escapeHtml(w.wk||'')}" style="accent-color:var(--accent-good);cursor:pointer;"></td>
                <td class="plan-week">${escapeHtml(w.w||'')}${w.wk === CURRENT_WEEK_KEY ? ' ◀' : ''}</td>
                <td><span class="plan-sub" style="background:${t.bg};color:${t.color};">${escapeHtml(s.l||'')}</span></td>
                <td class="plan-focus" style="${done?'text-decoration:line-through;':''}">${escapeHtml(w.focus||'')}</td>
                <td class="plan-resource">${escapeHtml(w.res||'')}</td>
                <td class="plan-pages">${escapeHtml(w.pages || '—')}</td>
                <td class="plan-deliverable">${escapeHtml(w.del||'')}</td>
              </tr>
            `;}).join("");
          }).join("")}
        </tbody>
      </table>
      </div>

      <div class="sec-title" style="color:${t.color}">Reading List</div>
      <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:6px;overflow:hidden;">
        ${readings.map((r,i) => {
          // Tracked books: derive the "when" range from the live (override-aware)
          // accessors so it reflects any user edits. Untracked entries
          // (papers, case studies, etc.) keep their hand-written r.when.
          const sched     = r.progressKey ? formatBookSchedule(r.progressKey) : null;
          const whenText  = sched ? sched.text : (r.when || '');
          const drifted   = !!(sched && sched.drifted);
          // Tooltip preserves the original r.when which often carries annotations
          // (e.g., "priority ch. 1,3,4,5 + ch.8 skim") that the derived range loses.
          const tooltip   = (sched && r.when) ? `Original: ${r.when}` : '';
          const tooltipAttr = tooltip ? ` title="${escapeHtml(tooltip)}"` : '';
          const driftBadge = drifted
            ? ' <span class="when-drift" title="Live schedule differs from data.js default">◆</span>'
            : '';
          return `
            <div style="display:flex;gap:12px;padding:10px 14px;border-bottom:1px solid var(--border);align-items:flex-start;">
              <div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-muted);min-width:20px;padding-top:2px;">${i+1}</div>
              <div style="flex:1;"><div style="font-weight:500;font-size:13px;">${escapeHtml(r.t||'')}</div><div style="font-size:12px;color:var(--text-secondary);">${escapeHtml(r.a||'')}</div></div>
              <div style="text-align:right;">
                <div style="font-size:10px;font-family:'DM Mono',monospace;color:var(--text-muted);padding:2px 6px;background:var(--bg-card);border-radius:3px;">${escapeHtml(r.type||'')}</div>
                <div style="font-size:9px;color:var(--text-dim);font-family:'DM Mono',monospace;margin-top:2px;"${tooltipAttr}>${escapeHtml(whenText)}${driftBadge}</div>
              </div>
            </div>
          `;
        }).join("")}
      </div>

      <div class="sec-title" style="color:${t.color}">Practice Method</div>
      <div class="practice-box" style="border-color:${t.color}33;"><p>${escapeHtml(t.practice || '')}</p></div>

      ${t.notes?`<div class="notes-box" style="border-left-color:${t.color};"><p>${escapeHtml(t.notes)}</p></div>`:''}
    `;
  } catch (e) {
    console.error('renderTopicPanel error:', e);
    return `<div style="padding:20px;color:var(--accent-bad);font-family:monospace;">Topic panel error: ${escapeHtml(e.message)}</div>`;
  }
}

// ── LOG TAB ──
function renderLog() {
  const sessions = [...P.sessions].sort((a,b) => b.ts - a.ts);
  const totalPages = sessions.reduce((s,x) => s + (x.pagesRead || 0), 0);
  const totalMin = sessions.reduce((s,x) => s + (x.durationMin || 0), 0);

  return `
    <div class="sec-title">Session Log</div>
    <div class="stats-strip">
      <div class="stat-card">
        <div class="stat-label">All-Time Pages</div>
        <div class="stat-value">${totalPages}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">All-Time Minutes</div>
        <div class="stat-value">${totalMin}</div>
        <div class="stat-sub">${Math.round(totalMin/60*10)/10} hours</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Sessions</div>
        <div class="stat-value">${sessions.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Current Streak</div>
        <div class="stat-value">${getStreakDays()}<span style="font-size:12px;color:var(--text-muted);font-weight:400;"> d</span></div>
      </div>
    </div>

    <div class="action-bar">
      <span class="action-bar-label">Sessions</span>
      <button class="btn btn-primary btn-small" data-modal="log-session">+ New Session</button>
    </div>

    ${sessions.length === 0 ? `
      <div style="padding:30px;text-align:center;color:var(--text-muted);font-size:13px;border:1px dashed var(--border);border-radius:6px;">
        No sessions logged yet. Click "+ Log Session" to track your first study block.
      </div>
    ` : sessions.map((s, idx) => {
      const date = new Date(s.ts);
      const book = BOOK_PROGRESS[s.bookKey];
      return `
        <div class="log-entry">
          <div class="log-entry-head">
            <div>
              <div class="log-entry-book">${book ? book.title : (s.bookKey || 'General study')}</div>
              <div class="log-entry-meta">${date.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})} · ${date.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})} · ${s.pagesRead || 0} pp · ${s.durationMin || 0} min</div>
            </div>
            <button class="btn btn-small btn-ghost btn-danger" data-delete-session="${P.sessions.indexOf(s)}" title="Delete session">×</button>
          </div>
          ${s.notes ? `<div class="log-entry-notes">${escapeHtml(s.notes)}</div>` : ''}
        </div>
      `;
    }).join('')}

    <div class="sec-title" style="margin-top:24px;">Leverage Log</div>
    <div class="action-bar">
      <span class="action-bar-label">Daily Insights</span>
      <button class="btn btn-primary btn-small" data-modal="leverage">+ New Entry</button>
    </div>
    ${P.leverageLog.length === 0 ? `
      <div style="padding:30px;text-align:center;color:var(--text-muted);font-size:13px;border:1px dashed var(--border);border-radius:6px;">
        No leverage notes yet. Capture one transferable principle per day.
      </div>
    ` : P.leverageLog.map((l, idx) => `
      <div class="leverage-entry">
        <div class="leverage-date">${l.date}</div>
        <div class="leverage-text">${escapeHtml(l.text)}</div>
      </div>
    `).join('')}

    <div class="sec-title" style="margin-top:24px;">Schedule Changes</div>
    <div class="action-bar">
      <span class="action-bar-label">Override Audit Trail</span>
      <span style="font-size:11px;color:var(--text-muted);">${P.scheduleLog.length} ${P.scheduleLog.length === 1 ? 'entry' : 'entries'}</span>
    </div>
    ${P.scheduleLog.length === 0 ? `
      <div style="padding:30px;text-align:center;color:var(--text-muted);font-size:13px;border:1px dashed var(--border);border-radius:6px;">
        No schedule overrides yet. Edit a book's start or end week to begin tracking drift.
      </div>
    ` : P.scheduleLog.map(e => {
      const d = new Date(e.ts);
      const book = BOOK_PROGRESS[e.bookKey];
      const title = book ? book.title : (e.bookKey || '?');
      const fieldLabel = e.field === 'startWeek' ? 'Start' : (e.field === 'endWeek' ? 'End' : e.field);
      // P1 #1.6: provenance chip — automated writes are visually distinct
      // from manual edits, so the audit trail keeps its chronic-slip signal.
      const sourceChip = e.source === 'autobalance' ? '<span class="auto-chip">⚖ auto</span>'
        : e.source === 'autobalance-undo' ? '<span class="auto-chip">⚖ undo</span>' : '';
      return `
        <div class="log-entry">
          <div class="log-entry-head">
            <div>
              <div class="log-entry-book">${escapeHtml(title)} · ${fieldLabel}${sourceChip}</div>
              <div class="log-entry-meta">${d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})} · ${d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})} · ${escapeHtml(weekLabel(e.from))} → ${escapeHtml(weekLabel(e.to))}</div>
            </div>
          </div>
        </div>
      `;
    }).join('')}
  `;
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ── MODAL ──
function renderModal() {
  if (!modalState) return '';
  try {
    const type = modalState.type;
    let body = '';
    let title = '';
    let footer = '';

  if (type === 'log-session') {
    title = 'Log Study Session';
    const preselectBook = modalState.context?.book || '';
    const activeBooks = Object.entries(BOOK_PROGRESS).filter(([k]) => !isBookComplete(k));
    // Default to viewing date, but clamp to today (can't log future sessions)
    const viewIso = getViewingIso();
    const defaultDate = viewIso > todayIso() ? todayIso() : viewIso;
    const dateHelp = defaultDate === todayIso()
      ? 'Today (override to backdate)'
      : 'Backdated from header';
    body = `
      <div class="form-group">
        <label class="form-label">Book / Resource</label>
        <select class="form-select" id="session-book">
          <option value="">— General / Notes only —</option>
          ${activeBooks.map(([k,b]) => `<option value="${k}" ${k===preselectBook?'selected':''}>${b.title} (p.${getCurrentPage(k)+1} / ${b.totalPages})</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Date</label>
          <input type="date" class="form-input" id="session-date" value="${defaultDate}" max="${todayIso()}">
          <div class="form-help">${dateHelp}</div>
        </div>
        <div class="form-group">
          <label class="form-label">Duration (min)</label>
          <input type="number" class="form-input" id="session-duration" min="0" placeholder="${timerState.elapsedSec ? Math.round(timerState.elapsedSec/60) : ''}">
          ${timerState.elapsedSec ? `<div class="form-help">Pre-filled from timer (${Math.round(timerState.elapsedSec/60)} min)</div>` : '<div class="form-help">Optional</div>'}
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Pages Read</label>
        <input type="number" class="form-input" id="session-pages" min="0" placeholder="0">
        <div class="form-help">Adds to current progress</div>
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea class="form-textarea" id="session-notes" placeholder="Key insight, what to revisit, atomic note seed..."></textarea>
      </div>
    `;
    footer = `
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="save-session">Save Session</button>
    `;
  } else if (type === 'roll') {
    title = '🎲 Activity Roll';
    // Cache the roll in modal context so re-render doesn't re-pick on every keystroke
    if (!modalState.context || !modalState.context.rolled) {
      modalState.context = { ...modalState.context, rolled: suggestRandomActivity() };
    }
    const rolled = modalState.context.rolled;
    if (!rolled) {
      body = `
        <div style="padding:30px 20px;text-align:center;color:var(--text-muted);">
          No active books to roll for right now. Check the Timeline tab or add books via <code style="font-family:'DM Mono',monospace;background:var(--bg-card);padding:2px 6px;border-radius:3px;">data.js</code>.
        </div>
      `;
      footer = `<button class="btn" onclick="closeModal()">Close</button>`;
    } else {
      const topic = T.find(t => t.id === rolled.book.topic);
      const topicColor = topic ? topic.color : 'var(--text-secondary)';
      body = `
        <div class="roll-pick" style="border-left:3px solid ${topicColor};">
          <div class="roll-pick-eyebrow">The dice picked</div>
          <div class="roll-pick-title">${escapeHtml(rolled.book.title)}</div>
          <div class="roll-pick-meta">
            <span style="color:${topicColor};">#${rolled.book.topic} · ${escapeHtml(topic ? topic.title : '')}</span>
            · Continue from <strong>p.${getCurrentPage(rolled.key) + 1}</strong>
          </div>
        </div>
        <div class="roll-reasons">
          <div class="roll-reasons-label">Why this one</div>
          <ul>
            ${rolled.reasons.slice(0, 4).map(r => `<li>${escapeHtml(r)}</li>`).join('') || '<li>Stochastic pick from your active books</li>'}
          </ul>
        </div>
        <div style="text-align:center;margin:10px 0 14px;">
          <button class="btn btn-small" id="roll-again">🎲 Re-roll</button>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:14px;">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Pages Read</label>
              <input type="number" class="form-input" id="roll-pages" min="0" placeholder="0">
              <div class="form-help">Target: ${rolled.weeklyTarget} pp/wk</div>
            </div>
            <div class="form-group">
              <label class="form-label">Duration (min)</label>
              <input type="number" class="form-input" id="roll-duration" min="0" placeholder="${timerState.elapsedSec ? Math.round(timerState.elapsedSec/60) : ''}">
              ${timerState.elapsedSec ? `<div class="form-help">From timer (${Math.round(timerState.elapsedSec/60)} min)</div>` : '<div class="form-help">Optional</div>'}
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Notes</label>
            <textarea class="form-textarea" id="roll-notes" placeholder="Key insight, what to revisit, atomic note seed..."></textarea>
          </div>
        </div>
      `;
      footer = `
        <button class="btn" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="roll-save" data-book="${rolled.key}">Save Session</button>
      `;
    }
  } else if (type === 'leverage') {
    title = 'Leverage Log Entry';
    body = `
      <div class="form-group">
        <label class="form-label">Today's Insight</label>
        <textarea class="form-textarea" id="leverage-text" placeholder="One transferable principle from today's work..." autofocus></textarea>
        <div class="form-help">What's the principle? How does it generalize?</div>
      </div>
    `;
    footer = `
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="save-leverage">Save Entry</button>
    `;
  } else if (type === 'edit-book') {
    const k = modalState.context && modalState.context.book;
    const book = k && BOOK_PROGRESS[k];
    if (!book) {
      title = 'Edit Book';
      body = `<div style="padding:20px;color:var(--accent-bad);font-size:12px;">Book not found.</div>`;
      footer = `<button class="btn" onclick="closeModal()">Close</button>`;
    } else {
      const cur = getCurrentPage(k);
      const startWeek = getStartWeek(k);
      const endWeek = getEndWeek(k);
      const liveNote = getBookNote(k);
      const defaultNote = book.note || '';
      const startOverridden = startWeek !== book.startWeek;
      const endOverridden = endWeek !== book.endWeek;
      const noteOverridden = hasCustomNoteOverride(k);
      const anyOverride = startOverridden || endOverridden || noteOverridden;
      title = `Edit: ${escapeHtml(book.title)}`;
      body = `
        <div class="form-group">
          <label class="form-label">Current Page</label>
          <input type="number" class="form-input" id="edit-page" value="${cur}" min="0" max="${book.totalPages}">
          <div class="form-help">of ${book.totalPages}</div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Target Start Week</label>
            <select class="form-select" id="edit-start">
              ${generateWeekOptions(startWeek)}
            </select>
            <div class="form-help">${startOverridden ? 'Overridden' : 'Default'}</div>
          </div>
          <div class="form-group">
            <label class="form-label">Target End Week</label>
            <select class="form-select" id="edit-end">
              ${generateWeekOptions(endWeek)}
            </select>
            <div class="form-help">${endOverridden ? 'Overridden' : 'Default'}</div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Note</label>
          <textarea class="form-textarea" id="edit-note" rows="2" maxlength="240" placeholder="Optional · e.g. 'pushed from Jul W1 to relieve July peak'">${escapeHtml(liveNote)}</textarea>
          <div class="form-help">${noteOverridden ? 'Overridden' : 'Default'} · shown on the Reading List row</div>
        </div>
        <div style="font-size:11px;color:var(--text-muted);padding:8px 12px;background:var(--bg-card);border-radius:4px;margin-top:8px;font-family:'DM Mono',monospace;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <div>
            <div>Start default: ${escapeHtml(book.startWeek)}${startOverridden ? ` → <span style="color:var(--accent-warn);">${escapeHtml(startWeek)}</span>` : ''}</div>
            <div>End default: ${escapeHtml(book.endWeek)}${endOverridden ? ` → <span style="color:var(--accent-warn);">${escapeHtml(endWeek)}</span>` : ''}</div>
            ${noteOverridden ? `<div>Note default: ${escapeHtml(defaultNote || '(none)')} → <span style="color:var(--accent-warn);">${escapeHtml(liveNote || '(empty)')}</span></div>` : ''}
          </div>
          ${anyOverride ? `<button type="button" class="btn btn-small btn-ghost" id="edit-reset" data-book="${k}" title="Clear start, end, and note overrides">↺ Reset to default</button>` : ''}
        </div>
      `;
      footer = `
        <button class="btn" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="save-edit" data-book="${k}">Save</button>
      `;
    }
  } else if (type === 'timer') {
    title = 'Session Timer';
    body = `
      <div id="timer-display" class="timer-display ${timerState.running ? (timerState.paused ? 'paused' : 'running') : ''}">
        00:00:00
      </div>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:12px;">
        ${!timerState.running ?
          `<button class="btn btn-primary" id="timer-start">▶ Start</button>` :
          `<button class="btn" id="timer-pause">${timerState.paused ? '▶ Resume' : '⏸ Pause'}</button>`
        }
        <button class="btn" id="timer-reset">Reset</button>
        <button class="btn btn-primary" id="timer-log">Log as Session</button>
      </div>
      <div style="font-size:11px;color:var(--text-muted);text-align:center;margin-top:12px;font-style:italic;">
        Timer keeps running when modal closes. Reopen any time to log.
      </div>
    `;
    footer = `<button class="btn" onclick="closeModal()">Close</button>`;
  } else if (type === 'data') {
    title = 'Data Management';
    body = `
      <div class="form-group">
        <label class="form-label">Export</label>
        <button class="btn" id="data-export" style="width:100%;">Download State as JSON</button>
        <div class="form-help">Save for Obsidian vault integration or backup</div>
      </div>
      <div class="form-group">
        <label class="form-label">Import</label>
        <input type="file" class="form-input" id="data-import" accept="application/json" style="padding:6px;">
        <div class="form-help">Restore from a previous export</div>
      </div>
      <div class="form-group" style="margin-top:20px;padding-top:14px;border-top:1px solid var(--border);">
        <label class="form-label" style="color:var(--accent-bad);">Danger Zone</label>
        <button class="btn btn-danger" id="data-reset" style="width:100%;">Reset All Progress</button>
        <div class="form-help">Erases all sessions, page progress, leverage entries, and completion marks. Cannot be undone.</div>
      </div>
      <div style="font-size:10px;color:var(--text-muted);font-family:'DM Mono',monospace;margin-top:14px;padding:10px;background:var(--bg-card);border-radius:4px;">
        Sessions: ${P.sessions.length} · Pages logged: ${P.sessions.reduce((s,x)=>s+(x.pagesRead||0),0)} · Books complete: ${Object.keys(P.bookCompleted).length} · Leverage notes: ${P.leverageLog.length}
      </div>
    `;
    footer = `<button class="btn" onclick="closeModal()">Close</button>`;
  } else if (type === 'sync') {
    title = 'GitHub Sync';
    const connected = syncEnabled();
    const lastPushLabel = P.sync.lastPushAt ? new Date(P.sync.lastPushAt).toLocaleString() : '—';
    const lastPullLabel = P.sync.lastPullAt ? new Date(P.sync.lastPullAt).toLocaleString() : '—';
    body = connected ? `
      <div style="padding:10px 12px;background:var(--bg-card);border-radius:5px;border-left:3px solid var(--accent-good);margin-bottom:14px;">
        <div style="font-size:11px;font-family:'DM Mono',monospace;color:var(--accent-good);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Connected</div>
        <div style="font-size:12px;">Gist ID: <code style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-secondary);">${escapeHtml(P.sync.gistId || '(creating…)')}</code></div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px;font-family:'DM Mono',monospace;">
          Last push: ${lastPushLabel}<br>
          Last pull: ${lastPullLabel}<br>
          Status: ${P.sync.status}${P.sync.lastError ? ' — ' + escapeHtml(P.sync.lastError) : ''}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-primary" id="sync-push" style="flex:1;">↑ Push Now</button>
        <button class="btn" id="sync-pull" style="flex:1;">↓ Pull Now</button>
      </div>
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);">
        <button class="btn btn-danger" id="sync-disconnect" style="width:100%;">Disconnect</button>
        <div class="form-help">Removes the token from this device only. Your gist stays in your GitHub account.</div>
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:12px;font-style:italic;line-height:1.5;">
        Auto-sync pushes 2 seconds after any change. To sync to another device, paste the same token there.
      </div>
    ` : `
      <div style="font-size:12px;line-height:1.5;color:var(--text-secondary);margin-bottom:14px;">
        Sync your progress and draft resources across devices via a private GitHub Gist. Create a Personal Access Token with <strong>only</strong> the <code style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-primary);background:var(--bg-card);padding:1px 4px;border-radius:2px;">gist</code> scope:
      </div>
      <a href="https://github.com/settings/tokens/new?description=Curriculum%20Dashboard&scopes=gist" target="_blank" class="btn btn-primary" style="display:block;text-align:center;text-decoration:none;margin-bottom:14px;">→ Create PAT on GitHub</a>
      <div class="form-group">
        <label class="form-label">Paste Token</label>
        <input type="password" class="form-input" id="sync-token-input" placeholder="ghp_..." autocomplete="off" style="font-family:'DM Mono',monospace;">
        <div class="form-help">Stored in localStorage on this device. Has gist scope only — cannot access repos or account settings.</div>
      </div>
      ${P.sync.lastError ? `<div style="padding:8px 10px;background:var(--accent-bad)15;border-left:2px solid var(--accent-bad);border-radius:0 4px 4px 0;font-size:11px;color:var(--accent-bad);margin-bottom:10px;">Last error: ${escapeHtml(P.sync.lastError)}</div>` : ''}
    `;
    footer = connected
      ? `<button class="btn" onclick="closeModal()">Close</button>`
      : `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="sync-connect">Connect</button>`;
  } else if (type === 'add-resource') {
    // Live form state stored on modalState.context so re-renders don't wipe input.
    if (!modalState.context) modalState.context = {};
    const ctx = modalState.context;
    if (!ctx.mediaType) ctx.mediaType = 'book';
    if (!ctx.topicChoice) ctx.topicChoice = (T[0] && String(T[0].id)) || 'new';
    if (!ctx.startDate) ctx.startDate = weekKeyToDate(CURRENT_WEEK_KEY);
    if (!ctx.endDate)   ctx.endDate   = weekKeyToDate(weekKey(Math.min(13, CURRENT_MONTH_IDX + 1), 4));

    const startSnap = dateToWeekKey(ctx.startDate);
    const endSnap   = dateToWeekKey(ctx.endDate);
    const addingNewTopic = ctx.topicChoice === 'new';

    title = '+ Add Resource';
    body = `
      <div class="form-group">
        <label class="form-label">Media type</label>
        <div class="media-pills" id="media-pills">
          ${MEDIA_TYPES.map(m => `
            <button type="button" class="media-pill ${ctx.mediaType===m.id?'active':''}" data-media="${m.id}">
              <span class="media-pill-icon">${m.icon}</span>
              <span class="media-pill-label">${m.label}</span>
            </button>
          `).join('')}
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Title</label>
        <input type="text" class="form-input" id="ar-title" placeholder="e.g. Fundamentals of Biostatistics" value="${escapeHtml(ctx.title || '')}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Author / Source</label>
          <input type="text" class="form-input" id="ar-author" placeholder="Optional" value="${escapeHtml(ctx.author || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Length (pages / units)</label>
          <input type="number" class="form-input" id="ar-pages" min="1" placeholder="e.g. 80" value="${escapeHtml(ctx.totalPages || '')}">
          <div class="form-help desktop-only">For video/podcast/course, use approximate page-equivalents (e.g. 1 page ≈ 3 min)</div>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Topic</label>
        <select class="form-select" id="ar-topic">
          ${T.map(t => `<option value="${t.id}" ${String(t.id)===String(ctx.topicChoice)?'selected':''}>#${t.id} · ${escapeHtml(t.title)}</option>`).join('')}
          <option value="new" ${addingNewTopic?'selected':''}>+ New topic…</option>
        </select>
      </div>

      ${addingNewTopic ? `
        <div class="form-row" style="padding:10px 12px;background:var(--bg-card);border-left:3px solid var(--accent-warn);border-radius:0 4px 4px 0;">
          <div class="form-group">
            <label class="form-label">New topic title</label>
            <input type="text" class="form-input" id="ar-newtopic" placeholder="e.g. Biostatistics" value="${escapeHtml(ctx.newTopicTitle || '')}">
            <div class="form-help">Will be assigned ID #${nextFreeTopicId()}</div>
          </div>
          <div class="form-group">
            <label class="form-label">Color (CSS)</label>
            <input type="text" class="form-input" id="ar-newcolor" placeholder="#a78bfa" value="${escapeHtml(ctx.newTopicColor || '')}">
            <div class="form-help">Optional · default muted</div>
          </div>
        </div>
      ` : ''}

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Start date</label>
          <input type="date" class="form-input" id="ar-start" value="${escapeHtml(ctx.startDate)}">
          <div class="form-help">Snaps to <strong>${escapeHtml(weekKeyToLabel(startSnap))}</strong></div>
        </div>
        <div class="form-group">
          <label class="form-label">End date</label>
          <input type="date" class="form-input" id="ar-end" value="${escapeHtml(ctx.endDate)}">
          <div class="form-help">Snaps to <strong>${escapeHtml(weekKeyToLabel(endSnap))}</strong></div>
        </div>
      </div>

      ${draftEntries.length ? `
        <div style="margin-top:14px;padding:10px 12px;background:rgba(251,191,36,0.08);border-left:3px solid var(--accent-warn);border-radius:0 4px 4px 0;font-size:11px;line-height:1.5;">
          <strong>${draftEntries.length} draft entr${draftEntries.length===1?'y':'ies'}</strong> saved locally.
          <button class="btn btn-small" style="margin-left:8px;" id="ar-show-patch">View patch</button>
        </div>
      ` : ''}
    `;
    footer = `
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="ar-save">Add & Recalculate</button>
    `;
  } else if (type === 'autobalance') {
    // P1 #1.5: propose → preview → explicit Apply. All live form state lives
    // on modalState.context (add-resource pattern) so full re-renders don't
    // wipe it. The plan is recomputed on every render from ctx — deterministic
    // solver, so toggling a lock or editing capacity refreshes the diff.
    title = '⚖ Rebalance Schedule';
    if (!modalState.context) modalState.context = {};
    const ctx = modalState.context;
    if (!ctx.init) {
      const ab = getAutobalanceConfig();
      ctx.init = true;
      ctx.measured = getMeasuredCapacity();
      ctx.capacityMode = ab.capacityMode;
      ctx.capacityInput = (ab.capacityMode === 'manual' && ab.manualCapacity)
        ? ab.manualCapacity
        : (ctx.measured.value != null ? ctx.measured.value : 120);
      // Session locks seeded from persisted pins; stale keys dropped.
      ctx.locks = new Set(Object.keys(ab.pinned).filter(k => BOOK_PROGRESS[k]));
    }
    const abCapacity = abEffectiveCapacity(ctx);
    const abSource = ctx.capacityMode === 'manual' ? 'manual' : (ctx.measured.value != null ? 'measured' : 'default');
    const plan = computeRebalancePlan({ capacity: abCapacity, capacitySource: abSource, locks: ctx.locks });
    ctx.plan = plan;

    const capacityHelp = ctx.capacityMode === 'manual'
      ? `Manual${ctx.measured.value != null ? ` · <a href="#" id="ab-use-measured">use measured (${ctx.measured.value} pp/wk)</a>` : ''}`
      : (ctx.measured.value != null
        ? `Measured: median ${ctx.measured.value} pp/wk over your last ${ctx.measured.weeksUsed} active week${ctx.measured.weeksUsed === 1 ? '' : 's'} (×0.9)`
        : `Default — insufficient history (fewer than 2 logged weeks). Edit to set your real pace.`);
    const lowNote = (ctx.capacityMode !== 'manual' && ctx.measured.low)
      ? `<div class="form-help" style="color:var(--accent-warn);">Measured pace is very low — consider entering a manual number.</div>` : '';

    const diffRows = plan.changes.map(ch => {
      const dotColor = `var(--t${+ch.topic || 2})`;
      return `
        <div class="ab-diff-row">
          <label class="ab-lock" title="Lock: never move this book (persists after Apply)">
            <input type="checkbox" data-ab-lock="${escapeHtml(ch.bookKey)}">🔒
          </label>
          <div class="ab-diff-main">
            <div class="ab-diff-title"><span class="dot" style="background:${dotColor};"></span>${escapeHtml(ch.title)} <span class="ab-tier">${TIER[ch.tier] || ''}</span></div>
            <div class="ab-diff-meta">${ch.remaining} pp left · ${weekLabel(ch.from)} → <strong>${weekLabel(ch.to)}</strong> (+${ch.deltaWeeks} wk) · ~${ch.oldRate} → <strong>~${ch.newRate} pp/wk</strong></div>
          </div>
        </div>`;
    }).join('');

    const lockedRows = plan.locked.map(l => `
      <div class="ab-diff-row ab-locked">
        <label class="ab-lock" title="Unlock to let autobalance move this book">
          <input type="checkbox" data-ab-lock="${escapeHtml(l.bookKey)}" checked>🔒
        </label>
        <div class="ab-diff-main"><div class="ab-diff-title">${escapeHtml(l.title)}</div>
        <div class="ab-diff-meta">Pinned — consumes capacity, never moves</div></div>
      </div>`).join('');

    const warnings = [];
    if (plan.error === 'capacity-too-low') warnings.push('Capacity must be at least 10 pp/wk.');
    plan.unresolved.forEach(u => warnings.push(`<strong>${escapeHtml(u.title)}</strong> doesn't fit by Jun 2027 — needs ~${u.needsPagesPerWeek} pp/wk you don't have. Cut scope, raise capacity, or unpin something.`));
    plan.markDone.forEach(m => warnings.push(`<strong>${escapeHtml(m.title)}</strong> has 0 pages left — mark it done instead (checkbox stays the source of truth).`));
    plan.invalid.forEach(i => warnings.push(`<strong>${escapeHtml(i.title)}</strong> has invalid scheduling and was excluded.`));
    if (plan.peakWeekLoad > abCapacity) warnings.push(`Peak week ~${plan.peakWeekLoad} pp (${weekLabel(plan.peakWeek)}) — unmovable books overlap there; the weekly re-check will pick it up.`);
    if (plan.changes.some(ch => +ch.to.split('-W')[0] > 5)) warnings.push(`Some new end dates fall after Oct 2026 — the Week-zoom Gantt currently shows only the first 6 months (roadmap 2.5).`);
    if (P.sync.gistId) warnings.push(`Multi-device sync is on — Pull latest before applying if you've edited elsewhere.`);

    body = `
      <div class="form-group">
        <label class="form-label">Weekly capacity (pages/week)</label>
        <div style="display:flex;gap:10px;align-items:flex-start;">
          <input type="number" class="form-input" id="ab-capacity" value="${abCapacity}" min="10" max="400" style="max-width:110px;">
          <div class="form-help" style="flex:1;margin-top:6px;">${capacityHelp}</div>
        </div>
        ${lowNote}
      </div>
      ${plan.changes.length === 0 && !plan.error ? `
        <div style="padding:24px 16px;text-align:center;color:var(--accent-good);font-size:13px;border:1px dashed var(--border);border-radius:6px;">
          ✓ Already balanced at ${abCapacity} pp/wk — nothing to move.
        </div>
      ` : `
        <div class="sec-title" style="margin-top:4px;">Proposed changes (${plan.changes.length})</div>
        <div class="ab-diff-table">${diffRows}</div>
      `}
      ${lockedRows ? `<div class="sec-title">Pinned (${plan.locked.length})</div><div class="ab-diff-table">${lockedRows}</div>` : ''}
      ${plan.unchanged.length ? `
        <details style="margin-top:10px;">
          <summary style="cursor:pointer;font-size:11px;color:var(--text-muted);font-family:'DM Mono',monospace;">Unchanged (${plan.unchanged.length})</summary>
          <div style="font-size:11px;color:var(--text-secondary);padding:6px 2px;">${plan.unchanged.map(u => escapeHtml(u.title)).join(' · ')}</div>
        </details>
      ` : ''}
      ${warnings.length ? `<div class="ab-warnings">${warnings.map(w => `<div class="ab-warn">⚠ ${w}</div>`).join('')}</div>` : ''}
      <div style="font-size:10px;color:var(--text-muted);font-family:'DM Mono',monospace;margin-top:12px;padding-top:10px;border-top:1px solid var(--border);">
        as of ${weekLabel(plan.asOf)} · overrides only — data.js defaults untouched, ◆ marks show drift · every move lands in the Schedule Changes audit log
      </div>
    `;
    footer = `
      <div style="flex:1;font-size:11px;font-family:'DM Mono',monospace;color:var(--text-secondary);align-self:center;">
        Weekly load: ${plan.before} pp (${loadBand(plan.before).label}) → <strong>${plan.after} pp (${loadBand(plan.after).label})</strong>
      </div>
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="ab-apply" ${plan.changes.length === 0 || plan.error ? 'disabled' : ''}>Apply ${plan.changes.length} change${plan.changes.length === 1 ? '' : 's'}</button>
    `;
  } else if (type === 'patch') {
    title = 'data.js Patch';
    const patch = generatePatch();
    body = `
      <div style="font-size:12px;line-height:1.5;color:var(--text-secondary);margin-bottom:10px;">
        Drafts are autosaved to local storage and survive reloads. To make them portable across devices, paste the snippets below into <code style="font-family:'DM Mono',monospace;background:var(--bg-card);padding:1px 5px;border-radius:3px;">data.js</code> at the indicated sections, reload, then use "Clear drafts" to remove the local copies.
      </div>
      <textarea class="form-textarea" id="patch-text" readonly style="min-height:240px;font-family:'DM Mono',monospace;font-size:11px;line-height:1.4;">${escapeHtml(patch)}</textarea>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
        <button class="btn btn-primary" id="patch-copy">Copy to clipboard</button>
        <button class="btn" id="patch-download">Download .js</button>
        <span style="flex:1;"></span>
        <button class="btn btn-danger btn-small" id="patch-clear">Clear drafts</button>
      </div>
    `;
    footer = `<button class="btn" onclick="closeModal()">Close</button>`;
  }

    return `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal" onclick="event.stopPropagation()">
          <div class="modal-head">
            <div class="modal-title">${title}</div>
            <button class="modal-close" onclick="closeModal()">×</button>
          </div>
          <div class="modal-body">${body}</div>
          <div class="modal-foot">${footer}</div>
        </div>
      </div>
    `;
  } catch (e) {
    console.error('renderModal error:', e);
    return `<div class="modal-backdrop" id="modal-backdrop"><div class="modal"><div class="modal-head"><div class="modal-title">Error</div><button class="modal-close" onclick="closeModal()">×</button></div><div class="modal-body" style="color:var(--accent-bad);font-size:12px;">Modal failed: ${escapeHtml(e.message)}</div></div></div>`;
  }
}

function generateWeekOptions(selected) {
  let opts = '';
  for (let m = 0; m < 14; m++) {
    for (let w = 1; w <= 4; w++) {
      const k = weekKey(m, w);
      const label = `${MF[m]} ${MY[m]} W${w}`;
      opts += `<option value="${k}" ${k===selected?'selected':''}>${label}</option>`;
    }
  }
  return opts;
}

// ── EVENTS ──
function bind() {
  try {
    document.querySelectorAll('[data-tab]').forEach(el => {
      el.addEventListener('click', () => {
        try { S.tab = el.dataset.tab; render(); window.scrollTo(0,0); }
        catch (e) { console.error('tab nav error:', e); }
      });
    });
    document.querySelectorAll('[data-z]').forEach(el => {
      el.addEventListener('click', () => { S.zoom = el.dataset.z; render(); });
    });
    document.querySelectorAll('[data-f]').forEach(el => {
      el.addEventListener('click', () => { S.tier = el.dataset.f; render(); });
    });
    document.querySelectorAll('[data-detail]').forEach(el => {
      el.addEventListener('click', () => { S.detail = +el.dataset.detail; render(); });
    });
    document.querySelectorAll('[data-overlay]').forEach(el => {
      el.addEventListener('click', () => {
        // For now there's only one overlay (books). If more get added, switch on dataset.overlay.
        S.bookOverlay = !S.bookOverlay;
        render();
      });
    });
    // Topic filter — per-checkbox toggle + Select all / Clear all actions.
    // Null S.topicFilter means "all"; we hydrate it into an explicit Set on
    // the first deselection so the user's choice survives across renders.
    document.querySelectorAll('[data-topic-filter]').forEach(el => {
      el.addEventListener('change', () => {
        const id = +el.dataset.topicFilter;
        if (isNaN(id)) return;
        if (!(S.topicFilter instanceof Set)) {
          S.topicFilter = new Set(T.map(t => t.id));
        }
        if (el.checked) S.topicFilter.add(id);
        else            S.topicFilter.delete(id);
        // If they've re-checked everything, drop back to the null sentinel
        // so the label reads "All" and gantt() skips the filter check.
        if (S.topicFilter.size === T.length) S.topicFilter = null;
        render();
      });
    });
    document.querySelectorAll('[data-topic-filter-action]').forEach(el => {
      el.addEventListener('click', () => {
        const a = el.dataset.topicFilterAction;
        if (a === 'all')  S.topicFilter = null;
        if (a === 'none') S.topicFilter = new Set();
        render();
      });
    });
    // Track <details> open state so render()-driven rebuilds don't snap the
    // dropdown shut after a checkbox click. The native toggle event fires
    // AFTER the open attribute changes; we mirror it into S and skip the
    // implicit render so the user's click doesn't trigger a full re-paint.
    const topicDetails = document.getElementById('topic-filter-details');
    if (topicDetails) {
      topicDetails.addEventListener('toggle', () => {
        S.topicFilterOpen = topicDetails.open;
      });
    }
    // P2 #2.6: stale-week reload
    const staleReload = document.getElementById('stale-reload');
    if (staleReload) staleReload.addEventListener('click', () => location.reload());

    // Date navigation
    const dnPrev = document.getElementById('dn-prev');
    if (dnPrev) dnPrev.addEventListener('click', () => { shiftViewingDate(-1); render(); });
    const dnNext = document.getElementById('dn-next');
    if (dnNext) dnNext.addEventListener('click', () => { shiftViewingDate(1); render(); });
    const dnLabel = document.getElementById('dn-label');
    if (dnLabel) dnLabel.addEventListener('click', () => {
      if (S.viewDate) { S.viewDate = null; render(); }
    });
    const dnPicker = document.getElementById('dn-picker');
    const dnInput = document.getElementById('dn-date-input');
    if (dnPicker && dnInput) {
      dnPicker.addEventListener('click', () => {
        try { dnInput.showPicker(); }
        catch (_) { dnInput.focus(); dnInput.click(); }
      });
      dnInput.addEventListener('change', () => {
        const v = dnInput.value;
        if (!v) return;
        S.viewDate = (v === todayIso()) ? null : v;
        render();
      });
    }

    // Modal triggers
    document.querySelectorAll('[data-modal]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        openModal(el.dataset.modal, { book: el.dataset.book });
      });
    });

    // Modal backdrop close
    const backdrop = document.getElementById('modal-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeModal);

    // Deliverable checkboxes
    document.querySelectorAll('[data-deliverable]').forEach(el => {
      el.addEventListener('change', () => {
        try {
          const parts = (el.dataset.deliverable || '').split('|');
          if (parts.length !== 3) return;
          const [tid, sublet, wk] = parts;
          toggleDeliverable(+tid, sublet, wk);
          render();
        } catch (e) { console.error('deliverable toggle error:', e); }
      });
    });

    // Mark book complete / reopen
    document.querySelectorAll('[data-mark-complete]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const k = el.dataset.markComplete;
        const book = BOOK_PROGRESS[k];
        if (!book) { toast('Book not found', true); return; }
        P.bookCompleted[k] = true;
        P.bookProgress[k] = book.totalPages;
        savePersistent();
        toast(`${book.title} marked complete`);
        render();
      });
    });
    document.querySelectorAll('[data-mark-incomplete]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const k = el.dataset.markIncomplete;
        delete P.bookCompleted[k];
        savePersistent();
        render();
      });
    });

    // Delete session
    document.querySelectorAll('[data-delete-session]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm('Delete this session and revert page progress?')) return;
        const idx = +el.dataset.deleteSession;
        if (isNaN(idx) || idx < 0 || idx >= P.sessions.length) { toast('Invalid session', true); return; }
        deleteSession(idx);
        render();
      });
    });

    // Modal form handlers
    const saveSession = document.getElementById('save-session');
    if (saveSession) {
      saveSession.addEventListener('click', () => {
        try {
          const bookEl = document.getElementById('session-book');
          const pagesEl = document.getElementById('session-pages');
          const durationEl = document.getElementById('session-duration');
          const notesEl = document.getElementById('session-notes');
          const dateEl = document.getElementById('session-date');
          if (!pagesEl || !durationEl || !notesEl) { toast('Form error', true); return; }
          const book = bookEl ? bookEl.value : '';
          const pages = pagesEl.value;
          const duration = durationEl.value;
          const notes = notesEl.value;
          const sessionDate = dateEl ? dateEl.value : '';
          if (!pages && !duration && !notes.trim()) {
            toast('Enter pages, duration, or notes', true);
            return;
          }
          // Validate pages is reasonable
          const pageNum = +pages;
          if (pages && (isNaN(pageNum) || pageNum < 0 || pageNum > 5000)) {
            toast('Pages must be 0–5000', true);
            return;
          }
          const durNum = +duration;
          if (duration && (isNaN(durNum) || durNum < 0 || durNum > 1440)) {
            toast('Duration must be 0–1440 min', true);
            return;
          }
          if (sessionDate && sessionDate > todayIso()) {
            toast('Cannot log a future date', true);
            return;
          }
          logSession(book, pages || 0, duration || 0, notes, sessionDate);
          if (timerState.elapsedSec && Math.abs(+duration - Math.round(timerState.elapsedSec/60)) < 1) {
            resetTimer();
          }
          closeModal();
          const dateLabel = (sessionDate && sessionDate !== todayIso()) ? ` (${sessionDate})` : '';
          toast(pages ? `+${pages} pages logged${dateLabel}` : `Session logged${dateLabel}`);
        } catch (e) { console.error('save session error:', e); toast('Save failed', true); }
      });
    }

    // Roll modal: re-roll and save
    const rollAgain = document.getElementById('roll-again');
    if (rollAgain) {
      rollAgain.addEventListener('click', () => {
        if (modalState && modalState.context) {
          // Force a new pick by clearing cached roll
          modalState.context.rolled = suggestRandomActivity();
        }
        render();
      });
    }
    const rollSave = document.getElementById('roll-save');
    if (rollSave) {
      rollSave.addEventListener('click', () => {
        try {
          const book = rollSave.dataset.book;
          const pagesEl = document.getElementById('roll-pages');
          const durationEl = document.getElementById('roll-duration');
          const notesEl = document.getElementById('roll-notes');
          if (!pagesEl || !durationEl || !notesEl) { toast('Form error', true); return; }
          const pages = pagesEl.value;
          const duration = durationEl.value;
          const notes = notesEl.value;
          if (!pages && !duration && !notes.trim()) {
            toast('Enter pages, duration, or notes', true);
            return;
          }
          const pageNum = +pages;
          if (pages && (isNaN(pageNum) || pageNum < 0 || pageNum > 5000)) {
            toast('Pages must be 0–5000', true); return;
          }
          const durNum = +duration;
          if (duration && (isNaN(durNum) || durNum < 0 || durNum > 1440)) {
            toast('Duration must be 0–1440 min', true); return;
          }
          logSession(book, pages || 0, duration || 0, notes);
          if (timerState.elapsedSec && Math.abs(+duration - Math.round(timerState.elapsedSec/60)) < 1) {
            resetTimer();
          }
          closeModal();
          toast(pages ? `🎲 +${pages} pages logged` : '🎲 Session logged');
        } catch (e) { console.error('roll save error:', e); toast('Save failed', true); }
      });
    }

    const saveLeverage = document.getElementById('save-leverage');
    if (saveLeverage) {
      saveLeverage.addEventListener('click', () => {
        try {
          const textEl = document.getElementById('leverage-text');
          if (!textEl) return;
          const text = textEl.value;
          if (!text.trim()) { toast('Empty entry', true); return; }
          addLeverageEntry(text);
          closeModal();
          toast('Leverage note saved');
        } catch (e) { console.error('save leverage error:', e); toast('Save failed', true); }
      });
    }

    const saveEdit = document.getElementById('save-edit');
    if (saveEdit) {
      saveEdit.addEventListener('click', () => {
        try {
          const k = saveEdit.dataset.book;
          const book = BOOK_PROGRESS[k];
          if (!book) { toast('Book not found', true); return; }
          const pageEl = document.getElementById('edit-page');
          const startEl = document.getElementById('edit-start');
          const endEl = document.getElementById('edit-end');
          const noteEl = document.getElementById('edit-note');
          if (!pageEl || !startEl || !endEl) { toast('Form error', true); return; }
          const newPage = +pageEl.value;
          const newStart = startEl.value;
          const newEnd = endEl.value;
          const newNote = noteEl ? noteEl.value.trim() : '';
          if (isNaN(newPage) || newPage < 0 || newPage > book.totalPages) {
            toast(`Page must be 0–${book.totalPages}`, true);
            return;
          }
          // Validate start ≤ end (compare global week indices: month*4 + week)
          try {
            const [sm, sw] = newStart.split('-W').map(Number);
            const [em, ew] = newEnd.split('-W').map(Number);
            if ([sm, sw, em, ew].some(isNaN)) { toast('Bad week value', true); return; }
            if (sm * 4 + sw > em * 4 + ew) {
              toast('End week must be on or after start week', true);
              return;
            }
          } catch { toast('Bad week value', true); return; }
          // P4 #14: capture live values BEFORE we mutate so the audit log
          // sees the real from→to transition (override-aware via accessors).
          const prevStart = getStartWeek(k);
          const prevEnd   = getEndWeek(k);
          P.bookProgress[k] = newPage;
          if (newStart !== book.startWeek) P.bookStartOverrides[k] = newStart;
          else delete P.bookStartOverrides[k];
          if (newEnd !== book.endWeek) P.bookEndOverrides[k] = newEnd;
          else delete P.bookEndOverrides[k];
          // P3 #12: note override symmetric with start/end — if equal to
          // default, drop the override so default rendering resumes.
          if (newNote !== (book.note || '')) P.customNotes[k] = newNote;
          else delete P.customNotes[k];
          if (newPage >= book.totalPages) P.bookCompleted[k] = true;
          else delete P.bookCompleted[k];
          logScheduleChange(k, 'startWeek', prevStart, getStartWeek(k));
          logScheduleChange(k, 'endWeek',   prevEnd,   getEndWeek(k));
          savePersistent();
          closeModal();
          toast('Updated');
        } catch (e) { console.error('save edit error:', e); toast('Save failed', true); }
      });
    }

    // Reset schedule overrides for the current book in the edit-book modal.
    // Clears both start and end overrides and re-renders so the selects snap
    // back to the data.js defaults.
    const editReset = document.getElementById('edit-reset');
    if (editReset) {
      editReset.addEventListener('click', () => {
        try {
          const k = editReset.dataset.book;
          if (!k || !BOOK_PROGRESS[k]) { toast('Book not found', true); return; }
          if (!hasScheduleOverride(k)) { toast('No overrides to reset'); return; }
          // P4 #14: capture live values BEFORE the reset so the audit log
          // records the back-to-default transition explicitly.
          const prevStart = getStartWeek(k);
          const prevEnd   = getEndWeek(k);
          resetScheduleOverride(k);
          logScheduleChange(k, 'startWeek', prevStart, getStartWeek(k));
          logScheduleChange(k, 'endWeek',   prevEnd,   getEndWeek(k));
          savePersistent();
          toast('Schedule reset to default');
          render(); // re-render modal so selects + override labels update
        } catch (e) { console.error('edit reset error:', e); toast('Reset failed', true); }
      });
    }

    // Add-Resource modal: live form bindings
    if (modalState && modalState.type === 'add-resource') {
      const ctx = modalState.context;
      const sync = () => {
        const t = document.getElementById('ar-title');
        const a = document.getElementById('ar-author');
        const p = document.getElementById('ar-pages');
        const tp = document.getElementById('ar-topic');
        const sd = document.getElementById('ar-start');
        const ed = document.getElementById('ar-end');
        const nt = document.getElementById('ar-newtopic');
        const nc = document.getElementById('ar-newcolor');
        if (t)  ctx.title = t.value;
        if (a)  ctx.author = a.value;
        if (p)  ctx.totalPages = p.value;
        if (tp) ctx.topicChoice = tp.value;
        if (sd) ctx.startDate = sd.value;
        if (ed) ctx.endDate = ed.value;
        if (nt) ctx.newTopicTitle = nt.value;
        if (nc) ctx.newTopicColor = nc.value;
      };

      document.querySelectorAll('[data-media]').forEach(el => {
        el.addEventListener('click', e => {
          e.preventDefault();
          sync();
          ctx.mediaType = el.dataset.media;
          render();
        });
      });
      const topicSel = document.getElementById('ar-topic');
      if (topicSel) topicSel.addEventListener('change', () => { sync(); render(); });

      // Live re-render the "Snaps to..." labels when dates change
      ['ar-start','ar-end'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => { sync(); render(); });
      });

      // Track text inputs into ctx without re-rendering (preserves focus)
      ['ar-title','ar-author','ar-pages','ar-newtopic','ar-newcolor'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', sync);
      });

      const showPatch = document.getElementById('ar-show-patch');
      if (showPatch) showPatch.addEventListener('click', () => { sync(); openModal('patch'); });

      const arSave = document.getElementById('ar-save');
      if (arSave) arSave.addEventListener('click', () => {
        try {
          sync();
          const title = (ctx.title || '').trim();
          const pages = +ctx.totalPages;
          if (!title) { toast('Title required', true); return; }
          if (!pages || pages < 1 || pages > 100000) { toast('Length must be 1–100000', true); return; }
          const startSnap = dateToWeekKey(ctx.startDate);
          const endSnap   = dateToWeekKey(ctx.endDate);
          if (!startSnap || !endSnap) { toast('Pick valid start + end dates', true); return; }
          // Compare week indices
          const [sm, sw] = startSnap.split('-W').map(Number);
          const [em, ew] = endSnap.split('-W').map(Number);
          if (sm*4+sw > em*4+ew) { toast('End must be on/after start', true); return; }

          let topicId;
          if (ctx.topicChoice === 'new') {
            const tt = (ctx.newTopicTitle || '').trim();
            if (!tt) { toast('New topic needs a title', true); return; }
            topicId = addDraftTopic({ title: tt, color: (ctx.newTopicColor || '').trim() || null });
          } else {
            topicId = +ctx.topicChoice;
            if (!T.find(t => t.id === topicId)) { toast('Pick a topic', true); return; }
          }

          addDraftBook({
            title, author: ctx.author || '', mediaType: ctx.mediaType,
            topicId, totalPages: pages,
            startWeek: startSnap, endWeek: endSnap,
          });

          toast(`+ ${title} added · weekly allocation recalculated`);
          closeModal();
          // Re-render picks up the new entry through existing BOOK_PROGRESS iteration
          render();
        } catch (e) { console.error('add-resource save error:', e); toast('Save failed', true); }
      });
    }

    // P1 #1.6: behind-banner snooze — suppresses until the NEXT curriculum
    // week (a week index, not a wall-clock delay), then re-arms.
    const abSnooze = document.getElementById('ab-snooze');
    if (abSnooze) abSnooze.addEventListener('click', () => {
      const ab = ensureAutobalanceState();
      ab.dismissedUntilIdx = CURRENT_MONTH_IDX * 4 + CURRENT_WEEK_OF_MONTH + 1;
      savePersistent();
      render();
    });

    // Autobalance modal: capacity input mirrors to ctx on every keystroke
    // (full-innerHTML re-render kills focus, so no render on 'input');
    // structural changes (blur/enter, lock toggles, mode switch) re-render,
    // which recomputes the plan from ctx (deterministic solver).
    if (modalState && modalState.type === 'autobalance') {
      const ctx = modalState.context;
      const capEl = document.getElementById('ab-capacity');
      if (capEl) {
        capEl.addEventListener('input', () => {
          ctx.capacityInput = capEl.value;
          ctx.capacityMode = 'manual';
        });
        // Refresh the preview when capacity is committed — but NOT by
        // re-rendering mid-click. A full innerHTML re-render replaces the DOM;
        // if it fires because the field blurred from a click on Apply / a lock
        // / Cancel, it destroys that control before its own handler runs and
        // the click is silently swallowed (user has to click twice). So skip
        // the render when focus is moving to another in-modal control — that
        // control recomputes the plan from ctx itself, and Apply reads ctx
        // authoritatively, so nothing is lost. Enter commits explicitly.
        capEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); render(); } });
        capEl.addEventListener('blur', e => {
          const rt = e.relatedTarget;
          if (rt && rt.closest && rt.closest('.modal')) return;
          render();
        });
      }
      const useMeasured = document.getElementById('ab-use-measured');
      if (useMeasured) useMeasured.addEventListener('click', e => {
        e.preventDefault();
        ctx.capacityMode = 'auto';
        ctx.capacityInput = (ctx.measured && ctx.measured.value != null) ? ctx.measured.value : 120;
        render();
      });
      document.querySelectorAll('[data-ab-lock]').forEach(el => {
        el.addEventListener('change', () => {
          const k = el.dataset.abLock;
          if (!k) return;
          if (el.checked) ctx.locks.add(k);
          else ctx.locks.delete(k);
          render();
        });
      });
      const abApply = document.getElementById('ab-apply');
      if (abApply) abApply.addEventListener('click', () => {
        try {
          // Recompute from current ctx — authoritative even if the last
          // keystroke hasn't been through a re-render yet.
          const capacity = abEffectiveCapacity(ctx);
          const capacitySource = ctx.capacityMode === 'manual' ? 'manual' : (ctx.measured.value != null ? 'measured' : 'default');
          const plan = computeRebalancePlan({ capacity, capacitySource, locks: ctx.locks });
          const pinned = {};
          // Preserve pins for books not present on THIS device (e.g. a draft
          // that only exists on another synced device) — the modal only seeds
          // locks for books in BOOK_PROGRESS, so rebuilding pins purely from
          // ctx.locks would drop and then sync-away those absent-book pins.
          const existingPins = getAutobalanceConfig().pinned;
          Object.keys(existingPins).forEach(k => { if (!BOOK_PROGRESS[k]) pinned[k] = true; });
          ctx.locks.forEach(k => { pinned[k] = true; });
          applyRebalancePlan(plan, {
            capacityMode: ctx.capacityMode,
            manualCapacity: ctx.capacityMode === 'manual' ? capacity : null,
            pinned,
          });
        } catch (e) { console.error('autobalance apply error:', e); toast('Apply failed', true); }
      });
    }

    // Patch modal handlers
    if (modalState && modalState.type === 'patch') {
      const copyBtn = document.getElementById('patch-copy');
      if (copyBtn) copyBtn.addEventListener('click', async () => {
        try {
          const text = document.getElementById('patch-text').value;
          await navigator.clipboard.writeText(text);
          toast('Patch copied');
        } catch (e) {
          const ta = document.getElementById('patch-text');
          if (ta) { ta.select(); document.execCommand('copy'); toast('Patch copied'); }
        }
      });
      const dl = document.getElementById('patch-download');
      if (dl) dl.addEventListener('click', () => {
        const text = document.getElementById('patch-text').value;
        const blob = new Blob([text], { type: 'text/javascript' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `curriculum-patch-${localDayKey(new Date())}.js`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 500);
      });
      const clear = document.getElementById('patch-clear');
      if (clear) clear.addEventListener('click', () => {
        if (!confirm('Remove all draft entries from local storage? Use this after you have pasted the patch into data.js and reloaded.')) return;
        clearAllDrafts();
        closeModal();
        render();
        toast('Drafts cleared');
      });
    }

    // Timer controls
    const tStart = document.getElementById('timer-start');
    if (tStart) tStart.addEventListener('click', () => { startTimer(); render(); });
    const tPause = document.getElementById('timer-pause');
    if (tPause) tPause.addEventListener('click', () => { pauseTimer(); render(); });
    const tReset = document.getElementById('timer-reset');
    if (tReset) tReset.addEventListener('click', () => { resetTimer(); render(); });
    const tLog = document.getElementById('timer-log');
    if (tLog) tLog.addEventListener('click', () => { closeModal(); setTimeout(() => openModal('log-session'), 100); });

    // Data management
    const exp = document.getElementById('data-export');
    if (exp) exp.addEventListener('click', exportState);
    const imp = document.getElementById('data-import');
    if (imp) imp.addEventListener('change', e => { if (e.target.files && e.target.files[0]) importState(e.target.files[0]); });
    const rst = document.getElementById('data-reset');
    if (rst) rst.addEventListener('click', () => { resetState(); closeModal(); });

    // Sync
    const sConnect = document.getElementById('sync-connect');
    if (sConnect) sConnect.addEventListener('click', async () => {
      const input = document.getElementById('sync-token-input');
      if (!input) return;
      const token = input.value;
      sConnect.disabled = true;
      sConnect.textContent = 'Connecting…';
      await connectSync(token);
      if (syncEnabled()) closeModal();
    });
    const sPush = document.getElementById('sync-push');
    if (sPush) sPush.addEventListener('click', async () => {
      sPush.disabled = true;
      try { await pushToGist(); toast('Pushed'); render(); }
      catch (e) { toast('Push failed: ' + e.message, true); }
      finally { sPush.disabled = false; }
    });
    const sPull = document.getElementById('sync-pull');
    if (sPull) sPull.addEventListener('click', async () => {
      sPull.disabled = true;
      try { await pullFromGist(); }
      catch (e) { toast('Pull failed: ' + e.message, true); }
      finally { sPull.disabled = false; }
    });
    const sDisc = document.getElementById('sync-disconnect');
    if (sDisc) sDisc.addEventListener('click', () => {
      if (confirm('Disconnect from GitHub on this device? Your gist will remain in your account.')) {
        disconnectSync();
        closeModal();
      }
    });

    // Init timer display if timer modal is open
    if (modalState && modalState.type === 'timer') {
      updateTimerDisplay();
    }

    // Refresh sync badge every 30s so "synced Xs ago" stays current
    if (!window._syncBadgeRefresh) {
      window._syncBadgeRefresh = setInterval(updateSyncBadge, 30000);
    }
  } catch (e) {
    console.error('bind error:', e);
  }
}

// ── INIT ──
// Restore any draft books/topics from a previous session before first render
loadDrafts();
// Re-evaluate mobile class on viewport changes (rotation, window resize)
try {
  let resizeRaf = null;
  window.addEventListener('resize', () => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(applyMobileBodyClasses);
  }, { passive: true });
} catch (_) {}
// P2 #2.6: when a long-lived tab regains focus, re-render so the stale-week
// banner surfaces the moment the calendar has drifted past the frozen anchor.
// Cheap (one integer compare); only re-renders when the state actually flips.
try {
  let _wasStale = isWeekStale();
  const checkStale = () => {
    const nowStale = isWeekStale();
    if (nowStale !== _wasStale) { _wasStale = nowStale; render(); }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkStale(); });
  window.addEventListener('focus', checkStale);
} catch (_) {}
render();