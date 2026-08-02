# DMS-1 Phase 4 — Crew Ticket (print) — build plan

**Repo:** sch-command · **Branch:** `feat/dms1-phase4`
**ERD:** inside open Loop #44 (the printed ticket is the built outcome that closes it). No new loop.
**Reference (the target):** `docs/plans/assets/6618-lakes-crossing-crew-ticket.pdf`

> **2026-08-02 RESET (Chris).** Rounds 1–3 fell into an accrete loop: each revision reused the shared
> `DayCard` more tightly, which forced new mechanism (showQty prop, hydrate loader, page-break-in-shared-CSS),
> which the next audit found. Root cause = **coupling the ticket to the live SOW print's shared component.**
> This version starts from zero mechanism and severs that coupling: a **self-contained ticket component**
> that loads its own data and renders its own markup. Whole classes of prior findings dissolve.

---

## Intent (the one outcome)

**From a job, print a paper crew ticket — a one-page material order summary (with bid quantities +
sign-off) followed by one card per scheduled day (work, scope notes, materials) — that the crew and
warehouse carry to the field.** That's the whole deliverable. Everything below exists only to produce it.

## §0 Baseline — verified current state (read-verified 2026-08-02)

- **No crew-ticket print code exists** — net-new. But `FieldSowModal.jsx` already prints a per-day SOW,
  proving the pattern: `PRINT_CSS` (a CSS string, `:31-56`, design system + `break-inside: avoid` +
  `print-color-adjust: exact`) and `handlePrint` (`:227-233`: `window.open` → `document.write(<style> +
  el.innerHTML)` → `setTimeout(win.print, 400)`).
- **A loaded WTC carries everything the ticket needs.** `loadJobWithWTCs(jobId)` (`queries.js:288`,
  selects `job_wtcs(*)`) returns `job._wtcs[]`, each with `field_sow` (the days), `proposal_wtc_id`,
  and `work_type_name`. Day shape (`FieldSowBuilder.jsx:38`): `{ day_label ("Day 1"), date, tasks[],
  crew_count, hours_planned, materials[], scope_notes, ... }`. Task: `{ description, pct_complete, size, unit }`.
- **Page-1 quantities = the salesperson's bid qty**, stored in `proposal_wtc.materials` (Sales-owned jsonb;
  shape `{ product, kit_size, qty, ... }`). `field_sow.materials[].qty_planned` is a dead field (defaults
  `0`, `FieldSowBuilder.jsx:115/153/170`) — NOT the source. sch-command already reads `proposal_wtc.materials`
  live (`Jobs.jsx:205-207`), RLS proven.
- **Unconfirmed-spec predicate exists:** `materialBlocksPrint(m)` (`FieldSowBuilder.jsx:32`).
- **`scope_notes` key confirmed** (`FieldSowModal.jsx:111`). `sq_ft`/`linear_ft` keys: default to `0`
  (`WTCCalculator.jsx:948`) → usually blank; confirm literal key names on a live row at build.
- **No DB changes** — reads existing `field_sow` + `proposal_wtc.materials`. No migration.

## Simplification — what got cut vs rounds 1–3

Dropped, because a self-contained ticket component doesn't need them:
- **Reusing shared `DayCard`** → so no `showQty` prop, no edit to the live SOW print, no re-verify of it.
- **The hydrate-on-click loader with disable-state** → the component loads its own data on open.
- **`call_log_id` grouping + multi-WTC filter/sum gymnastics** → reading `proposal_wtc` by
  `.in('id', <this job's proposal_wtc_ids>)` is inherently scoped to only scheduled WTCs.
- **Page-break leaking into shared `PRINT_CSS`** → the ticket owns its styles.

## Decisions (locked, Chris)

1. **Print lives in the materials / Logistics view** (all 3 mounts — the component self-loads, so mount
   doesn't matter). Button styled `app-act-btn app-act-primary`.
2. **Unconfirmed materials: tag, don't block.** Tag = `materialBlocksPrint(m)`; spec-less material = no tag.
3. **Day header = "Day 1/2/3"**, no "of N".
4. **Day cards show NO per-day qty** (decision A) — materials + specs-as-text only; totals live on page 1.
5. **Page-1 numbers = proposal bid qty** (`proposal_wtc.materials[].qty`), read directly.
6. **Match the reference PDF** otherwise (lighter reskin, task tags, scope-notes callout).

## The build — one component + one button

### A. `CrewTicket` component (self-contained) — new file `src/components/CrewTicket.jsx`
- **Input:** `{ jobId, onClose }`. On mount, loads its own data:
  1. `loadJobWithWTCs(jobId)` → `job` + `_wtcs[]` (field_sow days + `proposal_wtc_id` + `work_type_name`).
  2. `supabase.from('proposal_wtc').select('id, materials').in('id', _wtcs.map(w => w.proposal_wtc_id).filter(Boolean))`
     → the bid materials for exactly this job's scheduled WTCs. (Empty list / no rows → page-1 empty state.)
  - Show a brief "Loading…" until both resolve; render only after.
- **Renders its OWN markup** into a `printRef` (reuses the `.sow-*` CSS classes via an exported
  `PRINT_CSS` — add `export` to the const, a zero-behavior change — plus a small ticket-local `<style>`
  for the page-1 summary + a ticket-only `break-after: page`):
  - **Page 1 — Material Order Summary:** brand mark (`ScheduleCommandMark` as a React element, or omit
    if it doesn't survive `innerHTML`) + `JOB / JOB # / CUSTOMER / PREPARED BY`; a checklist row per
    **distinct bid material** = `product || name` + **summed `qty`** (group identical products across the
    WTCs) + `kit_size` unit; blank/0 qty → "—". `LEAD / SALES SIGNATURE` lines. **No proposal_wtc row →
    "No bid materials on file."**
  - **Per-day cards:** group by WTC (`work_type_name` label); for each day: "Day N" + item count;
    subline `Crew · Hours · Sq ft · Linear ft` (each segment rendered only if truthy); Work to Complete
    (tasks + %, task tags); Scope Notes callout; Materials list (`product || name` + kit + specs-as-text;
    unconfirmed tag; **no qty**). Legacy job (no `_wtcs`) → fall back to `job.field_sow`, `Array.isArray`-guarded.
  - **Footer:** `N DAYS SCHEDULED · GENERATED <date>`.
- **Print:** `const win = window.open('', '_blank'); if (!win) { toast('Allow pop-ups to print', 'err'); return }`
  then `document.write(<style>${PRINT_CSS}${ticketCss}</style> + printRef.innerHTML)` → `setTimeout(win.print, 400)`.
  Component uses `const toast = useToast()`.

### B. Print button — `src/components/LogisticsMaterials.jsx`
- Add a header row with a **Print Ticket** button that opens **`<CrewTicket jobId={job.job_id} />`**.
  (`loadJobWithWTCs` filters `.eq('job_id', …).single()` at `queries.js:289` — pass `job.job_id`,
  NOT `call_log_id`, or the read fails-empty. All 3 mounts give `LogisticsMaterials` a `job` with
  `.job_id`, `:54`.) Appears in all 3 mounts; each works because CrewTicket self-loads.

## Out of scope
- §4B shortage math (OK/SHORT/verify) and any size÷coverage NEED math.
- Blocking print on unconfirmed specs.
- Retiring the legacy `materials` table (Phase 5).
- Freezing bid qty into the SOW (backlog ADJ-4 — live-read accepted for now).

## Verify (before done)
- `npx vite build` green.
- Real WTC job → Print → page-1 bid-qty checklist + one card per day + signatures + footer, matches PDF.
- **Page-1 numbers == the QTY on that job's WTC Materials tab in Sales.**
- Multi-WTC job sharing a product → one summed row; nothing from unscheduled WTCs.
- Day headers "Day 1/2/3"; day cards have no qty column; unconfirmed tag shows.
- **Live SOW print (FieldSowModal → Print PDF) unchanged** (we only `export`-ed a const, didn't edit it).
- Legacy/no-SOW/no-proposal-materials job → empty state, no crash. Pop-up blocked → toast, no throw.

## Deploy
- Preview on `feat/dms1-phase4` → smoke → merge to main → live on schedulecommand.com. **No DB changes.**
- Closes Loop #44 when the ticket prints live.

---

## Audit — single materiality-gated pass (2026-08-02)

Per Chris's reset: one focused pass against the simplified plan, gate by materiality (fix only what blocks
the outcome), no more revise-audit rounds.

**Result (2026-08-02, single pass, materiality-gated):** ONE material problem — button was passing
`call_log_id` into a `job_id` filter (`loadJobWithWTCs`, `queries.js:289`), which fails-empty. **Fixed:**
pass `jobId={job.job_id}` (§B). Everything else verified CLEAR against live code + DB: proposal_wtc RLS is
`tenant_id = get_user_tenant_id()` so the direct `.in('id', ids)` read returns rows (no blank page-1);
render/print guards handle legacy/empty/no-proposal jobs without crashing; `proposal_wtc.materials` carries
`product`/`qty`/`kit_size` as assumed; `export`-ing `PRINT_CSS` is zero-behavior. **READY TO BUILD.**
