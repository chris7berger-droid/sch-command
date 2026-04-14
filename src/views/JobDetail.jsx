import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadJob, updateJobField, updateJobFields, updateCallLogStage } from '../lib/queries'
import JobCrewScheduler from '../components/JobCrewScheduler'

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
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')

  // sub-data
  const [assignments, setAssignments] = useState([])
  const [billingLog, setBillingLog] = useState([])
  const [materials, setMaterials] = useState([])
  const [changes, setChanges] = useState([])
  const [fieldCrew, setFieldCrew] = useState([])

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
    if (jobRes.data) setJob(jobRes.data)
    setAssignments(asgnRes.data || [])
    setBillingLog(blRes.data || [])
    setMaterials(matRes.data || [])
    setChanges(chgRes.data || [])
    // job_crew.job_id is FK to call_log.id, not jobs.job_id
    const clId = jobRes.data?.call_log_id
    if (clId) {
      const { data: fcData } = await supabase.from('job_crew').select('id, team_member_id, role, team_members(name)').eq('job_id', clId)
      setFieldCrew(fcData || [])
    } else {
      setFieldCrew([])
    }
    setLoading(false)
  }, [jobId])

  useEffect(() => { fetchData() }, [fetchData])

  // billing totals
  const billedPct = useMemo(() => {
    return billingLog.reduce((sum, b) => sum + (parseFloat(b.percent) || 0), 0)
  }, [billingLog])

  const amount = job?.amount ? parseFloat(job.amount) : 0

  if (loading) return <div className="jd-wrap"><div className="jh-empty">Loading...</div></div>
  if (!job) return <div className="jd-wrap"><div className="jh-empty">Job not found</div></div>

  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'schedule', label: 'Schedule' },
    { key: 'billing', label: 'Billing' },
    { key: 'materials', label: 'Materials' },
    { key: 'fieldsow', label: 'Field SOW' },
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

      {/* Tabs */}
      <div className="jd-tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`jd-tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

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
                    updateJobField(job.job_id, 'scheduled_start', val || null, 'schedule_user')
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
                    updateJobField(job.job_id, 'scheduled_end', val || null, 'schedule_user')
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
                    updateJobField(job.job_id, 'lead', e.target.value || null, 'schedule_user')
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
                    updateJobField(job.job_id, 'crew_needed', e.target.value || null, 'schedule_user')
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
                    updateJobField(job.job_id, 'vehicle', e.target.value || null, 'schedule_user')
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
                    updateJobField(job.job_id, 'equipment', e.target.value || null, 'schedule_user')
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
                    updateJobField(job.job_id, 'power_source', e.target.value || null, 'schedule_user')
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
            <JobCrewScheduler job={job} />
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
