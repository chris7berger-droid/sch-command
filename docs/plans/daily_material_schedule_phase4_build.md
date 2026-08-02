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
- **[round-2 R2-B + round-3 REG-B — concrete loader spec] Hydrate on click, two awaits.**
  `Materials.jsx:35` calls plain `loadJobs()` (no `_wtcs`), so from that mount the ticket would
  print blank/legacy for modern jobs. Fix — on Print press, do **two async fetches**:
  1. `loadJobWithWTCs(jobId)` (`queries.js:285`) → the job's `_wtcs[]` (each with `field_sow` + `proposal_wtc_id`).
  2. a **single-job `proposal_wtc` read** (the §2.3a query, scoped to this job's WTCs) → the bid materials.
  **Ordering + state (REG-B):** keep a `printing`/`loading` state that **disables the Print button
  until BOTH fetches resolve**; build + open the ticket **only after both settle**. Do not treat
  "hydrate then build" as one sync step. On either fetch erroring → toast, re-enable, don't open a
  blank window. (Preferred over making `Materials.jsx` always load WTCs — keeps the list view light.)

### 2.2 Ticket builder — reuse `FieldSowModal.jsx`'s print pattern (round-1 A, round-2 C/E/G)
- **Do NOT use `printWin`.** Build on FieldSowModal's harness:
  - **[round-2 R2-C — minimal, no new module] `DayCard` (`:95`) and `FieldSowView` (`:171`) are
    already clean, standalone components in FieldSowModal.jsx.** The only change needed is to **add
    `export` to `PRINT_CSS` and `DayCard`** and `import { PRINT_CSS, DayCard }` in the new ticket.
    **No `sowPrint.jsx` extraction, no render untangling** (the round-1 "extract to a shared module"
    was over-described — it misread the file). Lowest regression surface on the live SOW print.
  - **The crew ticket is a React COMPONENT** (not a bare "builder" fn) — it renders into a `printRef`,
    then prints via the same `window.open` → `document.write(<style>${TICKET_CSS}</style> + el.innerHTML)`
    → `setTimeout(() => win.print(), 400)` sequence as `handlePrint` (`:227-233`). Being a component
    is required for REG-C and the SVG (both need render context).
  - **[round-3 REG-C — toast is a hook] Guard `window.open`:** at the top of the component,
    `const toast = useToast()` (`toast.jsx:25` — hook, only callable inside render). Then
    `const win = window.open('', '_blank'); if (!win) { toast('Allow pop-ups to print', 'err'); return }`
    before `win.document.write`. (The round-2 note "call toast()" from a plain function was wrong — a
    builder fn can't call the hook.)
- **[round-3 REG-A — DECIDED: `showQty` prop] Reusing DayCard collides with decision A.** DayCard
  renders a **Qty column** (`FieldSowModal.jsx:139/:150` = `qty_planned || '-'`) that decision A
  forbids on the ticket. You can't drop a column by "extending." **Fix: add a `showQty` prop to
  DayCard, default `true`** (so the live SOW print is unchanged); the **ticket passes `showQty={false}`**.
  This **IS an edit to shared DayCard** — §4 must re-verify the live SOW modal still shows its Qty column.
  (Chris's call: `showQty` prop over forking `TicketDayCard` — keeps one source of truth, matches the
  codebase's prop-driven convention. Round-2's "no new module" stands.)
- **New markup on top of the reused DayCard render:**
  - **Page 1 — Material Order Summary:** brand mark (**[REG-G/N7]** render `ScheduleCommandMark`
    as a React element under `printRef` — NOT JSX-cased SVG attrs in an HTML string, which `innerHTML`
    strips/mangles; **if the SVG doesn't survive the `innerHTML` round-trip, omit the logo** — quarantined
    N7) + `JOB / JOB # / CUSTOMER / PREPARED BY` header; checklist of each **proposal bid material**
    with its **bid qty** as TOTAL NEEDED (see §2.3); `LEAD / SALES SIGNATURE`.
  - **Per-day cards:** **[round-2 R2-E / round-3 N2]** reuse DayCard (`showQty={false}`) but keep the
    `{wtcLabel, days}` grouping from `FieldSowView:175` (do NOT flatMap to bare days — §2.3b) so the
    subline can show **WTC + item count**; extend DayCard to add the `Sq ft · Linear ft` subline
    (renders only on nonzero entries — quarantined N8). Task tags kept.
  - **Footer:** `N DAYS SCHEDULED · GENERATED <date>`.
  - (ADJ-1 backlog: 0%-complete task framing on the ticket — filed, not this loop.)

### 2.3 Data sources + mapping (round-1 B/C, round-2 A/D)

**Two data sources, two purposes:**

**(a) Page-1 "Material Order Summary" = proposal bid materials (`proposal_wtc.materials`).**
- **[round-3 N1 — scope to SCHEDULED WTCs, then sum by identity]** Read `proposal_wtc` filtered to
  **only this job's scheduled WTCs** — `WHERE proposal_wtc.id IN (job._wtcs[].proposal_wtc_id)`
  (mirror `CardSowModal.jsx:76`). Do **NOT** group by `call_log_id` — that would pull in every WTC of
  the proposal, including ones never sent to schedule (over-scope), and print each WTC's copy of a
  shared product as a separate row (double-count). Then **group/sum `qty` by material identity across
  the scheduled WTCs** so the same product bid on two WTCs shows one row with the combined total.
- **[N5]** identity + display name = `m.product || m.name || 'Unnamed material'` (SAME accessor on
  page-1 AND day cards — no `product‖name` vs `name‖product` split). Row = name + summed `qty` as
  TOTAL NEEDED + `kit_size` unit label. **[C2-guard]** blank/0 qty prints "—", not a crash.
- **[round-3 N3 — empty-state is a spec, not an aspiration]** A job with no `proposal_wtc` row
  (archive / no-proposal job) → page 1 still renders **header + signatures + a "No bid materials on
  file" row**. Guard `materials` null/`[]`.
- **[round-3 N4 — distinguish error from empty]** The single-job read can return `[]` on an RLS/query
  error, which looks identical to "no materials." **Check the query error separately:** on error →
  toast + treat as a failure (don't silently print blank); on genuine empty → the N3 empty-state.
  (Security floor is clean — the inner-join scopes by `call_log.tenant_id`, no cross-tenant leak — so
  this is a UX/correctness guard, not a leak fix.)

**(b) Day cards = per-day SOW (`field_sow`).**
- **[round-3 N2 — keep the WTC grouping, don't flatten]** Preserve the `{wtcLabel, days}` structure
  from `FieldSowView:175` (`wtcLabel` = `work_type_name` on the `_wtcs[]` row). Do **NOT**
  `flatMap(w => w.field_sow)` to bare days — that drops the WTC label the day subline needs.
- Legacy fallback (C3): a non-WTC job has no `_wtcs` → fall back to
  `[{ wtcLabel: null, days: Array.isArray(job.field_sow) ? job.field_sow : [] }]`. Day shape:
  `{ day_label, date, tasks[], crew_count, hours_planned, materials[], scope_notes, sq_ft, linear_ft }`.
- **[BUILD-CONFIRM C1 / N8]** verify `sq_ft` / `linear_ft` literal keys against a live `field_sow` row
  (`scope_notes` confirmed at `FieldSowModal.jsx:111`); **truthy-guard each subline segment** — note
  N8: `sq_ft`/`linear_ft` default to `0` (`WTCCalculator.jsx:948`), so the guarded segment is blank on
  most days. That's expected, not a bug — don't oversell the subline.
- Task shape: `{ id, description, pct_complete, size, unit }`. Day-material shape:
  `{ name/product, kit_size, coverage_rate, mils, mix_time, mix_speed, cure_time, specs_confirmed }`.
  **[N5]** day-card material name uses the SAME accessor as page 1: `m.product || m.name || 'Unnamed material'`.
- **No per-day qty column** (decision A) — DayCard gets `showQty={false}` (REG-A); list material + specs-as-text only.
- **Un-confirmed tag (round-1 audit D — semantics decided):** tag = `materialBlocksPrint(m)`
  = `specs_confirmed !== true && hasAnySpec(m)`. A **spec-less** material (no specs at all) is
  deliberately **NOT tagged** — nothing to confirm. Render the tag, never block (decision #2).

**[VERIFY]** page-1 TOTAL NEEDED for each material == the QTY shown on that job's WTC Materials tab
in Sales (proves it's the bid qty read straight through, not a computed/dead-field number).

### 2.4 Print styling
- `print-color-adjust: exact`, fonts, and `.sow-day break-inside: avoid` come free from the imported
  `PRINT_CSS` (§2.2) — the day cards inherit them.
- **[round-3 N6 — ticket-only page-break, NOT in shared PRINT_CSS]** The "page 1 on its own sheet"
  rule must live in the **ticket's OWN `<style>` block under a ticket-only selector** (e.g.
  `.crew-ticket-page1 { break-after: page }`). Do **NOT** add it to shared `PRINT_CSS` — the live SOW
  print consumes that CSS and would get a stray blank page. So the ticket ships two style sources:
  imported `PRINT_CSS` (shared, untouched) + a small ticket-local block for page-1 break + any
  page-1-summary styling.
- **Logo:** render `ScheduleCommandMark` as a React element (§2.2); if it doesn't survive the
  `innerHTML` round-trip, omit it (N7).

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
  view**) on a modern WTC job → full ticket every time, not blank (REG-B). Print button is disabled
  until both fetches resolve.
- **[REG-A] Live SOW print still shows its Qty column** — open FieldSowModal → Print PDF, confirm the
  `showQty` default didn't regress it.
- **[N1] Multi-WTC job** (2+ scheduled WTCs sharing a product) → page 1 shows ONE row with the summed
  qty, and NO materials from unscheduled WTCs.
- Day headers read "Day 1/2/3", no "of N". Day cards show materials + specs, **no per-day qty**; WTC
  label + item count present on the subline (N2).
- A material with unconfirmed specs shows the "unconfirmed" tag and still prints; a spec-less
  material shows no tag.
- **Legacy (non-WTC) job** (`field_sow` on `jobs`, no `job_wtcs`) → renders via the fallback, no crash.
- **[N3] Archive / no-proposal job** → page 1 = header + signatures + "No bid materials on file", no crash.
- **[N4] Read error vs empty** → a failed proposal read toasts an error, does not print a silent blank page.
- Pop-up blocked → friendly toast, no thrown error (REG-C).
- Save-as-PDF from the print dialog looks right; page 1 is its own sheet (N6 ticket-only break).

## 5. Deploy
- Standard: preview deploy on `feat/dms1-phase4` → smoke → gate (buildvsplan / code-review /
  security-review) → merge to main → live on schedulecommand.com.
- **No DB changes** (app-code only — reads existing field_sow). No migration, no edge fn, no config.
- Closes Loop #44 when the ticket prints live.

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-08-02 (round 3 regen). Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
The risky part of this change is now the new number source: page-1 quantities are read live from the **salesperson's proposal** (a Sales-owned table), not from Schedule's own data. So this round points 3 reviewers at (1) is that cross-app read correct and safe — does it pull the right job's numbers, and what happens if the proposal is edited after the crew sheet was made; (2) did the last revision's fixes actually land; (3) do the day cards still come out right. Slightly bigger check than before because the numbers now cross an app boundary.

### Round
- Plan type: feature
- Current round: 3
- Plan revision under audit: `bd4c4ce` (revision pass 2 — round-2 response)
- Findings trend: round 1 (7 · 2H/4M/1L) → 2 (7 · 2H/3M/2L) → 3 (?) — **held flat 7→7; plateau signal active.** Each round has found a genuinely different real bug (harness → dead field → cross-app read), not re-litigation — but if round 3 holds flat again on the SAME mechanism (proposal read), `/runaudit` must force a scope-cut, not another patch round.

### Prior rounds
- Round 1: `997b45c` · 0C/2H/4M/1L · pattern: wrong-baseline-premise (built on printWin; totals from rollup coverage-math)
- Round 2: `bd4c4ce` · 0C/2H/3M/2L · pattern: totals-source-dead-field (qty_planned defaults 0 → blank totals; Materials-mount unhydrated)

**Briefing for agents**: do NOT re-find round-1/2 issues — the revision-pass commit messages are the canonical record of what was addressed. Attack ONLY material new to `bd4c4ce`: the `proposal_wtc.materials[].qty` totals source and the R2-B..R2-G fold-in. Regression-check that the R2 fixes actually took.

### Deployment context
- **Live tenants**: 1 — HDSP only (Schedule Command prod, schedulecommand.com)
- **Prod / staging / dev**: new print path, nothing live for it yet. Reads existing prod `field_sow` (Schedule) + `proposal_wtc.materials` (Sales) data.
- **Blocking feature flags**: none
- **Concurrency profile**: solo / ≤5 (office staff)

Agents weight severity against these: cross-tenant findings cap at Med (1 tenant); multi-user race findings cap at Low (solo/≤5); print-is-read-only so blast radius is a bad/blank printout, not data damage.

### Time budget + finding cap
- **Time budget**: 100 min (§7)
- **Finding cap**: 9 findings

Surface only the top 9 most consequential findings; remainder → "Quarantined findings (not actionable this loop)."

### Surface
- Total lines: 177 (plan body, pre-manifest)
- Sections: 9 (§0, §7, 0–5)
- [LOCKED] decisions: 7 (§1 — added #6 bid-qty source, #7 no per-day qty) + mount-scope lock (§2.1)
- [DESIGN-OPEN] items: 0 (2 build-time confirms in §0 + 1 semantic flag)
- [OPEN] items: 0
- Plan-to-code ratio: 177 : ~250–350 (0.6:1) — not flagged

### Layers touched
- UI / components (Print button in LogisticsMaterials 3-mount; ticket render; DayCard extend)
- Data layer (reads `field_sow` + `proposal_wtc.materials`; new hydrate-on-click loader)
- Cross-repo / RLS (reads Sales-owned `proposal_wtc` — cross-app data boundary + auth)

### New mechanisms introduced
- New crew-ticket component (page-1 bid summary + reused DayCards under a `printRef`) — novel surface
- New **hydrate-on-click loader** (R2-B fix) — loads WTC days + `proposal_wtc.materials` for the one job on Print, single-job scoping of the `Jobs.jsx:205` bulk read pattern
- Reused (not novel): `PRINT_CSS` + `DayCard` from `FieldSowModal.jsx` (add `export`), `materialBlocksPrint` (FieldSowBuilder). **NOT** `printWin` (R2-C), **NOT** `sowMaterials.js` rollup (R2-A dropped it)

### Cross-system reach
- **Reads `proposal_wtc.materials`** — a **Sales-owned** jsonb table, source of truth for bid qty, same shared Supabase DB. sch-command already reads it in bulk (`Jobs.jsx:205-207`, RLS proven live). Round-3 novelty: (a) single-job-scoped read from a new hydrate path; (b) **live-read, not a frozen snapshot** — a post-Send proposal edit changes printed numbers (§0 semantic flag); (c) the **`job_wtcs.proposal_wtc_id ↔ proposal_wtc.id`** link (or group-by-`call_log_id`) must resolve to the correct single proposal's materials. No writes, no other repo touched.

### Irreversibility
none — all changes reversible; no migration, backfill, or public API change

### Known weak points
- **Live-vs-frozen semantic (§0, flagged not-blocking).** `proposal_wtc.materials` is the LIVE proposal — a post-Send edit silently changes a crew sheet's totals vs what was sold. Chris flagged acceptable; agents pressure-test whether "rare/intentional" holds and whether the printed number can silently disagree with the field's material specs.
- **Proposal↔WTC link correctness (§0/§2.3).** A job with multiple proposals or multiple `proposal_wtc` rows under one `call_log_id` (the `Jobs.jsx:205` grouping) could pull the wrong, merged, or duplicated bid materials onto page 1. Highest new correctness risk.
- **RLS on the single-job read (§2.3a).** Bulk read is proven; confirm the hydrate-on-click single-job filter (`.eq(call_log_id/proposal_wtc_id)`) is correctly scoped and doesn't fail-open or fail-empty under the sch-command user's policies.
- **Blank/0 bid qty (§2.3a).** A material with blank/0 `qty` must print "—", not crash or print misleading 0.
- **R2 fold-in integrity.** Did R2-B (hydrate-on-click), R2-C (export-only, no new module), R2-E (DayCard extend for sq_ft/linear_ft/WTC subline), R2-G (window.open guard + SVG-as-React) actually land coherently, or did folding them in introduce a new seam? Regression-check.
- **Unverified day keys (§0).** `sq_ft` / `linear_ft` literal keys still not observed against a live row (`scope_notes` now confirmed).

### Open questions
- Count: 2 build-confirms (`sq_ft`/`linear_ft` keys; live-vs-frozen confirm) + 1 semantic (proposal↔WTC link resolution)
- Highest-pressure: the proposal↔WTC link — wrong link silently prints another job's / a merged bid quantity

### Suggested attack angles (3 total)
1. **Proposal-material read correctness & safety (NEW)** — covers Cross-repo / RLS + Data layer. Required reading: `src/views/Jobs.jsx:205-207` (the bulk read pattern being adapted), `src/lib/queries.js` (job/WTC hydration, `proposal_wtc_id`), the `proposal_wtc` table shape + RLS, `src/components/FieldSowBuilder.jsx` (how the material picker consumes proposal materials today). Specific pressure: single-job scoping of the bulk read; `job_wtcs.proposal_wtc_id ↔ proposal_wtc.id` link vs group-by-`call_log_id` (multiple proposals/WTCs → wrong/merged/duplicated materials); RLS fail-open/empty; live-vs-frozen semantic; blank/0 qty; does page-1 bid material reconcile with the day-card material list (same material, two sources).
2. **R2 fold-in integrity & print harness** — covers UI / components. Required reading: `src/components/FieldSowModal.jsx` (`PRINT_CSS`, `DayCard :95`, `FieldSowView :171`, `handlePrint :227`), `src/components/LogisticsMaterials.jsx` (3 mounts), `src/views/Materials.jsx:35`, `src/components/Logo.jsx`. Specific pressure: hydrate-on-click actually gives all 3 mounts both data sources (R2-B); `export`-only reuse with no new module and no live-SOW-print regression (R2-C); DayCard extended not verbatim for the subline (R2-E); window.open guard + SVG-as-React-not-string (R2-G); page-1 own-sheet page-break scoped to a ticket-only selector (doesn't leak into shared PRINT_CSS).
3. **Day-card content & decision-A consistency** — covers Data layer + render. Required reading: `src/components/FieldSowModal.jsx` (DayCard render), `src/components/FieldSowBuilder.jsx` (day/task/material shapes, `materialBlocksPrint`), `queries.js:714` (legacy fallback). Specific pressure: `sq_ft`/`linear_ft` unverified keys → blank subline; decision-A "no per-day qty" applied consistently (no leftover qty column); unconfirmed-tag semantics; legacy/no-SOW/no-proposal-materials empty states don't crash; day-card material list vs page-1 checklist coherence.

### Suggested agent count: 3

Rationale: cross-system reach became non-empty this round (the totals now cross into Sales-owned `proposal_wtc`), which adds a distinct RLS/link-correctness angle on top of the content + harness angles → formula gives 3; the new cross-app read is the round's real pressure and earns its own agent.
