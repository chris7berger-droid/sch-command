import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/* ── helpers ─────────────────────────────────────────────────────── */

function getMonday(d) {
  const dt = new Date(d)
  const day = dt.getDay()
  const diff = (day === 0 ? -6 : 1) - day
  dt.setDate(dt.getDate() + diff)
  dt.setHours(0, 0, 0, 0)
  return dt
}

function fmtD(d) {
  const dt = d instanceof Date ? d : new Date(d)
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const day = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtWk(monday) {
  const mon = monday instanceof Date ? monday : new Date(monday + 'T00:00:00')
  const fri = new Date(mon)
  fri.setDate(mon.getDate() + 4)
  const mStr = `${MONTHS[mon.getMonth()]} ${mon.getDate()}`
  const fStr = `${MONTHS[fri.getMonth()]} ${fri.getDate()}`
  return `${mStr} \u2013 ${fStr}, ${fri.getFullYear()}`
}

function flipName(n) {
  if (!n) return ''
  const p = n.split(',')
  return p.length === 2 ? p[1].trim() + ' ' + p[0].trim() : n
}

function isPW(j) {
  return j && (j.prevailing_wage === 'Yes' || j.prevailing_wage === true)
}

const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const WEEKDAY_ORDER = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

function dayLabel(dates, mondayOfWeek) {
  if (!dates || dates.length === 0) return ''
  const mon = mondayOfWeek instanceof Date ? mondayOfWeek : new Date(mondayOfWeek + 'T00:00:00')
  const labels = dates.map(ds => {
    const d = new Date(ds + 'T00:00:00')
    return DAY_NAMES[d.getDay()]
  })
  const unique = [...new Set(labels)]
  const sorted = unique.sort((a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b))

  // Check if consecutive weekdays
  if (sorted.length >= 2) {
    const indices = sorted.map(s => WEEKDAY_ORDER.indexOf(s))
    let consecutive = true
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] !== indices[i - 1] + 1) { consecutive = false; break }
    }
    if (consecutive) return `${sorted[0]}-${sorted[sorted.length - 1]}`
  }
  return sorted.join(',')
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

function getJobStatus(j) {
  if (!j || !j.status) return 'Ongoing'
  const s = j.status.toLowerCase().trim()
  if (s === 'on hold' || s === 'hold') return 'On Hold'
  if (s === 'complete' || s === 'completed' || s === 'done') return 'Complete'
  return 'Ongoing'
}

function getBilledToDate(billingLog, jobId) {
  if (!billingLog || !billingLog.length) return 0
  const entries = billingLog.filter(b => b.job_id === jobId)
  return entries.reduce((sum, b) => sum + (parseFloat(b.percent) || 0), 0)
}

/* ── main component ──────────────────────────────────────────────── */

export default function Jobs() {
  const [jobs, setJobs] = useState([])
  const [assignments, setAssignments] = useState([])
  const [billingLog, setBillingLog] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // search
  const [search, setSearch] = useState('')

  // week nav
  const [weekOffset, setWeekOffset] = useState(0)

  // drill-down
  const [selectedJob, setSelectedJob] = useState(null)
  const [jobAssignments, setJobAssignments] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  // restore bin
  const [showBin, setShowBin] = useState(false)
  const [deletedJobs, setDeletedJobs] = useState([])

  /* ── data fetch ─────────────────────────────────────────────── */

  const loadData = useCallback(async () => {
    setLoading(true)
    const [jobsRes, assignRes, billRes] = await Promise.all([
      supabase.from('jobs').select('*').or('deleted.is.null,deleted.eq.No'),
      supabase.from('assignments').select('*'),
      supabase.from('billing_log').select('*'),
    ])
    if (jobsRes.error) { setError(jobsRes.error.message); setLoading(false); return }
    setJobs(jobsRes.data || [])
    setAssignments(assignRes.data || [])
    setBillingLog(billRes.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  /* ── week nav ───────────────────────────────────────────────── */

  const currentMonday = useMemo(() => {
    const m = getMonday(new Date())
    m.setDate(m.getDate() + weekOffset * 7)
    return m
  }, [weekOffset])

  const currentFriday = useMemo(() => {
    const f = new Date(currentMonday)
    f.setDate(f.getDate() + 4)
    return f
  }, [currentMonday])

  const weekLabel = useMemo(() => fmtWk(currentMonday), [currentMonday])

  /* ── crew count for a job this week ─────────────────────────── */

  const weekCrewCounts = useMemo(() => {
    const monStr = fmtD(currentMonday)
    const friStr = fmtD(currentFriday)
    const map = {}
    for (const a of assignments) {
      if (a.date >= monStr && a.date <= friStr) {
        if (!map[a.job_id]) map[a.job_id] = new Set()
        map[a.job_id].add(a.crew_name)
      }
    }
    const counts = {}
    for (const [id, set] of Object.entries(map)) counts[id] = set.size
    return counts
  }, [assignments, currentMonday, currentFriday])

  /* ── filter jobs ────────────────────────────────────────────── */

  const filteredJobs = useMemo(() => {
    let list = jobs

    if (search.trim()) {
      const q = search.toLowerCase().trim()
      list = list.filter(j => {
        const num = (j.job_num || '').toLowerCase()
        const name = (j.job_name || '').toLowerCase()
        const wt = (j.work_type || '').toLowerCase()
        return num.includes(q) || name.includes(q) || wt.includes(q)
      })
    } else {
      // week filter: include jobs that overlap the current week or have no dates
      const monStr = fmtD(currentMonday)
      const friStr = fmtD(currentFriday)
      list = list.filter(j => {
        if (!j.start_date && !j.end_date) return true
        const start = j.start_date || '1900-01-01'
        const end = j.end_date || '2999-12-31'
        return start <= friStr && end >= monStr
      })
    }

    return list
  }, [jobs, search, currentMonday, currentFriday])

  /* ── buckets ────────────────────────────────────────────────── */

  const ongoing = useMemo(() => filteredJobs.filter(j => getJobStatus(j) === 'Ongoing'), [filteredJobs])
  const onHold = useMemo(() => filteredJobs.filter(j => getJobStatus(j) === 'On Hold'), [filteredJobs])
  const complete = useMemo(() => filteredJobs.filter(j => getJobStatus(j) === 'Complete'), [filteredJobs])

  /* ── status update ──────────────────────────────────────────── */

  const updateStatus = useCallback(async (jobId, newStatus) => {
    const { error: err } = await supabase.from('jobs').update({ status: newStatus }).eq('job_id', jobId)
    if (err) { console.error(err); return }
    setJobs(prev => prev.map(j => j.job_id === jobId ? { ...j, status: newStatus } : j))
    if (selectedJob && selectedJob.job_id === jobId) {
      setSelectedJob(prev => ({ ...prev, status: newStatus }))
    }
  }, [selectedJob])

  /* ── soft delete ────────────────────────────────────────────── */

  const softDelete = useCallback(async (jobId, jobName) => {
    if (!window.confirm(`Delete "${jobName}"? It can be restored within 24 hours.`)) return
    const now = new Date().toISOString()
    const { error: err } = await supabase.from('jobs').update({ deleted: 'Yes', deleted_at: now }).eq('job_id', jobId)
    if (err) { console.error(err); return }
    setJobs(prev => prev.filter(j => j.job_id !== jobId))
    if (selectedJob && selectedJob.job_id === jobId) setSelectedJob(null)
  }, [selectedJob])

  /* ── restore bin ────────────────────────────────────────────── */

  const openBin = useCallback(async () => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data, error: err } = await supabase
      .from('jobs')
      .select('*')
      .eq('deleted', 'Yes')
      .gte('deleted_at', cutoff)
      .order('deleted_at', { ascending: false })
    if (err) { console.error(err); return }
    setDeletedJobs(data || [])
    setShowBin(true)
  }, [])

  const restoreJob = useCallback(async (jobId) => {
    const { error: err } = await supabase.from('jobs').update({ deleted: 'No', deleted_at: null }).eq('job_id', jobId)
    if (err) { console.error(err); return }
    setDeletedJobs(prev => prev.filter(j => j.job_id !== jobId))
    await loadData()
  }, [loadData])

  /* ── drill-down ─────────────────────────────────────────────── */

  const openJob = useCallback(async (job) => {
    setSelectedJob(job)
    setLoadingHistory(true)
    const { data, error: err } = await supabase
      .from('assignments')
      .select('crew_name, date')
      .eq('job_id', job.job_id)
      .order('date', { ascending: false })
    if (err) { console.error(err); setJobAssignments([]); }
    else { setJobAssignments(data || []) }
    setLoadingHistory(false)
  }, [])

  /* ── assignment history grouped by week ─────────────────────── */

  const weekGroups = useMemo(() => {
    if (!jobAssignments.length) return []
    const groups = {}
    for (const a of jobAssignments) {
      const mon = getMonday(new Date(a.date + 'T00:00:00'))
      const key = fmtD(mon)
      if (!groups[key]) groups[key] = {}
      if (!groups[key][a.crew_name]) groups[key][a.crew_name] = []
      groups[key][a.crew_name].push(a.date)
    }
    const sorted = Object.keys(groups).sort((a, b) => b.localeCompare(a))
    return sorted.map(monStr => {
      const mon = new Date(monStr + 'T00:00:00')
      const crewEntries = Object.entries(groups[monStr]).sort((a, b) => a[0].localeCompare(b[0]))
      return {
        monday: monStr,
        label: fmtWk(mon),
        crew: crewEntries.map(([name, dates]) => ({
          name,
          days: dayLabel(dates, mon),
        })),
      }
    })
  }, [jobAssignments])

  /* ── work type tags renderer ────────────────────────────────── */

  function renderTags(workType) {
    if (!workType) return null
    return workType.split(',').map(t => t.trim()).filter(Boolean).map(t => (
      <span key={t} className={`sch-tg ${gTagClass(t)}`}>{t}</span>
    ))
  }

  /* ── render ─────────────────────────────────────────────────── */

  if (loading) return <div className="jh-empty">Loading jobs...</div>
  if (error) return <div className="jh-empty">Error: {error}</div>

  /* ── drill-down view ────────────────────────────────────────── */

  if (selectedJob) {
    const j = selectedJob
    return (
      <div className="jh-wrap">
        <button className="jh-back" onClick={() => setSelectedJob(null)}>{'\u2190'} Back to Jobs</button>

        <div className="jh-hist-hdr">
          <div className="jh-hist-title">
            <span className="jh-hist-num">{j.job_num}</span>
            <span className="jh-hist-name">{j.job_name}</span>
          </div>
          <div className="jh-hist-tags">
            {renderTags(j.work_type)}
            {isPW(j) && <span className="pw-tag">PW</span>}
          </div>
          <div className="jh-hist-meta">
            {j.vehicle && <span>Vehicle: {j.vehicle}</span>}
            {j.start_date && <span>Start: {j.start_date}</span>}
            {j.end_date && <span>End: {j.end_date}</span>}
            {j.lead && <span>Lead: {j.lead}</span>}
          </div>
          <div className="jh-hist-actions">
            <select
              className="jh-status-sel"
              value={getJobStatus(j)}
              onChange={e => updateStatus(j.job_id, e.target.value)}
            >
              <option value="Ongoing">Ongoing</option>
              <option value="On Hold">On Hold</option>
              <option value="Complete">Complete</option>
            </select>
            {j.sow && (
              <a className="jh-sow-link" href={j.sow} target="_blank" rel="noopener noreferrer">SOW Link</a>
            )}
          </div>
        </div>

        <div className="jh-hist-section-title">Assignment History</div>

        {loadingHistory ? (
          <div className="jh-empty">Loading history...</div>
        ) : weekGroups.length === 0 ? (
          <div className="jh-empty">No crew assignments yet</div>
        ) : (
          <div className="jh-wk-list">
            {weekGroups.map(wk => (
              <div key={wk.monday} className="jh-wk-card">
                <div className="jh-wk-title">{wk.label}</div>
                <div className="jh-wk-crew">
                  {wk.crew.map(c => (
                    <span key={c.name} className="jh-wk-chip">
                      {flipName(c.name)} <span className="jh-wk-days">{c.days}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  /* ── main list view ─────────────────────────────────────────── */

  return (
    <div className="jh-wrap">
      {/* search bar */}
      <div className="jh-toolbar">
        <input
          className="jh-search"
          type="text"
          placeholder="Search all jobs by name, number, or work type..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* week nav — hidden when searching */}
      {!search.trim() && (
        <div className="jh-week-nav">
          <button className="jh-wk-btn" onClick={() => setWeekOffset(o => o - 1)}>Prev</button>
          <div className="jh-wk-label">{weekLabel}</div>
          <button className="jh-wk-btn" onClick={() => setWeekOffset(o => o + 1)}>Next</button>
          <button className="jh-wk-btn" onClick={() => setWeekOffset(0)}>This Week</button>
        </div>
      )}

      {/* scoreboard + bin */}
      <div className="jh-scores-row">
        <div className="jh-scores">
          <div className="jh-score og">
            <div className="jh-score-num">{ongoing.length}</div>
            <div className="jh-score-lbl">Ongoing</div>
          </div>
          <div className="jh-score oh">
            <div className="jh-score-num">{onHold.length}</div>
            <div className="jh-score-lbl">On Hold</div>
          </div>
          <div className="jh-score cp">
            <div className="jh-score-num">{complete.length}</div>
            <div className="jh-score-lbl">Complete</div>
          </div>
        </div>
        <button className="jh-bin-btn" onClick={openBin} title="View deleted jobs">{'\uD83D\uDDD1'} Bin</button>
      </div>

      {/* 3-column layout */}
      <div className="jh-cols">
        {/* Ongoing */}
        <div className="jh-col">
          <div className="jh-col-hdr og">Ongoing ({ongoing.length})</div>
          {ongoing.length === 0 && <div className="jh-empty">No ongoing jobs this week</div>}
          {ongoing.map(j => (
            <JobCard
              key={j.job_id}
              job={j}
              status="og"
              crewCount={weekCrewCounts[j.job_id] || 0}
              billingLog={billingLog}
              onOpen={() => openJob(j)}
              onStatusChange={updateStatus}
              onDelete={softDelete}
              renderTags={renderTags}
            />
          ))}
        </div>

        {/* On Hold */}
        <div className="jh-col">
          <div className="jh-col-hdr oh">On Hold ({onHold.length})</div>
          {onHold.length === 0 && <div className="jh-empty">None</div>}
          {onHold.map(j => (
            <JobCard
              key={j.job_id}
              job={j}
              status="oh"
              crewCount={weekCrewCounts[j.job_id] || 0}
              billingLog={billingLog}
              onOpen={() => openJob(j)}
              onStatusChange={updateStatus}
              onDelete={softDelete}
              renderTags={renderTags}
            />
          ))}
        </div>

        {/* Complete */}
        <div className="jh-col">
          <div className="jh-col-hdr cp">Complete ({complete.length})</div>
          {complete.length === 0 && <div className="jh-empty">None</div>}
          {complete.map(j => (
            <JobCard
              key={j.job_id}
              job={j}
              status="cp"
              crewCount={weekCrewCounts[j.job_id] || 0}
              billingLog={billingLog}
              onOpen={() => openJob(j)}
              onStatusChange={updateStatus}
              onDelete={softDelete}
              renderTags={renderTags}
            />
          ))}
        </div>
      </div>

      {/* Restore Bin Modal */}
      {showBin && (
        <div className="mbg" onClick={e => { if (e.target === e.currentTarget) setShowBin(false) }}>
          <div className="mdl">
            <h3>Restore Bin (last 24 hrs)</h3>
            {deletedJobs.length === 0 ? (
              <div className="jh-empty">No recently deleted jobs</div>
            ) : (
              <div className="jh-bin-list">
                {deletedJobs.map(j => (
                  <div key={j.job_id} className="jh-bin-row">
                    <span className="jh-bin-name">{j.job_num} - {j.job_name}</span>
                    <button className="jh-bin-restore" onClick={() => restoreJob(j.job_id)}>Restore</button>
                  </div>
                ))}
              </div>
            )}
            <div className="macts">
              <button className="app-act-btn" onClick={() => setShowBin(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── JobCard sub-component ───────────────────────────────────────── */

function JobCard({ job, status, crewCount, billingLog, onOpen, onStatusChange, onDelete, renderTags }) {
  const j = job
  const billedPct = j.partial_billing === 'Yes' ? getBilledToDate(billingLog, j.job_id) : null

  return (
    <div className={`jh-row${isPW(j) ? ' pw-row' : ''}`} onClick={onOpen}>
      <div className="jh-row-top">
        <span className={`jh-dot ${status}`} />
        <div className="jh-rinfo">
          <div className="jh-rname">{j.job_num} - {j.job_name}</div>
        </div>
        <span className="jh-rarrow">{'\u203A'}</span>
        <button
          className="jh-del-btn"
          title="Delete job"
          onClick={e => { e.stopPropagation(); onDelete(j.job_id, `${j.job_num} - ${j.job_name}`) }}
        >{'\uD83D\uDDD1'}</button>
      </div>
      <div className="jh-rmeta" style={{ marginLeft: 18 }}>
        {renderTags(j.work_type)}
        {isPW(j) && <span className="pw-tag">PW</span>}
        {j.partial_billing === 'Yes' && <span className="rtb-tag">RTB</span>}
        {j.no_bill === 'Yes' && <span className="nb-tag">NO BILL</span>}
      </div>
      {(crewCount > 0 || billedPct !== null) && (
        <div className="jh-rmeta-line" style={{ marginLeft: 18 }}>
          {crewCount > 0 && <span>{crewCount} crew this week</span>}
          {billedPct !== null && billedPct > 0 && <span style={{ color: '#0891b2', fontWeight: 600 }}>{Math.round(billedPct)}% billed</span>}
        </div>
      )}
      <div style={{ marginLeft: 18, marginTop: 4 }} onClick={e => e.stopPropagation()}>
        <select
          className="jh-status-sel"
          value={getJobStatus(j)}
          onChange={e => onStatusChange(j.job_id, e.target.value)}
        >
          <option value="Ongoing">Ongoing</option>
          <option value="On Hold">On Hold</option>
          <option value="Complete">Complete</option>
        </select>
      </div>
    </div>
  )
}
