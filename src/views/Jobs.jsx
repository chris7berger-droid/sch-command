import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadJobs } from '../lib/queries'
import PipelineTab from '../components/tabs/PipelineTab'
import JobsTabBar, { JOBS_TABS } from '../components/JobsTabBar'

/* ── helpers (shared with PipelineTab; kept here for shell-level filters) ── */

function fmtD(d) {
  const dt = d instanceof Date ? d : new Date(d)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function getMonday(d) {
  const dt = new Date(d)
  const day = dt.getDay()
  dt.setDate(dt.getDate() - (day === 0 ? 6 : day - 1))
  dt.setHours(0, 0, 0, 0)
  return dt
}

function getQuarterStart(d) {
  const dt = new Date(d)
  const q = Math.floor(dt.getMonth() / 3) * 3
  return new Date(dt.getFullYear(), q, 1)
}

function getQuarterEnd(d) {
  const dt = new Date(d)
  const q = Math.floor(dt.getMonth() / 3) * 3 + 2
  return new Date(dt.getFullYear(), q + 1, 0)
}

function getJobStatus(j) {
  if (!j || !j.status) return 'Ongoing'
  const s = j.status.toLowerCase().trim()
  if (s === 'parked') return 'Parked'
  if (s === 'scheduled') return 'Scheduled'
  if (s === 'in progress') return 'In Progress'
  if (s === 'on hold' || s === 'hold') return 'On Hold'
  if (s === 'complete' || s === 'completed' || s === 'done') return 'Complete'
  return 'Ongoing'
}

function effectiveStart(j) { return j.scheduled_start || j.start_date || null }
function effectiveEnd(j) { return j.scheduled_end || j.end_date || null }

function getBilledTotal(billingLog, jobId) {
  if (!billingLog || !billingLog.length) return 0
  return billingLog
    .filter(b => b.job_id === jobId)
    .reduce((sum, b) => sum + (parseFloat(b.percent) || 0), 0)
}

function daysBetween(dateStr, refDate) {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  const r = new Date(refDate)
  r.setHours(0, 0, 0, 0)
  return Math.ceil((d - r) / (1000 * 60 * 60 * 24))
}

function urgencyScore(job, billingLog, today) {
  const status = getJobStatus(job)
  let score = 0
  if (status === 'Parked') score = -5000
  else if (status === 'Scheduled' || status === 'In Progress' || status === 'Ongoing') score = 0
  else if (status === 'On Hold') score = 10000
  else score = 20000

  const endDate = effectiveEnd(job)
  if (endDate) {
    const daysLeft = daysBetween(endDate, today)
    if (daysLeft !== null) {
      if (daysLeft < 0) score -= 1000 + Math.abs(daysLeft)
      else score += daysLeft
    }
  } else {
    score += 5000
  }

  if (job.amount && parseFloat(job.amount) > 0 && job.no_bill !== 'Yes') {
    const billed = getBilledTotal(billingLog, job.job_id)
    if (billed === 0) score -= 500
  }

  return score
}

/* ── shell ───────────────────────────────────────────────────────── */

export default function Jobs() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab = JOBS_TABS.includes(tabParam) ? tabParam : 'pipeline'
  const setActiveTab = useCallback((next) => {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev)
      if (next === 'pipeline') params.delete('tab')
      else params.set('tab', next)
      return params
    })
  }, [setSearchParams])

  const [jobs, setJobs] = useState([])
  const [assignments, setAssignments] = useState([])
  const [billingLog, setBillingLog] = useState([])
  const [teamMembers, setTeamMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // shell-level filters drive both scoreboard and tab content
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('week')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  // restore bin
  const [showBin, setShowBin] = useState(false)
  const [deletedJobs, setDeletedJobs] = useState([])

  const today = useMemo(() => new Date(), [])

  const loadData = useCallback(async () => {
    setLoading(true)
    const [jobsRes, assignRes, billRes, tmRes] = await Promise.all([
      loadJobs(),
      supabase.from('assignments').select('*'),
      supabase.from('billing_log').select('*'),
      supabase.from('team_members').select('id, name, role').eq('active', true).order('name'),
    ])
    if (jobsRes.error) { setError(jobsRes.error.message); setLoading(false); return }
    setJobs(jobsRes.data || [])
    setAssignments(assignRes.data || [])
    setBillingLog(billRes.data || [])
    setTeamMembers(tmRes.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Realtime: reload when jobs table changes
  useEffect(() => {
    const channel = supabase
      .channel('jobs-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => {
        loadData()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadData])

  const dateRange = useMemo(() => {
    const now = new Date()
    switch (dateFilter) {
      case 'week': {
        const mon = getMonday(now)
        const fri = new Date(mon)
        fri.setDate(fri.getDate() + 4)
        return { from: fmtD(mon), to: fmtD(fri) }
      }
      case 'month': {
        const first = new Date(now.getFullYear(), now.getMonth(), 1)
        const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
        return { from: fmtD(first), to: fmtD(last) }
      }
      case 'quarter':
        return { from: fmtD(getQuarterStart(now)), to: fmtD(getQuarterEnd(now)) }
      case 'all':
        return null
      case 'custom':
        if (customFrom && customTo) return { from: customFrom, to: customTo }
        return null
      default:
        return null
    }
  }, [dateFilter, customFrom, customTo])

  // shell-filtered jobs (date + search) — tabs apply status filter on top
  const filteredJobs = useMemo(() => {
    let list = jobs

    if (dateRange) {
      list = list.filter(j => {
        if (getJobStatus(j) === 'Parked') return true
        const start = effectiveStart(j)
        const end = effectiveEnd(j)
        if (!start && !end) return true
        return (start || '1900-01-01') <= dateRange.to && (end || '2999-12-31') >= dateRange.from
      })
    }

    if (search.trim()) {
      const q = search.toLowerCase().trim()
      list = list.filter(j => {
        const num = (j.job_num || '').toLowerCase()
        const name = (j.job_name || '').toLowerCase()
        const wt = (j.work_type || '').toLowerCase()
        return num.includes(q) || name.includes(q) || wt.includes(q)
      })
    }

    list = [...list].sort((a, b) => urgencyScore(a, billingLog, today) - urgencyScore(b, billingLog, today))
    return list
  }, [jobs, search, dateRange, billingLog, today])

  // scoreboard buckets
  const parkedCount = useMemo(() => filteredJobs.filter(j => getJobStatus(j) === 'Parked').length, [filteredJobs])
  const activeCount = useMemo(() => filteredJobs.filter(j => {
    const s = getJobStatus(j)
    return s === 'Ongoing' || s === 'Scheduled' || s === 'In Progress'
  }).length, [filteredJobs])
  const onHoldCount = useMemo(() => filteredJobs.filter(j => getJobStatus(j) === 'On Hold').length, [filteredJobs])
  const completeCount = useMemo(() => filteredJobs.filter(j => getJobStatus(j) === 'Complete').length, [filteredJobs])

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

  /* ── render ─────────────────────────────────────────────────── */

  if (loading) return <div className="jh-empty">Loading jobs...</div>
  if (error) return <div className="jh-empty">Error: {error}</div>

  // Schedule + Ready to Bill tabs render their own dashboards — hide shell scoreboard
  // and shell filters to avoid visual doubling.
  const showShellChrome = activeTab === 'pipeline' || activeTab === 'active'

  const FILTER_OPTIONS = [
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: 'quarter', label: 'This Quarter' },
    { key: 'all', label: 'All Time' },
    { key: 'custom', label: 'Custom' },
  ]

  return (
    <div className="jh-wrap">
      {showShellChrome && (
        <>
          {/* search bar */}
          <div className="jh-toolbar">
            <input
              className="jh-search"
              type="text"
              placeholder="Search jobs by name, number, or work type..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* date filter */}
          <div className="jh-filter-bar">
            <div className="jh-filter-pills">
              {FILTER_OPTIONS.map(f => (
                <button
                  key={f.key}
                  className={`jh-filter-pill${dateFilter === f.key ? ' active' : ''}`}
                  onClick={() => setDateFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {dateFilter === 'custom' && (
              <div className="jh-custom-range">
                <input
                  type="date"
                  className="jh-date-input"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                />
                <span className="jh-range-sep">to</span>
                <input
                  type="date"
                  className="jh-date-input"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* scoreboard + bin */}
          <div className="jh-scores-row">
            <div className="jh-scores">
              {parkedCount > 0 && (
                <div className="jh-score pk">
                  <div className="jh-score-num">{parkedCount}</div>
                  <div className="jh-score-lbl">Parked</div>
                </div>
              )}
              <div className="jh-score og">
                <div className="jh-score-num">{activeCount}</div>
                <div className="jh-score-lbl">Active</div>
              </div>
              <div className="jh-score oh">
                <div className="jh-score-num">{onHoldCount}</div>
                <div className="jh-score-lbl">On Hold</div>
              </div>
              <div className="jh-score cp">
                <div className="jh-score-num">{completeCount}</div>
                <div className="jh-score-lbl">Complete</div>
              </div>
            </div>
            <button className="jh-bin-btn" onClick={openBin} title="View deleted jobs">{'🗑'} Bin</button>
          </div>
        </>
      )}

      <JobsTabBar active={activeTab} onChange={setActiveTab} />

      {/* tab body */}
      {activeTab === 'pipeline' && (
        <PipelineTab
          filteredJobs={filteredJobs}
          jobs={jobs}
          setJobs={setJobs}
          billingLog={billingLog}
          setBillingLog={setBillingLog}
          today={today}
          reload={loadData}
        />
      )}
      {activeTab === 'schedule' && <div className="jh-empty">Schedule view coming next.</div>}
      {activeTab === 'active' && <div className="jh-empty">Active jobs view coming next.</div>}
      {activeTab === 'ready-to-bill' && <div className="jh-empty">Ready to Bill view coming next.</div>}

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
