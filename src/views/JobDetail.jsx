import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadJob, updateJobField, loadPRTsForJob, loadDailyLogsForJob, loadTeamMemberMap } from '../lib/queries'
import { useUser } from '../lib/user'
import { getJobStatus, getStatusBadgeClass } from '../lib/jobStatus'
import PRTDetail from '../components/PRTDetail'
import FieldSowBuilder from '../components/FieldSowBuilder'

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
  const [proposalMaterials, setProposalMaterials] = useState([])
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
      // Default tab: planning → fieldsow (top of planning tab list), else overview.
      // The legacy 'schedule' tab is gone; the planning tab now starts at Field SOW.
      setTab(prev => prev || (mode === 'planning' ? 'fieldsow' : 'overview'))
    }
    setAssignments(asgnRes.data || [])
    setBillingLog(blRes.data || [])
    setMaterials(matRes.data || [])
    setChanges(chgRes.data || [])
    // job_crew.job_id is FK to call_log.id, not jobs.job_id
    const clId = jobRes.data?.call_log_id
    if (clId) {
      const [{ data: fcData }, prtRes, dlRes, tmRes, pwRes] = await Promise.all([
        supabase.from('job_crew').select('id, team_member_id, role, team_members(name)').eq('job_id', clId),
        loadPRTsForJob(clId),
        loadDailyLogsForJob(clId),
        loadTeamMemberMap(),
        supabase
          .from('proposal_wtc')
          .select('id, materials, proposals!inner(call_log_id)')
          .eq('proposals.call_log_id', clId),
      ])
      setFieldCrew(fcData || [])
      setPrts(prtRes.data || [])
      setDailyLogs(dlRes.data || [])
      setTeamMap(tmRes.data || {})
      const flat = []
      ;(pwRes.data || []).forEach(w => (w.materials || []).forEach(m => {
        if (m && m.id != null) flat.push({ ...m, _wtc_id: w.id })
      }))
      setProposalMaterials(flat)
    } else {
      setFieldCrew([])
      setPrts([])
      setDailyLogs([])
      setTeamMap({})
      setProposalMaterials([])
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

  // "Schedule this job" deep-link target: Monday of the job's start week.
  const startForLink = effectiveStart(job)
  let weekMonday = null
  if (startForLink) {
    const d = new Date(startForLink + 'T00:00:00')
    const day = d.getDay()
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
    d.setHours(0, 0, 0, 0)
    weekMonday = fmtD(d)
  }

  const PLANNING_TABS = [
    { key: 'fieldsow', label: 'Field SOW' },
    { key: 'materials', label: 'Materials' },
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
          <span className={`jh-status-badge ${getStatusBadgeClass(getJobStatus(job))}`}>
            {getJobStatus(job)}
          </span>
          {weekMonday && (
            <button
              className="jd-sched-link"
              onClick={() => navigate(`/schedule?job=${job.job_id}&week=${weekMonday}`)}
            >
              Schedule this job →
            </button>
          )}
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
            <FieldSowBuilder
              key={job.job_id}
              value={job.field_sow}
              saving={false}
              availableMaterials={proposalMaterials}
              onSave={async (next) => {
                await updateJobField(job.job_id, 'field_sow', next, changedBy)
                setJob(prev => ({ ...prev, field_sow: next }))
              }}
            />
            {job.sow && (
              <details className="jd-sales-sow-collapse" style={{ marginTop: 20 }}>
                <summary style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--sand-dark)', cursor: 'pointer' }}>
                  Sales SOW (read-only reference)
                </summary>
                <pre className="jd-sow-text" style={{ marginTop: 8 }}>{job.sow}</pre>
              </details>
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
