# Jobs Landing — Two-Section Redesign

_Draft v0.1, 2026-05-26. Owner: Chris + plan author. Source: ERD Loop #26 (`schedule-command-workflow-landing-page`). Scope: `/jobs` landing page only (`JobsPicker.jsx`). Status: DRAFT — pending audit, then commit to feature branch._

Tags: **[LOCKED]** (decided in ERD loop conversation) · **[DERIVED]** (from current code) · **[OPEN]** (open question) · **[STUB]** (new card, full view deferred).

---

## §1 Problem statement

**[LOCKED]** Today's `/jobs` landing (`JobsPicker.jsx`) is a flat grid of 7 unlabeled tiles. Users can't see at a glance that some tiles belong to **production/scheduling** (the crew's daily reality) and others belong to **management** (billing, margin, oversight). The picker also lacks two cards that are core to the manager's workflow — a **Production Complete** signal (crew off site, billing not yet 100%) and a **Budget** view (real-time margin, fed by Field Command DPRs).

This redesign:
- Splits the picker into two labeled sections — **Job Crew & Schedule Stages** (Section 1) and **Job Management Stages** (Section 2).
- Renames Scheduled → **Ready** (label only — DB status + URL slug unchanged).
- Adds a new **Production Complete** tile (Section 1, Stage 4).
- Adds a new **Budget** tile (Section 2) — STUB view this loop; real margin computation deferred until Field Command DPRs flow.
- Adds a new **Daily Logs** tile (Section 2) — points at the existing `/daily` route.
- Renames "Billing" → **Ready to Bill** (Section 2) — clarifies Schedule's role as handoff/staging, not invoicing.
- Renames "Production Rate" → **Production Rate Trackers** (Section 2).
- Moves the **Live Schedule** tile into Section 1 (it's a schedule view).
- Stage 2 **keeps the "Active" label** (NOT renamed to "Live") to avoid collision with "Live Schedule".

---

## §2 Final design — two sections, 10 tiles

### Section 1 — Job Crew & Schedule Stages (6 tiles)

| # | Tile | Today's tile | Action | Routes to | Count source |
|---|---|---|---|---|---|
| 1 | **Ready** | Scheduled | Rename label only | `/jobs?tab=scheduled` | `getJobStatus === 'Scheduled'` |
| 2 | **Active** | Active | Keep (no rename) | `/jobs?tab=active` | `getJobStatus in ['In Progress','Ongoing']` |
| 3 | **On Hold** | On Hold | Keep | `/jobs?tab=on-hold` | `getJobStatus === 'On Hold'` |
| 4 | **Production Complete** | _(none — count was on Billing tile)_ | **NEW** | `/jobs?tab=complete` _(new tab)_ | `getJobStatus === 'Complete'` |
| V | **All Jobs** | All Jobs | Keep | `/jobs?tab=all` | total |
| V | **Live Schedule** | Live Schedule | Keep, restated as Section 1 view | `/schedule` | `scheduled + inProgress` |

### Section 2 — Job Management Stages (4 tiles)

| # | Tile | Today's tile | Action | Routes to | Count source |
|---|---|---|---|---|---|
| 5 | **Ready to Bill** | Billing | Rename label (Billing → Ready to Bill) | `/billing` | Billing.jsx Pending bucket count _(see §4)_ |
| V | **Budget** _(STUB)_ | _(none)_ | **NEW** | `/budget` _(stub view)_ | `—` _(placeholder)_ |
| V | **Production Rate Trackers** | Production Rate | Rename label | `/production-rate` | `counts.inProgress` |
| V | **Daily Logs** | _(none — `/daily` exists in nav only)_ | **NEW** | `/daily` | _(see §4)_ |

**Total: 6 + 4 = 10 tiles in two labeled sections.**

---

## §3 Decisions ratified in ERD Loop #26

| ID | Decision | Rationale |
|---|---|---|
| D1 | **[LOCKED]** Rename Scheduled → Ready is **label only**. URL slug `?tab=scheduled` and DB status string `'Scheduled'` stay untouched. | No redirects, no bookmark breakage, no cross-app shape changes. |
| D2 | **[LOCKED]** Stage 2 **keeps "Active"** — NOT renamed to "Live". | Avoids "Live"/"Live Schedule" tile name collision. |
| D3 | **[LOCKED]** Stage 4 = **Production Complete** (crew/scheduler lens — work done in field). Ready to Bill = manager/bookkeeper lens. **Overlap is allowed** — a job can appear in both until billing reaches 100%. | One card per owner perspective. Don't smash two truths together. |
| D4 | **[LOCKED]** Schedule Command does **not** generate invoices. Ready to Bill is a staging/handoff queue. Invoicing lives in sales-command today, eventually AR Command. | Cross-app boundary best practice. |
| D5 | **[LOCKED]** Budget tile lands as a **STUB this loop**. Card is real; clicked view is a "Coming soon — wired when Field Command DPRs ship" placeholder. | Keep this loop honest at 1hr budget. Real margin view is its own future loop. |
| D6 | **[LOCKED]** Live Schedule sits in **Section 1**. | It's a Job Crew & Schedule view, fits Section 1. |
| D7 | **[LOCKED]** "Manage 100%" bar = **today's pattern**. Card → list of jobs → click job → `JobDetail.jsx`. No new in-card actions. | Zero new components; JobDetail already covers crew, billing, materials, history. |
| D8 | **[LOCKED]** (audit MED-1) Ready to Bill tile count uses the **simple formula** `getJobStatus === 'Complete' && billed < 100`. Tile descriptor renamed to **"Complete, not fully billed"** so the label matches what's computed. Mirroring `Billing.jsx`'s full Pending bucket (week-relative end_date, partials, paused partials, no_bill exclusion, dedup) is deferred to a follow-up refactor loop. | Avoids hauling `Billing.jsx` Pending logic into a count source on the landing page. Honest label > misleading count. |
| D9 | **[LOCKED]** (audit MED-2) **No helper extraction this loop.** Inline `getBilledTotal` formula directly in `JobsPicker.jsx`. `Jobs.jsx:53`, `JobCardList.jsx:34` (duplicate `getBilledTotal`), and `Billing.jsx:53` (`getBilledToDate` — same function under a different name) stay untouched. A 3-call-site consolidation loop is its own future work. | Stay scoped (memory: minimal-fix-first). Three lines of inline code beats a cross-file rename. |
| D10 | **[LOCKED]** (audit OPEN-1) Daily Logs tile shows `—` for v1, no count. Loading daily-log data into `Jobs.jsx` is deferred. | Same Budget-tile rationale (D5): card lands now, data source is its own loop. |

---

## §4 File-by-file changes

### §4.1 `src/components/JobsPicker.jsx` — primary surface

**Layout change.** Wrap current `<div className="jh-picker-grid">` in two grouped sections with headers:

```jsx
<div className="jh-picker">
  <div className="jh-picker-intro">...</div>

  <section className="jh-picker-section">
    <h3 className="jh-picker-section-title">Job Crew & Schedule Stages</h3>
    <div className="jh-picker-grid">
      {/* Ready · Active · On Hold · Production Complete · All Jobs · Live Schedule */}
    </div>
  </section>

  <section className="jh-picker-section">
    <h3 className="jh-picker-section-title">Job Management Stages</h3>
    <div className="jh-picker-grid">
      {/* Ready to Bill · Budget · Production Rate Trackers · Daily Logs */}
    </div>
  </section>
</div>
```

**Tile changes:**
- Rename "Scheduled" → "Ready" (label string only; class `jh-tile-scheduled` unchanged).
- Add new **Production Complete** tile. Count source: `counts.complete`. Wires to `() => goTab('complete')`. Description: e.g. _"Crew off site, work finished. Hand off to billing."_
- Add new **Budget** tile (STUB). Count: `—`. Wires to `() => navigate('/budget')`. Description: _"Real-time margin per job. Coming soon — wired to Field Command DPRs."_
- Add new **Daily Logs** tile. Count: see §4.4. Wires to `() => navigate('/daily')`. Description: _"Daily crew status, photos, notes from the field."_
- Rename "Billing" → "Ready to Bill" (label only).
- Rename "Production Rate" → "Production Rate Trackers" (label only).
- "Billing" tile count source changes from `counts.complete` → `counts.readyToBill` _(new — see §4.4)_.
- Move tiles into the correct sections per §2.

### §4.2 `src/views/Jobs.jsx`

- Add `'complete'` to `VALID_TABS` array (line 12).
- Add the corresponding render block (line ~395 area, mirror the `'all'` block) that filters `filteredJobs.filter(j => getJobStatus(j) === 'Complete')` and renders via `JobCardList` (reusing the existing component). Update the `jh-back-context` ternary to include the Complete label.
- No other Jobs.jsx changes required (scoreboard already computes `completeCount`).

### §4.3 New stub view — `src/views/Budget.jsx`

Minimal placeholder, ~30 LOC:
```jsx
export default function Budget() {
  return (
    <div className="jh-wrap">
      <div className="jh-empty">
        Budget — coming soon. Will surface real-time per-job margin
        once Field Command DPRs are flowing.
      </div>
    </div>
  )
}
```

Wire into `App.jsx`:
- Import `Budget` from `./views/Budget`.
- Add route: `<Route path="/budget" element={<Budget />} />`.
- Do **not** add to main nav (tile-only access this loop).

### §4.4 Count derivation — `JobsPicker.jsx` (resolved per audit D8/D9/D10)

| Count | Definition | Source |
|---|---|---|
| `counts.readyToBill` | Complete-status jobs that are not fully billed. **Tile label: "Complete, not fully billed"** (per D8 — label matches the simple formula, NOT Billing.jsx's full Pending bucket). | Inline (per D9): `jobs.filter(j => { const billed = (billingLog || []).filter(b => b.job_id === j.job_id).reduce((s,b) => s + (parseFloat(b.percent) || 0), 0); return getJobStatus(j) === 'Complete' && billed < 100 })` |
| `counts.dailyLogs` | Locked at `—` for v1 (per D10). No data load. | n/a |

**Implementation:**
- `Jobs.jsx` already loads `billingLog` (line 132). Pass it down: `<JobsPicker billingLog={billingLog} ... />`.
- In `JobsPicker.jsx`, compute `readyToBill` inline inside the existing `useMemo` (alongside `scheduled`, `inProgress`, etc.). No new file. No helper extraction.
- `Jobs.jsx:53` `getBilledTotal`, `JobCardList.jsx:34` duplicate, and `Billing.jsx:53` `getBilledToDate` (same function, different name) are NOT touched in this loop (per D9).

### §4.5 CSS — `src/App.css` (or wherever `.jh-picker-grid` lives)

New rules:
- `.jh-picker-section` — margin between sections (~32px bottom).
- `.jh-picker-section-title` — Barlow Condensed, uppercase, letter-spacing 0.06em, color `#1c1814`, font-size ~14px, margin-bottom ~12px. Matches the existing design system per `CLAUDE.md` Design System section.
- Optional: thin divider line under section title (`border-bottom: 1px solid rgba(28,24,20,0.12)`).

---

## §5 Implementation steps (build mode)

This plan is the input to a **build mode** loop (opus 4.6, medium). Do not start build before the audit pass closes.

1. Branch from `main`: `git checkout -b feat/jobs-landing-sections`.
2. _(Removed per D9 — no helper extraction. Step renumbered below.)_
3. Update `JobsPicker.jsx`:
   - Add `billingLog` prop.
   - Add `counts.readyToBill` to the `useMemo` using the inlined formula per §4.4.
   - Restructure JSX into two `<section>` blocks per §4.1.
   - Add Production Complete, Budget, Daily Logs tiles.
   - Rename tile labels per §2 (note: Ready to Bill tile descriptor = "Complete, not fully billed" per D8).
   - Daily Logs tile count = `—` per D10.
4. Update `Jobs.jsx`:
   - Add `'complete'` to `VALID_TABS`.
   - Add the Complete tab render block.
   - Pass `billingLog` to `<JobsPicker>`.
5. Create `src/views/Budget.jsx` (stub).
6. Wire `/budget` route in `App.jsx`.
7. Add CSS for `.jh-picker-section` + `.jh-picker-section-title`.
8. Smoke locally:
   - All 10 tiles render in correct sections.
   - Counts populate (Ready, Active, On Hold, Production Complete, All Jobs, Ready to Bill, Production Rate Trackers).
   - Each tile click lands on the correct route/tab.
   - Production Complete tab renders a list of `Complete`-status jobs; clicking opens `JobDetail`.
   - Budget tile lands on "Coming soon" stub.
   - Daily Logs tile lands on existing `/daily` view.
9. Preview deploy via Vercel feature branch.
10. Merge to main once smoke passes on preview.

**Estimated build time:** ~2hr (under medium-effort opus 4.6).

---

## §6 Out of scope (explicit)

- **Per-card workflow audit.** Decision D7: today's JobDetail pattern is sufficient. No per-card workflow gap analysis in this loop.
- **Real Budget view.** Decision D5: STUB only.
- **DB status renames** (`Scheduled` → `Ready` in `jobs.status`). Decision D1: label-only.
- **URL slug renames** (`?tab=scheduled` → `?tab=ready`). Decision D1: label-only.
- **Cross-app billing handoff workflow.** Decision D4: noted, but actual AR Command build is its own future project.
- **Field Command DPR wiring.** Out of scope; prerequisite for the real Budget view.

---

## §7 Open questions / risks

- **[RESOLVED]** OPEN-1 (Daily Logs tile count) → **D10**: locked at `—` for v1.
- **[RISK-1]** **Realtime subscription.** `Jobs.jsx:168` subscribes to the `jobs` table. If `billing_log` changes, `counts.readyToBill` won't auto-refresh without a second channel. Acceptable for v1 (count goes stale until next page load); document for v2.
- **[RISK-2]** **Tile-count discrepancy.** Production Complete and Ready to Bill counts will overlap for the same jobs (by design, D3). Adds up to more than the "All Jobs" count. Flag visually if it confuses users; otherwise document in tile descriptions.
- **[RISK-3]** **Class names referencing old labels.** `.jh-tile-scheduled`, `.jh-tile-active`, `.jh-tile-billing` stay (D1: label-only). Future devs may be confused that the class says `scheduled` but the label says `Ready`. Acceptable trade-off; class rename is its own future loop.

---

## §8 ERD context

- **Loop #26** locked 2026-05-26 15:48.
- **Task:** `schedule-command-workflow-landing-page`.
- **Time budget:** 1hr (this plan + audit pass). Build is a follow-up loop.
- **Success defn (from lock):** "The landing page is split in two sections, one for Work Schedule Stages and one for Job Management Stages. Each card opens and has functions inside that allow the user to manage the job 100%."
- **This plan satisfies the success defn IF:** the build loop ships §5 steps 1–10, smoke passes on preview, and the existing JobDetail pattern (D7) is accepted as "manage 100%."

---

---

## §9 Audit history

| Date | Findings | Resolution |
|---|---|---|
| 2026-05-26 | 2 Med, 4 Low | MED-1 → D8 (rename descriptor, keep simple formula). MED-2 → D9 (no helper extraction, inline). OPEN-1/LOW-2 → D10 (Daily Logs count = `—` for v1). All amendments applied before commit. |

Proposed AUDIT_LOG row (Chris to file in a future repo-level AUDIT_LOG.md if/when that ledger exists):

```
| 2026-05-26 | docs/plans/jobs_landing_sections_redesign.md | 6 | 2 Med, 4 Low | accepted-pending-changes | spec-drift |
```

---

_End of plan. Audit applied. Committing to `feat/jobs-landing-sections` next._
