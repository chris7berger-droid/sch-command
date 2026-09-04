# Schedule Data Migration — App Script Sheet → Schedule Command

**Branch:** `feat/schedule-data-migration` (sch-command)
**Status:** Plan — revised after audit round 1. Ready for build. Not started.
**History:** ideate + plan 2026-09-03 → audit round 1 → this revision (2026-09-03).

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
10. **Clean-slate reload** *(resolved after audit — the orphan reframe)* — because all current
    schedule data is test, we **back up, then wipe all schedule test data and reload from the fresh
    sheet export.** We do NOT relink the existing 62 rows. The sheet is the sole source of truth.

---

## 4. The matching tool

**What it is:** a one-time, internal, dev-only tool. Proposed home: a temporary route in
sch-command (reuses the existing Supabase client + auth so it runs as an authenticated
HDSP-tenant user — see §5 tenant note), removed after cutover.

**Layout:**
- **Left — old jobs** (fresh sheet export): old JobID, job number, job name, dates, amount, status.
- **Right — master records** (`call_log`, 378): `display_job_number`, `job_name`, `customer_name`.
- **Match:** drag left onto right → one link `old_row → call_log.id`. A given `call_log.id` may be
  targeted only once (tool warns on a duplicate target, so two old rows can't collide onto one CO).

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
  `oldJobID → newJobId` map, and **repoint every child row** (assignments, billing_log, materials
  crew_status is keyed by name not id) through the map. Never copy old JobID verbatim into children
  (that was `migrate.mjs`'s bug).
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
3. **Baseline snapshot + counts (B2, B3).** Take a timestamped dump of prod `jobs`, `assignments`,
   `billing_log`, `crew_status`, `crew` **with a written restore command**. Record before-counts
   per table.
4. **Wipe schedule test data.** Inside **one transaction**, delete children → parents
   (assignments, billing_log, crew_status, then jobs). FKs are NO ACTION, so order
   matters. This is safe *because* all current schedule data is test (§3.10) — the backup in step 3
   is the guard.
5. **Rehearse on a prod-shaped copy.** Run the full Apply against a throwaway copy; assert:
   crew loaded before its FKs (**B1**); every child `job_id` exists in the remap (**A2**);
   `tenant_id` correct (**A3**); status values valid (**A5**); counts reconcile.
6. **Apply once** to live, in **one transaction** tagged with a migration-id for idempotent re-run
   (**B4** — no partial-load-then-stuck).
7. **Add forward guard (A6):** partial unique index on `jobs (call_log_id) WHERE call_log_id IS NOT
   NULL AND deleted <> 'Yes'`. (Clean slate means no existing dups to trip it.)
8. **Verify** (§7). Then **retire the old app** — only after verification passes.

---

## 7. Verification

- **Counts:** after-load == fresh-export counts (clean slate, so no before/after subtraction needed,
  but confirm the wipe emptied the tables first). Internal count == tool's internal bucket.
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

**Remaining (build-start):**
- **O2 — Rehearse mechanism:** branch DB vs local Postgres restore vs scratch schema on the shared
  project. Confirm what's realistic.
- **O3 — Tool home + draft storage:** temp route in sch-command (lean) vs standalone; confirm
  `migration_match_draft` table shape.

---

## 9. Suggested build sequence

1. Fresh export → commit CSVs (replace stale) + re-run counts.
2. Read models: left (old jobs) + right (`call_log` + customer) into the tool.
3. Matching UI: panes, drag-to-match, internal/unmatched states, duplicate-target warning, draft.
4. Smart assist: candidate ranking + confidence coloring.
5. Apply engine as **dry-run first**: transform + remap + tenant stamp + load into a copy; reconcile.
6. Backup + wipe (transaction) + forward-guard index.
7. Rehearse on copy → fix → **Apply to prod** (transaction, migration-id).
8. Verify (§7) → hand off "retire old app."

---

## 10. Handoff notes

- Repo: **sch-command**. Shared DB `pbgvgjjuhnpsumnowuym`.
- Schema reference: `command-suite-db/supabase/baseline/prod_public_schema.sql` (`jobs` ~910,
  `call_log` ~2529, `customers` ~2718). **Re-verify against live DB before executing** —
  CLAUDE.md's `materials` mention is stale (table doesn't exist).
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
| A6 | dedupe not deferrable; dups already exist | **Accept (reframed)** — clean slate wipes dups; add guard index §6.7 |
| B1 | crew load-order FK dependency | **Accept** — §5, §6.5 |
| B2 | no prod snapshot/rollback | **Accept** — §6.3 |
| B3 | no pre-load baseline count | **Accept** — §6.3 / §7 |
| B4 | transaction boundary/idempotency | **Accept** — §6.6 |
| B5 | crew_status UNIQUE(crew_name,date) | **Accept** — §5 (last-wins collapse) |
| B6 | tool built on stale CSVs | **Accept** — §6.1 |
| C1 | column names job_number/display_job_number/co_number | **Accept** — §5 |
| C2 | deleted/prevailing_wage/partial_billing are text | **Accept** — §5, §7 |
| C3 | "6507 = ~15" is actually 12 | **Accept** — §2 |
