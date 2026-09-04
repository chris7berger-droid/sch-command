# Schedule Data Migration — App Script Sheet → Schedule Command

**Branch:** `feat/schedule-data-migration` (sch-command)
**Status:** Plan — ready for a build session. Not started.
**Author of plan:** ideate + plan pass, 2026-09-03.

---

## 1. Plain-English summary (what we're doing and why)

The old Schedule tool was a Google App Script sitting on a spreadsheet ("YES Schedule v2").
It's been live and in daily use. We've now consolidated all apps onto one shared database, and
Schedule Command is the replacement. **This is a one-time copy of the old sheet's data into the
live Schedule Command, after which the old app shuts off.**

The catch: the old sheet's jobs don't line up cleanly with the master job records on the sales
side (different job-number formats, repeated numbers across change orders, customer-name variants).
A script would guess wrong constantly. So the heart of this work is a **one-time matching tool** —
old jobs on the left, real master records on the right, human confirms each link — then a single
clean load into the live schedule.

**Old app shuts off only after this load is verified.** No parallel run.

---

## 2. Verified current state (checked against the live DB, 2026-09-03)

Shared Supabase project: `pbgvgjjuhnpsumnowuym`.

| Fact | Value | Source |
|---|---|---|
| Master job records (`call_log`) | 378 (372 active, 6 archived) | live query |
| Customers (`customers`) | 2,098 | live query |
| Schedule jobs (`jobs`) already present | 86 | live query |
| — of those, **orphaned** (`call_log_id IS NULL`) | **62** | live query |
| — correctly linked (distinct `call_log_id`) | 19–24 | live query |
| Checked-in CSVs at sch-command root | **STALE** — 50 jobs, stops ~April | `YES Schedule v2 - Jobs.csv` |
| Live sheet ("YES Schedule v2", edited today) | ~120+ jobs, runs to job #10069+ | Google Drive |

**Match reliability (why automation fails):** of 38 distinct old job numbers tested, exact
number match hit 16; loose text match hit only 17. Concrete reasons, confirmed in `call_log`:

- **Numbers repeat.** "6507" is ~15 records under Contract Flooring (6507, 6507 CO1…CO7,
  6507WTC6, …). A number alone can't pick which one an old "6507CO2" row means.
- **Customer names vary.** Old sheet "Kalb" → sales side "KalB Construction", "KalB Industries
  of Nevada", "KalB Industries". Human judgment required.
- **Job names share no text.** Old "Kalb" vs sales "Kalb - Officers Memorial - Weatherproofing".
  Nothing for a script to anchor on.

**Premise (Chris, confirmed):** everything in the old Schedule sheet *does* have a master record
in Sales — the failures above are format/spelling mismatches, not missing records. The only true
exceptions are non-customer internal rows (see §4, internal bucket).

---

## 3. Locked scope decisions (from ideation)

1. **One-time copy**, old app retired after. No parallel run, no back-sync.
2. **Everything comes across** — full history, including finished/billed jobs.
3. **Clean, not flat** — every job wired to its real master record + customer, not left as text.
4. **Human matching via a purpose-built tool** — not a matching script.
5. **Smart-assisted** — tool floats best-guess candidates to the top; human confirms every one;
   nothing links itself.
6. **Change-order level** — each old row links to one exact `call_log` record (incl. the right CO).
7. **Internal bucket** — non-customer rows ("1111 Crew Work in shop", "6507 ORIENTATION",
   "Punch List") get parked as internal, unlinked, not forced onto a customer.
8. **Draft, then apply once** — matches accrue as a draft; nothing hits the live schedule until
   Apply; rehearse on a prod-shaped copy first.
9. **Crew needs no matcher** — schedule stores crew as plain text names; old crew assignments
   copy across as-is.

---

## 4. The matching tool

**What it is:** a one-time, internal, dev-only tool. Proposed home: a temporary route in
sch-command (reuses the existing Supabase client + auth), removed after cutover. Alternative: a
standalone Vite page. Decide at build start (see open questions).

**Layout:**
- **Left pane — old jobs** (from a fresh export of the live sheet; see §6). One row per old job:
  old job number, job name, dates, amount, status. Shows a badge once matched.
- **Right pane — master records** (`call_log`, 378 rows): display job number, job name, customer
  name. Searchable/filterable.
- **Match action:** drag a left row onto a right row (or select + confirm). Produces one link:
  `old_row → call_log_id`.

**Smart assist (suggestions only, never auto-applied):**
- For the selected old job, rank right-side candidates by: base-number prefix match, then
  customer-name similarity, then job-name tokens.
- Color-code by confidence (e.g. green = strong number+customer agreement, yellow = weak, none =
  no signal). Human still clicks to confirm.

**Buckets / states per old row:**
- **Matched** → holds a `call_log_id`.
- **Internal** → explicitly "no customer match; keep as internal." Imports unlinked with a note.
- **Unmatched** → not yet decided. Apply is blocked until every row is Matched or Internal.

**Draft persistence:** the draft mapping is saved (survives refresh) so matching can happen over
multiple sittings. Store as a dedicated table or a JSON draft keyed to this migration — decide at
build start. Nothing in the draft touches live schedule tables.

---

## 5. What comes across, and where it lands

Old sheet tabs → live schedule tables (all owned by the schedule side unless noted). Everything.

| Old sheet tab | → Target table | Key notes |
|---|---|---|
| Jobs | `jobs` | Set `call_log_id` from the match. Map amount/dates/status/crew_needed/lead/vehicle/equipment/power_source/sow/notes/billing flags/color. Status "Active" → the schedule's live status value. |
| Assignments | `assignments` | `job_id` (schedule) + `crew_name` (text, as-is) + `date`. ~519 rows in stale export; more live. |
| BillingLog | `billing_log` | job_id + date + percent + cumulative_percent + type + notes + invoiced + invoiced_date. |
| CrewStatus | `crew_status` | crew_name + date + status. |
| (derived) Crew | `crew` | Distinct crew names from Assignments + CrewStatus. No dedicated tab. |
| Materials | `materials` (legacy) | Old flat tracker. **Not** the new `job_material_lines` BOM. Import as legacy history only. |
| WorkTypes | — | **Skip.** Sales owns `work_types`. |
| Deleted | — | Empty in export. Skip. |

**Internal-bucket rows:** create `jobs` rows with `call_log_id = NULL` + a marker/note = "internal
(migrated)". Their assignments/billing still attach by the schedule `job_id`.

**Crew:** stays text (`crew_name`). The UUID `job_crew` table is a later concern, out of scope here.

---

## 6. Apply / safety flow

Ordered, and built to honor the "rehearse before push to shared DB" discipline.

1. **Fresh export.** Re-export all tabs from the live "YES Schedule v2" sheet (the checked-in CSVs
   are stale). This is the real source of truth for the load.
2. **Match** everything to Matched / Internal in the tool. Apply stays disabled until zero
   Unmatched.
3. **Clear the old mess.** Remove the 62 orphaned `jobs` rows (and any children) from the earlier
   half-finished import, so we load once onto a clean base. Confirm none are real/in-use first.
4. **Dedupe against the 19–24 already-linked jobs.** For a `call_log_id` that already has a live
   `jobs` row, Apply must **skip or refresh** rather than duplicate — decide the rule (open Q).
5. **Rehearse on a prod-shaped copy.** Run the full Apply against a throwaway copy of the DB;
   confirm counts and spot-check before touching prod. (Mirror of `command-suite-db` rehearse
   discipline.)
6. **Apply once** to the live schedule.
7. **Verify** (§7).
8. **Retire the old app** only after verification passes.

---

## 7. Verification (how we know the load is right)

- **Counts reconcile:** jobs / assignments / billing rows loaded == fresh-export counts (minus
  internal-bucket expectations).
- **Zero unintended orphans:** every migrated non-internal job has a `call_log_id`; internal count
  matches the tool's internal bucket exactly.
- **Spot-check by hand:** pick ~10 jobs across customers (incl. a multi-CO one like 6507 and a
  name-variant one like Kalb) and confirm each links to the correct master record + customer.
- **Billing sanity:** billed-to-date / cumulative percent for a few known jobs matches the sheet.
- **In-app smoke:** open Schedule Command, confirm the migrated jobs render on the schedule with
  crew and dates as expected.

---

## 8. Open questions (resolve at build start — not blockers to planning)

1. **Tool home:** temporary route inside sch-command vs standalone Vite page. (Lean: temp route —
   reuses Supabase client/auth.)
2. **Draft storage:** dedicated `migration_match_draft` table vs JSON blob. (Lean: small table so
   assist/queries are easy.)
3. **Dedupe rule** for the 19–24 already-linked jobs: skip vs refresh from sheet.
4. **"Rehearse on a copy" mechanism:** branch DB, local Postgres restore, or a scratch schema.
   Confirm what's realistic for the shared project.
5. **Old sheet JobID vs new schedule job_id:** old numeric JobID (1,2,3…) must not collide with
   existing `jobs.job_id`; confirm the sequence/assignment strategy so assignments/billing keep
   pointing at the right job after load.

---

## 9. Suggested build sequence

1. **Fresh export** of the live sheet → CSVs committed to this branch (replacing stale ones).
2. **Read models**: load left (old jobs from export) and right (`call_log` + customer) into the tool.
3. **Matching UI**: panes, drag-to-match, internal + unmatched states, draft persistence.
4. **Smart assist**: candidate ranking + confidence coloring.
5. **Apply engine (dry-run first)**: transform + load into a copy; reconcile counts.
6. **Orphan cleanup + dedupe rule**.
7. **Rehearse on copy**, fix, then **Apply to prod**.
8. **Verify** (§7), then hand off the "retire old app" step.

---

## 10. Handoff notes

- Repo: **sch-command**. Shared DB project `pbgvgjjuhnpsumnowuym`.
- Schedule-side schema reference: `command-suite-db/supabase/baseline/prod_public_schema.sql`
  (`jobs` ~line 910, `call_log` ~2529, `customers` ~2718).
- Prior half-finished importer: `sch-command/migrate.mjs` — **do not reuse as-is** (stale Desktop
  path, destructive table-clears, loads jobs with `call_log_id = NULL` = the flat approach we're
  explicitly replacing). Useful only as a column-mapping reference.
- Stale CSVs at repo root are the old April export — replace with a fresh export before loading.
