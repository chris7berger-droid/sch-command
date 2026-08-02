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
- **Page-1 "TOTAL NEEDED" source = `proposal_wtc.materials[].qty`** (the bid quantity — Chris 2026-08-02, resolving the round-2 "dead field" collision). `field_sow.materials[].qty_planned` defaults to `0` at every add path (`FieldSowBuilder.jsx:115/153/170`) and is only set by rare manual entry — so summing it prints blank (round-2 R2-A, verified). The real "how many" is the **bid qty the salesperson enters on the proposal** (the QTY column on the WTC Materials tab). It lives in the **`proposal_wtc.materials` jsonb** (Sales-owned, shared DB). **sch-command already reads it:** `Jobs.jsx:205-207` does `supabase.from('proposal_wtc').select('id, materials, proposals!inner(call_log_id)').in('proposals.call_log_id', ...)` to feed the SOW editor's material picker — RLS access is proven live. Material shape there: `{ id, product, kit_size, qty, coverage_rate, supplier, price_per_unit, ... }`. Link to a job's WTC: `job_wtcs.proposal_wtc_id` ↔ `proposal_wtc.id`, or (as Jobs.jsx does) group by `call_log_id`.
  - **Neither §4B coverage math nor the `sowMaterials.js` rollup is involved** in the total — it's the stored bid qty, read directly.
  - **[SEMANTIC — live vs frozen]** `proposal_wtc.materials` is the LIVE proposal; a post-Send proposal edit would change these numbers. Acceptable for now (the proposal is the source of truth for what was sold; post-send edits are rare/intentional). Flagged, not blocking. Confirm at re-audit.
- **Legacy WTC fallback** (round-1 audit C3): `queries.js:714` — `sows = (wtcs && wtcs.length) ? wtcs.map(w => w.field_sow) : [job?.field_sow]`, then `Array.isArray(fs) ? fs : []` per day array. Mirror this so a legacy (non-WTC) job still renders.
- **Logo** (round-1 audit F): there is no "HDSP logo" asset — the brand mark is `ScheduleCommandMark` in `src/components/Logo.jsx`. Inline its static SVG as a literal string, or omit the logo. Drop the HDSP premise.
- **Day data is reachable** at `job._wtcs[].field_sow` (array of days). Day shape (from `FieldSowBuilder.jsx:38-44`): `{ day_label ("Day 1"), date, tasks[], crew_count, hours_planned, materials[] }`. Task shape (`:36`): `{ id, description, pct_complete, size, unit }`. Material carries `kit_size, coverage_rate, mils, mix_time, mix_speed, cure_time, qty_planned, specs_confirmed`.
- **`day_label` already reads "Day 1"** (`FieldSowBuilder.jsx:39` ``day_label: `Day ${idx + 1}` ``) — no "of N" to strip; the PDF's "of 7" was mockup-only.
- **The unconfirmed predicate already exists:** `FieldSowBuilder.jsx:32` `materialBlocksPrint(m) = m.specs_confirmed !== true && hasAnySpec(m)`. We reuse it to render the tag (per decision #2 we tag, not block).
- **`Materials.jsx` mount loads jobs WITHOUT WTC data** (round-2 R2-B): `Materials.jsx:35` uses plain `loadJobs()` → `_wtcs = []` → the day-card fallback drops to the stale `jobs.field_sow` mirror. Since the button is in all 3 mounts (§2.1), this mount must hydrate WTC + proposal-material data before printing, or it prints a blank/legacy ticket for modern jobs. Fix in §2.1.
- **No DB objects needed** — read from existing `field_sow` (day cards) + `proposal_wtc.materials` (page-1 totals), both already live. Confirmed: no migration in scope.

**Not yet observed (build-time confirm):** exact keys for `sq_ft` / `linear_ft` on a day (PDF shows them; confirm against a live `field_sow` row). `scope_notes` key IS confirmed — `FieldSowModal.jsx:111` reads it.

---

## §7 Estimate / time budget

- **Est. code:** ~250–350 lines (ticket component + page-1 bid summary + hydrate-on-click loader +
  `export`s on PRINT_CSS/DayCard + button). App-code only, two existing data sources.
- **Time budget:** 100 min (single build cycle; low-risk, no DB, reuses print harness + live reads).

---

## 0. What this ships (plain)

A **Print button** in the materials view of a job. Clicking it opens a clean, printable
ticket that matches the reference PDF: a page-1 material checklist with totals + signature
lines, then one card per day (work, scope notes, materials), then a footer. Prints or
saves-as-PDF via the browser.

**No shortage math on the ticket** (that's the deferred §4B). Page-1 "TOTAL NEEDED" is the
**bid quantity** the salesperson entered on the proposal (`proposal_wtc.materials[].qty`) —
not computed, just read. Day cards list which materials each day (no per-day qty — decision A below).

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
6. **[2026-08-02, Chris] Page-1 numbers = proposal bid qty** (`proposal_wtc.materials[].qty`), read
   directly — resolves the round-2 collision (see §0). Not the empty field_sow box, not §4B math.
7. **[2026-08-02, Chris] Day-card materials show NO per-day qty (decision A).** The day card lists
   which materials + specs + scope for that day; the crew reads total quantities off page 1. (The
   per-day `qty_planned` box is empty in the real flow, so there's nothing honest to print per day.)

## 2. The pieces to build

### 2.1 Print button — `src/components/LogisticsMaterials.jsx` (round-1 audit G)
- LogisticsMaterials has **no header row today** — add a deliberate header with a **Print Ticket**
  button, styled `app-act-btn app-act-primary` (the app's real button classes, matching
  FieldSowModal's Print PDF button — NOT a hand-rolled "green accent").
- **[LOCKED 2026-08-02, Chris] Mount scope = all 3.** Leave the button in the shared component so
  Print appears in all 3 mount points (material modal, JobDetail Logistics tab, Materials view) —
  it's the same materials view everywhere, so Print is available wherever you see the material list.
  Not gated to the modal.
- **[round-2 R2-B — real bug, fix regardless] `Materials.jsx` mount lacks the data to print.**
  `Materials.jsx:35` calls plain `loadJobs()` (no `_wtcs`), so from that mount the ticket would
  print blank/legacy for modern jobs. Fix: **hydrate on click** — when Print is pressed, load the
  job's WTC days (`loadJob`/`withWTCs`) + `proposal_wtc.materials` before building the ticket, so the
  builder always has both data sources regardless of which mount launched it. (Preferred over making
  `Materials.jsx` always load WTCs — keeps the list view light.)
- On click → hydrate (if needed) → call the ticket builder with the job + its proposal materials.

### 2.2 Ticket builder — reuse `FieldSowModal.jsx`'s print pattern (round-1 A, round-2 C/E/G)
- **Do NOT use `printWin`.** Build on FieldSowModal's harness:
  - **[round-2 R2-C — minimal, no new module] `DayCard` (`:95`) and `FieldSowView` (`:171`) are
    already clean, standalone components in FieldSowModal.jsx.** The only change needed is to **add
    `export` to `PRINT_CSS` and `DayCard`** and `import { PRINT_CSS, DayCard }` in the new ticket.
    **No `sowPrint.jsx` extraction, no render untangling** (the round-1 "extract to a shared module"
    was over-described — it misread the file). Lowest regression surface on the live SOW print.
  - **New crew-ticket component** renders into a `printRef`, then prints via the same
    `window.open` → `document.write(<style>${PRINT_CSS}</style> + el.innerHTML)` →
    `setTimeout(() => win.print(), 400)` sequence as `handlePrint` (`:227-233`).
  - **[round-2 R2-G — in-loop, net-new code] Guard `window.open`:** `const win = window.open(...); if (!win) { toast('Allow pop-ups to print'); return }` before `win.document.write`. This is new code (one line), not the deferred pre-existing FieldSowModal guard.
- **New markup on top of the reused DayCard render:**
  - **Page 1 — Material Order Summary:** brand mark (**[round-2 R2-G]** render `ScheduleCommandMark`
    as a React element under `printRef` — do NOT paste JSX-cased SVG attrs into an HTML string, which
    `innerHTML` mangles; or omit) + `JOB / JOB # / CUSTOMER / PREPARED BY` header; checklist of each
    **proposal bid material** with its **bid qty** as TOTAL NEEDED (see §2.3); `LEAD / SALES SIGNATURE`.
  - **Per-day cards:** **[round-2 R2-E — reuse DayCard as base, then EXTEND]** DayCard (`:100-163`)
    renders day_label, crew/hours meta, scope_notes, tasks, materials — but **NOT** the
    `Sq ft · Linear ft · WTC · item-count` subline the PDF shows. So reuse DayCard as the base and
    **extend it** to add those (confirm `sq_ft`/`linear_ft` keys on a live row per §2.3). Materials
    table shows material + specs-as-text; **no per-day qty column** (decision A). Task tags kept.
  - **Footer:** `N DAYS SCHEDULED · GENERATED <date>`.
  - (ADJ-1 backlog: 0%-complete task framing on the ticket — filed, not this loop.)

### 2.3 Data sources + mapping (round-1 B/C, round-2 A/D)

**Two data sources, two purposes:**

**(a) Page-1 "Material Order Summary" = proposal bid materials (`proposal_wtc.materials`).**
- Read exactly like `Jobs.jsx:205-207`:
  `supabase.from('proposal_wtc').select('id, materials, proposals!inner(call_log_id)').eq(... this job's call_log_id/proposal_wtc_id)`.
  From the hydrate-on-click path (§2.1), scope it to the one job.
- One checklist row **per bid material**: `product` (name) + **`qty` as TOTAL NEEDED** + `kit_size`
  as the unit label. The bid qty is already a per-material total — **no summing across days, no
  grouping/dedupe** needed (it's not the per-day list).
- **[C2]** display name = `m.product || m.name || 'Unnamed material'`. **[C2-guard]** a bid material
  with blank/0 qty prints "—", not a crash.

**(b) Day cards = per-day SOW (`field_sow`).**
- Mirror the `queries.js:714` legacy fallback —
  `sows = (wtcs?.length ? wtcs.map(w => w.field_sow) : [job.field_sow])`, then
  `Array.isArray(day array)`-guard each before mapping (C3). Day shape:
  `{ day_label, date, tasks[], crew_count, hours_planned, materials[], scope_notes, sq_ft, linear_ft }`.
- **[BUILD-CONFIRM C1]** verify `sq_ft` / `linear_ft` literal keys against a live `field_sow` row
  (`scope_notes` confirmed at `FieldSowModal.jsx:111`); **truthy-guard each subline segment** (a
  missing linear_ft drops that segment, never prints "Linear ft: undefined").
- Task shape: `{ id, description, pct_complete, size, unit }`. Day-material shape:
  `{ name/product, kit_size, coverage_rate, mils, mix_time, mix_speed, cure_time, specs_confirmed }`.
- **No per-day qty column** (decision A) — list material + specs-as-text only.
- **Un-confirmed tag (round-1 audit D — semantics decided):** tag = `materialBlocksPrint(m)`
  = `specs_confirmed !== true && hasAnySpec(m)`. A **spec-less** material (no specs at all) is
  deliberately **NOT tagged** — nothing to confirm. Render the tag, never block (decision #2).

**[VERIFY]** page-1 TOTAL NEEDED for each material == the QTY shown on that job's WTC Materials tab
in Sales (proves it's the bid qty read straight through, not a computed/dead-field number).

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
- Open a real job with a SOW → Print → ticket matches the PDF (page 1 bid-qty checklist, one card
  per day, scope notes, specs text, signatures, footer).
- **Page-1 numbers = bid qty:** page-1 TOTAL NEEDED for each material == the QTY on that job's WTC
  Materials tab in Sales (proves it's the proposal bid qty read through, not the dead field_sow box).
- **Print from all 3 mounts** (material modal, JobDetail Logistics tab, **and the Materials list
  view**) on a modern WTC job → full ticket every time, not blank (round-2 R2-B).
- Day headers read "Day 1/2/3", no "of N". Day cards show materials + specs, **no per-day qty**.
- A material with unconfirmed specs shows the "unconfirmed" tag and still prints; a spec-less
  material shows no tag.
- **Legacy (non-WTC) job** (`field_sow` on `jobs`, no `job_wtcs`) → renders via the fallback, no crash.
- Job with no SOW / no proposal materials → sensible empty/absent state (no crash).
- Pop-up blocked → friendly toast, no thrown error (R2-G guard).
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
- New crew-ticket component (renders page-1 bid summary + reused DayCards under a `printRef`) + a hydrate-on-click loader — the novel surface
- Reused (not novel): `PRINT_CSS` + `DayCard` from `FieldSowModal.jsx` (add `export`), `materialBlocksPrint` (FieldSowBuilder), the `Jobs.jsx:205` `proposal_wtc` read pattern. **NOT** `printWin` (round-2 R2-C corrected: use FieldSowModal's harness)

### Cross-system reach
- **Reads `proposal_wtc.materials`** — a Sales-owned table (source of truth for bid qty), same shared DB. sch-command already reads it (`Jobs.jsx:205`), RLS proven. Live-read (not a frozen snapshot) — see §0 live-vs-frozen semantic. No writes, no other repo touched.

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
2. **Print harness reuse & framework fit** — covers UI / components. Required reading: `src/components/FieldSowModal.jsx` (`PRINT_CSS`, `DayCard`, `handlePrint`), `src/components/LogisticsMaterials.jsx` (3 mounts). Specific pressure: DayCard extended (not verbatim) for the subline, `export`-only reuse (no new module), window.open guard, SVG-as-React, print CSS page-breaks, all-3-mounts hydrate.

### Suggested agent count: 2

Rationale: 2 layers, 1 novel mechanism, no cross-system reach, <5 open questions → formula gives 2; a 3rd agent would have nothing distinct to attack on a read-only print path.
