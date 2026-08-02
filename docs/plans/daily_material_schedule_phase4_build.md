# DMS-1 Phase 4 — Crew Ticket (print) — build plan

**Repo:** sch-command · **Branch:** `feat/dms1-phase4`
**ERD:** inside open Loop #44 (the whole printed ticket — this is the built outcome that closes it). No new loop.
**Scope:** §4A only — the crew ticket that prints. §4B shortage view stays deferred to its own loop.
**Reference (the target):** `docs/plans/assets/6618-lakes-crossing-crew-ticket.pdf`

---

## §0 Baseline — observed current state (read-verified 2026-08-02)

Verified by reading the code, not by running the app (read-verified, NOT run-verified).

- **No crew-ticket / material-summary print code exists.** This feature is net-new.
- **The RIGHT print harness to reuse is `FieldSowModal.jsx`** (round-1 audit A — corrects the earlier `printWin` premise). It already renders a print-quality SOW: `PRINT_CSS` (`:31-56`) carries the full design system (linen/dark/teal, Barlow/JetBrains fonts), `break-inside: avoid` on `.sow-day`, and `print-color-adjust: exact`. The render is a React ref (`printRef`), and `handlePrint` (`:227-233`) does `window.open('', '_blank')` → `document.write(<style>${PRINT_CSS}</style> + el.innerHTML)` → `setTimeout(() => win.print(), 400)`. It escapes free text via React (no manual HTML concatenation). `printWin` in exports.js is a bare string-writer with none of this — do NOT use it.
- **The materials view (Print's home) is** `src/components/LogisticsMaterials.jsx` (254 lines, renamed from Materials in Phase 3). It has **NO header row** — the first control is `+ Add material` (`:145`). It is a **shared component with 3 mount points**: `MaterialsModal.jsx` (the material modal, opened from `StageJobCard`), the `JobDetail` "Logistics" tab (`JobDetail.jsx:422`), and `Materials.jsx` view. Any button added here appears in all three.
- **Grouping key for totals** (round-1 audit B): `sowMaterials.js:97` keys material identity as `m.catalog_id != null ? cat:${catalog_id} : name:${norm(m.name || m.product)}`. Use this exact identity for the page-1 sum.
- **Legacy WTC fallback** (round-1 audit C3): `queries.js:714` — `sows = (wtcs && wtcs.length) ? wtcs.map(w => w.field_sow) : [job?.field_sow]`, then `Array.isArray(fs) ? fs : []` per day array. Mirror this so a legacy (non-WTC) job still renders.
- **Logo** (round-1 audit F): there is no "HDSP logo" asset — the brand mark is `ScheduleCommandMark` in `src/components/Logo.jsx`. Inline its static SVG as a literal string, or omit the logo. Drop the HDSP premise.
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

### 2.1 Print button — `src/components/LogisticsMaterials.jsx` (round-1 audit G)
- LogisticsMaterials has **no header row today** — add a deliberate header with a **Print Ticket**
  button, styled `app-act-btn app-act-primary` (the app's real button classes, matching
  FieldSowModal's Print PDF button — NOT a hand-rolled "green accent").
- **[LOCKED 2026-08-02, Chris] Mount scope = all 3.** Leave the button in the shared component so
  Print appears in all 3 mount points (material modal, JobDetail Logistics tab, Materials view) —
  it's the same materials view everywhere, so Print is available wherever you see the material list.
  Not gated to the modal.
- On click → call the new ticket builder with the loaded job.

### 2.2 Ticket builder — reuse `FieldSowModal.jsx`'s print pattern (round-1 audit A)
- **Do NOT use `printWin`.** Build on FieldSowModal's harness instead:
  - **Extract/share `PRINT_CSS`** (`FieldSowModal.jsx:31-56`) and the **DayCard render** so the
    crew ticket reuses them verbatim — this inherits page-breaks (`break-inside: avoid`),
    `print-color-adjust: exact`, the design system, and React free-text escaping for free.
    (Extract to a shared module, e.g. `src/components/sowPrint.js[x]`, imported by both
    FieldSowModal and the new ticket — don't fork/copy the CSS.)
  - **New crew-ticket component** renders into a `printRef`, then prints via the same
    `window.open` → `document.write(<style>${PRINT_CSS}</style> + el.innerHTML)` →
    `setTimeout(() => win.print(), 400)` sequence as `handlePrint` (`:227-233`).
    (ADJ-2 backlog: `window.open` can return null under popup-block — guard it; filed, not this loop.)
- **New markup on top of the shared DayCard render:**
  - **Page 1 — Material Order Summary:** brand mark (inline `ScheduleCommandMark` SVG or omit,
    per §0 / audit F) + `JOB / JOB # / CUSTOMER / PREPARED BY` header; checklist of each material
    with a **TOTAL NEEDED** number (see §2.3 for the sum); `LEAD / SALES SIGNATURE` lines.
  - **Per-day cards:** reuse the DayCard render — `day_label` ("Day 1") + item count; subline
    `Crew · Hours · Sq ft · Linear ft · WTC`; **Work to Complete** (tasks + %, task tags);
    **Scope Notes** callout; **Materials Needed** table (material, qty `N (kit: …)`, specs as text).
  - **Footer:** `N DAYS SCHEDULED · GENERATED <date>`.
  - (ADJ-1 backlog: 0%-complete task framing on the ticket — filed, not this loop.)

### 2.3 Data sources + mapping (round-1 audit B, C1/C2/C3)
- **Days:** mirror the `queries.js:714` legacy fallback —
  `sows = (wtcs?.length ? wtcs.map(w => w.field_sow) : [job.field_sow])`, then
  `Array.isArray(day array)`-guard each before mapping (C3). Day shape:
  `{ day_label, date, tasks[], crew_count, hours_planned, materials[], scope_notes, sq_ft, linear_ft }`.
  **[BUILD-CONFIRM C1]** verify `sq_ft` / `linear_ft` / `scope_notes` **literal keys against a live
  `field_sow` row** before wiring, and **truthy-guard each subline segment** (a missing linear_ft
  drops that segment, doesn't print "Linear ft: undefined").
- **Task shape:** `{ id, description, pct_complete, size, unit }`.
- **Material shape:** `{ name/product, kit_size, coverage_rate, mils, mix_time, mix_speed,
  cure_time, qty_planned, specs_confirmed }`. **[C2]** read the display name as
  `m.name || m.product || 'Unnamed material'`.
- **Page-1 "TOTAL NEEDED" = SUM of per-day `m.qty_planned`**, grouped by material identity
  `m.catalog_id ?? name:${norm(m.name || m.product)}` (matching `sowMaterials.js:97`).
  **Do NOT call `rollupSowMaterials` for the total** — its `qty_needed` is the deferred §4B
  coverage math (size ÷ coverage), a different number. Print `kit_size` as the unit label next to
  the summed qty.
  **[VERIFY]** on a 2-day job, printed page-1 total for a repeated material == hand-sum of its
  `qty_planned` across both days.
- **Un-confirmed tag (round-1 audit D — semantics decided):** tag = `materialBlocksPrint(m)`
  = `specs_confirmed !== true && hasAnySpec(m)`. A **spec-less** material (no specs at all) is
  deliberately **NOT tagged** — there's nothing to confirm, so it's not a data gap worth flagging
  on a crew sheet. We only surface materials that HAVE specs but haven't been confirmed. Render the
  tag, never block (decision #2).

### 2.4 Print styling (inherited from FieldSowModal)
- Page-breaks, `print-color-adjust: exact`, and the design system come free from the shared
  `PRINT_CSS` (§2.2) — `.sow-day` already carries `break-inside: avoid`. Add a page-break so page 1
  (material summary) sits on its own sheet before the day cards.
- **Logo:** inline `ScheduleCommandMark`'s SVG (from `Logo.jsx`) as a literal string, or omit — no
  external asset (audit F).

## 3. Out of scope (do NOT build)
- Shortage / "do we have enough" status (OK / SHORT / verify) — deferred §4B, own loop.
- Any NEED = size ÷ coverage math on the ticket.
- Blocking print on unconfirmed specs.
- Retiring the legacy `materials` table — that's Phase 5.

## 4. Verify (before calling done)
- Build green (`npx vite build`).
- Open a real job with a SOW → Print → ticket matches the PDF (page 1 totals, one card per day,
  scope notes, specs text, signatures, footer).
- **Totals hand-sum:** on a 2-day job with a repeated material, page-1 TOTAL NEEDED ==
  hand-sum of that material's `qty_planned` across both days (proves it's the sum, not §4B math).
- Day headers read "Day 1/2/3", no "of N".
- A material with unconfirmed specs shows the "unconfirmed" tag and still prints; a spec-less
  material shows no tag.
- **Legacy (non-WTC) job** (`field_sow` on `jobs`, no `job_wtcs`) → renders via the fallback, no crash.
- Old job with no SOW at all → sensible empty/absent state (no crash).
- Save-as-PDF from the print dialog looks right; page 1 is its own sheet.

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
