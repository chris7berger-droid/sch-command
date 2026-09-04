// ─────────────────────────────────────────────────────────────────────────────
// ONE-TIME HDSP wipe + load — SQL generator (§6 / §9.6, R3-3)
// ─────────────────────────────────────────────────────────────────────────────
// STANDALONE, outside the Import feature's runtime. The shipped React feature
// contains NO `DELETE FROM jobs`; the destructive wipe lives ONLY here, and only
// ever runs as a deliberate, rehearsed operational step.
//
// This generator reuses the pure import engine (src/lib/yesv2Import.js) to
// transform the fresh YESv2 CSVs, applies the human-confirmed match mapping, and
// EMITS a single self-contained .sql file that performs the whole operation in
// ONE transaction:
//   1. BACKUP every touched table (all 9 jobs-children + job_changes + jobs +
//      crew + crew_status) into schema `migration_backup` (§6.3).
//   2. WIPE rows only (never DROP), in FK order (§6.4): NO-ACTION children
//      (assignments, billing_log) → 7 CASCADE children → job_changes (no FK) →
//      jobs → crew_status → crew.
//   3. EMPTY-GATE (§6.5/N3): assert 0 rows on jobs + all children, else RAISE
//      (rollback) — a partial/failed wipe can never leave the load stacked.
//   4. GUARD INDEX (§6.6/N4): partial-unique on jobs(call_log_id) created HERE,
//      post-wipe / pre-insert (it can't be a standing migration — current prod's
//      duplicate call_log_ids would fail it; empty tables make it safe).
//   5. LOAD: crew first (FK parent), then jobs staged with old JobID and
//      loop-inserted to capture the fresh serial job_id (A2 remap), then the
//      job_id-keyed children through the id map, then collapsed crew_status.
//   6. COMMIT.
//
// tenant_id: a raw admin/service SQL session has NO auth.uid(), so
// get_user_tenant_id() would return NULL → NOT NULL violation (§5/A3). Every
// INSERT here therefore stamps tenant_id EXPLICITLY with --tenant-id.
//
// Usage:
//   node scripts/generate_hdsp_migration_sql.mjs \
//     --dir . --draft ./hdsp_draft.json \
//     --tenant-id 246f6551-60de-4965-bb97-9a52971bc05d \
//     --stamp 20260910 --out ./hdsp_wipe_and_load.sql
//
//   --draft: JSON { "decisions": { "<oldJobID>": <call_log.id> | "internal" } }
//            exported from the Import feature's saved draft. Every Jobs row's
//            JobID MUST have a decision (matched id, or "internal") or the
//            generator refuses (mirrors the feature's "Apply blocked until zero
//            Unmatched"). Pass --sample to fill an all-internal draft for a
//            structural dry run against the checked-in sample CSVs.
//
// See scripts/HDSP_MIGRATION_RUNBOOK.md for the full operational sequence
// (fresh export → match in-app → export draft → generate → rehearse on a
// prod-shaped copy → run on prod → verify → retire the old sheet).

import { readFileSync, writeFileSync } from 'fs'
import { parse } from 'csv-parse/sync'
import {
  transformJob, transformAssignment, transformBillingLog, transformCrewStatus,
  collapseCrewStatus, deriveCrew, validateHeaders,
} from '../src/lib/yesv2Import.js'

// ── args ──
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] == null ? true : arr[i + 1]])
  return acc
}, []))
const DIR = (args.dir || '.').replace(/\/$/, '')
const TENANT = args['tenant-id']
const STAMP = args.stamp || 'REPLACE_STAMP'
const OUT = args.out || './hdsp_wipe_and_load.sql'
const SAMPLE = !!args.sample

if (!TENANT || TENANT === true) { console.error('ERROR: --tenant-id is required (HDSP = 246f6551-60de-4965-bb97-9a52971bc05d).'); process.exit(1) }
if (!/^[0-9a-f-]{36}$/i.test(TENANT)) { console.error(`ERROR: --tenant-id "${TENANT}" is not a uuid.`); process.exit(1) }

const readCsv = (f) => parse(readFileSync(`${DIR}/${f}`, 'utf-8'), { columns: true, skip_empty_lines: true, trim: false })

// ── SQL literal helpers ──
const q = (v) => {
  if (v == null) return 'NULL'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}
const T = q(TENANT)

// ── the tables the wipe touches (§6.3/§6.4) ──
const NO_ACTION_CHILDREN = ['assignments', 'billing_log']
const CASCADE_CHILDREN = ['billing_worklist', 'job_assets', 'job_material_lines', 'job_material_signoff', 'job_mobilizations', 'job_wtcs', 'pull_tickets']
const BACKUP_TABLES = ['jobs', ...NO_ACTION_CHILDREN, ...CASCADE_CHILDREN, 'job_changes', 'crew', 'crew_status']
// Wipe order: children that block a jobs delete first, then cascade children
// (explicit for backup/restore parity), then job_changes, then jobs, then crew.
const WIPE_ORDER = [...NO_ACTION_CHILDREN, ...CASCADE_CHILDREN, 'job_changes', 'jobs', 'crew_status', 'crew']
// Every table the empty-gate asserts is 0 after the wipe.
const EMPTY_GATE_TABLES = ['jobs', ...NO_ACTION_CHILDREN, ...CASCADE_CHILDREN, 'job_changes', 'crew', 'crew_status']

// ── read + transform ──
function loadTab(file, tab) {
  const rows = readCsv(file)
  const v = validateHeaders(tab, Object.keys(rows[0] || {}))
  if (!v.ok) { console.error(`ERROR: ${file} failed header validation — missing: ${v.missing.join(', ')}`); process.exit(1) }
  return rows
}

const jobsRaw = loadTab('YES Schedule v2 - Jobs.csv', 'Jobs')
const asgRaw = loadTab('YES Schedule v2 - Assignments.csv', 'Assignments')
const blRaw = loadTab('YES Schedule v2 - BillingLog.csv', 'BillingLog')
const csRaw = loadTab('YES Schedule v2 - CrewStatus.csv', 'CrewStatus')

const jobs = jobsRaw.map(transformJob).filter(j => j._oldJobId)

// ── the confirmed match decisions ──
let decisions
if (SAMPLE) {
  decisions = Object.fromEntries(jobs.map(j => [j._oldJobId, 'internal'])) // structural dry-run
} else {
  const draft = JSON.parse(readFileSync(args.draft, 'utf-8'))
  decisions = draft.decisions || draft
}
// Enforce the feature's invariant: every job must be decided (matched or internal).
const undecided = jobs.filter(j => !(j._oldJobId in decisions) || decisions[j._oldJobId] == null)
if (undecided.length) {
  console.error(`ERROR: ${undecided.length} job(s) have no confirmed match — refuse to generate (Apply-blocked-until-zero-Unmatched). First: JobID ${undecided[0]._oldJobId}.`)
  process.exit(1)
}
const callLogIdFor = (oldId) => decisions[oldId] === 'internal' ? null : decisions[oldId]

// ── build derived load sets ──
const crew = deriveCrew(asgRaw, csRaw)
const assignments = asgRaw.map(transformAssignment).filter(Boolean)
const billing = blRaw.map(transformBillingLog).filter(Boolean)
const crewStatus = collapseCrewStatus(csRaw.map(transformCrewStatus).filter(Boolean))

// ── emit SQL ──
const JOB_COLS = ['job_num', 'job_name', 'amount', 'work_type', 'crew_needed', 'lead', 'vehicle', 'equipment', 'power_source', 'sow', 'status', 'start_date', 'end_date', 'color', 'prevailing_wage', 'partial_billing', 'partial_bill_date', 'partial_percent', 'billed_to_date', 'billing_paused', 'billing_notes', 'notes', 'deferred_time', 'deferred_days', 'no_bill', 'no_bill_reason', 'deleted', 'call_log_id']

const L = []
const p = (s = '') => L.push(s)

p(`-- ═══════════════════════════════════════════════════════════════════════════`)
p(`-- HDSP one-time wipe + load — GENERATED ${SAMPLE ? '(SAMPLE / structural dry-run)' : ''}`)
p(`-- tenant_id ${TENANT} · stamp ${STAMP}`)
p(`-- Source rows: jobs ${jobs.length}, assignments ${assignments.length}, billing_log ${billing.length}, crew ${crew.length}, crew_status ${crewStatus.length}`)
p(`-- Matched ${jobs.filter(j => callLogIdFor(j._oldJobId) != null).length} · Internal ${jobs.filter(j => callLogIdFor(j._oldJobId) == null).length}`)
p(`--`)
p(`-- REHEARSE on a prod-shaped copy first (§6.7). Do NOT run against prod until`)
p(`-- rehearsal passes. Runs as ONE transaction — any failure rolls back whole.`)
p(`-- ═══════════════════════════════════════════════════════════════════════════`)
p(`\\set ON_ERROR_STOP on`)
p(`BEGIN;`)
p()
p(`-- 1) BACKUP (§6.3) — every touched table, into schema migration_backup.`)
p(`CREATE SCHEMA IF NOT EXISTS migration_backup;`)
for (const t of BACKUP_TABLES) {
  p(`CREATE TABLE migration_backup.${t}_${STAMP} AS SELECT * FROM public.${t};`)
}
p()
p(`-- 2) WIPE (§6.4) — rows only, never DROP; FK order.`)
for (const t of WIPE_ORDER) p(`DELETE FROM public.${t};`)
p()
p(`-- 3) EMPTY-GATE (§6.5 / N3) — abort (rollback) if anything survived the wipe.`)
p(`DO $$`)
p(`BEGIN`)
for (const t of EMPTY_GATE_TABLES) {
  p(`  IF (SELECT count(*) FROM public.${t}) <> 0 THEN RAISE EXCEPTION 'empty-gate failed: public.% not empty after wipe — aborting', '${t}'; END IF;`)
}
p(`END $$;`)
p()
p(`-- 4) GUARD INDEX (§6.6 / N4) — partial-unique, created before any insert.`)
p(`CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_call_log_active`)
p(`  ON public.jobs(call_log_id) WHERE call_log_id IS NOT NULL AND deleted <> 'Yes';`)
p()
p(`-- 5a) LOAD crew FIRST (FK parent of assignments.crew_name / crew_status.crew_name).`)
if (crew.length) {
  p(`INSERT INTO public.crew (name, team, phone, archived, tenant_id) VALUES`)
  p(crew.map(c => `  (${q(c.name)}, ${q(c.team)}, ${q(c.phone)}, ${q(c.archived)}, ${T})`).join(',\n') + ';')
}
p()
p(`-- 5b) STAGE jobs with their old JobID, then loop-insert to capture the fresh`)
p(`--     serial job_id into _idmap (A2 remap). ON COMMIT DROP cleans the temps.`)
p(`CREATE TEMP TABLE _stage_jobs (old_job_id text, ${JOB_COLS.map(c => `${c} ${c === 'call_log_id' ? 'bigint' : 'text'}`).join(', ')}) ON COMMIT DROP;`)
p(`CREATE TEMP TABLE _idmap (old_job_id text PRIMARY KEY, new_job_id int) ON COMMIT DROP;`)
if (jobs.length) {
  p(`INSERT INTO _stage_jobs (old_job_id, ${JOB_COLS.join(', ')}) VALUES`)
  p(jobs.map(j => {
    const vals = JOB_COLS.map(c => c === 'call_log_id' ? q(callLogIdFor(j._oldJobId)) : q(j[c]))
    return `  (${q(j._oldJobId)}, ${vals.join(', ')})`
  }).join(',\n') + ';')
}
p(`DO $$`)
p(`DECLARE r record; nid int;`)
p(`BEGIN`)
p(`  FOR r IN SELECT * FROM _stage_jobs ORDER BY old_job_id LOOP`)
p(`    INSERT INTO public.jobs (${JOB_COLS.join(', ')}, source_call_log_id, source_proposal_id, tenant_id) VALUES (`)
p(`      ${JOB_COLS.map(c => {
       // cast staged text back to the real column types
       if (c === 'call_log_id') return 'r.call_log_id'
       if (['amount', 'partial_percent', 'billed_to_date'].includes(c)) return `r.${c}::numeric`
       if (c === 'crew_needed') return 'r.crew_needed::int'
       if (['start_date', 'end_date', 'partial_bill_date'].includes(c)) return `r.${c}::date`
       return `r.${c}`
     }).join(', ')},`)
// Sales backlinks (A-14.1). source_call_log_id = the matched call_log; matches
// Sales' "Send to Schedule" (ProposalDetail.jsx:741). source_proposal_id gets the
// call_log's LIVE 'Sold' proposal ONLY when exactly one exists — HAVING count(*)=1
// returns the id for exactly-one and NO row (→ NULL) for zero or multiple, so we
// never guess. Internal rows (call_log_id NULL) get NULL on both, naturally.
p(`      r.call_log_id,`)
p(`      (SELECT max(p.id) FROM public.proposals p`)
p(`         WHERE p.call_log_id = r.call_log_id AND p.status = 'Sold'`)
p(`           AND coalesce(p.is_archive_proposal, false) = false`)
p(`         HAVING count(*) = 1),`)
p(`      ${T})`)
p(`    RETURNING job_id INTO nid;`)
p(`    INSERT INTO _idmap (old_job_id, new_job_id) VALUES (r.old_job_id, nid);`)
p(`  END LOOP;`)
p(`END $$;`)
p()
p(`-- 5c) CHILDREN keyed by job_id — remapped through _idmap (A2).`)
if (assignments.length) {
  p(`INSERT INTO public.assignments (job_id, crew_name, date, tenant_id)`)
  p(`SELECT m.new_job_id, v.crew_name, v.date::date, ${T} FROM ( VALUES`)
  p(assignments.map(a => `  (${q(a._oldJobId)}, ${q(a.crew_name)}, ${q(a.date)})`).join(',\n'))
  p(`) AS v(old_job_id, crew_name, date) JOIN _idmap m ON m.old_job_id = v.old_job_id;`)
}
p()
if (billing.length) {
  p(`INSERT INTO public.billing_log (job_id, date, percent, cumulative_percent, type, notes, invoiced, invoiced_date, tenant_id)`)
  p(`SELECT m.new_job_id, v.date::date, v.percent::numeric, v.cumulative_percent::numeric, v.type, v.notes, v.invoiced::boolean, v.invoiced_date::date, ${T} FROM ( VALUES`)
  p(billing.map(b => `  (${q(b._oldJobId)}, ${q(b.date)}, ${q(b.percent)}, ${q(b.cumulative_percent)}, ${q(b.type)}, ${q(b.notes)}, ${q(b.invoiced)}, ${q(b.invoiced_date)})`).join(',\n'))
  p(`) AS v(old_job_id, date, percent, cumulative_percent, type, notes, invoiced, invoiced_date) JOIN _idmap m ON m.old_job_id = v.old_job_id;`)
}
p()
p(`-- 5d) crew_status — collapsed last-wins, keyed by crew_name (no remap).`)
if (crewStatus.length) {
  p(`INSERT INTO public.crew_status (crew_name, date, status, tenant_id) VALUES`)
  p(crewStatus.map(c => `  (${q(c.crew_name)}, ${q(c.date)}, ${q(c.status)}, ${T})`).join(',\n') + ';')
}
p()
p(`-- 6) sanity counts (informational — appear in psql output before COMMIT).`)
p(`SELECT 'jobs' AS t, count(*) FROM public.jobs`)
p(`UNION ALL SELECT 'assignments', count(*) FROM public.assignments`)
p(`UNION ALL SELECT 'billing_log', count(*) FROM public.billing_log`)
p(`UNION ALL SELECT 'crew', count(*) FROM public.crew`)
p(`UNION ALL SELECT 'crew_status', count(*) FROM public.crew_status`)
p(`UNION ALL SELECT 'backlinked_to_proposal', count(*) FROM public.jobs WHERE source_proposal_id IS NOT NULL`)
p(`UNION ALL SELECT 'matched_needs_proposal_review', count(*) FROM public.jobs WHERE call_log_id IS NOT NULL AND source_proposal_id IS NULL;`)
p()
p(`COMMIT;`)
p()

writeFileSync(OUT, L.join('\n'))
console.log(`Wrote ${OUT}`)
console.log(`  jobs ${jobs.length} (matched ${jobs.filter(j => callLogIdFor(j._oldJobId) != null).length} / internal ${jobs.filter(j => callLogIdFor(j._oldJobId) == null).length}), assignments ${assignments.length}, billing_log ${billing.length}, crew ${crew.length}, crew_status ${crewStatus.length}`)
if (SAMPLE) console.log('  (SAMPLE mode: all-internal draft, stale sample CSVs — structural check only, NOT a real load)')
