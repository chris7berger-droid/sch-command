import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadJob, updateJobField, updateJobFields, updateCallLogStage } from '../lib/queries'

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
    const [jobRes, asgnRes, blRes, matRes, chgRes, fcRes] = await Promise.all([
      loadJob(parseInt(jobId)),
      supabase.from('assignments').select('crew_name, date').eq('job_id', parseInt(jobId)).order('date', { ascending: false }),
      supabase.from('billing_log').select('*').eq('job_id', parseInt(jobId)).order('date', { ascending: false }),
      supabase.from('materials').select('*').eq('job_id', parseInt(jobId)).order('ordinal'),
      supabase.from('job_changes').select('*').eq('job_id', parseInt(jobId)).order('changed_at', { ascending: false }).limit(100),
      supabase.from('job_crew').select('id, team_member_id, role, team_members(name)').eq('job_id', parseInt(jobId)),
    ])
    if (jobRes.data) setJob(jobRes.data)
    setAssignments(asgnRes.data || [])
    setBillingLog(blRes.data || [])
    setMaterials(matRes.data || [])
    setChanges(chgRes.data || [])
    setFieldCrew(fcRes.data || [])
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
                <span className="jd-label">Scheduled Start</span>
                <span className="jd-value">{effectiveStart(job) || '-'}</span>
              </div>
              <div className="jd-field">
                <span className="jd-label">Scheduled End</span>
                <span className="jd-value">{effectiveEnd(job) || '-'}</span>
              </div>
              <div className="jd-field">
                <span className="jd-label">Contract</span>
                <span className="jd-value">{fmtMoney(amount)}</span>
              </div>
              <div className="jd-field">
                <span className="jd-label">Billed</span>
                <span className="jd-value">{Math.round(billedPct)}% ({fmtMoney(amount * billedPct / 100)})</span>
              </div>
              <div className="jd-field">
                <span className="jd-label">Lead</span>
                <span className="jd-value">{job.lead || '-'}</span>
              </div>
              <div className="jd-field">
                <span className="jd-label">Crew Needed</span>
                <span className="jd-value">{job.crew_needed || '-'}</span>
              </div>
              <div className="jd-field">
                <span className="jd-label">Vehicle</span>
                <span className="jd-value">{job.vehicle || '-'}</span>
              </div>
              <div className="jd-field">
                <span className="jd-label">Equipment</span>
                <span className="jd-value">{job.equipment || '-'}</span>
              </div>
              <div className="jd-field">
                <span className="jd-label">Power Source</span>
                <span className="jd-value">{job.power_source || '-'}</span>
              </div>
              <div className="jd-field">
                <span className="jd-label">Call Log Stage</span>
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

            {/* Field crew */}
            {fieldCrew.length > 0 && (
              <div className="jd-crew-section">
                <span className="jd-label">Field Crew</span>
                <div className="jh-field-crew-list">
                  {fieldCrew.map(fc => (
                    <div key={fc.id} className="jh-fc-chip">
                      <span className={`jh-fc-role${fc.role === 'lead' ? ' lead' : ''}`}>
                        {fc.role === 'lead' ? 'L' : 'C'}
                      </span>
                      <span className="jh-fc-name">{fc.team_members?.name || '?'}</span>
                    </div>
                  ))}
                </div>
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

        {/* ── Schedule (assignment history) ──────────────── */}
        {tab === 'schedule' && (
          <div className="jd-section">
            {assignments.length === 0 ? (
              <div className="jh-empty">No crew assignments yet</div>
            ) : (
              <table className="jd-table">
                <thead>
                  <tr><th>Date</th><th>Crew</th></tr>
                </thead>
                <tbody>
                  {assignments.map((a, i) => (
                    <tr key={i}>
                      <td>{a.date}</td>
                      <td>{a.crew_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
                    <div className="jd-sow-day">Day {i + 1}</div>
                    {day.tasks && day.tasks.map((task, ti) => (
                      <div key={ti} className="jd-sow-task">{task}</div>
                    ))}
                    {day.crew_count && <div className="jd-sow-meta">Crew: {day.crew_count}</div>}
                    {day.hours && <div className="jd-sow-meta">Hours: {day.hours}</div>}
                    {day.description && <div className="jd-sow-task">{day.description}</div>}
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
              <div className="jd-timeline">
                {changes.map(c => (
                  <div key={c.id} className="jd-timeline-item">
                    <div className="jd-timeline-dot" />
                    <div className="jd-timeline-content">
                      <div className="jd-timeline-meta">
                        <span className="jd-timeline-date">{fmtTimestamp(c.changed_at)}</span>
                        <span className="jd-timeline-who">{c.changed_by}</span>
                        <span className="jd-timeline-source">{c.source}</span>
                      </div>
                      <div className="jd-timeline-change">
                        <span className="jd-timeline-field">{c.field}</span>
                        {c.old_value && <span className="jd-timeline-old">{c.old_value}</span>}
                        <span className="jd-timeline-arrow">{'\u2192'}</span>
                        <span className="jd-timeline-new">{c.new_value}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
