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

## §0 Baseline — what already exists (read-verified 2026-08-06)

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

_Generated by `/auditcriteria` on 2026-08-06. Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
Small, low-risk change — a new print sheet that reuses a screen you already shipped, with no database or other-app impact. Two reviewers, pointed at the two things that can actually go wrong: (1) the receiving list showing different material totals than the crew ticket for the same job, and (2) the new "RECEIVED" column breaking the printed layout. Quick check, not a deep one.

### Round
- Plan type: feature
- Current round: 1
- Plan revision under audit: 451cc89 (draft) + this manifest commit — HEAD of `feat/dms2-receiving-ticket`
- Findings trend: n/a — round 1

### Prior rounds
none — this is round 1

**Briefing for agents**: do NOT re-find issues from prior rounds. Each round's revision-pass commit message is the canonical record of what was addressed. Attack ONLY material new to the plan revision under audit. (Round 1 — nothing prior.)

**Plateau signal**: n/a at round 1. If a round 2 is needed and its count is steady-or-higher, `/runaudit` must present scope-cut as the only build-prompt option.

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant onboarding blocked
- **Prod / staging / dev**: sch-command is live on schedulecommand.com, but Schedule Command has **no office/warehouse users yet** (Chris-only, testing) — this surface is test-only in practice
- **Blocking feature flags**: none
- **Concurrency profile**: solo (Schedule)

Agents weight severity against these values. Cross-tenant findings cap at Med while live_tenants == 1. Multi-user race findings cap at Low while solo. There is no DB/RLS/cross-repo surface here to attack regardless.

### Time budget + finding cap
- **Time budget**: 30 min (small surface; confirmed by Chris)
- **Finding cap**: 3 findings

Synthesis MUST surface only the top-3 most consequential findings. Remainder go to "Quarantined findings (not actionable this loop)."

### Surface
- Total lines: ~95 (ex-manifest)
- Sections: 7 (§0 Baseline + §0-plain-intro + §2–§6)
- [LOCKED] decisions: 0 literal tags; 3 ratified scope-locks in §0 (RECEIVED column, second-button placement, pull/pallet dropped)
- [DESIGN-OPEN] items: 1 (§2 [DECISION] reuse strategy A vs B)
- [OPEN] items: 3 (§6)
- Plan-to-code ratio: ~95 : ~140 est ≈ 0.7:1 — not scope-crept

### Layers touched
- UI / components (new `ReceivingTicket.jsx` print component; `LogisticsMaterials.jsx` button + mount)
- Data layer (read-only reuse of `loadJobWithWTCs` + a scoped `proposal_wtc.materials` read — no new query)

### New mechanisms introduced
- New component: `ReceivingTicket.jsx` (derivative of the shipped `CrewTicket.jsx`)
- New UI state + button: `receivingOpen` + "Print Receiving List" in `LogisticsMaterials.jsx`
- (Option B only, conditional) shared helper module `src/lib/ticketMaterials.js` — not built under recommended Option A
- New columns/tables/triggers/RLS/routes/cron: none

### Cross-system reach
none — sch-command only; no service-role/bypass path; reads Sales-owned `proposal_wtc` read-only via an existing loader

### Irreversibility
none — all reversible; no migration, no backfill, no schema change, no public API change

### Known weak points
- **Reuse fidelity (§2/§3) — highest consequence.** Option A duplicates the summary grouping (`name+kit` key, `Number(m.qty)||0`, cross-WTC sum, empty state) from `CrewTicket.jsx:203-218`. Any divergence means the receiving ticket and the crew ticket show DIFFERENT totals for the same job — breaking the plan's core "it's the same list" premise.
- **RECEIVED column layout (§3 step 1).** Grid goes 4→5 columns (`28px 34px 1fr 96px` → `+96px`) on a fixed print width (~800px). Must not overflow the page or crush the Material column.
- **Preview/print parity.** The on-screen preview uses a simpler grid than the print markup (`CrewTicket.jsx:259-267` vs `:313-326`). The RECEIVED column must be added to BOTH, or the preview misleads about what prints.
- **A vs B decision unresolved (§2).** B re-opens the shipped, gate-passed crew ticket → owes a re-smoke. A leaves it untouched but owes a drift-watch on the duplicated logic.
- **Empty state.** Zero-bid-material job inherits "No bid materials on file" — verify it renders without crashing in the trimmed component.

### Open questions
- Count: 3 (§6)
- Highest-pressure: reuse strategy A vs B (§2); RECEIVED column form (blank line vs boxed cell) against the printed proof

### Suggested attack angles (2 total)
1. **Reuse fidelity + summary correctness** — covers Data layer + state/business logic. Required reading: `CrewTicket.jsx:23,148-218,303-334`; plan §2–§3. Specific pressure: does the duplicated (A) or extracted (B) summary produce row-identical output to the crew ticket for the same job — grouping key, qty coercion, cross-WTC sum, empty state? Any divergence = two tickets disagree on the same job.
2. **Print/UI layout + framework fit** — covers UI/components. Required reading: `CrewTicket.jsx:41-71,186-200,278-334`; `LogisticsMaterials.jsx:53,113-118`. Specific pressure: the 5-column RECEIVED grid fits the fixed print width without overflow; `receivingOpen` + button mirror the existing `ticketOpen` pattern exactly; the on-screen preview also gains the RECEIVED column so preview matches print; `handlePrint`/`window.open` reuse stays faithful (title-escaping from T6 preserved).

### Suggested agent count: 2

Rationale: two layers (UI + read-only data), no cross-system reach, low novelty (one derivative component), and only 3 open questions — two focused angles cover the whole surface; a third would pad against a 2-file change.
