# SCH_HANDOFF_v33 — D2 Warehouse Receiving Ticket SHIPPED

**Repo:** sch-command · **Branch:** `main` · **Date:** 2026-08-07
**Production:** https://schedulecommand.com — merged + deploying (Vercel auto-build on push to main).
**Cross-repo:** none — sch-command only, **NO DB / NO migration** (reads existing data, paper write-in only).
Spine: `command-suite-db/docs/MASTER_SCHEDULE.md` Row **D2**. Plan: `docs/plans/warehouse_receiving_ticket.md` (Option B, locked).

> **Loop:** rides under open ERD Loop #44 (the DMS printed-ticket family). No separate loop opened; nothing written to LOG.md.

---

## 1. Session summary

Built and shipped **D2 — the Warehouse Receiving Ticket**: a page-1-only, warehouse-relabeled derivative
of the crew ticket, reachable from a new **"Print Receiving List"** button on the Logistics tab (beside
Print Ticket). It's the crew ticket's whole-job Material Order Summary, trimmed to stand alone, with a
blank **RECEIVED** write-in column so the warehouse can check off + record what actually arrives.

The architecture decision (plan §2, Option B, round-1-audit ratified): **extract the shared load + summary
into one canonical module** so the crew ticket and the receiving ticket can never disagree on a job's
totals — one function, one grouping, one order. Not a copy-paste twin.

Went build → buildvsplan (T4) → §5 smoke → code-review (T5) → security-review (T6) — **all green,
0 ship-blockers** — then merged to main + deployed. Both feature branches (`feat/dms2-receiving-ticket`
and the superseded `feat/mtrl-sow-rollup`) deleted.

## 2. Changes shipped

**sch-command (main, merged as `fd620d9` — feature commit `6833cb8`):**
- **NEW `src/lib/ticketMaterials.js`** — canonical `loadBidMaterialsForJob` (verbatim two-hop:
  `loadJobWithWTCs` → this job's scheduled `proposal_wtc_id`s → `.in('id', pwIds)` on `proposal_wtc`
  → flattened `materials`) + `summarizeBidMaterials` (name+kit grouping, `Number(qty)||0`, cross-WTC
  sum) + `uname`. Added a **deterministic `.sort()` by name/kit** so both tickets list rows identically.
- **`src/components/CrewTicket.jsx`** — refactored to import all three from the module; inline load body,
  summary IIFE, and local `uname` deleted. Page-1 markup untouched. **Behavior: numbers identical;
  page-1 row order now alphabetical** (was proposal-insertion order) — the intended §2 consequence.
- **NEW `src/components/ReceivingTicket.jsx`** — page-1-only print sheet: WAREHOUSE RECEIVING header,
  RECEIVED write-in column on all four sites (print header/row + preview header/row), `.ct-mat-name`
  nowrap/ellipsis/min-width:0, "Received By · Date" sign line, null-guarded `window.open`, esc()'d
  `<title>`. No DayCard, no `.ct-cover`, no `.sow-footer`, no sections/totalDays derivations.
- **`src/components/LogisticsMaterials.jsx`** — `receivingOpen` state + second "Print Receiving List"
  button + `<ReceivingTicket>` mount, mirroring the existing `ticketOpen`/CrewTicket pattern.

## 3. Gate record (all green)

- **buildvsplan (T4):** GO, 0 T1 / 0 T2, 4 intended-notes. Byte-diffed the extracted load + summary
  against the 85fda44 source — identical. `vite build` green.
- **§5 smoke:** 4/4 PASS. Preview is auth-gated (no login here), so verified the parts that matter via
  **real DB data (job 92, the only multi-WTC job with materials) + headless-render of the actual print
  HTML** (real `PRINT_CSS` + `receivingCss` + true markup): (1) multi-WTC summary correct + sorted +
  RECEIVED column present; (2) crew numbers unchanged, order now sorted; (3) forced-overlong name
  ellipsizes, RECEIVED box not crushed, no grid overflow; (4) zero-bid → "No bid materials on file",
  no crash.
- **code-review (T5):** clean, 0 findings (limiter-gated). Extraction fidelity, dropped-mid-await guard
  (no setState-after-unmount / no double-fetch), dead imports, handlePrint/esc, hooks/deps — all clean.
- **security-review (T6):** 0 exploitable-today. No DB/write path; reuses the already-T6'd read path;
  title esc()'d; body is React DOM; window.open guarded. Cross-tenant path = pre-existing **SEC-6**
  (not introduced here, not re-filed).

## 4. Accepted / known (do NOT re-open)

- **Sort → alphabetical page-1 on BOTH sheets** — LOCKED plan §2 (so the two match). Quantities identical.
  Note: plan §5's "row order identical to before" wording is superseded by the explicit sort.
- **D1: name+kit = one unit** — `summarizeBidMaterials` groups by name+kit, discards unit/supplier.
  Accepted §2 (test-only surface; revisit if a real warehouse hits mixed-unit materials).
- **`.ct-sign` reserves 2 cols, fills 1** (single "Received By · Date" line) — cosmetic, open item §6.2.
- **TOTAL NEEDED (96px) wraps long kit strings to 2 lines** — pre-existing crew-ticket behavior,
  inherited, NOT introduced here. Ties to §6.2 "decide against the printed proof." Widen someday.

## 5. Backlog touched

- **BF-12** → **Closed 2026-08-07**: branch `feat/mtrl-sow-rollup` deleted (local + remote). Its
  `rollupSowMaterials()` seed was folded into DMS-1 Phase 4, and Phase 5 dropped the `materials` table
  it bridged against — doubly superseded.

## 6. State at close

- On `main`, up to date with origin (`fd620d9`), working tree clean.
- Only `main` remains (local + remote) — both feature branches deleted.
- **No cross-repo, no migration, no edge fn, no secrets.** Merge = the whole "make it live."

## 7. Next / open

- **Prod sanity (Chris):** once Vercel finishes, open any job → Logistics → "Print Receiving List" and
  eyeball the printed proof against a real 2-WTC job — confirm the RECEIVED column + sign line read clean
  on paper (the §6.2 cosmetic decisions are best made against a real print).
- Nothing else outstanding on D2.
