// ─────────────────────────────────────────────────────────────────────────────
// Import feature — DB-facing data layer (right-pane load, draft persistence,
// ADDITIVE Apply). Pairs with the pure engine in yesv2Import.js.
// ─────────────────────────────────────────────────────────────────────────────
// Plan: docs/plans/schedule_data_migration.md §4/§5/§6.
//
// R3-3 boundary: the SHIPPED FEATURE contains NO `DELETE FROM jobs` path. Apply
// here is ADDITIVE only — it inserts matched rows. The one-time HDSP test-data
// wipe is a SEPARATE standalone script (scripts/), never wired to this feature.
//
// Tenant: every target table stamps tenant_id via its get_user_tenant_id()
// DEFAULT, so an authed HDSP user's inserts self-tenant. We never send tenant_id.
// call_log / customers (the right pane) are correctly tenant-scoped by RLS
// (§4). Note the §4 warning: the 5 schedule tables are NOT RLS-isolated today
// (blanket authenticated policy) — real isolation is a command-suite-db prereq
// gated before a 2nd tenant. We do not claim isolation the DB doesn't enforce.

import { supabase } from './supabase'
import { loadAllRows } from './queries'
import {
  transformJob, transformAssignment, transformBillingLog,
  transformCrewStatus, collapseCrewStatus, deriveCrew,
} from './yesv2Import.js'

// Stable key for the draft row (one match-session per tenant per source).
export const HDSP_MIGRATION_KEY = 'yesv2_hdsp'

// ── Right pane: the tenant's real master records (call_log) ──────────────────
// The match targets. §5 match keys: job_number (int) + co_number +
// display_job_number (text). customer_name comes off call_log directly.
// Paginated per CLAUDE.md even though HDSP is ~379 rows (well under the cap).
export async function loadRightPane() {
  const { data, error } = await loadAllRows(
    'call_log',
    'id, job_number, co_number, display_job_number, job_name, customer_name, customer_id, is_change_order, stage',
    { orderBy: 'id' }
  )
  if (error) return { data: [], error }
  return { data: data || [], error: null }
}

// ── Sales backlink: the qualifying proposal per matched call_log (A-14.1) ─────
// A normal Sales "Send to Schedule" stamps jobs.source_proposal_id with the
// proposal it sent — a LIVE (non-archive) proposal in status 'Sold'
// (ProposalDetail.jsx:141/741). The import must match that definition so Sales'
// "already sent?" guard (jobs.source_proposal_id) sees an imported job as sent
// and does NOT create a duplicate on a later send.
//
// Returns a Map call_log_id → array of qualifying proposal ids. The caller
// stamps source_proposal_id ONLY when exactly one exists; zero or multiple →
// null + flagged for review (don't guess which proposal).
export async function loadQualifyingProposals(callLogIds) {
  const ids = [...new Set((callLogIds || []).filter(v => v != null))]
  const byCallLog = new Map()
  if (!ids.length) return byCallLog
  const { data, error } = await supabase
    .from('proposals')
    .select('id, call_log_id, status, is_archive_proposal')
    .in('call_log_id', ids)
    .eq('status', 'Sold')
  if (error) return byCallLog // best-effort: no backlink rather than a bad guess
  for (const p of data || []) {
    if (p.is_archive_proposal) continue // archive snapshots are never the sent one
    const arr = byCallLog.get(p.call_log_id) || []
    arr.push(p.id)
    byCallLog.set(p.call_log_id, arr)
  }
  return byCallLog
}

// ── Draft persistence (survives refresh) ─────────────────────────────────────
// One row per (tenant_id, migration_key) in migration_match_draft, holding the
// whole match state as jsonb. tenant_id is filled by the table DEFAULT and the
// upsert conflict-targets (tenant_id, migration_key) — the unique constraint the
// command-suite-db migration creates. Nothing here touches live schedule tables.

export async function loadDraft(migrationKey = HDSP_MIGRATION_KEY) {
  const { data, error } = await supabase
    .from('migration_match_draft')
    .select('state, updated_at')
    .eq('migration_key', migrationKey)
    .maybeSingle()
  if (error) return { data: null, error }
  return { data: data?.state ?? null, updatedAt: data?.updated_at ?? null, error: null }
}

export async function saveDraft(state, migrationKey = HDSP_MIGRATION_KEY) {
  const { error } = await supabase
    .from('migration_match_draft')
    .upsert(
      { migration_key: migrationKey, state },
      { onConflict: 'tenant_id,migration_key' }
    )
  return { error: error || null }
}

// ── ADDITIVE Apply ───────────────────────────────────────────────────────────
// Loads matched YESv2 rows into the schedule tables. NO delete anywhere.
//
// `mapping` maps each YESv2 old JobID → the confirmed call_log.id (or null for an
// Internal-bucket row). Only jobs whose old id is present in `mapping` are loaded
// (the UI blocks Apply until zero Unmatched, so that's every non-excluded job).
//
// Order (§5/§6.5): crew FIRST (FK parent of assignments.crew_name /
// crew_status.crew_name), then jobs (capture generated job_id → build the
// old→new remap, A2), then the job_id-keyed children through the remap, then
// crew_status (collapsed, keyed by crew_name — no remap).
//
// Returns { ok, counts, error }. Best-effort sequential; on first error it stops
// and returns what was written so the caller can surface it. This is additive —
// re-running would duplicate, so the UI runs it once per confirmed draft. (The
// atomic, idempotent, wipe-inclusive path is the standalone HDSP script, not this.)
export async function applyImport({ jobsRaw, assignmentsRaw, billingLogRaw, crewStatusRaw }, mapping) {
  const counts = { crew: 0, jobs: 0, assignments: 0, billing_log: 0, crew_status: 0, skipped: 0, backlinked: 0 }
  // Rows matched to a call_log that got NO source_proposal_id (zero or multiple
  // qualifying proposals) — surfaced so the user can review, not guessed (A-14.1).
  const review = []

  // 1) crew first (FK parent). Upsert ignore-duplicates so names already in the
  //    tenant's crew list don't error and aren't clobbered.
  const crew = deriveCrew(assignmentsRaw, crewStatusRaw)
  if (crew.length) {
    const { error } = await supabase.from('crew').upsert(crew, { onConflict: 'name', ignoreDuplicates: true })
    if (error) return { ok: false, counts, error: `crew: ${error.message}` }
    counts.crew = crew.length
  }

  // 2) jobs — insert only mapped rows; capture generated job_id in send order.
  //    PostgREST returns inserted rows in the order sent, so we zip old→new by
  //    index and guard on length. Strip engine-private fields before insert.
  const jobsToLoad = (jobsRaw || [])
    .map(transformJob)
    .filter(j => Object.prototype.hasOwnProperty.call(mapping, j._oldJobId))

  // Sales backlinks (A-14.1): resolve each matched call_log's qualifying proposal
  // up front, one batched query. source_call_log_id = the matched call_log.id;
  // source_proposal_id only when exactly one qualifying proposal exists.
  const matchedCallLogIds = jobsToLoad.map(j => mapping[j._oldJobId]).filter(v => v != null)
  const propsByCallLog = await loadQualifyingProposals(matchedCallLogIds)

  const oldToNew = new Map()
  const JOB_CHUNK = 200
  for (let i = 0; i < jobsToLoad.length; i += JOB_CHUNK) {
    const slice = jobsToLoad.slice(i, i + JOB_CHUNK)
    const payload = slice.map(j => {
      const row = { ...j }
      delete row._oldJobId
      delete row._statusWarning
      const clId = mapping[j._oldJobId] ?? null // null = Internal bucket
      row.call_log_id = clId
      row.source_call_log_id = clId
      const props = clId != null ? (propsByCallLog.get(clId) || []) : []
      if (props.length === 1) {
        row.source_proposal_id = props[0]
        counts.backlinked++
      } else {
        row.source_proposal_id = null
        if (clId != null) review.push({ oldJobId: j._oldJobId, jobNum: j.job_num, callLogId: clId, reason: props.length === 0 ? 'no sold proposal' : `${props.length} sold proposals` })
      }
      return row
    })
    const { data: inserted, error } = await supabase.from('jobs').insert(payload).select('job_id')
    if (error) return { ok: false, counts, error: `jobs: ${error.message}` }
    if (!inserted || inserted.length !== slice.length) {
      return { ok: false, counts, error: `jobs: inserted ${inserted?.length ?? 0} of ${slice.length} — cannot correlate remap; aborting` }
    }
    slice.forEach((j, k) => oldToNew.set(j._oldJobId, inserted[k].job_id))
    counts.jobs += inserted.length
  }

  // 3) assignments — remap old JobID → new job_id (A2). Drop rows whose parent
  //    wasn't loaded (shouldn't happen once Apply is unblocked; guard anyway).
  const assignments = (assignmentsRaw || [])
    .map(transformAssignment)
    .filter(Boolean)
    .map(a => {
      const jid = oldToNew.get(a._oldJobId)
      if (jid == null) { counts.skipped++; return null }
      return { job_id: jid, crew_name: a.crew_name, date: a.date }
    })
    .filter(Boolean)
  if (assignments.length) {
    const { error } = await supabase.from('assignments').insert(assignments)
    if (error) return { ok: false, counts, error: `assignments: ${error.message}` }
    counts.assignments = assignments.length
  }

  // 4) billing_log — remap old JobID → new job_id (A2).
  const billing = (billingLogRaw || [])
    .map(transformBillingLog)
    .filter(Boolean)
    .map(b => {
      const jid = oldToNew.get(b._oldJobId)
      if (jid == null) { counts.skipped++; return null }
      const { _oldJobId, ...row } = b
      return { ...row, job_id: jid }
    })
    .filter(Boolean)
  if (billing.length) {
    const { error } = await supabase.from('billing_log').insert(billing)
    if (error) return { ok: false, counts, error: `billing_log: ${error.message}` }
    counts.billing_log = billing.length
  }

  // 5) crew_status — collapsed last-wins, keyed by crew_name (no remap).
  const crewStatus = collapseCrewStatus((crewStatusRaw || []).map(transformCrewStatus).filter(Boolean))
  if (crewStatus.length) {
    const { error } = await supabase.from('crew_status').insert(crewStatus)
    if (error) return { ok: false, counts, error: `crew_status: ${error.message}` }
    counts.crew_status = crewStatus.length
  }

  return { ok: true, counts, review, error: null }
}
