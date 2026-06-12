import { supabase } from './supabase'
import { STATUS_OPTIONS_PICKER } from './jobStatus'

// ── Paginating loader ──────────────────────────────────────────────────────
// PostgREST caps at 1000 rows. This helper pages through with .range().
// orderBy is required — composite-PK tables must specify a stable column.
export async function loadAllRows(tableName, selectStr, {
  orderBy,
  orderAsc = true,
  filterFn,
} = {}) {
  if (!orderBy) throw new Error(`loadAllRows(${tableName}): orderBy is required`)
  const PAGE = 1000
  const all = []
  let chain = supabase.from(tableName).select(selectStr)
  if (filterFn) chain = filterFn(chain)
  chain = chain.order(orderBy, { ascending: orderAsc })

  let firstRowPK = null
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await chain.range(from, from + PAGE - 1)
    if (error) return { data: all, error, partial: true }
    if (import.meta.env.DEV && from === PAGE && data?.length > 0 && firstRowPK != null) {
      if (data[0]?.id === firstRowPK) {
        console.warn(`loadAllRows(${tableName}): chunk 2 repeated chunk 1 — .range() reuse may be broken`)
      }
    }
    if (from === 0 && data?.length > 0) firstRowPK = data[0]?.id ?? null
    all.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return { data: all, error: null, partial: false }
}

// ── Staged/Ready checklist ─────────────────────────────────────────────────
// Base checklist: SOW + date + crew + materials-decided.
// Uses blacklist for materials to match SQL job_base_checklist_passes().
export function baseChecklistPasses(job, crewRows, materialRows) {
  const hasSOW = job.field_sow != null
  const hasDate = (job.scheduled_start || job.start_date) != null
  const hasCrew = crewRows.length >= 1
  const materialsDecided = materialRows.length === 0
    || materialRows.every(m => !['Not Ordered', 'Delayed'].includes(m.status))
  return hasSOW && hasDate && hasCrew && materialsDecided
}

// Full isReady = base checklist + manual promotion gate.
// crewByCallLog / matsByJobId are pre-indexed Maps for O(1) lookup.
export function isReady(job, crewByCallLog, matsByJobId) {
  const crew = crewByCallLog[job.call_log_id] || []
  const mats = matsByJobId[job.job_id] || []
  return baseChecklistPasses(job, crew, mats) && job.ready_confirmed_at != null
}

// ── Call_log fields pulled via join ─────────────────────────────────────────
const CALL_LOG_SELECT = `
  call_log (
    id,
    job_name,
    display_job_number,
    customer_name,
    sales_name,
    stage,
    jobsite_address,
    jobsite_city,
    jobsite_state,
    jobsite_zip,
    prevailing_wage,
    customer_id,
    is_change_order,
    co_number,
    show_cents
  )
`.replace(/\s+/g, ' ').trim()

// ── Normalize a joined row into a flat shape ────────────────────────────────
// Shared fields prefer call_log when available, fall back to jobs (legacy rows)
function normalizeJob(row) {
  const cl = row.call_log || {}
  const wtcs = Array.isArray(row.job_wtcs) ? row.job_wtcs : []
  return {
    ...row,
    // shared fields — call_log is source of truth
    job_name:           cl.job_name            || row.job_name,
    job_num:            cl.display_job_number  || row.job_num,
    customer_name:      cl.customer_name       || null,
    sales_name:         cl.sales_name          || null,
    jobsite_address:    cl.jobsite_address     || null,
    jobsite_city:       cl.jobsite_city        || null,
    jobsite_state:      cl.jobsite_state       || null,
    jobsite_zip:        cl.jobsite_zip         || null,
    prevailing_wage:    cl.prevailing_wage != null
                          ? (cl.prevailing_wage ? 'Yes' : 'No')
                          : row.prevailing_wage,
    stage:              cl.stage               || null,
    customer_id:        cl.customer_id         || null,
    is_change_order:    cl.is_change_order     || false,
    co_number:          cl.co_number           || null,
    show_cents:         cl.show_cents          || false,
    // keep raw call_log for detail views
    _call_log: cl,
    // per-WTC attributes (empty for legacy rows; readers fall back to
    // jobs.field_sow / jobs.material_status when this is empty)
    _wtcs: wtcs,
  }
}

// ── Load jobs with call_log join ────────────────────────────────────────────
// Replaces: supabase.from('jobs').select('*')
//
// withWTCs: when true, also left-joins job_wtcs and attaches j._wtcs.
// Legacy rows have zero job_wtcs children — _wtcs comes back as [].
export async function loadJobs({ includeDeleted = false, withWTCs = false } = {}) {
  const sel = withWTCs
    ? `*, ${CALL_LOG_SELECT}, job_wtcs(*)`
    : `*, ${CALL_LOG_SELECT}`

  let query = supabase
    .from('jobs')
    .select(sel)

  if (!includeDeleted) {
    query = query.or('deleted.is.null,deleted.eq.No')
  }

  const { data, error } = await query
  if (error) return { data: null, error }
  return { data: (data || []).map(normalizeJob), error: null }
}

// ── Load a single job by job_id ─────────────────────────────────────────────
export async function loadJob(jobId) {
  const { data, error } = await supabase
    .from('jobs')
    .select(`*, ${CALL_LOG_SELECT}`)
    .eq('job_id', jobId)
    .single()

  if (error) return { data: null, error }
  return { data: normalizeJob(data), error: null }
}

// ── Load a single job with its job_wtcs children ────────────────────────────
export async function loadJobWithWTCs(jobId) {
  const { data, error } = await supabase
    .from('jobs')
    .select(`*, ${CALL_LOG_SELECT}, job_wtcs(*)`)
    .eq('job_id', jobId)
    .single()

  if (error) return { data: null, error }
  return { data: normalizeJob(data), error: null }
}

// ── Update a job field with audit logging ───────────────────────────────────
export async function updateJobField(jobId, field, newValue, changedBy, source = 'schedule_command') {
  // read current value
  const { data: current } = await supabase
    .from('jobs')
    .select(`${field}, call_log_id`)
    .eq('job_id', jobId)
    .single()

  const oldValue = current ? String(current[field] ?? '') : ''
  const newStr = String(newValue ?? '')

  // write update
  const { error } = await supabase
    .from('jobs')
    .update({ [field]: newValue })
    .eq('job_id', jobId)

  if (error) return { error }

  // log if changed
  if (newStr !== oldValue) {
    await supabase.from('job_changes').insert({
      job_id: jobId,
      call_log_id: current?.call_log_id || null,
      field,
      old_value: oldValue || null,
      new_value: newStr || null,
      changed_by: changedBy,
      source,
    })
  }

  return { error: null }
}

// ── Update multiple job fields at once with audit logging ───────────────────
export async function updateJobFields(jobId, updates, changedBy, source = 'schedule_command', { skipAuditFields = [] } = {}) {
  const fields = Object.keys(updates)
  const selectFields = [...fields, 'call_log_id'].join(', ')

  // read current values
  const { data: current } = await supabase
    .from('jobs')
    .select(selectFields)
    .eq('job_id', jobId)
    .single()

  // write update
  const { error } = await supabase
    .from('jobs')
    .update(updates)
    .eq('job_id', jobId)

  if (error) return { error }

  // log each changed field (skip fields handled by DB trigger to avoid duplicates)
  const logs = []
  for (const field of fields) {
    if (skipAuditFields.includes(field)) continue
    const oldValue = String(current?.[field] ?? '')
    const newValue = String(updates[field] ?? '')
    if (newValue !== oldValue) {
      logs.push({
        job_id: jobId,
        call_log_id: current?.call_log_id || null,
        field,
        old_value: oldValue || null,
        new_value: newValue || null,
        changed_by: changedBy,
        source,
      })
    }
  }
  if (logs.length > 0) {
    await supabase.from('job_changes').insert(logs)
  }

  return { error: null }
}

// ── Stage-sync chokepoint (SCH3) ────────────────────────────────────────────
// Every jobs.status write MUST go through updateJobStatus() so the paired
// call_log.stage (which drives Field's PowerSync visibility filter) can never
// drift out of sync. Stage resolution lives INSIDE the helper, so no caller can
// forget it; the map is fully enumerated and the helper THROWS (fail-closed) on
// any unmapped status rather than silently skipping the stage write.
//
// On Hold → 'In Progress' (Option 1, LOCKED 2026-06-12): 'In Progress' is
// already in the Field call_log.stage filter, so a held job stays synced to the
// crew with NO powersync-sync-rules.yaml edit. See plan §3.6 + §SCH3.
const STATUS_TO_STAGE = {
  'Scheduled':   'Scheduled',
  'In Progress': 'In Progress',
  'On Hold':     'In Progress',
  'Ongoing':     'In Progress',
  'Complete':    'Complete',
}

// Startup invariant: every status the user can assign from the dropdown must
// have a stage mapping, else updateJobStatus would throw the moment it's picked.
// This converts "someone added a dropdown option without a map entry" into a
// loud, pre-ship failure instead of a silently-stale stage that drops the job
// from the crew.
for (const pickerStatus of STATUS_OPTIONS_PICKER) {
  if (STATUS_TO_STAGE[pickerStatus] === undefined) {
    throw new Error(
      `STATUS_TO_STAGE is missing an entry for picker status "${pickerStatus}" — ` +
      `every STATUS_OPTIONS_PICKER value must map to a call_log stage (SCH3 fail-closed invariant).`
    )
  }
}

// Write jobs.status (plus any paired fields) and unconditionally sync the
// paired call_log.stage. Routes the jobs write through updateJobFields so audit
// logging + the on_hold_resume source/skipAuditFields behavior are preserved.
//   opts.extraFields     — extra jobs columns to write alongside status
//                          (e.g. { ready_confirmed_at: null } on resume)
//   opts.skipAuditFields — fields to skip in the job_changes audit log
export async function updateJobStatus(jobId, newStatus, changedBy, source = 'schedule_command', { extraFields = {}, skipAuditFields = [] } = {}) {
  // Fail-closed: resolve the stage BEFORE any write. An unmapped status throws
  // here, so neither jobs.status nor call_log.stage is touched.
  const newStage = STATUS_TO_STAGE[newStatus]
  if (newStage === undefined) {
    throw new Error(
      `updateJobStatus: unmapped status "${newStatus}" — add it to STATUS_TO_STAGE ` +
      `(fail-closed: refusing to write a status with no paired call_log stage).`
    )
  }

  // 1) write jobs.status (+ paired fields) through the audit-logged path
  const { error } = await updateJobFields(jobId, { status: newStatus, ...extraFields }, changedBy, source, { skipAuditFields })
  if (error) return { error }

  // 2) unconditionally sync the paired call_log.stage when the job has a call_log
  const { data: jobRow } = await supabase
    .from('jobs')
    .select('call_log_id')
    .eq('job_id', jobId)
    .single()
  if (jobRow?.call_log_id) {
    const { error: stageErr } = await updateCallLogStage(jobRow.call_log_id, newStage, changedBy, source)
    if (stageErr) return { error: stageErr }
  }

  return { error: null }
}

// ── PRT readers (Field Command writes via PowerSync) ───────────────────────
// daily_production_reports.job_id is FK to call_log.id (NOT jobs.job_id).
// Always pass job.call_log_id, not job.job_id.

export async function loadPRTsForCallLogIds(callLogIds) {
  if (!callLogIds || callLogIds.length === 0) {
    return { data: new Map(), error: null, partial: false }
  }
  const CHUNK = 100
  const chunks = []
  for (let i = 0; i < callLogIds.length; i += CHUNK) {
    chunks.push(callLogIds.slice(i, i + CHUNK))
  }
  const settled = await Promise.allSettled(chunks.map(ids =>
    supabase
      .from('daily_production_reports')
      .select('id, job_id, wtc_id, report_date, submitted_by, tasks, materials_used, hours_regular, hours_ot, photos, notes, status, approved_by, approved_at, created_at, tenant_id, team_members:submitted_by(id, name)')
      .in('job_id', ids)
      .order('report_date', { ascending: false })
  ))
  const byCallLogId = new Map()
  let firstError = null
  let rejected = 0
  for (const r of settled) {
    if (r.status === 'fulfilled' && !r.value.error) {
      for (const row of (r.value.data || [])) {
        const arr = byCallLogId.get(row.job_id) || []
        arr.push(row)
        byCallLogId.set(row.job_id, arr)
      }
    } else {
      rejected++
      if (!firstError) firstError = r.status === 'fulfilled' ? r.value.error : r.reason
    }
  }
  for (const [, arr] of byCallLogId) {
    arr.sort((a, b) => (b.report_date || '').localeCompare(a.report_date || ''))
  }
  return { data: byCallLogId, error: firstError, partial: rejected > 0 }
}

export async function loadPRTsForJob(callLogId) {
  if (!callLogId) return { data: [], error: null }
  const { data, error } = await supabase
    .from('daily_production_reports')
    .select('id, job_id, wtc_id, report_date, submitted_by, tasks, materials_used, hours_regular, hours_ot, photos, notes, status, approved_by, approved_at, created_at, tenant_id, team_members:submitted_by(id, name)')
    .eq('job_id', callLogId)
    .order('report_date', { ascending: false })
  if (error) return { data: null, error }
  return { data: data || [], error: null }
}

export async function loadPRT(prtId) {
  const { data, error } = await supabase
    .from('daily_production_reports')
    .select('*, team_members:submitted_by(id, name)')
    .eq('id', prtId)
    .single()
  if (error) return { data: null, error }
  return { data, error: null }
}

// daily_log_entries.job_id is FK to call_log.id (NOT jobs.job_id).
// employee_id is text, references team_members.id (uuid).
export async function loadDailyLogsForJob(callLogId) {
  if (!callLogId) return { data: [], error: null }
  const { data, error } = await supabase
    .from('daily_log_entries')
    .select('id, job_id, employee_id, entry_type, photos, notes, created_at')
    .eq('job_id', callLogId)
    .order('created_at', { ascending: false })
  if (error) return { data: null, error }
  return { data: data || [], error: null }
}

export async function loadRecentPRTs(days = 14) {
  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceStr = since.toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('daily_production_reports')
    .select('id, job_id, report_date, submitted_by, tasks, hours_regular, hours_ot, photos, status, team_members:submitted_by(id, name), call_log:job_id(id, display_job_number, job_name)')
    .gte('report_date', sinceStr)
    .order('report_date', { ascending: false })
    .limit(500)
  if (error) return { data: null, error }
  return { data: data || [], error: null }
}

let _teamMemberMapCache = null
export async function loadTeamMemberMap({ refresh = false } = {}) {
  if (_teamMemberMapCache && !refresh) return { data: _teamMemberMapCache, error: null }
  const { data, error } = await supabase
    .from('team_members')
    .select('id, name, role, email')
  if (error) return { data: null, error }
  const map = {}
  for (const m of (data || [])) map[m.id] = m
  _teamMemberMapCache = map
  return { data: map, error: null }
}

// ── Multi-week alert (M6 tightening) ────────────────────────────────────────
// Returns the count of weeks AFTER the job's start week that the job spans
// where this specific job has zero crew assignments. 0 = no alert.
// See plan §6.1 for the criterion and §6.5 for the perf envelope.

function _fmtD(d) {
  const dt = d instanceof Date ? d : new Date(d)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function _getMonday(d) {
  const dt = d instanceof Date ? new Date(d) : new Date(d)
  const day = dt.getDay()
  dt.setDate(dt.getDate() - (day === 0 ? 6 : day - 1))
  dt.setHours(0, 0, 0, 0)
  return dt
}

export function getJobMultiWeekAlert(job, assignments, today) {
  const start = job?.scheduled_start || job?.start_date
  const end = job?.scheduled_end || job?.end_date
  if (!start || !end) return 0

  const startD = new Date(start + 'T00:00:00')
  const endD = new Date(end + 'T00:00:00')
  const startMonday = _getMonday(startD)
  const endMonday = _getMonday(endD)
  if (startMonday.getTime() === endMonday.getTime()) return 0

  let alerts = 0
  const cursor = new Date(startMonday)
  cursor.setDate(cursor.getDate() + 7)  // skip start week

  while (cursor.getTime() <= endMonday.getTime()) {
    const daysInWeek = []
    for (let i = 0; i < 6; i++) {
      const d = new Date(cursor); d.setDate(d.getDate() + i)
      const ds = _fmtD(d)
      if (ds >= start && ds <= end) daysInWeek.push(ds)
    }
    const hasAsgn = (assignments || []).some(a =>
      a.job_id === job.job_id && daysInWeek.includes(a.date)
    )
    if (!hasAsgn) alerts++
    cursor.setDate(cursor.getDate() + 7)
  }
  return alerts
}

// ── Update call_log stage with audit logging ────────────────────────────────
export async function updateCallLogStage(callLogId, newStage, changedBy, source = 'schedule_command') {
  // read current stage
  const { data: current } = await supabase
    .from('call_log')
    .select('stage')
    .eq('id', callLogId)
    .single()

  const oldStage = current?.stage || ''

  // write update
  const { error } = await supabase
    .from('call_log')
    .update({ stage: newStage })
    .eq('id', callLogId)

  if (error) return { error }

  // log if changed — use call_log_id but no job_id (this is a call_log update)
  if (newStage !== oldStage) {
    await supabase.from('job_changes').insert({
      job_id: null,
      call_log_id: callLogId,
      field: 'stage',
      old_value: oldStage || null,
      new_value: newStage,
      changed_by: changedBy,
      source,
    })
  }

  return { error: null }
}
