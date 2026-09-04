# Schedule Data Migration — App Script Sheet → Schedule Command

**Branch:** `feat/schedule-data-migration` (sch-command)
**Status:** **BUILT (feature + one-time scripts), 2026-09-04** — commit + save only; nothing
deployed, no test data touched. Gates (buildvsplan / code-review / security-review) + the actual
one-time run (fresh export → match → rehearse → apply) are separate downstream steps.
**History:** ideate + plan → audit R1 (clean-slate) → audit R2 (wipe scope) → onboarding-tool
decision → audit R3 (converged 0C/0H) — all 2026-09-03 → build 2026-09-04.

## Build log (2026-09-04)

Branch `feat/schedule-data-migration` (sch-command) + `feat/schedule-data-migration`
(command-suite-db). Live schema re-verified before building (§10).

- **Import engine** — `src/lib/yesv2Import.js` (+ `.verify.mjs`, 21 checks pass): hardcoded YESv2
  header contract + validation (R3-4), §5 transforms (Active→Ongoing, text Yes/No, wall-clock
  dates, money strip, `_oldJobId` for the A2 remap, `call_log_id` null pre-match), crew_status
  last-wins collapse (B5), crew derivation, smart-assist ranking (number → customer → job-name)
  with confidence tiers.
- **Feature** — `src/views/Import.jsx` (`/import` route + nav) + `src/lib/importData.js`: CSV
  upload with per-tab header validation, left/right panes, ranked candidates + click-to-confirm
  (chosen over drag — same one-link result, steadier over ~120 rows), right-pane search,
  Internal/Unmatched states, duplicate-target hard block (N4), draft autosave/restore, ADDITIVE
  Apply with the A2 remap. **No `DELETE FROM jobs` anywhere in the feature (R3-3).**
- **Draft table** — command-suite-db migration `20260904120000_migration_match_draft.sql`:
  `tenant_id` DEFAULT + FK, 4 standard tenant policies, **no catch-all** (R3-2). Not pushed.
- **One-time wipe+load** — `scripts/generate_hdsp_migration_sql.mjs` + `HDSP_MIGRATION_RUNBOOK.md`:
  standalone generator (outside feature runtime) emitting ONE transaction — backup all 9 children
  + job_changes (§6.3), FK-order rows-only wipe (§6.4), empty-gate (§6.5/N3), guard index
  pre-insert (§6.6/N4 — created here, not a standing migration, because current prod's duplicate
  `call_log_id`s would fail a unique index today), staged load with the A2 remap, explicit
  tenant_id stamp (§5/A3). Verified to emit well-formed SQL in `--sample` mode.
- **O2 (rehearse mechanism)** still open — confirm with the DB terminal before the prod run.

---

## 1. Plain-English summary (what we're doing and why)

The old Schedule tool is a Google App Script on a spreadsheet ("YES Schedule v2" / YESv2). It has
been the **only** place real scheduling happens. Schedule Command is its replacement, now on the
shared database. **This is a one-time copy of the old sheet's data into the live Schedule Command,
after which the old app shuts off.**

**Confirmed 2026-09-03 (Chris):** all real scheduling has happened *only* in the old YESv2 sheet.
Everything currently sitting in Schedule Command is **test data** — safe to clear after a backup.
This makes the load a clean-slate reload from the sheet, not a merge.

The catch that shapes the whole job: the old sheet's jobs don't line up cleanly with the master
job records on the sales side (job-number formats differ, numbers repeat across change orders,
customer names vary). A script guesses wrong constantly (proved: only ~17 of 38 auto-match). So the
heart of this is a **one-time matching tool** — old jobs on the left, real master records on the
right, human confirms each link — then one clean, verified load.

---

## 2. Verified current state (checked against the live DB, 2026-09-03)

Shared Supabase project: `pbgvgjjuhnpsumnowuym`.

| Fact | Value | Note |
|---|---|---|
| Master job records (`call_log`) | 378 (372 active, 6 archived) | the right-side match target |
| Customers (`customers`) | 2,098 | |
| Schedule jobs (`jobs`) currently present | 86 (84 live / 86 raw) | **all TEST data** (Chris-confirmed) |
| — orphaned (`call_log_id IS NULL`) | 62 | prior `migrate.mjs` load |
| — carrying assignments | 58 orphans, **742 assignment rows** | test, but real rows — must back up before wipe |
| — carrying billing | 25 orphans | test |
| — edited | 2026-05-28 → 2026-07-14 | test poking, not real work |
| `jobs.job_id` | serial, max 106; 43 rows in range 1–50 | **collides with old sheet JobIDs** (see §5 remap) |
| Duplicate `call_log_id` in test jobs | 3485×3, 3855×3, 42×2 | wiped in reset; no `UNIQUE` on the column today |
| `materials` table | **does not exist** | live DB has `job_material_lines` etc., not `materials` |
| Checked-in CSVs at repo root | STALE (50 jobs, ~April) | replace with fresh export |
| Live sheet ("YES Schedule v2") | ~120+ jobs to #10069+, edited today | source of truth |

**Why automation can't match (confirmed in `call_log`):**
- **Numbers repeat** — "6507" is 12 records under Contract Flooring (6507, 6507 CO1…CO7, 6507WTC6…).
- **Customer names vary** — old "Kalb" → "KalB Construction" / "KalB Industries of Nevada" / …
- **Job names share no text** — old "Kalb" vs "Kalb - Officers Memorial - Weatherproofing".

---

## 3. Locked scope decisions

1. **One-time copy**, old app retired after. No parallel run, no back-sync.
2. **Everything comes across** — full history, incl. finished/billed jobs.
3. **Clean, not flat** — every job wired to its real master record + customer.
4. **Human matching via a purpose-built tool** — not a matching script.
5. **Smart-assisted** — tool floats best-guess candidates; human confirms every one.
6. **Change-order level** — each old row links to one exact `call_log` record.
7. **Internal bucket** — non-customer rows (shop work, orientations, punch lists) park unlinked.
8. **Draft, then apply once** — matches accrue as a draft; rehearse on a copy before prod.
9. **Crew needs no matcher** — schedule stores crew as text; assignments copy as-is.
10. **Clean-slate reload** *(resolved after audit rounds 1–2)* — all current schedule data is test
    (Chris-confirmed 2026-09-03: the React app has only had jobs run through it to check flow; he
    makes no real decisions from it and starts real use *after* this load). So we **back up, then
    wipe all schedule test data — rows only, never structure — and reload from the fresh sheet
    export.** Scope of the wipe is all 9 `jobs` children + the audit log, not just 3 (see §6). We do
    NOT relink the existing 62 rows. The sheet is the sole source of truth. The SOW / material-flow
    feature structure we built is preserved (DELETE, not DROP).
11. **Matcher is a permanent onboarding feature, not a throwaway** *(decided with Chris)* — built as
    a reusable Customer Onboarding / Import tool in Schedule Command: CSV-in, additive-only,
    match-to-existing. The one-time test-data wipe is a separate operation, not part of the feature.
    See §4.

---

## 4. The matching tool — a permanent onboarding feature

**What it is (decided with Chris):** not a throwaway — a **permanent Customer Onboarding / Import
feature in Schedule Command**, analogous to Sales Command's archive locker. Every future customer
onboards the same way. Runs in-app as the authenticated tenant user.

> **⚠️ Tenant isolation is NOT RLS-enforced today (R3-1, verified live 2026-09-03).**
> `jobs`, `assignments`, `billing_log`, `crew`, `crew_status` each carry a legacy policy
> `"Authenticated users can do everything"` (cmd=ALL, `USING auth.role()='authenticated'`). Postgres
> OR's permissive policies, so this **overrides** the correct `tenant_id = get_user_tenant_id()`
> policy — the effective check on these 5 tables collapses to "any authenticated user." Harmless now
> (1 live tenant, no victim), but this feature must NOT claim "isolation for free."
> **Hard prerequisite before a 2nd tenant uses the tool:** drop those 5 blanket policies in
> command-suite-db (per `CLAUDE_RLS.md`, 6-gate deploy). Does NOT block the one-time HDSP load.
> (`call_log` / `customers` — the right pane — are correctly scoped.)

**Core principles of the reusable tool:**
- **CSV in, never a live connection.** The customer hands us a CSV export; we never reach into their
  old system. Their old structure is left entirely alone.
- **Validate the upload (R3-4).** On import, check CSV headers == the expected set, reject/report
  malformed or oversized rows before anything reaches the matcher. (Injection risk is low — inserts
  are parameterized — but a permanent feature needs real input validation.)
- **Additive only.** The tool imports; it never deletes or wipes anything. (Chris's one-time
  test-data wipe, §6, is a *separate*, guarded, one-off operation — NOT part of this feature.)
- **Mix-and-match, import-what-you-need.** User selects which rows/columns come across.
- **Match-to-existing** (this build): link CSV rows to records already in the tenant (call_log /
  customers). *Leave room for* a future **create-from-CSV** mode for brand-new empty tenants.
- **Swappable source:** a future generic **column-mapping** step ("your column → our field"). For
  YESv2 the columns are known, so hardcode that mapping now; generalize later.

**This build (YESv2 → HDSP) uses the feature in match-to-existing mode**, fed by the fresh YESv2
CSV export (§6.1) — exactly how a customer would use it.

**Layout:**
- **Left — imported rows** (uploaded YESv2 CSV): old JobID, job number, job name, dates, amount, status.
- **Right — master records** (tenant's `call_log`, 378 for HDSP): `display_job_number`, `job_name`, `customer_name`.
- **Match:** drag left onto right → one link `old_row → call_log.id`. A given `call_log.id` may be
  targeted only once — the tool **hard-blocks** a duplicate target (Apply disabled while any
  duplicate exists, N4), so two old rows can't collide onto one CO.

**Smart assist (suggestions only, never auto-applied):** rank right-side candidates by base-number
prefix, then customer-name similarity, then job-name tokens; color-code by confidence. Human
confirms each.

**Row states:** Matched (`call_log.id`) · Internal (no customer; import unlinked w/ note) ·
Unmatched. **Apply is blocked until zero Unmatched.**

**Draft persistence:** save the draft mapping (survives refresh) in a `migration_match_draft` table
keyed to this migration. Nothing in the draft touches live schedule tables until Apply.

---

## 5. What comes across, where it lands, and the transforms (audit-hardened)

Old sheet tabs → live schedule tables. Everything. **Correct live column names used throughout.**

| Old sheet tab | → Target table | Notes |
|---|---|---|
| Jobs | `jobs` | Set `call_log_id` from the match. Map amount/dates/crew_needed/lead/vehicle/equipment/power_source/sow/notes/billing flags/color. **Status: `Active` → `Ongoing`** (valid set: Complete / In Progress / Ongoing / Parked / Scheduled — no CHECK constraint, so a wrong value loads silently). Note `deleted`, `prevailing_wage`, `partial_billing` are **text `'Yes'/'No'`, not boolean**. |
| Assignments | `assignments` | `job_id` (**remapped**, see below) + `crew_name` (text) + `date`. |
| BillingLog | `billing_log` | `job_id` (**remapped**) + date + percent + cumulative_percent + type + notes + invoiced + invoiced_date. |
| CrewStatus | `crew_status` | crew_name + date + status. **UNIQUE(crew_name, date)** → collapse duplicates last-wins before load. |
| (derived) Crew | `crew` | Distinct crew names from Assignments + CrewStatus. **Must load FIRST** — `assignments.crew_name` and `crew_status.crew_name` FK → `crew.name`. |
| Materials | — | **Dropped from scope (Chris, 2026-09-03).** Sheet's ~20 rows are stale; the app has its own materials model. Not imported. (Aside: audit A4 said the `materials` table doesn't exist, but CLAUDE.md + the live `/materials` view read one — a discrepancy left unresolved because materials is now out of scope and moot.) |
| WorkTypes | — | Skip. Sales owns `work_types`. |
| Deleted | — | Empty. Skip. |

**Match-key columns (right side):** `call_log.job_number` (int) + `call_log.co_number` +
`call_log.display_job_number` (text). **There is no `call_log.job_num`.**

**Critical transforms the loader MUST do:**

- **A2 — old-JobID → new job_id remap.** `jobs.job_id` is serial (max 106) and old sheet JobIDs
  (1,2,3…) overlap real rows. Insert `jobs` first, capture each generated `job_id`, build an
  `oldJobID → newJobId` map, and **repoint every child row keyed by `job_id`** — assignments and
  billing_log — through the map. (crew_status is keyed by `crew_name`, not `job_id`, so it needs no
  remap.) Never copy old JobID verbatim into children (that was `migrate.mjs`'s bug).
- **A3 — tenant stamp.** Every target table is `tenant_id uuid NOT NULL DEFAULT
  get_user_tenant_id()`; that function returns NULL in a script/anon context → insert fails on row
  one. **Loader runs as an authenticated HDSP-tenant user, or sets `tenant_id` explicitly.**
  Rehearsal asserts `tenant_id` non-null and correct on a sample.
- **Internal-bucket rows:** `jobs` rows with `call_log_id = NULL` + note "internal (migrated)".

---

## 6. Apply / safety flow (rewritten)

Honors "rehearse before push to shared DB." Ordered:

1. **Fresh export.** Re-export all tabs from the live "YES Schedule v2" sheet; commit to this
   branch (replacing the stale April CSVs). Re-verify headers and re-run §2 counts against the
   fresh files (**B6** — tool + counts were built on stale data).
2. **Match** everything to Matched / Internal in the tool. Apply disabled until zero Unmatched.
3. **Baseline snapshot + counts (B2, B3, N1, N2).** Timestamped dump of **every table the wipe
   touches**, with a written restore command. That is `jobs`, `crew`, `crew_status`, and **all 9
   `jobs` children + the audit log** (verified live 2026-09-03):
   - NO-ACTION children (must be deleted before `jobs`): `assignments`, `billing_log`.
   - CASCADE children (auto-clear with `jobs`, but dump them anyway for restore parity):
     `billing_worklist`, `job_assets`, `job_material_lines`, `job_material_signoff`,
     `job_mobilizations`, `job_wtcs`, `pull_tickets`.
   - No-FK, keyed-by-value: `job_changes` (137 rows) — does NOT auto-clear; handled in step 4.
   Record before-counts per table (currently: jobs 86, assignments 840, billing_log 26,
   job_material_lines 20, job_wtcs 5, job_mobilizations 5, billing_worklist 3, job_changes 137;
   job_assets / job_material_signoff / pull_tickets empty).
4. **Wipe schedule test data — rows only, never structure (N1).** This is `DELETE FROM`, **never
   `DROP TABLE`**. The SOW / material-flow feature we built (tables, FKs, wiring) stays fully
   intact; only test rows are cleared. Order inside the load transaction (step 5):
   delete `assignments`, `billing_log` (NO-ACTION → before `jobs`) and the 7 CASCADE children
   explicitly, then `job_changes` (no FK — must be deleted by hand or it survives and mis-attaches
   to reloaded jobs, **N2**), then `jobs`. Then `crew_status` → `crew`.
   Safe *because* all current schedule data is test (§3.10, Chris-confirmed) and step 3 backs up
   every touched table.
5. **Wipe + load in ONE transaction, with a hard empty-gate (N3).** Do not split wipe and load.
   After the deletes, **assert `count(*) = 0` on `jobs` and all children before inserting**; abort
   (rollback) otherwise — so a partial/failed wipe can never leave the load stacked on top of the
   86 test jobs. Tag inserted rows with a migration-id for idempotent re-run (**B4**).
6. **Guard index before load, not after (N4, A6).** Create the partial unique index
   `jobs (call_log_id) WHERE call_log_id IS NOT NULL AND deleted <> 'Yes'` **inside the transaction,
   before the job inserts**, so a duplicate `call_log_id` fails *inside* the load (clean rollback)
   rather than after it (stuck half-migrated). Belt-and-suspenders with the tool's hard block on
   duplicate match-targets (§4).
7. **Rehearse the whole thing on a prod-shaped copy first.** Run steps 4–6 against a throwaway
   copy; assert: crew loaded before its FKs (**B1**); every child `job_id` exists in the remap
   (**A2**); `tenant_id` non-null + correct (**A3**); status values valid (**A5**); empty-gate
   fires correctly; counts reconcile. Only then run against prod.
8. **Verify** (§7). Then **retire the old app** — only after verification passes.

---

## 7. Verification

- **Counts:** after-load == fresh-export counts. Clean slate, so this is a straight equality (the
  §6.5 empty-gate already proved the tables were 0 before load — B3 is a wipe-verification here, not
  a live-data safeguard). Internal count == tool's internal bucket.
- **No unintended orphans:** every non-internal migrated job has a `call_log_id`.
- **Spot-check ~10 jobs** across customers incl. a multi-CO (6507) and a name-variant (Kalb):
  correct master record + customer.
- **Billing sanity:** billed-to-date / cumulative percent for a few known jobs matches the sheet.
- **Text-column gotcha (C2):** verify queries must use `deleted = 'No'` (text), not `= false`.
- **In-app smoke:** open Schedule Command; migrated jobs render with crew + dates.

---

## 8. Open questions

**Resolved this round:**
- Orphan reframe → §3.10 clean-slate reload. Dedupe-vs-existing (old Q3/A6) dissolves; forward
  guard index instead.
- Tenant, ID remap, status map, load order, column names → folded into §5/§6.

**Resolved this round (round 2 prep):**
- **O1 — Materials → DROPPED from scope (Chris, 2026-09-03).** Not imported. §5, §11/A4 updated.

**Resolved this round (round 2 → onboarding-tool decision, Chris):**
- **O3 — Tool home →** permanent **Customer Onboarding / Import feature** in Schedule Command (not a
  throwaway). CSV-in, additive-only, match-to-existing now (create-from-CSV + generic column-mapping
  later). One-time wipe stays separate. See §4.

**Remaining (build-start):**
- **O2 — Rehearse mechanism:** branch DB vs local Postgres restore vs scratch schema on the shared
  project. Confirm what's realistic.
- **O4 — Draft storage shape (R3-2):** `migration_match_draft` (or per-tenant `import_session`) —
  must be created with `tenant_id uuid NOT NULL DEFAULT get_user_tenant_id()` + the 4 standard
  tenant policies, and **must NOT get a blanket catch-all policy** (the R3-1 anti-pattern). It holds
  cross-customer match mappings, so it needs real isolation. Confirm exact columns at build.

---

## 9. Suggested build sequence

1. Fresh export → commit CSVs (replace stale) + re-run counts.
2. Read models: left (old jobs) + right (`call_log` + customer) into the tool.
3. CSV upload + **header/shape validation (R3-4)**; matching UI: panes, drag-to-match,
   internal/unmatched states, **hard-block duplicate targets**, draft.
4. Smart assist: candidate ranking + confidence coloring.
5. Apply engine as **dry-run first**: transform + remap + tenant stamp + load into a copy; reconcile.
6. Backup **all 9 children + audit log** → single-transaction wipe (rows only) → **empty-gate** →
   guard index **before** inserts. **(R3-3) The wipe is a standalone one-off script/migration OUTSIDE
   the onboarding feature's code path — the shipped feature contains NO `DELETE FROM jobs` path.**
7. Rehearse on copy → fix → **Apply to prod** (one transaction, migration-id).
8. Verify (§7) → hand off "retire old app."

---

## 10. Handoff notes

- Repo: **sch-command**. Shared DB `pbgvgjjuhnpsumnowuym`.
- Schema reference: `command-suite-db/supabase/baseline/prod_public_schema.sql` (`jobs` ~910,
  `call_log` ~2529, `customers` ~2718). **Re-verify against live DB before executing** — schema docs
  drift (round 1 flagged a `materials` mismatch; moot now that materials is out of scope).
- **`jobs` has 9 FK children (live-verified 2026-09-03)** — 2 NO-ACTION (`assignments`,
  `billing_log`), 7 CASCADE (`billing_worklist`, `job_assets`, `job_material_lines`,
  `job_material_signoff`, `job_mobilizations`, `job_wtcs`, `pull_tickets`) — plus `job_changes`
  (no FK, keyed by value). Any wipe must account for all of them (§6).
- Prior importer `sch-command/migrate.mjs`: **do not reuse.** Stale Desktop path, destructive
  blind clears, copies old JobID into children (the A2 bug), loads `call_log_id = NULL`. Column-map
  reference only.
- Stale root CSVs are the old April export — replace with a fresh export before loading.

---

## 11. Audit round 1 — disposition

| # | Finding | Disposition |
|---|---|---|
| A1 | 62 orphans are live (test) data, not junk — 742 assignments | **Accept** — §3.10 (backup before wipe), §6.3 |
| A2 | No old-JobID → new job_id remap | **Accept** — §5 remap |
| A3 | tenant_id insert fails under script context | **Accept** — §5 tenant note |
| A4 | `materials` table doesn't exist | **Resolved** — materials dropped from scope (Chris); existence dispute moot. §5 |
| A5 | status "Active" invalid, loads silently | **Accept** — §5 (Active→Ongoing) |
| A6 | dedupe not deferrable; dups already exist | **Accept (reframed)** — clean slate wipes dups; guard index §6.6 |
| B1 | crew load-order FK dependency | **Accept** — §5, §6.5 |
| B2 | no prod snapshot/rollback | **Accept** — §6.3 |
| B3 | no pre-load baseline count | **Accept** — §6.3 / §7 |
| B4 | transaction boundary/idempotency | **Accept** — §6.6 |
| B5 | crew_status UNIQUE(crew_name,date) | **Accept** — §5 (last-wins collapse) |
| B6 | tool built on stale CSVs | **Accept** — §6.1 |
| C1 | column names job_number/display_job_number/co_number | **Accept** — §5 |
| C2 | deleted/prevailing_wage/partial_billing are text | **Accept** — §5, §7 |
| C3 | "6507 = ~15" is actually 12 | **Accept** — §2 |

## 12. Audit round 2 — disposition

Round 1: 13/15 closed, 0 regressions. Round 2 found the clean-slate reframe's blind spot — the
wipe assumed "all test" but only listed 3 of the tables that hang off `jobs`. All new findings
verified live 2026-09-03 and accepted; the "test vs real" design call was resolved by Chris (all
React-app data is test; real use begins *after* this load). Key boundary Chris drew: wipe **rows,
not structure** — the SOW/material-flow feature we built is preserved.

| # | Finding | Disposition |
|---|---|---|
| N1 | Wipe destroys 7 CASCADE children (33 rows: material_lines/wtcs/mobilizations/worklist) not on backup/wipe list | **Accept** — §6.3 backs up all 9 children; §6.4 wipes all; rows-only (DELETE not DROP), §3.10 |
| N2 | `job_changes` (137 rows, no FK) survives wipe → mis-attaches to reloaded ids | **Accept** — §6.3 backup + §6.4 explicit delete |
| N3 | No hard "empty after wipe" gate between wipe and load | **Accept** — §6.5 single transaction + count=0 gate, else rollback |
| N4 | Guard index created after load; dup-target only warned | **Accept** — §6.6 index before inserts; §4 tool hard-blocks dup targets |
| N5 | Corrupted A2 child-list sentence + stale materials ref | **Accept** — §5 rewritten |
| B3 (weak) | §11 over-claimed baseline count as safeguard | **Accept** — §7 reworded (wipe-verification, not live safeguard) |

**Adjacent / backlog (not this import):**
- `/materials` view (532 lines) reads a `materials` table whose live existence is disputed —
  pre-existing app concern, filed for separate follow-up.

## 13. Audit round 3 — disposition (CONVERGED)

Round 2: **6/6 CLOSED, 0 regressions**; all live counts reproduce. Trend R1→R2→R3: **4C/6H → 1C/2H
→ 0C/0H.** N1–N5 + B3 all verified closed in the body. **Build-ready for the one-time HDSP import.**
The 5 new findings are productization-hardening from the onboarding reframe — all gated *before
customer #2*, none block this load. (742 vs 840 confirmed a non-contradiction: 742 = orphan-carried
subset, 840 = table total; wipe clears the whole table.)

| # | Finding | Disposition |
|---|---|---|
| R3-1 | Tenant isolation NOT RLS-enforced (blanket `authenticated` policy overrides tenant policy on 5 tables) | **Accept (doc'd now, fix gated pre-tenant-2)** — §4 warning callout; command-suite-db RLS cleanup is a hard prereq before a 2nd tenant. No victim today (1 tenant). |
| R3-2 | Draft table has no RLS spec | **Accept** — §8 O4: tenant_id + 4 standard policies, no catch-all |
| R3-3 | Wipe/feature separation prose-only | **Accept** — §9.6: wipe is a standalone one-off outside feature code; feature has no DELETE-jobs path |
| R3-4 | No CSV input validation for permanent feature | **Accept** — §4 + §9.3 header/shape validation |
| R3-5 | Stale header status line | **Accept** — header updated |

**Filed to command-suite-db backlog (multi-tenant prerequisite, NOT this import):** drop the 5
blanket `"Authenticated users can do everything"` policies on jobs/assignments/billing_log/crew/
crew_status and enforce tenant-only isolation, per `CLAUDE_RLS.md` 6-gate deploy.

---

## 14. Amendment A-14 (2026-09-04) — sales-side backlinks on imported jobs

*Post-build design realization (Chris). Verified in code, not assumed. Appended (not rewritten into
§5/§6) because the plan is already BUILT and under gates.*

**Finding.** A normal Sales→Schedule "Send to Schedule" writes three backlink columns on the `jobs`
row that the import currently leaves null: `call_log_id` (import **does** set this — the load-bearing
one), `source_call_log_id`, and `source_proposal_id`
(`sales-command/src/components/ProposalDetail.jsx:741-742`). It also builds `job_wtcs`
(per-work-type dated SOW, from `proposal_wtc`) and `job_mobilizations`. The import writes none of
these beyond `call_log_id`.

**Impact ranking (code-evidenced):**
- **`source_proposal_id` / `source_call_log_id` — the one real gap (must-fix).** Sales' "already
  sent to Schedule?" guard matches on `jobs.source_proposal_id`
  (`ProposalDetail.jsx:141,600,642,833`). Left null, Sales never sees a matched proposal as sent →
  a later "Send to Schedule" creates a **duplicate `jobs` row**. Silent cross-app integrity hole.
- **`job_wtcs` / `field_sow` — load-bearing but fail-safe.** Missing → imported job can't reach the
  "Ready" column, shows a red "✗ no SOW" badge, empty SOW modal (`queries.js:68-104`,
  `Jobs.jsx:136-137`). No crash. Irrelevant for completed history (most of the ~120); matters only
  for active/upcoming imported jobs.
- **`job_mobilizations`, `job_crew`, `proposal_number`, jobs-col `is_change_order`/`co_number` —
  cosmetic or correctly-empty.** Degrade to blank; CO status resolves via the `call_log` join.

**Decisions:**
- **A-14.1 (fold into this build):** on Apply, set `source_call_log_id = call_log_id`, and set
  `source_proposal_id` from the matched `call_log`'s approved proposal **when exactly one exists**;
  if a matched `call_log` has zero or multiple proposals, leave null and flag the row for review
  (don't guess). Closes the duplicate-on-resend hole. Small, additive.
- **A-14.2 (future work, NOT this build):** a targeted per-job **"Pull scope from Sales"** action
  that re-runs the send-to-schedule logic (build `job_wtcs` + `job_mobilizations` + `field_sow` from
  the matched proposal) for the handful of **active** imported jobs that need a live SOW. Deliberately
  not a bulk backfill — most imported jobs are dead history with no structured scope to rebuild.

**Open question for A-14.1:** confirm how many matched call_logs map to exactly one vs multiple
proposals (drives how often the "flag for review" branch fires). Resolve with a read-only count
before build picks this up.

### A-14.1 — BUILT (2026-09-04)

Additive only — nothing already built was changed (matcher, transforms, wipe/load §6 untouched).

**Qualifying-proposal rule (read from code, not assumed):** Sales stamps `source_proposal_id = p.id`
for the proposal it sends, and its "already sent?" guard keys on `status === 'Sold'`
(`ProposalDetail.jsx:141,741`). So the qualifying proposal = **status `Sold`, non-archive**
(`is_archive_proposal = false` — archive rows are historical snapshots, never the sent one). Matches
Sales' guard, so imported jobs read as already-sent and can't be duplicated on a later send.

**Pre-check (read-only, all 379 call_logs — proxy before the real draft exists):** qualifying =
Sold+non-archive → **130 have exactly one** (backlinked), **11 multiple**, **238 zero**. (Sold incl.
archive would be 173/15/191.) "Zero" is expected for dead history with no sold proposal — left null
(no regression), flagged for review. The matched subset (~120) skews toward the one-proposal case.

**Built:**
- Feature path — `src/lib/importData.js`: `loadQualifyingProposals()` batches the Sold+non-archive
  proposals for the matched call_logs; Apply sets `source_call_log_id = call_log_id` and
  `source_proposal_id` only when exactly one qualifies (else null + a `review` entry). `Import.jsx`
  shows the backlinked count + the review list in the Apply result.
- One-time path — `scripts/generate_hdsp_migration_sql.mjs`: emitted `jobs` INSERT sets
  `source_call_log_id = r.call_log_id` and `source_proposal_id` via a scalar subselect using
  `HAVING count(*) = 1` (returns the id for exactly-one, NULL for zero/multiple — no guess). Trailing
  sanity report adds `backlinked_to_proposal` + `matched_needs_proposal_review` counts.
- Column assembly stayed out of the pure engine (`yesv2Import.js`) — the match-derived columns are
  set where the match is known (Apply / emitted INSERT), keeping the transform match-agnostic.

Verified: engine checks pass, lint clean, `npm run build` green, generator emits well-formed SQL.
**A-14.2 (per-job "Pull scope from Sales") deliberately NOT built.**
