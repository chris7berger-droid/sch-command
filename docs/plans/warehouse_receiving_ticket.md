# Warehouse Receiving Ticket (D2) — Build Plan

**Status:** PLAN — drafted 2026-08-06, not yet audited. No code ships from this doc.
**Loop:** opens at build (`/erd-start` in the build terminal) — not yet locked.
**Branch:** `sch-command feat/dms2-receiving-ticket` (this plan doc lives here).
**Repo:** sch-command ONLY. No `command-suite-db`, no migration, no `sales-command` — cannot collide with the in-flight sales-command bug fix.
**Parents:** `command-suite-db/docs/MASTER_SCHEDULE.md` Row **D2** · shipped precedent `docs/plans/daily_material_schedule_phase4_build.md` (the crew ticket this reuses).

---

## 0. What this is (plain English)

A printable **warehouse receiving ticket**: a whole-job list of every material on the job, so the warehouse can check off each line as the delivery comes in and write down what actually arrived. It's the crew ticket's page-1 "Material Order Summary" — trimmed to stand alone, relabeled for the warehouse, with a blank **RECEIVED** column added.

**Scope locked with Chris 2026-08-06:**
- Pull ticket and auto-cut pallet ticket are **OUT** — the warehouse groups material its own way per job (3 days combined / whole job / 1+5 split), so there's no fixed rule to auto-cut and no user-selectable grouping is wanted.
- Whole-job receiving list **only**.
- Add a blank **RECEIVED** column (write-in on paper — catches short deliveries). *Ratified.*
- Print from a **second button next to "Print Ticket"** on the Logistics tab. *Ratified.*

---

## 1. Baseline — what already exists (read-verified 2026-08-06)

- `src/components/CrewTicket.jsx` (362 lines) — the shipped crew ticket. **Self-contained by design** (Phase-4 reset, 2026-08-02): loads its own data (`loadJobWithWTCs` + a scoped `proposal_wtc.materials` read, `:156-184`) and renders its own markup; the only borrow is the read-only `PRINT_CSS` string from `FieldSowModal`.
- **The receiving list already exists as page 1.** `summarizeBidMaterials` logic (`CrewTicket.jsx:203-218`) groups bid materials by `name + kit_size` and sums `qty` across the job's scheduled WTCs → the exact rows a receiving ticket wants. Rendered at `:303-334` with check-box + index + Material + **Total Needed** columns, then a Lead/Sales signature frame (`:330-333`).
- **One mount point:** `LogisticsMaterials.jsx:53` (`ticketOpen` state), `:116` (Print Ticket button), `:118` (`<CrewTicket jobId={job.job_id} …/>`). The old Phase-4 handoff said "all 3 mounts" — **grep shows one.** (Corrected here.)
- **No schema touched by this build.** The RECEIVED column is a blank printed column; nothing is captured back to the DB.

---

## 2. THE one architecture decision — reuse strategy `[DECISION — for /runaudit + build terminal to ratify]`

The receiving ticket needs the SAME two things the crew ticket already does: (a) load bid materials for the job, (b) group+sum them (`summarizeBidMaterials`). It differs only in render: page-1 only (no per-day cards), a RECEIVED column, warehouse title, "Received by / Date" frame.

**Option A — self-contained `ReceivingTicket.jsx`, CrewTicket untouched (RECOMMENDED).**
- New component mirrors CrewTicket's self-contained pattern: its own data load + its own `summarizeBidMaterials` copy (~20 stable lines) + its own trimmed markup.
- **Pro:** zero risk to the shipped, gate-passed crew ticket (no re-smoke of Phase 4 owed); consistent with the Phase-4 reset philosophy that self-containment "held up through every gate."
- **Con:** the group-by-name+kit rule now lives in two places — a twin that could drift ([[feedback_extend_canonical_not_twin]]).

**Option B — extract shared helpers, both tickets consume them.**
- Pull `loadBidMaterialsForJob(jobId)` (the `:160-181` useEffect body) + `summarizeBidMaterials()` + `uname` into `src/lib/ticketMaterials.js`; refactor CrewTicket to import them; ReceivingTicket imports the same.
- **Pro:** one canonical grouping rule, no drift — honors [[feedback_extend_canonical_not_twin]].
- **Con:** touches shipped/verified code ([[feedback_minimal_fix_first]]) → the crew ticket must be re-smoked to prove no regression.

**My recommendation: A for this build.** The shared logic is ~20 stable lines, "get through this build" is the stated goal, and not re-opening the shipped crew ticket is the lower-risk path. If the grouping rule ever actually changes, extract then. The build terminal can upgrade to B cheaply if the audit prefers it.

---

## 3. Build steps (Option A)

1. **NEW `src/components/ReceivingTicket.jsx`** — modeled on `CrewTicket.jsx`, trimmed:
   - Same data load (`loadJobWithWTCs` + scoped `proposal_wtc.materials` read) and same `summarizeBidMaterials` grouping.
   - **Render page 1 ONLY** — drop the per-day `DayCard` section entirely (`CrewTicket.jsx:337-349`) and the `.ct-cover` page-break.
   - **Header:** title "WAREHOUSE RECEIVING" + subtitle (e.g. "MATERIAL RECEIVING TICKET") in place of "Daily Material Schedule / JOB TICKET · PRINT ONE PER CREW" (`:286-287`).
   - **Add RECEIVED column:** grid goes from `28px 34px 1fr 96px` to `28px 34px 1fr 96px 96px` (col header + row cell in `.ct-cols`/`.ct-row`, `:47-49`); the new cell is a blank underline/box for handwriting the received qty.
   - **Signature frame:** "Received by · Date" (single or double line) in place of Lead/Sales signatures (`:330-333`).
   - Keep the modal shell + on-screen preview + `handlePrint` popup pattern verbatim (incl. the `<title>` escaping from T6 security-review, `:195-197`) — proven, and keeps print behavior identical.
2. **`LogisticsMaterials.jsx`** — add a second button + mount:
   - New state `receivingOpen` (beside `ticketOpen`, `:53`).
   - Second button **"Print Receiving List"** next to Print Ticket (`:116`).
   - Mount `{receivingOpen && <ReceivingTicket jobId={job.job_id} onClose={() => setReceivingOpen(false)} />}` (beside `:118`).
3. `vite build` green; no lint/TDZ issues (new component, no new useEffect ordering traps).

**Files touched:** `src/components/ReceivingTicket.jsx` (new), `src/components/LogisticsMaterials.jsx` (2-line add). Nothing else. (Option B would additionally add `src/lib/ticketMaterials.js` and edit `CrewTicket.jsx`.)

---

## 4. Not in scope / non-goals

- No per-day breakdown, no grouping selector, no pull ticket, no pallet ticket (scope-locked §0).
- No data capture of received quantities (paper write-in only) → **no migration, no `command-suite-db`, no RLS.**
- No change to the crew ticket's output (Option A). No `sales-command` change.

---

## 5. Verify (build terminal, before /buildvsplan)

- Open a real multi-WTC job's Logistics tab → **Print Receiving List** → preview shows every job material grouped+summed, matching the crew ticket's page-1 numbers exactly (same source, same grouping).
- Print output: WAREHOUSE RECEIVING title, RECEIVED blank column present, Received-by frame, **no** per-day cards.
- Confirm the existing **Print Ticket** still prints the full crew sheet unchanged (Option A: it wasn't touched — a glance, not a full re-smoke).
- Zero-bid-material job → "No bid materials on file" (inherited empty state), no crash.

---

## 6. Open items

| # | Item | Status |
|---|---|---|
| 1 | Button label — "Print Receiving List" vs "Receiving Ticket" | trivial, decide at build |
| 2 | RECEIVED column: blank line vs boxed cell; single "Received by/Date" line vs two | cosmetic, decide against the printed proof |
| 3 | Reuse strategy A vs B (§2) | ratify in /runaudit + build terminal |

---

## Audit manifest

_To be generated by `/auditcriteria` in the audit terminal. Small surface (one new component + a 2-line mount, no DB, no cross-repo) — expect a low finding cap and a small agent count._
