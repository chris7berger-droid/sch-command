import { supabase } from './supabase'

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
  }
}

// ── Load jobs with call_log join ────────────────────────────────────────────
// Replaces: supabase.from('jobs').select('*')
export async function loadJobs({ includeDeleted = false } = {}) {
  let query = supabase
    .from('jobs')
    .select(`*, ${CALL_LOG_SELECT}`)

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
export async function updateJobFields(jobId, updates, changedBy, source = 'schedule_command') {
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

  // log each changed field
  const logs = []
  for (const field of fields) {
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

// ── PRT readers (Field Command writes via PowerSync) ───────────────────────
// daily_production_reports.job_id is FK to call_log.id (NOT jobs.job_id).
// Always pass job.call_log_id, not job.job_id.

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
