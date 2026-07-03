# Curriculum Dashboard — Roadmap v2

_Refreshed: 2026-07-03. Prior roadmap (P0–P4, items #1–#14) complete as of the 2026-05-18/19 build sprint; #6 confirmed never landed and is superseded below._

Headline: **Autobalance** — when actual pace falls behind plan, propose a capacity-fitted reschedule that keeps the weekly plan realistic in volume and propagates new due dates through the engine and every UI surface.

Design provenance: three independent designs (minimal-diff / derived-schedule-core / capacity-first) scored by a three-lens judge panel (engineering fit — verified against source line-by-line; algorithm stress tests; product/UX). Winner: minimal-diff core built on the existing override + audit-log substrate, with grafts from both runners-up.

---

# AUTOBALANCE — Synthesized Design

**Base:** capacity-fit end-week rebalancer on the existing override substrate. **Grafts:** `getWeeklyDemand()` extraction, syntopic concurrency cap, capacity-relative trigger, per-book locks (from capacity-first design); median capacity estimator, apply-time week-drift abort, `dismissedUntilIdx` snooze, collapsed "unchanged" diff group, explicit auto/manual capacity mode (from scheduler-core design).

## 1. Principles

- `data.js` is immutable defaults; the only write target is `P.bookEndOverrides` (MVP never touches `P.bookStartOverrides`, pages, `bookCompleted`, `deliverablesDone`, or data.js).
- All reads through `getStartWeek` (app.js:143) / `getEndWeek` (app.js:148) / `getCurrentPage` / `isBookComplete` — includes runtime draft books.
- Never runs automatically. Propose → preview → explicit Apply. One `savePersistent()` per batch → one debounced gist push.
- Every write follows the save-edit discipline (app.js:2853-2905): capture `prev` via accessor BEFORE mutating, write-or-DELETE-when-equal-to-default (2888-2891, keeps ◆ drift badges truthful), `logScheduleChange` per changed field (app.js:183, P4 #14 contract).
- One `render()` propagates to every surface: This Week filters/pills/target bar, dice, Gantt `.g-bar-book` overlays, `formatBookSchedule`, `getDerivedTopicTimeframe`, `getDerivedTopicActiveMonths`, edit-book "Overridden"/Reset.

## 2. Data model

New top-level `P` key (add to `DEFAULT_PERSISTENT` app.js:68-89 + one type-guard line in `loadPersistent`; rides gist `state.json` free; survives old-client round-trips via spread):

```js
autobalance: {
  capacityMode: 'auto',      // 'auto' (measured median) | 'manual'
  manualCapacity: null,      // pp/wk number when manual
  pinned: {},                // {bookKey: true} — persisted pins; ALWAYS rendered visibly in the modal
  dismissedUntilIdx: null,   // global week idx; banner suppressed while curIdx < this (re-arms next curriculum week)
  lastRunTs: null,           // ms epoch of last Apply
  lastRun: null              // {ts, capacity, capacitySource, changes:[{bookKey, from, to}]} — powers Phase-2 undo
}
```

Because `pullFromGist` and `importState` bypass load guards, all reads go through a new normalizing accessor `getAutobalanceConfig()`. No `windowDays` config — the estimator window is a constant.

`scheduleLog` entries gain an OPTIONAL `source` field: `'autobalance' | 'autobalance-undo'` (absent = manual). `logScheduleChange` gets an optional 5th param, spread only when truthy. Backward/forward compatible; no schema version bump; `_v4` key unchanged; zero data.js changes.

## 3. Capacity measurement

`getMeasuredCapacity()`:
1. Bucket `P.sessions` into curriculum weeks (local-date semantics — never `toISOString`; `dateToWeekKey` → weekIdx).
2. Take the last 6 **completed** curriculum weeks containing ≥1 session. Require ≥2 qualifying weeks, else `{value: null, reason: 'insufficient-history'}`.
3. `measured = Math.round(0.9 * median(weeklyPageSums))`. No clamp floor — median-over-active-weeks makes it unnecessary; genuinely-low median reported honestly ("measured pace very low — consider a manual number" when < 25).

Effective capacity: manual override if set, else measured. Null measured in auto mode → modal prefills 120 labeled "(default — insufficient history)"; Apply not blocked, label honest. Explicit auto/manual toggle with a "use measured (N pp/wk)" link back. Planner hard-refuses capacity < 10 pp/wk; input clamped [10, 400]. Value mirrored into `modalState.context` on every input (survives full-innerHTML re-render focus kill).

## 4. Demand measurement

**Extract** the weeklyTarget reduce from `renderThisWeek` (app.js:1137-1147) into shared `getWeeklyDemand()` returning `{total, perBook}` using the exact existing formula (`pagesPerWeek = ceil(remaining / max(1, endIdx - curIdx + 1))` over the P3 #11 overdue-inclusive active filter). `renderThisWeek` refactors to call it — behavior-identical, single call site. The planner's objective is then bit-identical to the displayed load pill **by construction**.

## 5. Solver — `computeRebalancePlan({capacity, locks})` (pure, deterministic)

Shared helpers: `weekIdx(wk)` = `split('-W').map(Number)` → `m*4+w` (null on NaN — never lexical compare); `idxToWeekKey(idx)`; domain idx 1 ("0-W1") .. `MAX_IDX = 56` ("13-W4").

```
cIdx = CURRENT_MONTH_IDX*4 + CURRENT_WEEK_OF_MONTH        // same frozen anchor as all pace pills
load = float array [0..56]

POOL: each non-complete book → {k, sIdx, eIdx, remaining, tier}
  remaining === 0 → markDone[] ("mark done instead" — never writes bookCompleted)
  unparseable weeks → invalid[] (excluded, listed)

PARTITION: locked (session locks ∪ persisted pins) | upcoming (sIdx > cIdx) | active (sIdx <= cIdx)

PRE-CHARGE: locked ∪ upcoming books charge load[max(sIdx,cIdx)..max(eIdx,·)] += even-spread rate
  (pins consume capacity, never move — honest solver)

FIT ACTIVE, priority order: tier asc, live eIdx asc, remaining desc, bookKey asc (determinism):
  rateCap = (2+ active) ? ceil(capacity * 0.5) : capacity   // concurrency cap: weeks realistic in composition
  scan E from max(cIdx, current live eIdx) .. 56:           // scan floor = live end: NEVER-SHRINK by construction
    rate = remaining / (E - cIdx + 1)
    accept first E where rate <= rateCap AND load[t] + rate <= capacity for all t in window
  no fit → E = 56, unresolved[] with needsPagesPerWeek
  commit load; emit change {bookKey, from, to, oldRate, newRate, deltaWeeks} only if E != live end

RETURN {changes, before, after, capacity, capacitySource, unresolved, markDone, invalid, locked, unchanged, asOf}
```

**Idempotency (provable):** post-apply every active book's live end = its fitted E and `load[t] <= capacity` ∀t; rerun with the identical deterministic order accepts every book at its first candidate → empty plan → "Already balanced." Manually pushed-out ends and ahead books are structurally untouchable (never-shrink), so pins are only needed for "never push LATER" hard dates. ~12 books × 56 × 56 — trivial; no memoization.

## 6. Apply — `applyRebalancePlan(plan)`

1. **Week-drift abort:** if the live computed week idx ≠ the frozen page-load anchor → toast("Week changed since page load — reload"), return.
2. Per change: skip if `isBookComplete` flipped; `prev = getEndWeek(k)`; **SKIP if `prev !== change.from`** (staleness guard — gist pull or second-tab edit under an open modal degrades to partial-apply-with-explanation, never blind overwrite); write or delete-when-equal-to-default; `logScheduleChange(k, 'endWeek', prev, getEndWeek(k), 'autobalance')`.
3. Persist `lastRunTs`/`lastRun` + capacity mode from modal state.
4. ONE `savePersistent()`; `closeModal()`; `render()`; toast("⚖ Rebalanced N · M skipped (state changed) · K can't fit by Jun 2027").

## 7. Trigger / detection (computed fresh each render, never stored, never auto-fires)

In `renderThisWeek` after the load-band block (app.js:1149-1154):

`behind = anyOverdue || (capacity != null && demand.total > capacity * 1.25) || demand.total >= 180`

— capacity-relative predicate (adapts to the actual reader) with the OVERLOAD band kept as absolute backstop. Banner copy is **plan-framed, not user-framed**: "Plan asks {demand} pp/wk · your measured pace is ~{capacity} pp/wk · {n} overdue — [⚖ Rebalance] [Snooze]". Snooze sets `dismissedUntilIdx = cIdx + 1`. Permanent ⚖ Rebalance button in the Quick Actions bar (app.js:948-957) via existing `data-modal` wiring. Banner ships in Phase 1.

## 8. UI changes per surface

- **Quick Actions bar:** `⚖ Rebalance` button — zero new event plumbing.
- **This Week:** behind banner above stats strip; post-apply the tab self-corrects on the same render (weeklyTarget + load pill drop, OVERDUE pills clear via real moves, Read Now + active/upcoming recompute).
- **Autobalance modal** (new `renderModal` branch; state in `modalState.context`): capacity section (observed-median readout, auto/manual toggle, editable input) · per-book diff table (topic dot + tier, remaining pp, `from → to`, Δweeks, `~oldRate → ~newRate pp/wk`, lock checkbox with recompute-on-toggle) · "Pinned (n)" group always visible with unpin · "unchanged (n)" collapsed group · warnings (unresolved "doesn't fit by Jun 2027 — cut scope, raise capacity, or pin less"; mark-done candidates; invalid keys; low-measured-pace; months-past-idx-5 Gantt blind spot) · footer "Weekly load: {before} pp ({band}) → {after} pp ({band})" + Apply/Cancel · empty plan → "Already balanced", Apply disabled · footnote "hand-written spans/labels don't move — ◆ marks show drift".
- **bind():** `#ab-apply`, capacity input/mode/locks → update ctx + recompute + `render()`; snooze → `dismissedUntilIdx`. All inputs mirror to ctx (focus-kill workaround — highest implementation-risk item).
- **Log tab:** `⚖ auto` chip when `entry.source === 'autobalance'` — manual vs automated provenance in the audit trail.
- **Passive propagation (zero code):** book cards, Gantt overlays, topic Timeframe, Active Months, Reading List ◆ badges, edit-book "Overridden"/Reset (per-book undo to data.js defaults for free).
- **styles.css:** ~15 lines (`.rebalance-banner`, `.auto-chip`, diff rows).

## 9. Edge cases

- **14-month wall:** E clamps to 56; unresolved books flagged with `needsPagesPerWeek`; never emits monthIdx > 13.
- **Overdue monster book:** concurrency cap prevents mono-book weeks; its displayed rate collapses from all-remaining-this-week to the fitted rate post-apply.
- **remaining === 0, not complete:** excluded, surfaced "mark done instead."
- **Vacation/month gap:** median over session-containing weeks skips dead weeks; < 2 qualifying weeks → honest labeled default; planner refuses < 10.
- **Stale state under open modal:** per-change from-mismatch skip + week-drift abort at Apply.
- **Proposed end == data.js default:** override key DELETED (drift badges + `hasScheduleOverride` stay truthful).
- **Gist LWW:** never auto-runs; plan never persisted pre-apply; one debounced push per batch; "pull latest before applying" hint when gist configured. Stale-device clobber is pre-existing exposure — real fix is 2.4.
- **Draft books:** participate via the same accessors/keys.
- **Malformed synced state:** `getAutobalanceConfig()` normalizes; unparseable weekKeys → invalid[] (mirrors the existing "⚠ Invalid scheduling" card path).
- **Encoding:** clean UTF-8 only (mojibake history); APP_VERSION line untouched.

## 10. Accepted tradeoffs

1. **Never-shrink ratchet:** ends never pull in on a surge — ahead-compression is explicit opt-in in 2.3 (intent-preservation over recovery).
2. **Upcoming books frozen in MVP:** honest background load, but an unrealistic future start survives until active → possible repeat banner. 2.3 adds start-slides.
3. **Prose drift:** cluster spans/metas, `t.tf`, `r.when`, Study Plan labels don't move; ◆/outline affordances cover tracked surfaces. Real fix = 4.1 re-baseline.
4. **No test harness in MVP:** solver kept pure/deterministic so golden tests land cheaply in 3.2; scheduler.js file + memoization deliberately rejected (cache-coherence + document.write loader costs).
5. **Rolling-7d logged pages vs curriculum-week targets mismatch:** inherited app-wide, untouched.

## 11. Phase 1 commits (MVP: ~2 sessions, ~350-420 LOC app.js + ~15 styles.css, 0 data.js)

- **C1:** `weekIdx`/`idxToWeekKey` helpers; `autobalance` in `DEFAULT_PERSISTENT` + guard + `getAutobalanceConfig()`; `logScheduleChange` optional `source`. (~50 LOC)
- **C2:** `getWeeklyDemand()` extraction + `renderThisWeek` refactor (behavior-identical; verify load pill unchanged). (~30)
- **C3:** `getMeasuredCapacity()` median estimator. (~35)
- **C4:** `computeRebalancePlan()` pure solver. (~90)
- **C5:** `applyRebalancePlan()` + modal branch + bind() wiring + action-bar button. (~140)
- **C6:** This Week banner + snooze + `⚖ auto` log chip + styles. (~50)

---

# ROADMAP

## P1 — Autobalance (headline)

| # | Item | Rationale | Size |
|---|------|-----------|------|
| 1.1 | Week-index helpers + `P.autobalance` state + `scheduleLog.source` tag | Foundation; first shared inverse of the m*4+w convention | S |
| 1.2 | `getWeeklyDemand()` extraction from renderThisWeek:1137-1147 | Kills the would-be 9th copy of pacing math; planner objective == displayed pill by construction | S |
| 1.3 | Median capacity estimator (6 active curriculum weeks × 0.9) | Binge/vacation-resistant learned capacity — the "realistic in volume" primitive | S |
| 1.4 | `computeRebalancePlan()` pure solver (never-shrink, concurrency cap, horizon clamp) | Provably idempotent capacity fit; Sprint tiers front-loaded | M |
| 1.5 | Preview/apply modal + `applyRebalancePlan` + action-bar button | The trust surface: explicit diff, locks, staleness + week-drift guards, audit entries | M |
| 1.6 | Capacity-relative behind banner + snooze + `⚖ auto` log chip | Detection without shame; provenance in Schedule Changes | S |

## P2 — Scheduling trust & reach

| # | Item | Rationale | Size |
|---|------|-----------|------|
| 2.1 | Undo last rebalance (`lastRun.changes` reversed, `source:'autobalance-undo'`) | One-click confidence; edit-reset only reverts to data.js defaults, not pre-rebalance values | S |
| 2.2 | Chronic-slip stats from `P.scheduleLog` in autobalance preview + edit-book modal | The explicitly stated purpose of P4 #14 ("surface which books chronically slip and by how much") | M |
| 2.3 | Upcoming start-slides + opt-in ahead-compression in solver | Closes the recurring-nag loop and the never-shrink ratchet | M |
| 2.4 | Gist push conflict guard (compare remote `updated_at`/etag before PATCH; warn on mismatch) | LWW whole-file clobber is the systemic hazard; autobalance concentrates more value in the override maps | M |
| 2.5 | Extend `weeklyGantt` past hardcoded months 0-5 (app.js:1831-1835) | Rebalanced ends past Oct 2026 currently vanish from Week zoom — moves look like they "didn't take" | S/M |
| 2.6 | Stale-'now' detection (week drift from frozen CURRENT_* on render/visibilitychange → reload banner) | Long-lived tabs silently show stale pacing; generalizes the apply-time abort | S |

## P3 — Debt paydown (unlocked by 1.1)

| # | Item | Rationale | Size |
|---|------|-----------|------|
| 3.1 | Migrate ~8 inline `m*4+w` / `split('-W')` sites onto `weekIdx`/`idxToWeekKey` | Single week-math authority | M |
| 3.2 | Extract pure schedule/pacing math into a testable module + node golden tests (bit-parity fixtures) | First tests in the repo, gated migration — the scheduler-core payoff, de-risked | M/L |
| 3.3 | Dedupe `weekLabel` vs `weekKeyToLabel` | Near-identical implementations | S |
| 3.4 | Stable session ids; `deleteSession` by id not array index | Index deletion corrupts progress if any UI ever reorders/filters | S |
| 3.5 | `escapeHtml` audit (renderCluster interpolates title/desc raw; sweep all innerHTML sites) | Known laxity; cheap insurance | S |
| 3.6 | Replace `document.write('?v='+Date.now())` cache-buster with APP_VERSION-derived URLs | Assets never cached — wastes bandwidth, defeats offline | S |
| 3.7 | macOS commit pipeline (replace dead .ps1 tooling with a shell script or git hook; UTF-8-safe) | Zero commits since 2026-05-19 partly because the Windows pipeline has no path on this Mac | S |
| 3.8 | loadPersistent-grade normalization inside `pullFromGist` / `importState` | Both bypass type guards today; every new P field needs defensive accessors as workaround | S |

## P4 — Content lifecycle & polish

| # | Item | Rationale | Size |
|---|------|-----------|------|
| 4.1 | Re-baseline tool: extend `generatePatch` to emit data.js `BOOK_PROGRESS` snippets from live overrides | The cure for post-autobalance ◆ drift proliferation — promote accepted schedule to new defaults | M |
| 4.2 | Machine-readable cluster spans (structured startWeek/endWeek alongside prose, or derive from member books) | `parseClusterSpan` free-text is fragile/fail-closed; cluster metas have zero drift affordance | M |
| 4.3 | Study Plan "When" drift affordance (compare anchor vs live book span; mark stale rows) | The one schedule surface with no drift handling; autobalance multiplies its staleness | M |
| 4.4 | Data-driven tier (topic-level `tier` field with `tierOf` fallback) | `tierOf` hardcodes ids; runtime-added topics forced to tier 4, silently deprioritized by autobalance | S |
| 4.5 | Capacity trend sparkline on This Week (weekly page sums from the 1.3 estimator buckets) | Makes measured pace continuously visible, not just inside the modal | S |
| 4.6 | Fix save-edit unconditional `P.bookProgress[k] = newPage` write | Writes a page override even when unchanged, permanently masking later data.js `currentPage` edits | S |

**Sequencing:** 1.1→1.6 strictly ordered (each commit shippable). 2.1/2.2 depend only on P1. 2.4 is independent — pull forward if multi-device use increases. 3.1 precedes 3.2. 4.1 becomes valuable ~a month after autobalance is in regular use, once drift markers accumulate.
