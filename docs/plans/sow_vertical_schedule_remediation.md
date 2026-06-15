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

**DaysModal write authority — [LOCKED Option 3] (Chris, 2026-06-15):** "single canonical writer" means
one write **function** (`updateJobWtcFieldSow`), **not** one UI. So the DAYS modal is a **read-only
overview that is click-to-edit**: each day row **deep-links into the in-card SOW modal** (the per-WTC
`FieldSowBuilder`) focused on that day's WTC. The DAYS modal itself performs **no SOW/date write** — it
only navigates to the canonical editor, where the write goes through `updateJobWtcFieldSow`. This
preserves the single-write-**function** discipline AND delivers finding #4 ("click a day to fix it").
(Supersedes the earlier Option-1 read-only-only framing.)

## 4. Complete SOW / per-day-dates surface inventory

**[DERIVED — recurrence vector]** Round-1 audit found the §4 inventory MISSED the **Staged→Ready readiness gate**, which is itself a SOW-*reading* surface and still keys on `jobs.field_sow` only. This is the exact failure class that shipped: a SOW-touching surface absent from the inventory. The readiness predicate exists in **two reconciled copies** (JS + SQL) that must be unified on ONE WTC-aware predicate (Finding A below).

### 4.1 The shared WTC-aware SOW predicate [LOCKED]

Every "does this job have a Field SOW?" check — read or gate — resolves through ONE predicate:

```js
// canonical SOW-present test (JS form)
const hasFieldSow =
     (job._wtcs?.some(w => Array.isArray(w.field_sow) && w.field_sow.length))
  || job.field_sow != null
```

The SQL mirror (`job_base_checklist_passes`) must be redefined to the equivalent: a job has SOW if **any** of its `job_wtcs` rows has a non-empty `field_sow` array, **OR** the parent `jobs.field_sow` is non-null (legacy fallback). Replace the current `IF p_job.field_sow IS NULL THEN RETURN false;` with an EXISTS-on-`job_wtcs`-OR-parent check.

### 4.2 Surface table

| Surface | Today (verified file:line) | Disposition |
|---|---|---|
| **Staged→Ready readiness gate (JS)** — `queries.js:38-45` `baseChecklistPasses` (`hasSOW = job.field_sow != null`, line 39) + `queries.js:49-53` `isReady` | reads `jobs.field_sow` only — **MISSED in round-1 inventory** | **REWIRE** `baseChecklistPasses` `hasSOW` to §4.1 predicate. **COUPLED** with the SQL fn (next row) — same step. |
| **Staged→Ready readiness gate (SQL)** — `job_base_checklist_passes(p_job)` — **canonical def in `20260528133000_repoint_crew_readiness_to_assignments.sql:32`** (redefines the earlier `20260528120000_...:60`; crew signal now reads `assignments`) | `IF p_job.field_sow IS NULL THEN RETURN false;` | **REWIRE** to §4.1's WTC-OR-parent EXISTS check. **COUPLED with the JS edit — must land in the SAME step**: a new migration redefines the fn; the JS predicate changes alongside it. Migration goes through the dashboard-apply + `migration repair --status applied` discipline (see §3 deploy path in `CLAUDE.md`); base the redefine on the **`...133000` body** (latest), not `...120000`, or the assignments-based crew check is lost. |
| `JobsPicker.jsx:34` tile-checklist SOW counter (`if (j.field_sow == null) missingSow++`) | `jobs.field_sow` only | **REWIRE** to §4.1 predicate (negated). |
| `StageJobCard.jsx:111` staged banner missing-📋 (`if (job.field_sow == null) missing.push('📋')`) | `jobs.field_sow` only | **REWIRE** to §4.1 predicate (negated). |
| `StageJobCard.jsx:206` PlanningPanel SOW scorecard (`const hasSOW = job.field_sow != null`) | `jobs.field_sow` only | **REWIRE** to §4.1 predicate. |
| `StageJobCard` **SOW** chip → in-card modal | opens `FieldSowModal` → merged `jobs.field_sow` | **REWIRE** → in-card modal hosting per-WTC `FieldSowBuilder` writing `job_wtcs` (design §3.5). Primary editor. See §6.1. |
| `StageJobCard` **DAYS** chip → `DaysModal` (`DaysModal.jsx`) | **already read-only**; reads job-level `scheduled_start`/`start_date` | **UPDATE** to read canonical per-WTC `job_wtcs` dates + TBD state; **read-only overview + click-to-edit deep-link into the SOW modal; no independent write path** (Finding F, [LOCKED Option 3]). |
| `StageJobCard` card body / **WORK TYPES** | uses `job._wtcs` | **ADD** "Dates TBD" indicator (SCH4) |
| `FieldSowModal` (`FieldSowModal.jsx`) | merged editor (`handleSave:83` writes `jobs.field_sow:92`), not WTC-aware | **STRIP EDIT PATH** → Print-only, reading `_wtcs`. See §6.1 / Finding D. After this it has NO write to `jobs.field_sow`. |
| **JobDetail `?mode=planning` Field SOW tab** (SCH1's edit) — render `JobDetail.jsx:448-494`; planning-tab-group gate `:193`; default-tab `:86`; URL deep-link consumed `:53` | per-WTC editor but on a **deprecated** surface | **REVERT** — JobDetail is mgmt-only. See §6.1 step 3 for exact targets. |
| ~~SCH4 badge on `ScheduledCardList`~~ | **`ScheduledCardList` is DEAD — zero importers** (verified: no `import`/`<ScheduledCardList` anywhere in `src/`) | **DELETE** the dead file; do NOT treat `ScheduledCardList:148/159` as live `mode=planning` deep-links. |
| Live `mode=planning` deep-links | `JobCardList.jsx:258` ("Job Planning" button) | **REMOVE** — only reachable `mode=planning` entry that survives. |
| Schedule crew-view **SCOPE/SOW** field (#9) | `jobs.sow` text, not openable | make readable from canonical |
| `queries.js updateJobWtcFieldSow` (`queries.js:500`, sig `(jobWtcId, nextFieldSow, changedBy, source)`) | writes `job_wtcs` ✓ + audits | **KEEP** — reuse from the card modal |

## 5. Salvaged vs redone
- **KEEP (correct):** `updateJobWtcFieldSow`; the `FieldSowBuilder` enhancements (date picker, `date`
  coercion guard, `handleSave` date preservation, scope-frozen note); both migrations (applied);
  **all Sales S1–S4** (different app, smoke-verified); Field F1–F3 (deferred, backlog D1).
- **REDO:** SCH1 editor placement (→ card modal); SCH4 badge placement (→ `StageJobCard`); the
  two-editor consolidation (#6/#8/#10/#11 fold in here).
- **REVERT:** JobDetail Planning Field SOW tab render (`JobDetail.jsx:448-494`) + the live `mode=planning`
  deep-link (`JobCardList.jsx:258`). **DELETE** the dead `ScheduledCardList.jsx` (zero importers) rather
  than reverting its links.
- **UNIFY:** the Staged→Ready readiness predicate (JS `baseChecklistPasses`/`isReady` + SQL
  `job_base_checklist_passes`) onto ONE WTC-aware SOW test (Finding A / §4.1) — the recurrence vector.

## 6. Build sequence

### 6.1 Detailed surface wiring

**Step 0 — shared SOW predicate + readiness reconciliation (Finding A, COUPLED).**
Land in ONE step:
- JS: edit `baseChecklistPasses` (`queries.js:38-45`) so `hasSOW` uses the §4.1 predicate; rewire the three other readers (`JobsPicker.jsx:34`, `StageJobCard.jsx:111`, `StageJobCard.jsx:206`) to the same predicate. Consider extracting a `hasFieldSow(job)` helper in `queries.js` so all four import one function (single source of truth, grep-able).
- SQL: new migration redefining `job_base_checklist_passes` — **base the body on `20260528133000`** (keeps the assignments-based crew check) and swap only the SOW test to the WTC-OR-parent EXISTS. Deploy via dashboard-apply + `migration repair --status applied <ts>` (`CLAUDE.md` §"Pushing Migrations"); run `node scripts/check-migration-collision.mjs` first.
- The JS edit and the SQL migration are a single coupled change — neither ships without the other, or the tile/gate and the DB disagree.

**Step 1 — host per-WTC `FieldSowBuilder` in the `StageJobCard` SOW modal (Finding B). (#6/#8/#10)**
- The in-card SOW modal maps `job._wtcs` → renders **one `FieldSowBuilder` per WTC**. `FieldSowBuilder`'s verified signature is `({ value, onSave, saving, availableMaterials })` (`FieldSowBuilder.jsx:26`); `onSave(clean)` is the save callback (`:142`).
- Each builder saves via `updateJobWtcFieldSow(wtc.id, next, changedBy)` — note the **real signature is `(jobWtcId, nextFieldSow, changedBy, source?)`** (`queries.js:500`), passing `wtc.id`, NOT a curried `updateJobWtcFieldSow(wtc.id)`. On success, update local `job._wtcs[i].field_sow` in place (mirror the existing JobDetail pattern at `JobDetail.jsx:461-468`).
- **Proposal-materials loader filtered by `proposal_wtc_id`.** This already exists in JobDetail (`JobDetail.jsx:100-113`: loads `proposal_wtc` rows joined to `proposals.call_log_id`, flattens `materials` tagging each with `_wtc_id = proposal_wtc.id`) and is consumed per-WTC at `JobDetail.jsx:460` via `proposalMaterials.filter(m => String(m._wtc_id) === String(wtc.proposal_wtc_id))`. **Port this loader + per-WTC filter into the StageJobCard modal host** (or lift into a shared hook/`queries.js` helper so JobDetail and the card don't drift). Do NOT invent a new query — reuse this verified one.
- **Multi-WTC container — [LOCKED] WTC tabs/switcher in the modal:** a job with N WTCs shows N tabs (one per `job._wtcs` row, labelled `work_type_name`); the active tab renders that WTC's `FieldSowBuilder` with its `proposal_wtc_id`-filtered materials. (Chosen over a long vertical stack — keeps the modal scannable for multi-GC jobs; single-WTC jobs render one tab / no tab chrome.)

**Step 2 — "Dates TBD" badge on `StageJobCard` (+ tile checklist). (#11/SCH4)**

**Step 3 — revert JobDetail Planning Field SOW tab + remove live `mode=planning` deep-links (Finding C).**
Verified targets:
- Remove the Field SOW tab render block `JobDetail.jsx:448-494`.
- Remove/neutralize the planning-tab-group gate `JobDetail.jsx:193` (`mode !== 'management'`) and the default-tab branch `JobDetail.jsx:86` (`mode === 'planning' ? 'fieldsow' : 'overview'`) so no `mode=planning` resolves to a SOW editor; `:53` reads the `mode` param.
- Remove the live deep-link: `JobCardList.jsx:258` ("Job Planning" → `?mode=planning`).
- **DELETE `src/components/ScheduledCardList.jsx`** — it is DEAD (zero importers). Its `:148/159` `mode=planning` links are unreachable; do NOT spend revert effort treating them as live.

**Step 4 — DAYS modal + crew-view scope field read canonical. (#9)**
- `DaysModal.jsx` is **already read-only** (no write path today; reads `scheduled_start`/`start_date`). Update it to read canonical **per-WTC `job_wtcs`** dates and surface TBD state. **[LOCKED Option 3]:** read-only overview with per-WTC dates/TBD; **each day row deep-links into the SOW modal at that day/WTC** (opens the per-WTC `FieldSowBuilder` focused there). The DAYS modal performs **no SOW/date write** — it only navigates to the canonical editor. Do NOT add a DaysModal write path.
- Crew-view scope field reads canonical.

**Step 5 — strip `FieldSowModal` edit path entirely (Finding D). (#6/#8)**
- Remove the Edit/Save UI and `handleSave` (`FieldSowModal.jsx:83-97`, which writes `supabase.from('jobs').update({ field_sow })` at `:92`), plus the `editing` state, Edit button (`:174`), and `handleCancel`.
- **Keep Print only** (`handlePrint`, `FieldSowModal.jsx:105`), reading `_wtcs` (canonical) instead of `job.field_sow`.
- After this, `FieldSowModal` has **NO write path** to `jobs.field_sow`.

**Step 6 — re-smoke the full Sales→Schedule path from the card flow.**

## 7. Acceptance criteria (new — entry-point coverage)

### 7.1 `jobs.field_sow` writer allowlist
After this remediation, exactly **ONE** code path may write `jobs.field_sow`, and it is the documented legacy/mirror fallback:

- **ALLOWED:** `JobDetail.jsx:480` — `updateJobField(job.job_id, 'field_sow', next, ...)` inside the **legacy / pre-vertical fallback branch** (the `job._wtcs.length === 0` else-branch), reached only for legacy merged-row jobs with no `job_wtcs` children. This is the one documented `jobs.field_sow` writer that remains.
- **FAIL (must be zero after build):** any other write of `jobs.field_sow`. Specifically the current `FieldSowModal.jsx:92` (`supabase.from('jobs').update({ field_sow })`) MUST be gone (Finding D / §6.1 step 5).

**Grep gate (precise enough to distinguish allowlisted legacy writer from a regression):**
```bash
# 1. All jobs.field_sow writes via .update():
grep -rn "update(.*field_sow" src/
#    → MUST return ONLY JobDetail.jsx (the legacy-fallback updateJobField). Zero hits in FieldSowModal/StageJobCard/any card-modal host = pass.
# 2. Any raw supabase write to the jobs table carrying field_sow:
grep -rnE "from\('jobs'\)\.update\(.*field_sow|update\(\{[^}]*field_sow" src/
#    → MUST NOT hit FieldSowModal.jsx; MUST NOT hit any new StageJobCard SOW-modal file.
# 3. Canonical writer is reused, not re-implemented:
grep -rn "updateJobWtcFieldSow" src/
#    → the card SOW modal MUST call this; raw from('job_wtcs').update() outside queries.js = fail.
```
The distinguisher: a hit is allowlisted ONLY if it is the `updateJobField(..., 'field_sow', ...)` call in JobDetail's `_wtcs.length === 0` fallback branch. A `from('jobs').update({ field_sow })` anywhere, or any `field_sow` write outside that branch, is a canonical-write regression and fails the gate.

### 7.2 Per-surface enumeration — each REWIRE/UPDATE asserts `job_wtcs` change + `job_changes` audit row
For each surface from §4 that edits SOW/dates, the acceptance test asserts BOTH a `job_wtcs` mutation AND a `job_changes` audit row (the `updateJobWtcFieldSow` path inserts `field = 'job_wtc.field_sow:<id>'`, verified `queries.js:530`):

| Surface (§4) | Action | Assert `job_wtcs` change | Assert `job_changes` audit |
|---|---|---|---|
| StageJobCard SOW modal — per-WTC `FieldSowBuilder` (§6.1 step 1) | save SOW for a WTC | `job_wtcs.field_sow` (+ derived `start_date`/`end_date`) updated for that `wtc.id` | one row, `field = 'job_wtc.field_sow:<wtc.id>'`, `source='schedule_command'` |
| Multi-WTC job (N tabs) | save on tab 2 | only tab-2's `job_wtcs` row changes | one audit row keyed to tab-2's WTC; tab-1 untouched |
| `baseChecklistPasses` / `isReady` (JS) + `job_base_checklist_passes` (SQL) | add SOW to a WTC of a Staged job | the WTC-aware predicate now returns SOW-present; tile/gate flip without writing `jobs.field_sow` | n/a (read gate) — but the SOW write that triggered it produced its `job_wtcs` audit row above |
| DaysModal (read-only overview, click-to-edit deep-link — Finding F / Option 3) | open on a multi-WTC job; click a day row | DAYS modal writes **nothing**; clicking a day **navigates** to the SOW modal, where any edit goes through `updateJobWtcFieldSow` | **zero** `job_changes` rows from DaysModal itself; the audit row (if the user then edits) is produced by the SOW modal, not DaysModal |

### 7.3 Coverage / revert assertions
- Editing SOW from the **staged card** updates `job_wtcs`, reflected in card + DB (not `jobs.field_sow`).
- "Dates TBD" badge shows on the staged card for a TBD WTC.
- No reachable JobDetail Planning Field SOW editor remains (`mode=planning` resolves to nothing SOW-editing; `JobCardList:258` link gone; `ScheduledCardList.jsx` deleted).
- The Staged→Ready gate (JS + SQL) agrees on SOW-present for a WTC-only job (no parent `jobs.field_sow`).
- **The DAYS modal has zero SOW/date write paths** — it only navigates to the canonical SOW modal (Option 3). Grep-confirm no date write exists outside `updateJobWtcFieldSow`: `DaysModal.jsx` (and its handlers) contains no `from('job_wtcs').update`/`from('jobs').update` carrying `field_sow`, `start_date`, or `end_date`; the only date-write path in the codebase is `updateJobWtcFieldSow` (which derives dates from `field_sow[*].date`).

## 8. Process fix (so this class can't recur) — enforceable gate (Fold O2)

Prose alone is what let this slip. Concrete, checkable gate. **A plan that touches a shared data field
does not pass `/auditcriteria` until every box is checked in the plan doc:**

- [ ] **Entry-point inventory present.** A table listing EVERY surface that reads or writes the touched
  field, each with a **verified `file:line`** and a disposition (`REWIRE` / `LEAVE` / `RETIRE` /
  `DELETE`). The recurrence vector here was a SOW *reader* (the readiness gate) with no inventory row.
- [ ] **Grep-derived, not memory-derived.** The inventory was built by running and pasting the grep:
  `grep -rn "<field>" src/` (+ the SQL mirror: `grep -rln "<fn_or_field>" supabase/migrations/`). Include
  the command + that it was run. Both JS **and** SQL surfaces enumerated.
- [ ] **Dead-code check.** Every "deep-link / consumer" surface was confirmed live via
  `grep -rn "import.*<Component>\|<<Component>" src/` — zero-importer files are marked DELETE, not REVERT.
- [ ] **Canonical-write allowlist.** A `file:line` allowlist of every permitted writer of the field, with
  a grep gate precise enough to distinguish the allowlisted writer from a regression (see §7.1).
- [ ] **Design-baseline check.** Named the current production design doc and confirmed the touched
  surfaces are the ones users actually reach (not a retired screen) — the §2 root cause.

`buildvsplan` adds an **entry-point-coverage** pass: re-run the inventory grep against the built diff and
confirm no SOW-touching surface writes the non-canonical field outside the allowlist (not just spec-vs-code).

## 9. Not affected by this remediation
- **Sales S1–S4** (sales-command WTCCalculator/ProposalDetail) — verified; the design issue is
  Schedule-only.
- **Migrations** `20260612120000` (job_wtcs nullable) + `20260613120000` (proposal_wtc.dates_tbd) —
  applied to prod; unchanged.
- **Field F1–F3** — deferred to Field launch (backlog D1). Fold O1: the specific Field surface this
  remediation does **not** touch is **`TasksTab`** (Field Command's day/task editor). It reads `job_wtcs`
  via PowerSync; once Schedule writes canonical per-WTC SOW correctly (the fix here), `TasksTab` consumes
  it unchanged. No edit to `TasksTab` is in scope; "Field not affected" is scoped to that component, not a
  blanket claim about the Field app.

## 10. Captured findings rolled into this remediation
Bugs: #7 (MaterialsModal closes per-edit — separate, not SOW), #8 (FieldSowModal input truncation →
folds into editor rebuild). Enhancements: #1 carry material specs, #2 menu-first task + 100% cap,
#3 ordered-qty header, #4 completeness gate, #5 burden-rate law, #6 FieldSowModal WTC-aware/date-
grouped, #9 crew-view scope clickable, #10 staged-card→canonical editor (this), #11 badge on staged
card (this). #6/#8/#10/#11 are the consolidation; #1–#5/#9 remain design-pass items.

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-06-15 (round 2). Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
Round 1 found the big miss — a "is the SOW done?" check (the Staged→Ready gate) that everyone forgot was reading the SOW, in both the app code and the database. The plan now fixes it. This round confirms the inventory is finally complete and checks the one new moving part: a database-function change that has to stay in lock-step with the app code, built on the *right* version of that function (an earlier copy would quietly break the crew-readiness check). Three reviewers, still weighted on "did we find every screen."

### Round
- Current round: 2
- Plan revision under audit: `14c12e4`
- Findings trend: round 1 (12 deduped: 5H/4M/3L) → round 2 (?) — coverage gap addressed; this round verifies completeness + the new SQL-fn migration the fix introduced.

### Prior rounds
- Round 1: `1392dc7` · 5H/4M/3L (12 deduped) · pattern: `entry-point-coverage-gap`

**Briefing for agents**: do NOT re-find round-1 issues. Round-1 fixes (commit `1392dc7` + Option-3 follow-up `14c12e4`): **A** — the MISSED Staged→Ready readiness gate added to §4; all four `jobs.field_sow` readers (`baseChecklistPasses`/`isReady`, `JobsPicker:34`, `StageJobCard:111`, `:206`) + the SQL `job_base_checklist_passes` unified on ONE WTC-aware predicate (§4.1); **B** per-WTC `FieldSowBuilder` loop + reused `proposal_wtc_id` materials loader + WTC-tabs container; **C** `ScheduledCardList` confirmed DEAD → DELETE, real revert targets are `JobCardList:258` + JobDetail (`:448-494/:193/:86`); **D** `FieldSowModal` edit/handleSave stripped → Print-only; **E** §7 `jobs.field_sow` writer allowlist + per-surface `job_wtcs`+`job_changes` enumeration; **F→Option 3** — DAYS modal is a read-only overview whose day rows **deep-link** into the SOW modal (no DAYS write path; single write *function*). This audit must STAY design-baseline + entry-point-coverage aware (the parent's 3 spec-vs-code rounds missed the original design mismatch). Verify the §4 inventory is NOW complete and the JS↔SQL predicate parity holds.

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant blocked.
- **Prod / staging / dev**: Schedule Command live; the `StageJobCard` / staged-ready-cards design IS the production surface. The `job_wtcs` SOW write path is net-new and was **BROKEN** at round 0 (smoke failed — real edits hit `jobs.field_sow`, not canonical `job_wtcs`).
- **Blocking feature flags**: none.
- **Concurrency profile**: ≤5 office on web.

Severity caps: cross-tenant → **Med**; race → **Low**. NOTE: this fixes a **confirmed-broken** path (smoke failed), so "an editor writes the wrong table / a surface is missed / JS-SQL predicate disagree" findings are real **CAUSED-BY**, not theoretical.

### Time budget + finding cap
- **Time budget**: not ERD-locked (focused remediation).
- **Finding cap**: **6**.

### Surface
- Total lines: 283
- Sections: 11
- [LOCKED] decisions: 6 (incl. §3 design authority, §4.1 shared predicate, WTC-tabs container, F=Option 3)
- [DESIGN-OPEN] items: 0 (F resolved → Option 3)
- [OPEN] items: 0
- Plan-to-code ratio: ~283 plan : est ~250–450 code (rewire + 1 SQL-fn migration) ≈ healthy

### Layers touched
- UI / components (StageJobCard SOW/DAYS chips + in-card modal, FieldSowModal Print-only, FieldSowBuilder per-WTC + WTC tabs, DaysModal deep-link, JobDetail revert, tile checklist)
- Data layer (`queries.js` `updateJobWtcFieldSow` reuse, the new shared `hasFieldSow` predicate helper, `loadJobs({withWTCs})`)
- State model (`job_wtcs` canonical vs `jobs.field_sow` legacy mirror; the readiness predicate)
- **Migrations / schema (NEW this round)** — a migration redefining the SQL fn `job_base_checklist_passes` (the SOW-present test → WTC-aware), coupled to the JS edit
- Audit logging (`job_changes` rows asserted per surface, §7.2)

### New mechanisms introduced
- **New migration** — redefine `job_base_checklist_passes` (SQL) to the WTC-aware SOW EXISTS check, **based on the `...133000` body** (assignments-based crew check) — dashboard-apply + ledger-repair.
- **New shared helper** — `hasFieldSow(job)` in `queries.js`, the single WTC-aware SOW-present predicate all four JS readers import (§4.1).
- Rewire: per-WTC `FieldSowBuilder` loop inside the `StageJobCard` SOW modal; **WTC-tabs** container; `FieldSowModal` → Print-only (edit path stripped); DAYS modal day-row → SOW-modal deep-link (Option 3).
- Process: planning gate (surface/entry-point inventory + design-baseline check); `buildvsplan` gains entry-point-coverage (§8).

### Cross-system reach
- Schedule-only this remediation (§9: Sales S1–S4 unaffected/verified; Field narrowed to `TasksTab`, deferred to backlog D1).
- Touches canonical `job_wtcs` (shared DB) Field will read — Field deferred, no live cross-repo consumer this round.

### Irreversibility
- **One migration** — the `job_base_checklist_passes` redefine (replaces an existing fn body; cross-repo ledger-coordinated, dashboard-applied + `migration repair`). Reversible by redefining back, but a wrong base body (`...120000` not `...133000`) silently regresses the crew-readiness check.
- No backfills; no new columns; rest is UI rewiring.

### Known weak points
- **Entry-point coverage completeness (STILL the crux):** round 1 caught one missed SOW surface (the readiness gate). VERIFY the §4 inventory is now EXHAUSTIVE — grep every `field_sow`/`job_wtcs` read+write; find ANY remaining surface not listed or still treating `jobs.field_sow` as canonical.
- **JS↔SQL predicate parity (NEW, the coupled-change risk):** the `hasFieldSow` JS helper and the redefined `job_base_checklist_passes` SQL must encode the SAME WTC-OR-parent logic; if they drift, tile/gate and DB disagree. And the SQL redefine MUST start from `...133000` (assignments crew check) — `...120000` loses it.
- **`FieldSowModal` strip leaves no writer:** edit/handleSave removed, Print-only reading `_wtcs` — confirm zero residual `jobs.field_sow` write.
- **Option-3 DAYS deep-link wiring:** the day-row click must open the SOW modal focused on that day's WTC, and the DAYS modal must hold no write path of its own (§7.3 grep assertion).
- **JobDetail revert completeness:** the real targets (`JobCardList:258`, JobDetail `:448-494/:193/:86`); `ScheduledCardList.jsx` DELETED — confirm no `mode=planning` resolves to a SOW editor.
- **Grep-gate precision (§7):** must distinguish the ONE allowlisted legacy writer (`JobDetail.jsx:480`, `_wtcs.length===0` fallback) from a regression — false-pass risk.

### Open questions
- Count: 0 design-open. Round 2 = verify completeness + the new SQL-fn migration parity.
- Highest-pressure: is the §4 inventory NOW exhaustive, and do the JS + SQL predicates match?

### Suggested attack angles (3 total)
1. **Entry-point coverage completeness (STILL the crux)** — covers UI + State model. Reading: grep every `field_sow`/`job_wtcs` read+write across sch-command `src/`; the §4 inventory + §4.1 predicate; `JobsPicker`, `StageJobCard`, `DaysModal`, `FieldSowModal`, crew-view, tile checklist. Pressure: round 1 found ONE missed surface — find another, or prove the inventory is exhaustive. Do all four JS readers now route through the shared predicate? Any surface still keying on `jobs.field_sow` alone?
2. **SQL-fn migration + JS↔SQL predicate parity** — covers Migrations + Data layer + State model. Reading: `20260528133000_*` + `20260528120000_*` (the two `job_base_checklist_passes` defs), the planned redefine, `queries.js` `hasFieldSow`/`baseChecklistPasses`, RESUME ALERT/ledger discipline. Pressure: is the redefine based on `...133000` (keeps assignments crew check)? Do JS and SQL encode identical WTC-OR-parent logic? Migration-ledger / collision discipline followed? 3VL edge cases (empty array vs null).
3. **Rewire + Option-3 deep-link + `FieldSowModal` strip** — covers UI / components + audit logging. Reading: `staged_ready_card_design.md` (§3.5/§376), `StageJobCard`, `FieldSowBuilder` (sig `{value,onSave,saving,availableMaterials}`), `DaysModal`, `FieldSowModal`, JobDetail revert sites, `queries.js:500` `updateJobWtcFieldSow`. Pressure: per-WTC builder in WTC tabs (state/save/close per tab); does the DAYS day-row deep-link land on the right WTC/day with no DAYS write path; does the `FieldSowModal` strip leave zero `jobs.field_sow` writes; is the JobDetail revert complete; per-surface `job_changes` audit-row assertions (§7.2) sound.

### Suggested agent count: 3

Rationale: round 1 surfaced 5 Highs and the coverage crux remains; the new SQL-fn migration adds a real JS↔SQL-parity + wrong-base-body risk worth a dedicated agent. 3 (coverage / migration-parity / rewire) — not down to 2 yet given the High count and the new migration.
