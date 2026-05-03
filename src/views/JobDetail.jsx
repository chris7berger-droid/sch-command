import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadJob, updateJobField, updateJobFields, updateCallLogStage, loadPRTsForJob, loadDailyLogsForJob, loadTeamMemberMap } from '../lib/queries'
import { useUser } from '../lib/user'
import JobCrewScheduler from '../components/JobCrewScheduler'
import PRTDetail from '../components/PRTDetail'

/* ── helpers ─────────────────────────────────────────────────────── */

function fmtD(d) {
  const dt = d instanceof Date ? d : new Date(d)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function fmtMoney(n) {
  if (n == null || n === '' || isNaN(n)) return '-'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function isPW(j) {
  return j && (j.prevailing_wage === 'Yes' || j.prevailing_wage === true)
}

function gTagClass(t) {
  if (!t) return ''
  const lower = t.toLowerCase().trim()
  if (lower.includes('flake')) return 'tg-flake'
  if (lower.includes('epoxy')) return 'tg-epoxy'
  if (lower.includes('caulk')) return 'tg-caulk'
  if (lower.includes('demo')) return 'tg-demo'
  if (lower.includes('joint') || lower.includes('fill') || lower.includes('seal')) return 'tg-teal'
  if (lower.includes('plenum')) return 'tg-plenum'
  return 'tg-default'
}

function effectiveStart(j) { return j?.scheduled_start || j?.start_date || null }
function effectiveEnd(j) { return j?.scheduled_end || j?.end_date || null }

function fmtTimestamp(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

/* ── component ───────────────────────────────────────────────────── */

export default function JobDetail() {
  const { jobId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const mode = searchParams.get('mode') // 'planning' | 'management' | null
  const user = useUser()
  const changedBy = user?.name || changedBy
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState(null)

  // sub-data
  const [assignments, setAssignments] = useState([])
  const [billingLog, setBillingLog] = useState([])
  const [materials, setMaterials] = useState([])
  const [changes, setChanges] = useState([])
  const [fieldCrew, setFieldCrew] = useState([])
  const [prts, setPrts] = useState([])
  const [openPrtId, setOpenPrtId] = useState(null)
  const [dailyLogs, setDailyLogs] = useState([])
  const [teamMap, setTeamMap] = useState({})

  const fetchData = useCallback(async () => {
    setLoading(true)
    const jid = parseInt(jobId)
    const [jobRes, asgnRes, blRes, matRes, chgRes] = await Promise.all([
      loadJob(jid),
      supabase.from('assignments').select('crew_name, date').eq('job_id', jid).order('date', { ascending: false }),
      supabase.from('billing_log').select('*').eq('job_id', jid).order('date', { ascending: false }),
      supabase.from('materials').select('*').eq('job_id', jid).order('ordinal'),
      supabase.from('job_changes').select('*').eq('job_id', jid).order('changed_at', { ascending: false }).limit(100),
    ])
    if (jobRes.data) {
      setJob(jobRes.data)
      // Default tab based on mode param or job status
      setTab(prev => prev || (mode === 'management' ? 'overview' : mode === 'planning' ? 'schedule' : jobRes.data.status === 'Parked' ? 'schedule' : 'overview'))
    }
    setAssignments(asgnRes.data || [])
    setBillingLog(blRes.data || [])
    setMaterials(matRes.data || [])
    setChanges(chgRes.data || [])
    // job_crew.job_id is FK to call_log.id, not jobs.job_id
    const clId = jobRes.data?.call_log_id
    if (clId) {
      const [{ data: fcData }, prtRes, dlRes, tmRes] = await Promise.all([
        supabase.from('job_crew').select('id, team_member_id, role, team_members(name)').eq('job_id', clId),
        loadPRTsForJob(clId),
        loadDailyLogsForJob(clId),
        loadTeamMemberMap(),
      ])
      setFieldCrew(fcData || [])
      setPrts(prtRes.data || [])
      setDailyLogs(dlRes.data || [])
      setTeamMap(tmRes.data || {})
    } else {
      setFieldCrew([])
      setPrts([])
      setDailyLogs([])
      setTeamMap({})
    }
    setLoading(false)
  }, [jobId])

  useEffect(() => { fetchData() }, [fetchData])

  // billing totals
  const billedPct = useMemo(() => {
    return billingLog.reduce((sum, b) => sum + (parseFloat(b.percent) || 0), 0)
  }, [billingLog])

  const amount = job?.amount ? parseFloat(job.amount) : 0

  // Readiness checks
  const scheduleReady = assignments.length > 0
  const materialsReady = job?.materials_needed === false || (job?.materials_needed === true && materials.length > 0)
  const materialsDecided = job?.materials_needed !== null && job?.materials_needed !== undefined
  const fieldSowReady = job?.field_sow && job.field_sow.length > 0
  const readyCount = [scheduleReady, materialsReady && materialsDecided, fieldSowReady].filter(Boolean).length
  const allReady = readyCount === 3

  // Schedule summary
  const crewNames = [...new Set(assignments.map(a => a.crew_name))]
  const scheduleDays = [...new Set(assignments.map(a => a.date))].length
  const soldCrewCount = job?.field_sow?.length > 0
    ? Math.max(...job.field_sow.map(d => d.crew_count || 0))
    : null
  const crewMismatch = soldCrewCount && crewNames.length !== soldCrewCount
  const scheduleSummary = scheduleReady
    ? `${crewNames.length} man crew, ${scheduleDays} day${scheduleDays !== 1 ? 's' : ''}${crewMismatch ? ` (sold as ${soldCrewCount} man crew job)` : ''}`
    : 'No crew assigned'

  // Materials summary
  const materialsSummary = !materialsDecided
    ? 'Not decided'
    : job.materials_needed === false
      ? 'No materials needed'
      : materials.length === 0
        ? 'Needed — none added'
        : `${materials.length} item${materials.length !== 1 ? 's' : ''}${materials.some(m => m.status === 'Not Ordered') ? `, ${materials.filter(m => m.status === 'Not Ordered').length} not ordered` : ''}`

  // Field SOW summary
  const fieldSowSummary = fieldSowReady
    ? `${job.field_sow.length} day${job.field_sow.length !== 1 ? 's' : ''} planned`
    : 'No Field SOW data'

  if (loading) return <div className="jd-wrap"><div className="jh-empty">Loading...</div></div>
  if (!job) return <div className="jd-wrap"><div className="jh-empty">Job not found</div></div>

  const PLANNING_TABS = [
    { key: 'schedule', label: 'Schedule' },
    { key: 'materials', label: 'Materials' },
    { key: 'fieldsow', label: 'Field SOW' },
  ]

  const MANAGEMENT_TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'production', label: 'Production' },
    { key: 'daily-log', label: 'Daily Log' },
    { key: 'billing', label: 'Billing' },
    { key: 'history', label: 'History' },
  ]

  return (
    <div className="jd-wrap">
      {/* Header */}
      <div className="jd-header">
        <button className="jd-back" onClick={() => navigate('/jobs')}>{'< JOBS'}</button>
        <div className="jd-title-row">
          <span className="jd-num">{job.job_num}</span>
          <span className="jd-name">{job.job_name}</span>
          <span className={`jh-status-badge ${job.status === 'Parked' ? 'pk' : job.status === 'Complete' ? 'cp' : job.status === 'On Hold' ? 'oh' : 'og'}`}>
            {job.status}
          </span>
        </div>
      </div>

      {/* Tab Groups */}
      <div className="jd-tab-groups">
        {mode !== 'management' && (
        <div className="jd-tab-group">
          <div className="jd-tab-group-label">JOB PLANNING</div>
          <div className="jd-tabs">
            {PLANNING_TABS.map(t => (
              <button
                key={t.key}
                className={`jd-tab${tab === t.key ? ' active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        )}
        {mode !== 'planning' && (
        <div className="jd-tab-group">
          <div className="jd-tab-group-label">JOB MANAGEMENT</div>
          <div className="jd-tabs">
            {MANAGEMENT_TABS.map(t => (
              <button
                key={t.key}
                className={`jd-tab${tab === t.key ? ' active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        )}
      </div>

      {/* Readiness Checklist — Parked jobs only, planning mode */}
      {job.status === 'Parked' && mode !== 'management' && (
        <div className="jd-readiness">
          <div className="jd-readiness-items">
            <div className={`jd-ready-item${scheduleReady ? ' done' : ''}`} onClick={() => setTab('schedule')}>
              <span className="jd-ready-check">{scheduleReady ? '\u2713' : '\u25CB'}</span>
              <span className="jd-ready-label">Schedule</span>
              <span className="jd-ready-summary">{scheduleSummary}</span>
            </div>
            <div className={`jd-ready-item${materialsReady && materialsDecided ? ' done' : ''}`}>
              <span className="jd-ready-check">{materialsReady && materialsDecided ? '\u2713' : '\u25CB'}</span>
              <span className="jd-ready-label">Materials</span>
              {!materialsDecided ? (
                <span className="jd-ready-toggle">
                  <button
                    className="jd-mat-toggle-btn yes"
                    onClick={async () => {
                      await updateJobField(job.job_id, 'materials_needed', true, changedBy)
                      setJob(prev => ({ ...prev, materials_needed: true }))
                      setTab('materials')
                    }}
                  >
                    Needed
                  </button>
                  <button
                    className="jd-mat-toggle-btn no"
                    onClick={async () => {
                      await updateJobField(job.job_id, 'materials_needed', false, changedBy)
                      setJob(prev => ({ ...prev, materials_needed: false }))
                    }}
                  >
                    Not Needed
                  </button>
                </span>
              ) : (
                <span className="jd-ready-summary">
                  {materialsSummary}
                  <button
                    className="jd-mat-change"
                    onClick={async () => {
                      const newVal = !job.materials_needed
                      await updateJobField(job.job_id, 'materials_needed', newVal, changedBy)
                      setJob(prev => ({ ...prev, materials_needed: newVal }))
                      if (newVal) setTab('materials')
                    }}
                  >
                    change
                  </button>
                </span>
              )}
            </div>
            <div className={`jd-ready-item${fieldSowReady ? ' done' : ''}`} onClick={() => setTab('fieldsow')}>
              <span className="jd-ready-check">{fieldSowReady ? '\u2713' : '\u25CB'}</span>
              <span className="jd-ready-label">Field SOW</span>
              <span className="jd-ready-summary">{fieldSowSummary}</span>
            </div>
          </div>
          <div className="jd-readiness-footer">
            <span className="jd-ready-count">{readyCount} of 3 ready</span>
            <button
              className={`jh-confirm-btn${!allReady ? ' disabled' : ''}`}
              disabled={!allReady}
              onClick={async () => {
                await updateJobField(job.job_id, 'status', 'Scheduled', changedBy)
                if (job.call_log_id) {
                  await updateCallLogStage(job.call_log_id, 'Scheduled', changedBy)
                }
                setJob(prev => ({ ...prev, status: 'Scheduled' }))
              }}
            >
              Send Job Plan to Schedule
            </button>
          </div>
        </div>
      )}

      {/* Tab content */}
      <div className="jd-content">

        {/* ── Overview ───────────────────────────────────── */}
        {tab === 'overview' && (
          <div className="jd-section">
            {/* Read-only info row */}
            <div className="jd-grid">
              <div className="jd-field">
                <span className="jd-label">Customer</span>
                <span className="jd-value">{job.customer_name || '-'}</span>
              </div>
              <div className="jd-field">
                <span className="jd-label">Sales Rep</span>
                <span className="jd-value">{job.sales_name || '-'}</span>
              </div>
              <div className="jd-field">
                <span className="jd-label">Contract</span>
                <span className="jd-value">{fmtMoney(amount)}</span>
              </div>
              <div className="jd-field">
                <span className="jd-label">Billed</span>
                <span className="jd-value">{Math.round(billedPct)}% ({fmtMoney(amount * billedPct / 100)})</span>
              </div>
            </div>

            {/* Editable fields */}
            <div className="jd-grid" style={{ marginTop: 12 }}>
              <div className="jd-field">
                <span className="jd-label">Scheduled Start</span>
                <input
                  type="date"
                  className="jd-input"
                  value={effectiveStart(job) || ''}
                  max={effectiveEnd(job) || ''}
                  onChange={e => {
                    const val = e.target.value
                    setJob(prev => ({ ...prev, scheduled_start: val }))
                    updateJobField(job.job_id, 'scheduled_start', val || null, changedBy)
                  }}
                />
              </div>
              <div className="jd-field">
                <span className="jd-label">Scheduled End</span>
                <input
                  type="date"
                  className="jd-input"
                  value={effectiveEnd(job) || ''}
                  min={effectiveStart(job) || ''}
                  onChange={e => {
                    const val = e.target.value
                    setJob(prev => ({ ...prev, scheduled_end: val }))
                    updateJobField(job.job_id, 'scheduled_end', val || null, changedBy)
                  }}
                />
              </div>
              <div className="jd-field">
                <span className="jd-label">Lead</span>
                <input
                  type="text"
                  className="jd-input"
                  defaultValue={job.lead || ''}
                  placeholder="Crew lead"
                  onBlur={e => {
                    updateJobField(job.job_id, 'lead', e.target.value || null, changedBy)
                  }}
                />
              </div>
              <div className="jd-field">
                <span className="jd-label">Crew Needed</span>
                <input
                  type="number"
                  className="jd-input"
                  defaultValue={job.crew_needed || ''}
                  placeholder="0"
                  onBlur={e => {
                    updateJobField(job.job_id, 'crew_needed', e.target.value || null, changedBy)
                  }}
                />
              </div>
            </div>

            <div className="jd-grid" style={{ marginTop: 12 }}>
              <div className="jd-field">
                <span className="jd-label">Vehicle</span>
                <input
                  type="text"
                  className="jd-input"
                  defaultValue={job.vehicle || ''}
                  placeholder="-"
                  onBlur={e => {
                    updateJobField(job.job_id, 'vehicle', e.target.value || null, changedBy)
                  }}
                />
              </div>
              <div className="jd-field">
                <span className="jd-label">Equipment</span>
                <input
                  type="text"
                  className="jd-input"
                  defaultValue={job.equipment || ''}
                  placeholder="-"
                  onBlur={e => {
                    updateJobField(job.job_id, 'equipment', e.target.value || null, changedBy)
                  }}
                />
              </div>
              <div className="jd-field">
                <span className="jd-label">Power Source</span>
                <input
                  type="text"
                  className="jd-input"
                  defaultValue={job.power_source || ''}
                  placeholder="-"
                  onBlur={e => {
                    updateJobField(job.job_id, 'power_source', e.target.value || null, changedBy)
                  }}
                />
              </div>
              <div className="jd-field">
                <span className="jd-label">Stage</span>
                <span className="jd-value">{job.stage || '-'}</span>
              </div>
            </div>

            {/* Work type tags */}
            <div className="jd-tags">
              {job.work_type && job.work_type.split(',').map(t => t.trim()).filter(Boolean).map(t => (
                <span key={t} className={`sch-tg ${gTagClass(t)}`}>{t}</span>
              ))}
              {isPW(job) && <span className="pw-tag">PW</span>}
            </div>

            {/* Jobsite address */}
            {job.jobsite_address && (
              <div className="jd-address">
                <span className="jd-label">Jobsite</span>
                <span className="jd-value">
                  {job.jobsite_address}{job.jobsite_city ? `, ${job.jobsite_city}` : ''}{job.jobsite_state ? ` ${job.jobsite_state}` : ''} {job.jobsite_zip || ''}
                </span>
              </div>
            )}

            {job.notes && (
              <div className="jd-notes">
                <span className="jd-label">Notes</span>
                <p>{job.notes}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Schedule (crew scheduler) ──────────────────── */}
        {tab === 'schedule' && (
          <div className="jd-section">
            <JobCrewScheduler job={job} onAssignmentsChange={setAssignments} />
          </div>
        )}

        {/* ── Billing ────────────────────────────────────── */}
        {tab === 'billing' && (
          <div className="jd-section">
            {/* Progress bar */}
            {amount > 0 && (
              <div className="jd-billing-summary">
                <div className="jh-progress-bar" style={{ marginBottom: 12 }}>
                  <div
                    className={`jh-progress-fill${billedPct >= 100 ? ' done' : ''}`}
                    style={{ width: `${Math.min(billedPct, 100)}%` }}
                  />
                </div>
                <div className="jd-billing-stats">
                  <span>{Math.round(billedPct)}% billed</span>
                  <span>{fmtMoney(amount * billedPct / 100)} of {fmtMoney(amount)}</span>
                </div>
              </div>
            )}
            {billingLog.length === 0 ? (
              <div className="jh-empty">No billing entries</div>
            ) : (
              <table className="jd-table">
                <thead>
                  <tr><th>Date</th><th>%</th><th>Cumulative</th><th>Type</th><th>Invoiced</th><th>Notes</th></tr>
                </thead>
                <tbody>
                  {billingLog.map((b, i) => (
                    <tr key={i}>
                      <td>{b.date}</td>
                      <td>{b.percent}%</td>
                      <td>{b.cumulative_percent}%</td>
                      <td>{b.type}</td>
                      <td>{b.invoiced}{b.invoiced_date ? ` (${b.invoiced_date})` : ''}</td>
                      <td>{b.notes || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Materials ──────────────────────────────────── */}
        {tab === 'materials' && (
          <div className="jd-section">
            {materials.length === 0 ? (
              <div className="jh-empty">No materials tracked</div>
            ) : (
              <table className="jd-table">
                <thead>
                  <tr><th>#</th><th>Material</th><th>Status</th><th>Arrival</th><th>Notes</th></tr>
                </thead>
                <tbody>
                  {materials.map((m, i) => (
                    <tr key={m.id || i}>
                      <td>{m.ordinal}</td>
                      <td>{m.name}</td>
                      <td>{m.status || '-'}</td>
                      <td>{m.arrival_date || '-'}</td>
                      <td>{m.notes || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Field SOW ──────────────────────────────────── */}
        {tab === 'fieldsow' && (
          <div className="jd-section">
            {(!job.field_sow || job.field_sow.length === 0) ? (
              <div className="jh-empty">No Field SOW data</div>
            ) : (
              <div className="jd-sow-list">
                {job.field_sow.map((day, i) => (
                  <div key={i} className="jd-sow-card">
                    <div className="jd-sow-day">{day.day_label || `Day ${i + 1}`}</div>
                    {day.tasks && day.tasks.map((task, ti) => (
                      <div key={ti} className="jd-sow-task">
                        {typeof task === 'string' ? task : task.description || ''}
                        {task.pct_complete ? <span className="jd-sow-pct">{task.pct_complete}%</span> : null}
                      </div>
                    ))}
                    {day.materials && day.materials.length > 0 && (
                      <div className="jd-sow-materials">
                        {day.materials.map((mat, mi) => (
                          <div key={mi} className="jd-sow-mat">
                            {mat.name}{mat.qty_planned ? ` x${mat.qty_planned}` : ''}{mat.mils ? ` @ ${mat.mils} mils` : ''}
                          </div>
                        ))}
                      </div>
                    )}
                    {day.crew_count ? <div className="jd-sow-meta">Crew: {day.crew_count}</div> : null}
                    {day.hours_planned ? <div className="jd-sow-meta">Hours: {day.hours_planned}</div> : null}
                  </div>
                ))}
              </div>
            )}
            {job.sow && (
              <div className="jd-sales-sow">
                <span className="jd-label">Sales SOW</span>
                <pre className="jd-sow-text">{job.sow}</pre>
              </div>
            )}
          </div>
        )}

        {/* ── Production (PRT list from Field Command) ───── */}
        {tab === 'production' && (
          <div className="jd-section">
            {openPrtId ? (
              <PRTDetail prtId={openPrtId} onBack={() => setOpenPrtId(null)} />
            ) : prts.length === 0 ? (
              <div className="jh-empty">No production reports submitted yet</div>
            ) : (
              <div className="jd-prt-list">
                {prts.map(p => {
                  const tasks = Array.isArray(p.tasks) ? p.tasks : (p.tasks ? JSON.parse(p.tasks) : [])
                  const photos = Array.isArray(p.photos) ? p.photos : (p.photos ? JSON.parse(p.photos) : [])
                  const submitter = p.team_members?.name || 'Unknown'
                  const hoursR = p.hours_regular != null ? Number(p.hours_regular) : 0
                  const hoursOT = p.hours_ot != null ? Number(p.hours_ot) : 0
                  return (
                    <div key={p.id} className="jd-prt-card" onClick={() => setOpenPrtId(p.id)}>
                      <div className="jd-prt-row">
                        <span className="jd-prt-date">{p.report_date}</span>
                        <span className={`jd-prt-status jd-prt-status-${p.status || 'submitted'}`}>{p.status || 'submitted'}</span>
                      </div>
                      <div className="jd-prt-row">
                        <span className="jd-prt-submitter">by {submitter}</span>
                      </div>
                      <div className="jd-prt-meta">
                        <span className="jd-prt-meta-item"><strong>{tasks.length}</strong> task{tasks.length !== 1 ? 's' : ''}</span>
                        <span className="jd-prt-meta-item"><strong>{photos.length}</strong> photo{photos.length !== 1 ? 's' : ''}</span>
                        <span className="jd-prt-meta-item"><strong>{(hoursR + hoursOT).toFixed(1)}</strong>h{hoursOT > 0 ? ` (${hoursOT}OT)` : ''}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Daily Log (Field Command entries) ─────────── */}
        {tab === 'daily-log' && (
          <div className="jd-section">
            {dailyLogs.length === 0 ? (
              <div className="jh-empty">No daily log entries yet</div>
            ) : (
              <div className="jd-dl-list">
                {(() => {
                  // Group by date (created_at YYYY-MM-DD)
                  const groups = new Map()
                  for (const e of dailyLogs) {
                    const date = (e.created_at || '').slice(0, 10) || 'undated'
                    if (!groups.has(date)) groups.set(date, [])
                    groups.get(date).push(e)
                  }
                  return [...groups.entries()].map(([date, entries]) => (
                    <div key={date} className="jd-dl-group">
                      <div className="jd-dl-date">{date}</div>
                      <div className="jd-dl-items">
                        {entries.map(e => {
                          const photos = (() => {
                            if (Array.isArray(e.photos)) return e.photos
                            if (typeof e.photos === 'string') {
                              try { const p = JSON.parse(e.photos); return Array.isArray(p) ? p : [] } catch { return [] }
                            }
                            return []
                          })()
                          const author = teamMap[e.employee_id]?.name || 'Unknown'
                          const type = (e.entry_type || 'OTHER').toUpperCase()
                          return (
                            <div key={e.id} className="jd-dl-card">
                              <div className="jd-dl-row">
                                <span className={`jd-dl-pill jd-dl-pill-${type.toLowerCase()}`}>{type}</span>
                                <span className="jd-dl-author">{author}</span>
                                <span className="jd-dl-time">{fmtTimestamp(e.created_at)}</span>
                              </div>
                              {e.notes && <div className="jd-dl-notes">{e.notes}</div>}
                              {photos.length > 0 && (
                                <div className="jd-dl-photos">
                                  {photos.map((url, i) => (
                                    <a key={i} href={url} target="_blank" rel="noreferrer" className="jd-dl-photo">
                                      <img src={url} alt={`Daily log ${i + 1}`} loading="lazy" />
                                    </a>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))
                })()}
              </div>
            )}
          </div>
        )}

        {/* ── History (audit log) ────────────────────────── */}
        {tab === 'history' && (
          <div className="jd-section">
            {changes.length === 0 ? (
              <div className="jh-empty">No changes logged yet</div>
            ) : (
              <div className="jd-history">
                {(() => {
                  // Group by date
                  const groups = []
                  let currentDate = null
                  changes.forEach(c => {
                    const d = new Date(c.changed_at)
                    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                    if (dateKey !== currentDate) {
                      currentDate = dateKey
                      groups.push({ date: dateKey, label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }), items: [] })
                    }
                    groups[groups.length - 1].items.push(c)
                  })
                  return groups.map(g => (
                    <div key={g.date} className="jd-history-group">
                      <div className="jd-history-date">{g.label}</div>
                      <div className="jd-history-items">
                        {g.items.map(c => (
                          <div key={c.id} className="jd-history-row">
                            <span className="jd-history-field">{c.field}</span>
                            <span className="jd-history-vals">
                              {c.old_value && <span className="jd-history-old">{c.old_value}</span>}
                              <span className="jd-history-arrow">{'\u2192'}</span>
                              <span className="jd-history-new">{c.new_value}</span>
                            </span>
                            <span className="jd-history-time">{new Date(c.changed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                })()}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
