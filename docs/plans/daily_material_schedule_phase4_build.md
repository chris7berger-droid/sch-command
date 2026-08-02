# DMS-1 Phase 4 — Crew Ticket (print) — build plan

**Repo:** sch-command · **Branch:** `feat/dms1-phase4`
**ERD:** inside open Loop #44 (the whole printed ticket — this is the built outcome that closes it). No new loop.
**Scope:** §4A only — the crew ticket that prints. §4B shortage view stays deferred to its own loop.
**Reference (the target):** `docs/plans/assets/6618-lakes-crossing-crew-ticket.pdf`

---

## §0 Baseline — observed current state (read-verified 2026-08-02)

Verified by reading the code, not by running the app (read-verified, NOT run-verified).

- **No crew-ticket / material-summary print code exists.** `grep -rl "window.print|@media print|ticket|material.*summary" src/` → only `FieldSowModal.jsx`, `exports.js`, `FieldSowBuilder.jsx` (none render a crew ticket). This feature is net-new.
- **A print harness already exists** to build on: `src/lib/exports.js:43` `printWin(title, bodyHtml)` opens a window, injects a Print/Save-as-PDF button + `@media print{button{display:none}}`. Existing users: `printWeekSchedule` (55), `printJobList` (93), `printMaterialsList` (110). The crew ticket follows the same pattern.
- **The materials view (Print's home) is** `src/components/LogisticsMaterials.jsx` (254 lines) — renamed from Materials in Phase 3.
- **Day data is reachable** at `job._wtcs[].field_sow` (array of days). Day shape (from `FieldSowBuilder.jsx:38-44`): `{ day_label ("Day 1"), date, tasks[], crew_count, hours_planned, materials[] }`. Task shape (`:36`): `{ id, description, pct_complete, size, unit }`. Material carries `kit_size, coverage_rate, mils, mix_time, mix_speed, cure_time, qty_planned, specs_confirmed`.
- **`day_label` already reads "Day 1"** (`FieldSowBuilder.jsx:39` ``day_label: `Day ${idx + 1}` ``) — no "of N" to strip; the PDF's "of 7" was mockup-only.
- **The unconfirmed predicate already exists:** `FieldSowBuilder.jsx:32` `materialBlocksPrint(m) = m.specs_confirmed !== true && hasAnySpec(m)`. We reuse it to render the tag (per decision #2 we tag, not block).
- **The rollup already exists:** `src/lib/sowMaterials.js` (Phase 3) groups per stable logical material (REG-4 grain — same material across days counts once) with 26/26 verify tests.
- **No DB objects needed** — everything above is read from existing `field_sow` jsonb. Confirmed: no migration in scope.

**Not yet observed (build-time confirm):** exact keys for `scope_notes` / `sq_ft` / `linear_ft` on a day (PDF shows them; confirm against `FieldSowView` render); whether page-1 totals sum `qty_planned` or reuse the rollup count.

---

## §7 Estimate / time budget

- **Est. code:** ~200–300 lines (one ticket builder + a button + print CSS). App-code only.
- **Time budget:** 90 min (single build cycle; low-risk, no DB, reuses print harness).

---

## 0. What this ships (plain)

A **Print button** in the materials view of a job. Clicking it opens a clean, printable
ticket that matches the reference PDF: a page-1 material checklist with totals + signature
lines, then one card per day (work, scope notes, materials), then a footer. Prints or
saves-as-PDF via the browser.

**No shortage math on the ticket** (that's the deferred §4B). Page-1 totals are just the
per-day quantities added up.

## 1. Decisions locked this ideate (2026-08-02, Chris)

1. **Where Print lives:** in the **materials / Logistics view** of a job (not the job overview,
   not the schedule board). You're already looking at the material list; Print sits there.
2. **Un-confirmed materials:** **do NOT block printing.** Just show a small "unconfirmed" tag
   next to any material still lacking its confirmed thumbs-up. Ship it; revisit if it bites.
   (Reverses the buildorder §4A "enforce specs_confirmed before print" gate — intentional.)
3. **Day header:** just **"Day 1", "Day 2"…** — drop the "of 7" badge. (Loop #44 locked decision;
   the PDF still shows the old "of 7" because it's the mockup.)
4. **Look:** slightly lighter than the PDF (Loop #44 reskin option a). Keep task tags, scope-notes
   callout, materials-as-text specs.
5. **Contents:** match the PDF 1:1 otherwise.

## 2. The pieces to build

### 2.1 Print button — `src/components/LogisticsMaterials.jsx`
- Add a **Print Ticket** button to the materials view header.
- On click → call the new ticket builder with the loaded job.
- Button style = existing content buttons (green accent).

### 2.2 Ticket builder — `src/lib/exports.js` (reuse existing print harness)
- **Reuse `printWin(title, bodyHtml)`** (already in exports.js — opens a window, injects a
  Print/Save-as-PDF button + `@media print` CSS). Same pattern as `printMaterialsList()`.
- New `printCrewTicket(job)` (or a small `src/lib/crewTicket.js` if the HTML grows) that builds:
  - **Page 1 — Material Order Summary:** logo + `JOB / JOB # / CUSTOMER / PREPARED BY` header;
    checklist of each material with a **TOTAL NEEDED** number; `LEAD / SALES SIGNATURE` lines.
    Totals = per-day quantities rolled up across all days.
  - **Per-day cards:** `day_label` ("Day 1") + item count; subline `Crew · Hours · Sq ft ·
    Linear ft · WTC`; **Work to Complete** (tasks + %, with task tags); **Scope Notes** callout;
    **Materials Needed** table (material, qty `N (kit: …)`, specs as text in Notes).
  - **Footer:** `N DAYS SCHEDULED · GENERATED <date>`.

### 2.3 Data sources (all already exist)
- **Days:** `job._wtcs[].field_sow` (array of days). Day shape:
  `{ day_label, date, tasks[], crew_count, hours_planned, materials[], scope_notes, sq_ft, linear_ft }`.
  (Confirm `scope_notes` / `sq_ft` / `linear_ft` exact keys at build — visible in FieldSowView render.)
- **Task shape:** `{ id, description, pct_complete, size, unit }`.
- **Material shape:** `{ product/name, kit_size, coverage_rate, mils, mix_time, mix_speed,
  cure_time, qty_planned, specs_confirmed }`.
- **Page-1 totals:** roll up per-day quantities. Prefer reusing `src/lib/sowMaterials.js` grouping
  (stable logical-material key, REG-4 grain — same-material-across-days counts once) so the summary
  matches the Logistics view. Confirm at build whether we sum `qty_planned` or the rollup's count.
- **Un-confirmed tag:** `materialBlocksPrint(m)` from FieldSowBuilder.jsx already = the exact
  predicate (`specs_confirmed !== true && hasAnySpec(m)`). Use it to render the tag — but per
  decision #2 we render, not block.

### 2.4 Print styling
- Page 1 as its own print page; day cards flow after. Use `@media print` page-break rules so a
  card doesn't split awkwardly.
- Logo asset: reuse whatever the app already ships (check `src/` for the HDSP logo used in nav).

## 3. Out of scope (do NOT build)
- Shortage / "do we have enough" status (OK / SHORT / verify) — deferred §4B, own loop.
- Any NEED = size ÷ coverage math on the ticket.
- Blocking print on unconfirmed specs.
- Retiring the legacy `materials` table — that's Phase 5.

## 4. Verify (before calling done)
- Build green (`npx vite build`).
- Open a real job with a SOW → Print → ticket matches the PDF (page 1 totals, one card per day,
  scope notes, specs text, signatures, footer).
- Day headers read "Day 1/2/3", no "of N".
- A material with unconfirmed specs shows the "unconfirmed" tag and still prints.
- Old job with no SOW → sensible empty/absent state (no crash).
- Save-as-PDF from the print dialog looks right.

## 5. Deploy
- Standard: preview deploy on `feat/dms1-phase4` → smoke → gate (buildvsplan / code-review /
  security-review) → merge to main → live on schedulecommand.com.
- **No DB changes** (app-code only — reads existing field_sow). No migration, no edge fn, no config.
- Closes Loop #44 when the ticket prints live.

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-08-02. Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
Small, low-risk change with **no database work** — it just reads job data that already exists and prints it. A light 2-reviewer check: one on "do the numbers and day cards come out right," one on "does the printed page look and behave right." Quick pass, not a deep one.

### Round
- Plan type: feature
- Current round: 1
- Plan revision under audit: uncommitted (will be the round-1 draft commit)
- Findings trend: n/a — round 1

### Prior rounds
none — this is round 1

**Briefing for agents**: attack the plan revision under audit. This is the first round; nothing to exclude.

### Deployment context
- **Live tenants**: 1 — HDSP only (Schedule Command prod, schedulecommand.com)
- **Prod / staging / dev**: affected surface is a new print path; nothing live for it yet. Reads existing prod `field_sow` data.
- **Blocking feature flags**: none
- **Concurrency profile**: solo / ≤5 (office staff)

Agents weight severity against these: cross-tenant findings cap at Med (1 tenant); multi-user race findings cap at Low (solo/≤5); print-is-read-only so blast radius is a bad printout, not data damage.

### Time budget + finding cap
- **Time budget**: 90 min (§7)
- **Finding cap**: 9 findings

Surface only the top 9 most consequential findings; remainder → "Quarantined findings (not actionable this loop)."

### Surface
- Total lines: 114
- Sections: 9 (§0, §7, 0–5)
- [LOCKED] decisions: 5 (§1)
- [DESIGN-OPEN] items: 0 (2 build-time confirms noted in §0)
- [OPEN] items: 0
- Plan-to-code ratio: 114 : ~250 (0.46:1) — not flagged

### Layers touched
- UI / components (Print button in LogisticsMaterials; the ticket render)
- Data layer (reads `field_sow`; reuses `sowMaterials.js` rollup)

### New mechanisms introduced
- New helper: `printCrewTicket(job)` (or `src/lib/crewTicket.js`) — the only novel mechanism
- Reused (not novel): `printWin` (exports.js), `materialBlocksPrint` (FieldSowBuilder), `sowMaterials.js` rollup

### Cross-system reach
none — app-code only; reads existing data; no other repo, edge fn, or service touched

### Irreversibility
none — all changes reversible; no migration, backfill, or public API change

### Known weak points
- **Page-1 totals grain (§2.3).** Must roll up per stable logical material (REG-4) so a material used on multiple days counts once, not N×. Highest-value correctness risk.
- **Qty source ambiguity (§2.3).** Undecided whether page-1 totals sum `qty_planned` or reuse the rollup count — a wrong pick silently prints wrong numbers.
- **Unverified day keys (§0).** `scope_notes` / `sq_ft` / `linear_ft` exact keys not yet observed — a mismatch renders blank sublines/callouts.
- **Legacy / empty-SOW jobs.** Old jobs with no `field_sow` must render an empty state, not crash.
- **Print page-breaks.** Day cards splitting across pages would make an ugly crew sheet.

### Open questions
- Count: 2 (both build-time confirms in §0) — day-field keys; qty source for totals
- Highest-pressure: the qty-source decision (drives whether printed totals are correct)

### Suggested attack angles (2 total)
1. **Ticket-content & data-mapping correctness** — covers Data layer + the render. Required reading: `src/lib/sowMaterials.js`, `src/components/FieldSowBuilder.jsx` (day/task/material shapes), the reference PDF. Specific pressure: page-1 totals grain (no N× overcount), qty source, per-day fields map to real `field_sow` keys, unconfirmed tag via `materialBlocksPrint`, empty/legacy-job safety.
2. **Print harness reuse & framework fit** — covers UI / components. Required reading: `src/lib/exports.js` (`printWin` + sibling print fns), `src/components/LogisticsMaterials.jsx`. Specific pressure: button placement matches existing patterns, print CSS page-breaks (card not split), logo-asset reuse, save-as-PDF fidelity, matches `exports.js` print-function conventions.

### Suggested agent count: 2

Rationale: 2 layers, 1 novel mechanism, no cross-system reach, <5 open questions → formula gives 2; a 3rd agent would have nothing distinct to attack on a read-only print path.
