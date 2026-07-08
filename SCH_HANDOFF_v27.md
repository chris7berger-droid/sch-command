# SCH_HANDOFF_v27 — Job-card polish (notes modal + Material Memory shipped); Daily Material Schedule plan seeded

**Repo:** sch-command · **Branch:** `main` (two features merged + pushed; `feat/mtrl-sow-rollup` PARKED, unmerged)
**Date:** 2026-07-08
**Production:** https://schedulecommand.com — two fixes LIVE this session.
**ERD:** none — session ran `/orient` → `/decide` (ideate) but no `/erd-start` was opened. Build-preview-ship cadence throughout.

> Single-repo session that pivoted at the end into a **cross-repo plan** (DMS-1) spanning
> sales-command + command-suite-db + sch-command. That plan is **not started** — it needs
> its own planning terminal (see §6).

---

## 1. Session summary

Focus: fixing small issues on the new job cards. Shipped two to prod, then a third fix uncovered a data-model gap that turned into a much bigger, deliberately-scoped plan.

1. **BF-10 — billing-card notes pop-up.** The billing card's `chris_notes` was a single-line input that truncated long notes to "We had to go back to…" and couldn't be read/edited. Replaced with a compact Notes button (green dot + preview) → modal with a multi-line textarea. Shipped.
2. **BF-11 — Field SOW reuses Sales Material Memory.** The SOW "+ Add Custom Material" only offered this job's WTC materials + a blank custom entry; it never touched `materials_catalog`. Added a read-only, RLS-scoped, paginated catalog loader + a searchable "FROM MATERIAL MEMORY" section in the day-materials picker (custom stays SOW-local with an inline "add it in Sales to reuse" note). Shipped.
3. **BF-12 → DMS-1 pivot.** Rebuilding the MTRL modal to show SOW materials revealed the MTRL button reads a *different, legacy* data source (the `materials` table) than where materials now live (the Field SOW). Mid-fix, Chris surfaced the real target: the **Daily Material Schedule** crew/warehouse job ticket (built in Claude Web, crew loves it). Doing it right is a data-model change spanning Sales + Schedule, so we **stopped the patch, parked the branch, and seeded a plan** (DMS-1) instead of shipping a fix that the model change would immediately reshape.

BF-1 was also verified already-done in code (header + back on all billing screens) and marked Done — no work needed.

---

## 2. Changes shipped (to prod)

### BF-10 — billing notes modal (merge `2dd93cb` → prod)
- `BillingCard.jsx` + `App.css` — inline `wl-notes` input → compact Notes button (dot + preview) opening a `.mbg`/`.mdl` modal with a 5-row textarea + Save/Cancel. Save path unchanged (`onFlag(jobId, 'chris_notes', v)`; empty → null).

### BF-11 — SOW Material Memory picker (merge `42797b8` → prod)
- `queries.js` — `loadMaterialsCatalog()`: read-only, RLS-scoped, `loadAllRows` paginated, Sales' name+kit dedupe (tenant wins over system).
- `CardSowModal.jsx` — loads the catalog once, passes to every `FieldSowBuilder`.
- `FieldSowBuilder.jsx` + `App.css` — `DayMaterials` dropdown gains a searchable "FROM MATERIAL MEMORY" section beside the kept proposal quick-add + custom option; inline note that custom stays SOW-local.
- **Scope decision:** read-only reuse — Schedule never writes the Sales-owned catalog.

---

## 3. Deployed

- **sch-command** → Vercel prod (schedulecommand.com): BF-10 (`2dd93cb`), BF-11 (`42797b8`). Both preview-verified before merge.
- No migrations, no edge functions, no Sales/DB changes this session.

---

## 4. Decisions / choices made

- **BF-11 read-only reuse (no save-back).** Custom materials stay on the SOW; an inline note directs the user to Sales to save one for reuse. Avoids Schedule writing the Sales-owned `materials_catalog`. (Full parity w/ save-back was offered and declined.)
- **Stop-and-plan on MTRL instead of shipping the patch.** The `materials` table has no `kit_size`/spec columns (only job_id/ordinal/name/status/arrival_date/notes); the rollup fix worked but the *right* fix is a cross-repo data-model change. Chris chose to bite the bullet and plan it (DMS-1) rather than layer patches.
- **CORE ARCHITECTURE for DMS-1 [PROPOSED — ratify in plan]:** material application specs (kit, mils, coverage, mix time/speed, cure, unit) live on **`materials_catalog`** so they flow Sales bid → Schedule field SOW → crew ticket, with per-job override. This is why the **Sales SOW process/outputs must change too**.
- **DMS-1 UI decisions [LOCKED this session]:** (a) day-card header = day_label title + **TASK count**; drop the redundant "DAY X OF 7" badge. (b) Work to Complete = one row per task, **"TASK N"** label + colored **% badge** (100%=green, partial=amber). (c) Materials tagged with a **TASK N chip** (blank if unassigned).
- **Terminal discipline:** stayed in one terminal for all same-repo/same-mode work (no re-orient tax); the cross-repo *plan* gets a fresh terminal.

---

## 5. Backlog changes this session (`docs/BACKLOG.md`)

- **BF-1** → Done (verified already-shipped in code: header + back on worklist, forecast, and drill-ins).
- **BF-10** → Done (shipped) — notes modal.
- **BF-11** → Done (shipped) — Material Memory picker.
- **BF-12** → **Parked** on `feat/mtrl-sow-rollup` (pushed, unmerged). Its `rollupSowMaterials()` is the seed for DMS-1 Phase 4. Do NOT merge; fold in during Phase 4, then delete the branch.
- **DMS-1** (T2) → **New — the full plan seed.** Target, reference PDF, core architecture, data gaps, locked UI decisions, and the 5-phase sequence. This is the durable memory for the planning terminal.

Backlog commits: `f84eaeb`, `393e811`, `228047d`.

---

## 6. Current state & next steps

- **`main` is clean.** Two features live in prod. `feat/mtrl-sow-rollup` sits parked (unmerged) on purpose.
- **Next up = DMS-1, in its OWN planning terminal (plan mode).** Steps:
  1. `/orient` → `/decide` → **plan** (opus 4.8, xhigh) → `/erd-start daily-material-schedule`.
  2. Read **DMS-1** in `docs/BACKLOG.md` — it's the full seed; don't re-derive this conversation.
  3. **Copy the reference PDF off the Desktop into the repo** (`~/Desktop/6618 - Lakes Crossing - Material Schedule.pdf` → e.g. `docs/plans/assets/`) — never leave it on Desktop.
  4. Draft `docs/plans/daily_material_schedule.md` starting with the **field-ownership matrix** (bid vs field) and ratifying the specs-on-catalog decision, then update the Command Suite data contract.
- **Cross-repo reminder:** DMS-1 touches sales-command (SOW origin) + command-suite-db (migrations) + sch-command (SOW builder, MTRL, print). Migrations go through **command-suite-db** only.
