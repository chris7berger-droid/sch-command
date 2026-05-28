import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadJobs, loadAllRows, loadPRTsForCallLogIds, isReady } from '../lib/queries'
import JobsPicker from '../components/JobsPicker'
import JobCardList from '../components/JobCardList'
import StagedCardList from '../components/StagedCardList'
import OnHoldCardList from '../components/OnHoldCardList'
import { getJobStatus } from '../lib/jobStatus'

const VALID_TABS = ['staged', 'scheduled', 'active', 'on-hold', 'complete', 'all']
// Old/removed tab slugs redirect to their canonical destination.
// 'pipeline' is the old Parked-bucket tab; legacy bookmarks land on Scheduled.
const TAB_REDIRECTS = {
  pipeline: '/jobs?tab=scheduled',
  ready: '/schedule',
  schedule: '/schedule',
  billing: '/billing',
  'ready-to-bill': '/billing',
}

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
  // Plan §4 row 15(f): replace legacy "Parked → -5000" with a softer pin for
  // Scheduled jobs whose kickoff isn't imminent, so they still float to the top
  // of "All Jobs" without the old hard-pin semantic.
  let score = 0
  const startDate = effectiveStart(job)
  const startDaysFromNow = startDate ? daysBetween(startDate, today) : null
  if (status === 'Scheduled' && (startDaysFromNow === null || startDaysFromNow > 14)) {
    score = -2500
  } else if (status === 'Scheduled' || status === 'In Progress' || status === 'Ongoing') {
    score = 0
  } else if (status === 'On Hold') {
    score = 10000
  } else {
    score = 20000
  }

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
  const navigate = useNavigate()
  const tabParam = searchParams.get('tab')
  const redirectTo = tabParam && TAB_REDIRECTS[tabParam]
  const activeTab = !redirectTo && VALID_TABS.includes(tabParam) ? tabParam : null
  const showPicker = activeTab === null && !redirectTo

  useEffect(() => {
    if (redirectTo) navigate(redirectTo, { replace: true })
  }, [redirectTo, navigate])

  const setActiveTab = useCallback((next) => {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev)
      if (next === null) params.delete('tab')
      else params.set('tab', next)
      return params
    })
  }, [setSearchParams])

  const goToPicker = useCallback(() => setActiveTab(null), [setActiveTab])

  const [jobs, setJobs] = useState([])
  const [assignments, setAssignments] = useState([])
  const [billingLog, setBillingLog] = useState([])
  const [teamMembers, setTeamMembers] = useState([])
  const [jobCrew, setJobCrew] = useState([])
  const [materials, setMaterials] = useState([])
  const [prtMap, setPrtMap] = useState(new Map())
  const [syncWarning, setSyncWarning] = useState(null)
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

  const crewByCallLog = useMemo(() => jobCrew.reduce((m, r) => {
    (m[r.job_id] ||= []).push(r); return m
  }, {}), [jobCrew])

  const matsByJobId = useMemo(() => materials.reduce((m, r) => {
    (m[r.job_id] ||= []).push(r); return m
  }, {}), [materials])

  const loadData = useCallback(async () => {
    setLoading(true)
    const [jobsRes, assignRes, billRes, tmRes, crewRes, matsRes] = await Promise.all([
      loadJobs({ withWTCs: true }),
      supabase.from('assignments').select('*'),
      supabase.from('billing_log').select('*'),
      supabase.from('team_members').select('id, name, role').eq('active', true).order('name'),
      loadAllRows('job_crew', 'id, job_id, team_member_id', { orderBy: 'id' }),
      loadAllRows('materials', 'id, job_id, status', { orderBy: 'id' }),
    ])
    if (jobsRes.error) { setError(jobsRes.error.message); setLoading(false); return }
    setJobs(jobsRes.data || [])
    setAssignments(assignRes.data || [])
    setBillingLog(billRes.data || [])
    setTeamMembers(tmRes.data || [])
    setJobCrew(crewRes.data || [])
    setMaterials(matsRes.data || [])
    setSyncWarning(crewRes.partial || matsRes.partial ? 'Counts may be stale — partial data loaded' : null)

    const loadedJobs = jobsRes.data || []
    const activeCallLogIds = loadedJobs
      .filter(j => j.status === 'In Progress' || j.status === 'Ongoing')
      .map(j => j.call_log_id)
      .filter(Boolean)
    if (activeCallLogIds.length > 0) {
      const prtRes = await loadPRTsForCallLogIds(activeCallLogIds)
      setPrtMap(prtRes.data)
    } else {
      setPrtMap(new Map())
    }

    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Realtime: reload on jobs, job_crew, or materials changes.
  // 300ms debounce so bulk imports (CSV of 500 materials) don't freeze the tab.
  useEffect(() => {
    let timer = null
    const debouncedLoad = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => loadData(), 300)
    }
    const channels = [
      supabase.channel('jobs-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, debouncedLoad)
        .subscribe(),
      supabase.channel('job-crew-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'job_crew' }, debouncedLoad)
        .subscribe(),
      supabase.channel('materials-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'materials' }, debouncedLoad)
        .subscribe(),
    ]
    return () => {
      if (timer) clearTimeout(timer)
      channels.forEach(c => supabase.removeChannel(c))
    }
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

  // scoreboard buckets (Parked is gone — legacy Parked rows normalize to Scheduled)
  const scheduledCount = useMemo(() => filteredJobs.filter(j => getJobStatus(j) === 'Scheduled').length, [filteredJobs])
  const activeCount = useMemo(() => filteredJobs.filter(j => {
    const s = getJobStatus(j)
    return s === 'Ongoing' || s === 'In Progress'
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

  // Picker has its own layout — hide shell chrome on landing.
  const showShellChrome = activeTab !== null

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

          <div className="jh-scores-row">
            <div className="jh-scores">
              <div className="jh-score og">
                <div className="jh-score-num">{scheduledCount}</div>
                <div className="jh-score-lbl">Scheduled</div>
              </div>
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

      {showPicker && (
        <JobsPicker jobs={jobs} assignments={assignments} billingLog={billingLog} crewByCallLog={crewByCallLog} matsByJobId={matsByJobId} syncWarning={syncWarning} today={today} onPick={setActiveTab} />
      )}

      {!showPicker && (
        <>
          <div className="jh-back-bar">
            <button className="jh-back-btn" onClick={goToPicker}>← All stages</button>
            <span className="jh-back-context">
              Viewing <b>{
                activeTab === 'staged' ? 'Staged' :
                activeTab === 'scheduled' ? 'Ready' :
                activeTab === 'active' ? 'Active' :
                activeTab === 'on-hold' ? 'On Hold' :
                activeTab === 'complete' ? 'Production Complete' :
                activeTab === 'all' ? 'All Jobs' : ''
              }</b>
            </span>
          </div>

          {activeTab === 'staged' && (
            <StagedCardList
              jobs={filteredJobs.filter(j => getJobStatus(j) === 'Scheduled' && !isReady(j, crewByCallLog, matsByJobId))}
              crewByCallLog={crewByCallLog}
              matsByJobId={matsByJobId}
              billingLog={billingLog}
              today={today}
              onJobUpdate={loadData}
              emptyText="No staged jobs in this date range"
            />
          )}
          {activeTab === 'scheduled' && (
            <StagedCardList
              jobs={filteredJobs.filter(j => getJobStatus(j) === 'Scheduled' && isReady(j, crewByCallLog, matsByJobId))}
              stage="ready"
              crewByCallLog={crewByCallLog}
              matsByJobId={matsByJobId}
              billingLog={billingLog}
              today={today}
              onJobUpdate={loadData}
              emptyText="No ready jobs in this date range"
            />
          )}
          {activeTab === 'active' && (
            <StagedCardList
              jobs={filteredJobs.filter(j => {
                const s = getJobStatus(j)
                return s === 'In Progress' || s === 'Ongoing'
              })}
              stage="active"
              crewByCallLog={crewByCallLog}
              matsByJobId={matsByJobId}
              billingLog={billingLog}
              prtMap={prtMap}
              today={today}
              onJobUpdate={loadData}
              emptyText="No active jobs in this date range"
            />
          )}
          {activeTab === 'on-hold' && (
            <OnHoldCardList
              filteredJobs={filteredJobs}
              jobs={jobs}
              setJobs={setJobs}
              billingLog={billingLog}
              setBillingLog={setBillingLog}
              today={today}
              crewByCallLog={crewByCallLog}
              matsByJobId={matsByJobId}
              prtMap={prtMap}
              onJobUpdate={loadData}
            />
          )}
          {activeTab === 'complete' && (
            <StagedCardList
              jobs={filteredJobs.filter(j => getJobStatus(j) === 'Complete')}
              stage="complete"
              crewByCallLog={crewByCallLog}
              matsByJobId={matsByJobId}
              billingLog={billingLog}
              today={today}
              onJobUpdate={loadData}
              emptyText="No production-complete jobs in this date range"
            />
          )}
          {activeTab === 'all' && (
            <JobCardList
              jobs={filteredJobs}
              allJobs={jobs}
              setJobs={setJobs}
              billingLog={billingLog}
              setBillingLog={setBillingLog}
              today={today}
              emptyText="No jobs match the current filters"
            />
          )}
        </>
      )}

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
