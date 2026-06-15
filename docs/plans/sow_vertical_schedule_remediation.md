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

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-06-15. Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
The Schedule-side SOW work was built on a screen the app had already retired, so the screen users actually click still saves to the wrong place and the crew never sees the edit — the smoke test caught it. This plan rewires the editing onto the current card. The one thing that matters: did we find **every** screen that touches the SOW, or is another one still wired to the old data? Three reviewers, weighted on coverage completeness.

### Round
- Current round: 1
- Plan revision under audit: `acb8e54`
- Findings trend: n/a — round 1 (new remediation plan, separate from `sow_vertical.md`).

### Prior rounds
none — round 1 for this remediation plan.

**Briefing for agents**: the parent `sow_vertical.md` passed a 3-round audit, but those passes were **spec-vs-code** and MISSED this **design-baseline mismatch** (see §2) — the editor was placed on a retired surface. This audit MUST be **design-baseline + entry-point-coverage aware**, not spec-vs-code. The §0-equivalent reproduction is §1 (observed smoke failure) + §2 (root cause): the real path (`StageJobCard` SOW chip → `FieldSowModal`) writes merged `jobs.field_sow`, bypassing canonical `job_wtcs`, so Field never sees the edit.

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant blocked.
- **Prod / staging / dev**: Schedule Command live; the `StageJobCard` / staged-ready-cards design IS the production surface. The `job_wtcs` SOW write path is net-new and currently **BROKEN** (smoke failed — real edits hit `jobs.field_sow`, not canonical `job_wtcs`).
- **Blocking feature flags**: none.
- **Concurrency profile**: ≤5 office on web.

Severity caps: cross-tenant → **Med**; race → **Low**. NOTE: this fixes a **confirmed-broken** path (smoke failed), so "an editor writes the wrong table / a surface is missed" findings are real **CAUSED-BY**, not theoretical.

### Time budget + finding cap
- **Time budget**: not ERD-locked (focused remediation).
- **Finding cap**: **6**.

### Surface
- Total lines: 92
- Sections: 10
- [LOCKED] decisions: 1 (§3 — `staged_ready_card_design.md` is the design authority; **no** JobDetail Planning tabs)
- [DESIGN-OPEN] items: 0 formal (#1–#5/#9 explicitly deferred to a later design pass — out of scope)
- [OPEN] items: 0
- Plan-to-code ratio: ~92 plan : est ~200–400 code (rewire across several components) ≈ healthy

### Layers touched
- UI / components (StageJobCard SOW/DAYS chips + in-card modals, FieldSowModal, FieldSowBuilder, DaysModal, JobDetail revert, ScheduledCardList/JobCardList deep-links, tile checklist)
- Data layer (`queries.js` `updateJobWtcFieldSow` reuse, `loadJobs({withWTCs})`)
- State model (`job_wtcs` canonical vs `jobs.field_sow` merged mirror; `dates_tbd`)

### New mechanisms introduced
- No new tables/columns (both migrations already applied, unchanged — §9).
- Rewire: host `FieldSowBuilder` (per-WTC) inside the `StageJobCard` SOW modal; retire `FieldSowModal` as editor.
- Move SCH4 "Dates TBD" badge → `StageJobCard` + tile checklist.
- Revert JobDetail Planning Field SOW tab + `mode=planning` deep-links.
- Process: new planning gate (surface/entry-point inventory + design-baseline check); `buildvsplan` gains an entry-point-coverage dimension (§8).

### Cross-system reach
- Schedule-only this remediation (§9: Sales S1–S4 unaffected/verified; Field F1–F3 deferred to backlog D1).
- Touches canonical `job_wtcs` (shared DB) that Field will read — but Field is deferred, so no live cross-repo consumer this round.

### Irreversibility
- None — UI rewiring; no new migrations, no backfills, no schema change. Reversible.

### Known weak points
- **Entry-point coverage completeness (THE crux):** §4's inventory must catch EVERY surface that reads/writes SOW. If one surface still treats `jobs.field_sow` as canonical, the bug recurs — this is exactly the failure that shipped. The §7 grep gate must hold.
- **`FieldSowModal` retire boundary:** retired as editor but maybe kept as print/view — does any retained path still WRITE merged `jobs.field_sow`?
- **`FieldSowBuilder` in a new container:** built for the JobDetail tab; hosting it in the `StageJobCard` in-card modal — does state/save/close behave correctly in the modal context?
- **JobDetail revert completeness:** reverting the Planning tab + the `mode=planning` deep-links (`ScheduledCardList:148/159`, `JobCardList:258`) — any missed deep-link leaves a reachable broken editor.
- **Mirror vs canonical boundary:** `jobs.field_sow` stays as a legacy read fallback; the §7 grep gate must distinguish the documented fallback from a canonical write (false-pass risk).
- **DAYS modal + crew-view scope:** updating these to read canonical `job_wtcs` — do they handle the per-WTC + TBD shape?

### Open questions
- Count: 0 formal design-open (#1–#5/#9 deferred to a later design pass, out of scope).
- Highest-pressure: is the §4 surface inventory actually COMPLETE? (recurrence risk)

### Suggested attack angles (3 total)
1. **Entry-point / surface-coverage completeness** (THE crux) — covers UI + State model. Reading: grep every `jobs.field_sow` / `job_wtcs` / `field_sow` read+write across sch-command `src/`; `StageJobCard`, `FieldSowModal`, `DaysModal`, `FieldSowBuilder`, tile checklist, crew-view; the §4 inventory. Pressure: is the inventory complete? Find ANY SOW read/write surface not listed in §4. Any surface still writing `jobs.field_sow` as canonical after the rewire? Will the §7 grep gate actually catch a regression?
2. **Component rewire + design-baseline fit** — covers UI / components. Reading: `staged_ready_card_design.md` (§3.5, §376), `StageJobCard`, `FieldSowModal`, `FieldSowBuilder`, JobDetail (`mode=planning`/`management`), the deep-link sites. Pressure: does hosting `FieldSowBuilder` per-WTC in the in-card modal actually work (state/save/close)? Does the `FieldSowModal` retire leave no canonical-write path? Is the JobDetail revert + deep-link removal complete? Does it match the design doc's stated intent (§3.5 click target = `FieldSowBuilder`)?
3. **Canonical-data consistency + acceptance/process gates** — covers Data layer + State model. Reading: `queries.js` (`updateJobWtcFieldSow`, `loadJobs withWTCs`), the `jobs.field_sow` mirror vs `job_wtcs`, DAYS modal, crew-view scope, §7 acceptance + §8 process fix. Pressure: the mirror/canonical boundary (legacy fallback vs canonical write); do DAYS modal + crew-view read the per-WTC/TBD shape; do the §7 acceptance criteria actually PROVE entry-point coverage (not just "an editor works"); is §8's process fix concrete enough to prevent recurrence.

### Suggested agent count: 3

Rationale: 3 distinct layers (UI-heavy + data + state) plus a hard recurrence-risk crux (entry-point coverage) that the prior spec-vs-code audit missed — one dedicated coverage agent + rewire-correctness + consistency. Schedule-only + no new schema keeps it at 3, not 4.
