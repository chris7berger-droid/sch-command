# Warehouse Receiving Ticket (D2) — Build Plan

**Status:** PLAN — revision pass 1 (round-1 audit response: 0C/0H/3M/2L, pattern reuse-fidelity). **Option B locked** 2026-08-06. Ready for build. No code ships from this doc.
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

## 2. THE architecture decision — reuse strategy `[LOCKED — Option B, ratified 2026-08-06 after round-1 audit]`

Both round-1 reviewers independently recommended B over the draft's A; **ratified by Chris 2026-08-06.** **Extract the shared load + summary into one canonical module; both tickets consume it.** Rationale: the receiving ticket exists to show the SAME material totals as the crew ticket — two copies of that logic (A) can drift; one shared function (B) cannot. Honors [[feedback_extend_canonical_not_twin]]; the draft's A traded that away for "don't touch shipped code," which the audit correctly reversed. Cost of B (re-smoke that the crew ticket still prints identical page-1 numbers + order) is trivial.

**Shared module `src/lib/ticketMaterials.js` exports:**
- `loadBidMaterialsForJob(jobId)` — the EXACT two-hop from `CrewTicket.jsx:159-181` (`loadJobWithWTCs` → map `_wtcs.proposal_wtc_id` → `.filter(Boolean)` → `.in('id', pwIds)` on `proposal_wtc` → `flatMap` materials). Copy verbatim; do NOT swap for an embed.
- `summarizeBidMaterials(bidMaterials)` — the `:203-218` IIFE, carrying its `uname` dependency (`:23`) into the module, PLUS a deterministic `.sort()` by `uname` so both tickets list rows in identical order (round-1 finding — without it the two sheets could order the same materials differently).

`CrewTicket.jsx` refactors to import both (behavior-identical); `ReceivingTicket.jsx` imports the same.

**Known assumption [D1, round-1 over-cap, Low]:** `summarizeBidMaterials` groups by `name + kit_size` (`:211`) and discards `unit`/`supplier` — two same-name lines in different units sum into one "Total Needed". Benign on the crew checklist; newly load-bearing when a warehouse counts physical delivery against it. **Accepted for this build** (test-only surface, no live warehouse users); documented here as the **"one name+kit = one unit" assumption**. Revisit if a real warehouse hits mixed-unit materials.

---

## 3. Build steps (Option B — locked)

1. **NEW `src/lib/ticketMaterials.js`** — extract `loadBidMaterialsForJob`, `summarizeBidMaterials` (+ `uname`, + deterministic `.sort()` by `uname`) per §2. Copy the two-hop verbatim; no embed swap.
2. **Refactor `CrewTicket.jsx`** — import `loadBidMaterialsForJob` + `summarizeBidMaterials` from the module; delete the now-duplicated inline load body (`:159-181`), summary IIFE (`:203-218`), and local `uname` (`:23`). **No behavior change intended** — page-1 numbers + order identical. **Re-smoke owed** (§5).
3. **NEW `src/components/ReceivingTicket.jsx`** — imports the shared module; renders page-1 ONLY:
   - Drop the per-day `DayCard` section (`CrewTicket.jsx:337-349`), the `.ct-cover` page-break, the `.sow-footer` (`:351-354`), AND the dead `sections`/`totalDays`/`wtcs` derivations (`:220-225`) — no "0 DAYS SCHEDULED" on a warehouse sheet [C1].
   - **Header:** "WAREHOUSE RECEIVING" + subtitle in place of "Daily Material Schedule / JOB TICKET · PRINT ONE PER CREW" (`:286-287`).
   - **RECEIVED column on ALL FOUR sites** [B1]: print col-header (`:313-318`), print row (`:319-326`), preview grid (`:261`, currently `28px 1fr auto`), preview row (`:262-264`) — give the preview an explicit RECEIVED cell so the on-screen preview shows the column. Print grid `28px 34px 1fr 96px` → `28px 34px 1fr 96px 72px`; RECEIVED is a ~72px write-in box [C2].
   - **`.ct-mat-name` in the new component gets `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`** [C2] so a long material name can't blow out the tighter grid. Verify against a real long-name job, not a toy.
   - **Signature frame:** "Received by · Date" in place of Lead/Sales (`:330-333`).
   - Keep `handlePrint` verbatim incl. `esc()` (`:195`) — do NOT re-concatenate material names into the popup HTML [round-1].
4. **`LogisticsMaterials.jsx`** — `receivingOpen` state (beside `:53`), second **"Print Receiving List"** button (`:116`), mount `{receivingOpen && <ReceivingTicket jobId={job.job_id} onClose={() => setReceivingOpen(false)} />}` (beside `:118`).
5. `vite build` green.

**Files touched:** `src/lib/ticketMaterials.js` (new), `src/components/ReceivingTicket.jsx` (new), `src/components/CrewTicket.jsx` (refactor to import shared), `src/components/LogisticsMaterials.jsx` (button + mount).

---

## 4. Not in scope / non-goals

- No per-day breakdown, no grouping selector, no pull ticket, no pallet ticket (scope-locked §0).
- No data capture of received quantities (paper write-in only) → **no migration, no `command-suite-db`, no RLS.**
- No change to the crew ticket's OUTPUT — its printed page-1 numbers + row order stay identical after the Option-B refactor (re-smoke confirms, §5). No `sales-command` change.

---

## 5. Verify (build terminal, before /buildvsplan)

- Real multi-WTC job's Logistics tab → **Print Receiving List** → preview AND print show every job material grouped+summed, matching the crew ticket's page-1 numbers + order exactly (same shared module). **Preview must visibly show the RECEIVED column** [B1] — the verifier only looks at the preview.
- Print output: WAREHOUSE RECEIVING title, RECEIVED write-in column, Received-by frame, **no** per-day cards, **no** "DAYS SCHEDULED" footer.
- **Crew-ticket re-smoke** (B refactored its load+summary): Print Ticket page-1 numbers AND row order identical to before; per-day cards unchanged.
- **Long-material-name job** [C2]: name ellipsizes, RECEIVED box not crushed, no grid overflow — test on a real long-name job, not a toy.
- Zero-bid-material job → "No bid materials on file" (inherited empty state), no crash.

---

## 6. Open items

| # | Item | Status |
|---|---|---|
| 1 | Button label — "Print Receiving List" vs "Receiving Ticket" | trivial, decide at build |
| 2 | RECEIVED cell + "Received by/Date" line form | cosmetic; RECEIVED = ~72px write-in box [C2], decide line style against the printed proof |
| 3 | Reuse strategy A vs B (§2) | **RESOLVED — Option B locked, ratified 2026-08-06 (round-1 audit)** |

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
