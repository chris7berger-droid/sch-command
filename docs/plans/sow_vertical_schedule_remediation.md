# Remediation Plan — SOW Vertical, Schedule-side rebuild on the current card design

**Status:** DRAFT for audit · supersedes the SCH placement decisions in `sow_vertical.md`
**Created:** 2026-06-15 (after Sales→Schedule smoke FAILED on design-baseline mismatch)
**Repo:** sch-command · branch `feat/sow-vertical`

---

## 1. What happened
SCH1/SCH2/SCH4 were built against the **JobDetail → Planning → Field SOW tab**, a design that
production had already retired in favor of the **Option-D `StageJobCard` + in-card modals**
(`feat/staged-ready-cards`, merged to `main` and present on this branch). Result: the per-WTC /
`job_wtcs` editor and the "Dates TBD" badge sit on surfaces users no longer reach; the surface
they *do* reach (`StageJobCard` SOW chip → `FieldSowModal`) still reads/writes the merged
`jobs.field_sow`, bypassing `job_wtcs`. Because Field reads `job_wtcs` first, Schedule SOW edits
made through the real path never reach the canonical data or the crew. **Smoke failed.**

## 2. Root cause
The vertical plan was authored against the old JobDetail-tab design and never reconciled with the
shipped card redesign. The audits / buildvsplan were spec-vs-code, so a design-baseline mismatch
the plan never named was invisible to every gate.

## 3. Design baseline (LOCKED for this remediation)
**`docs/plans/staged_ready_card_design.md` is the authority.** Confirmations:
- §3.5 — the SOW scorecard's click target is "Field SOW modal (`FieldSowBuilder.jsx`)": the design
  *intended* the in-card SOW modal to use `FieldSowBuilder`; the implementation diverged to
  `FieldSowModal`. Aligning to per-WTC completes the design's stated intent.
- §376 — JobDetail `?mode=management` "now serves only as a deep-history/audit-log surface": the
  Planning tabs (where SCH1 placed the editor) are **deprecated**.
- `Jobs.jsx:188` calls `loadJobs({ withWTCs: true })` and `StageJobCard` already uses `job._wtcs`,
  so the card has per-WTC data today — badge + per-WTC editing need no new loaders.

Planning happens in **in-card modals** on `StageJobCard`. **No work may reintroduce JobDetail
Planning tabs.**

## 4. Complete SOW / per-day-dates surface inventory

| Surface | Today | Disposition |
|---|---|---|
| `StageJobCard` **SOW** chip → in-card modal | opens `FieldSowModal` → merged `jobs.field_sow` | **REWIRE** → in-card modal hosting per-WTC `FieldSowBuilder` writing `job_wtcs` (design §3.5). Primary editor. |
| `StageJobCard` **DAYS** chip → `DaysModal` | read-only, job-level dates | **UPDATE** to per-WTC `job_wtcs` dates + TBD state |
| `StageJobCard` card body / **WORK TYPES** | uses `job._wtcs` | **ADD** "Dates TBD" indicator (SCH4) |
| Staged/Ready **tile checklist** (📋 SOW) | `field_sow != null` | extend to per-WTC / TBD awareness |
| `FieldSowModal` | merged, not WTC-aware (#6/#8) | **RETIRE/REPLACE** as editor; if kept as print/view, must read `job_wtcs`, WTC-tagged, widened inputs |
| **JobDetail `?mode=planning` Field SOW tab** (SCH1's edit) | per-WTC but deprecated surface | **REVERT** — JobDetail is mgmt-only |
| SCH4 badge on `ScheduledCardList` + JobDetail header | added by me | **MOVE** to `StageJobCard`; drop deprecated `mode=planning` deep-links (`ScheduledCardList:148/159`, `JobCardList:258`) |
| Schedule crew-view **SCOPE/SOW** field (#9) | `jobs.sow` text, not openable | make readable from canonical |
| `queries.js updateJobWtcFieldSow` | writes `job_wtcs` ✓ | **KEEP** — reuse from the card modal |

## 5. Salvaged vs redone
- **KEEP (correct):** `updateJobWtcFieldSow`; the `FieldSowBuilder` enhancements (date picker, `date`
  coercion guard, `handleSave` date preservation, scope-frozen note); both migrations (applied);
  **all Sales S1–S4** (different app, smoke-verified); Field F1–F3 (deferred, backlog D1).
- **REDO:** SCH1 editor placement (→ card modal); SCH4 badge placement (→ `StageJobCard`); the
  two-editor consolidation (#6/#8/#10/#11 fold in here).
- **REVERT:** JobDetail Planning Field SOW tab render + the `mode=planning` deep-links.

## 6. Build sequence
1. Host `FieldSowBuilder` (per-WTC, `updateJobWtcFieldSow`) inside the `StageJobCard` SOW modal;
   retire `FieldSowModal` as editor. (#6/#8/#10)
2. Add "Dates TBD" badge to `StageJobCard` (+ tile checklist). (#11/SCH4)
3. Revert JobDetail Planning Field SOW tab + `mode=planning` deep-links.
4. DAYS modal + crew-view scope field read canonical. (#9)
5. Re-smoke the full Sales→Schedule path **from the card flow**.

## 7. Acceptance criteria (new — entry-point coverage)
- Every SOW edit/read entry point resolves to `job_wtcs` (grep gate: no surface writes
  `jobs.field_sow` as canonical except the documented legacy fallback).
- Editing SOW from the **staged card** updates `job_wtcs`, reflected in card + DB.
- "Dates TBD" badge shows on the staged card for a TBD WTC.
- No reachable JobDetail Planning Field SOW editor remains.

## 8. Process fix (so this class can't recur)
Any data-model change requires, in planning: (a) a **surface/entry-point inventory** — every screen
reading/writing the touched data, tagged rewire / leave / retire; and (b) a **design-baseline
check** against the current production design doc. buildvsplan adds an **entry-point-coverage**
dimension (not just spec-vs-code).

## 9. Not affected by this remediation
- **Sales S1–S4** (sales-command WTCCalculator/ProposalDetail) — verified; the design issue is
  Schedule-only.
- **Migrations** `20260612120000` (job_wtcs nullable) + `20260613120000` (proposal_wtc.dates_tbd) —
  applied to prod; unchanged.
- **Field F1–F3** — deferred to Field launch (backlog D1).

## 10. Captured findings rolled into this remediation
Bugs: #7 (MaterialsModal closes per-edit — separate, not SOW), #8 (FieldSowModal input truncation →
folds into editor rebuild). Enhancements: #1 carry material specs, #2 menu-first task + 100% cap,
#3 ordered-qty header, #4 completeness gate, #5 burden-rate law, #6 FieldSowModal WTC-aware/date-
grouped, #9 crew-view scope clickable, #10 staged-card→canonical editor (this), #11 badge on staged
card (this). #6/#8/#10/#11 are the consolidation; #1–#5/#9 remain design-pass items.
