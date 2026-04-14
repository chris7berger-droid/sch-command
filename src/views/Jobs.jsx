import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadJobs, updateJobField, updateJobFields, updateCallLogStage } from '../lib/queries'
import FieldSowModal from '../components/FieldSowModal'

/* ── helpers ─────────────────────────────────────────────────────── */

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

function isPW(j) {
  return j && (j.prevailing_wage === 'Yes' || j.prevailing_wage === true)
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

// Effective start/end: prefer scheduled dates, fall back to legacy
function effectiveStart(j) { return j.scheduled_start || j.start_date || null }
function effectiveEnd(j) { return j.scheduled_end || j.end_date || null }

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

function fmtMoney(n) {
  if (n == null || n === '' || isNaN(n)) return '-'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function flipName(n) {
  if (!n) return ''
  const p = n.split(',')
  return p.length === 2 ? p[1].trim() + ' ' + p[0].trim() : n
}

const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const WEEKDAY_ORDER = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtWk(monday) {
  const mon = monday instanceof Date ? monday : new Date(monday + 'T00:00:00')
  const fri = new Date(mon)
  fri.setDate(mon.getDate() + 4)
  return `${MONTHS[mon.getMonth()]} ${mon.getDate()} \u2013 ${MONTHS[fri.getMonth()]} ${fri.getDate()}, ${fri.getFullYear()}`
}

function dayLabel(dates, mondayOfWeek) {
  if (!dates || dates.length === 0) return ''
  const labels = dates.map(ds => DAY_NAMES[new Date(ds + 'T00:00:00').getDay()])
  const unique = [...new Set(labels)]
  const sorted = unique.sort((a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b))
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

/* ── flags ───────────────────────────────────────────────────────── */

function getJobFlags(job, billingLog, today) {
  const flags = []
  const status = getJobStatus(job)

  // Overdue: active job past end_date
  const endDate = effectiveEnd(job)
  if ((status === 'Ongoing' || status === 'Scheduled' || status === 'In Progress') && endDate) {
    const daysLeft = daysBetween(endDate, today)
    if (daysLeft !== null && daysLeft < 0) flags.push('OVERDUE')
  }

  // Unbilled: has amount, no billing log entries, not no_bill
  if (status !== 'Complete' && job.amount && parseFloat(job.amount) > 0 && job.no_bill !== 'Yes') {
    const billed = getBilledTotal(billingLog, job.job_id)
    if (billed === 0) flags.push('UNBILLED')
  }

  // Ready to Invoice: partial billing, not paused, has amount
  if (job.partial_billing === 'Yes' && job.billing_paused !== 'Yes' && job.amount && parseFloat(job.amount) > 0) {
    const billed = getBilledTotal(billingLog, job.job_id)
    if (billed < 100) flags.push('READY TO INVOICE')
  }

  return flags
}

/* ── urgency score (lower = more urgent) ─────────────────────────── */

function urgencyScore(job, billingLog, today) {
  const status = getJobStatus(job)
  let score = 0

  // Status weight: Parked first, then active, On Hold, Complete last
  if (status === 'Parked') score = -5000
  else if (status === 'Scheduled' || status === 'In Progress' || status === 'Ongoing') score = 0
  else if (status === 'On Hold') score = 10000
  else score = 20000

  // Days until end date: overdue jobs float to top
  const endDate = effectiveEnd(job)
  if (endDate) {
    const daysLeft = daysBetween(endDate, today)
    if (daysLeft !== null) {
      if (daysLeft < 0) score -= 1000 + Math.abs(daysLeft) // overdue = highest urgency
      else score += daysLeft
    }
  } else {
    score += 5000 // no end date = low urgency
  }

  // Unbilled flag adds urgency
  if (job.amount && parseFloat(job.amount) > 0 && job.no_bill !== 'Yes') {
    const billed = getBilledTotal(billingLog, job.job_id)
    if (billed === 0) score -= 500
  }

  return score
}

/* ── main component ──────────────────────────────────────────────── */

export default function Jobs() {
  const navigate = useNavigate()
  const [jobs, setJobs] = useState([])
  const [assignments, setAssignments] = useState([])
  const [billingLog, setBillingLog] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // search
  const [search, setSearch] = useState('')

  // date filter
  const [dateFilter, setDateFilter] = useState('week')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  // expanded job
  const [expandedId, setExpandedId] = useState(null)
  const [jobAssignments, setJobAssignments] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [pctInput, setPctInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [amountInput, setAmountInput] = useState('')
  const [savingAmount, setSavingAmount] = useState(false)

  // restore bin
  const [showBin, setShowBin] = useState(false)
  const [deletedJobs, setDeletedJobs] = useState([])

  // field sow modal
  const [sowJob, setSowJob] = useState(null)

  // field crew assignment
  const [teamMembers, setTeamMembers] = useState([])
  const [fieldCrew, setFieldCrew] = useState([])
  const [crewLoading, setCrewLoading] = useState(false)

  const today = useMemo(() => new Date(), [])

  /* ── data fetch ─────────────────────────────────────────────── */

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

  /* ── date range from filter ────────────────────────────────── */

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
      case 'quarter': {
        return { from: fmtD(getQuarterStart(now)), to: fmtD(getQuarterEnd(now)) }
      }
      case 'all':
        return null
      case 'custom':
        if (customFrom && customTo) return { from: customFrom, to: customTo }
        return null
      default:
        return null
    }
  }, [dateFilter, customFrom, customTo])

  /* ── filter jobs ────────────────────────────────────────────── */

  const filteredJobs = useMemo(() => {
    let list = jobs

    // date range filter (using scheduled dates, falling back to legacy)
    // Parked jobs always pass — they're incoming work that needs attention
    if (dateRange) {
      list = list.filter(j => {
        if (getJobStatus(j) === 'Parked') return true
        const start = effectiveStart(j)
        const end = effectiveEnd(j)
        if (!start && !end) return true
        return (start || '1900-01-01') <= dateRange.to && (end || '2999-12-31') >= dateRange.from
      })
    }

    // search filter
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      list = list.filter(j => {
        const num = (j.job_num || '').toLowerCase()
        const name = (j.job_name || '').toLowerCase()
        const wt = (j.work_type || '').toLowerCase()
        return num.includes(q) || name.includes(q) || wt.includes(q)
      })
    }

    // sort by urgency
    list = [...list].sort((a, b) => urgencyScore(a, billingLog, today) - urgencyScore(b, billingLog, today))

    return list
  }, [jobs, search, dateRange, billingLog, today])

  /* ── buckets (counts for scoreboards) ──────────────────────── */

  const parked = useMemo(() => filteredJobs.filter(j => getJobStatus(j) === 'Parked'), [filteredJobs])
  const activeJobs = useMemo(() => filteredJobs.filter(j => {
    const s = getJobStatus(j)
    return s === 'Ongoing' || s === 'Scheduled' || s === 'In Progress'
  }), [filteredJobs])
  const onHold = useMemo(() => filteredJobs.filter(j => getJobStatus(j) === 'On Hold'), [filteredJobs])
  const complete = useMemo(() => filteredJobs.filter(j => getJobStatus(j) === 'Complete'), [filteredJobs])
  // Main list excludes parked (they get their own section)
  const mainList = useMemo(() => filteredJobs.filter(j => getJobStatus(j) !== 'Parked'), [filteredJobs])

  /* ── status update ──────────────────────────────────────────── */

  const updateStatus = useCallback(async (jobId, newStatus) => {
    const job = jobs.find(j => j.job_id === jobId)
    const changedBy = 'schedule_user' // TODO: replace with actual user name from auth context
    const { error: err } = await updateJobField(jobId, 'status', newStatus, changedBy)
    if (err) { console.error(err); return }
    // sync call_log.stage for linked jobs
    if (job?.call_log_id) {
      const stageMap = { 'Scheduled': 'Scheduled', 'In Progress': 'In Progress', 'Complete': 'Complete' }
      if (stageMap[newStatus]) {
        await updateCallLogStage(job.call_log_id, stageMap[newStatus], changedBy)
      }
    }
    setJobs(prev => prev.map(j => j.job_id === jobId ? { ...j, status: newStatus } : j))
  }, [jobs])

  /* ── soft delete ────────────────────────────────────────────── */

  const softDelete = useCallback(async (jobId, jobName) => {
    if (!window.confirm(`Delete "${jobName}"? It can be restored within 24 hours.`)) return
    const now = new Date().toISOString()
    const { error: err } = await updateJobFields(jobId, { deleted: 'Yes', deleted_at: now }, 'schedule_user')
    if (err) { console.error(err); return }
    setJobs(prev => prev.filter(j => j.job_id !== jobId))
    if (expandedId === jobId) setExpandedId(null)
  }, [expandedId])

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

  /* ── field crew assignment ───────────────────────────────────── */

  const loadFieldCrew = useCallback(async (jobId) => {
    setCrewLoading(true)
    const { data, error: err } = await supabase
      .from('job_crew')
      .select('id, team_member_id, role, team_members(name)')
      .eq('job_id', jobId)
    if (err) { console.error(err); setFieldCrew([]) }
    else { setFieldCrew(data || []) }
    setCrewLoading(false)
  }, [])

  const assignFieldCrew = useCallback(async (jobId, memberId) => {
    const { error: err } = await supabase
      .from('job_crew')
      .insert({ job_id: jobId, team_member_id: memberId, role: 'crew' })
    if (err) { console.error(err); return }
    await loadFieldCrew(jobId)
  }, [loadFieldCrew])

  const removeFieldCrew = useCallback(async (rowId, jobId) => {
    const { error: err } = await supabase.from('job_crew').delete().eq('id', rowId)
    if (err) { console.error(err); return }
    await loadFieldCrew(jobId)
  }, [loadFieldCrew])

  const toggleFieldCrewRole = useCallback(async (rowId, currentRole, jobId) => {
    const newRole = currentRole === 'lead' ? 'crew' : 'lead'
    const { error: err } = await supabase.from('job_crew').update({ role: newRole }).eq('id', rowId)
    if (err) { console.error(err); return }
    await loadFieldCrew(jobId)
  }, [loadFieldCrew])

  /* ── expand / collapse ──────────────────────────────────────── */

  const toggleExpand = useCallback(async (job) => {
    if (expandedId === job.job_id) {
      setExpandedId(null)
      return
    }
    setExpandedId(job.job_id)
    setPctInput('')
    setAmountInput(job.amount != null && job.amount !== '' ? String(job.amount) : '')
    setLoadingHistory(true)
    const [assignRes] = await Promise.all([
      supabase
        .from('assignments')
        .select('crew_name, date')
        .eq('job_id', job.job_id)
        .order('date', { ascending: false }),
      loadFieldCrew(job.job_id),
    ])
    if (assignRes.error) { console.error(assignRes.error); setJobAssignments([]) }
    else { setJobAssignments(assignRes.data || []) }
    setLoadingHistory(false)
  }, [expandedId, loadFieldCrew])

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

  /* ── add to bill list ───────────────────────────────────────── */

  const addToBillList = useCallback(async (job) => {
    const pct = parseFloat(pctInput)
    if (isNaN(pct) || pct <= 0 || pct > 100) {
      alert('Enter a valid percent (1-100)')
      return
    }
    setSaving(true)
    const existing = getBilledTotal(billingLog, job.job_id)
    const { error: err } = await supabase.from('billing_log').insert({
      job_id: job.job_id,
      date: fmtD(new Date()),
      percent: pct,
      cumulative_percent: existing + pct,
      type: 'partial',
      notes: '',
      invoiced: 'No',
    })
    if (err) { console.error(err); setSaving(false); return }
    // refresh billing log
    const { data } = await supabase.from('billing_log').select('*')
    if (data) setBillingLog(data)
    setPctInput('')
    setSaving(false)
  }, [pctInput, billingLog])

  /* ── save contract amount ──────────────────────────────────── */

  const saveAmount = useCallback(async (jobId) => {
    const val = amountInput.trim() === '' ? null : parseFloat(amountInput)
    if (amountInput.trim() !== '' && (isNaN(val) || val < 0)) {
      alert('Enter a valid dollar amount')
      return
    }
    setSavingAmount(true)
    const { error: err } = await updateJobField(jobId, 'amount', val, 'schedule_user')
    if (err) { console.error(err); setSavingAmount(false); return }
    setJobs(prev => prev.map(j => j.job_id === jobId ? { ...j, amount: val } : j))
    setSavingAmount(false)
  }, [amountInput])

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

  const FILTER_OPTIONS = [
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: 'quarter', label: 'This Quarter' },
    { key: 'all', label: 'All Time' },
    { key: 'custom', label: 'Custom' },
  ]

  return (
    <div className="jh-wrap">
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
          {parked.length > 0 && (
            <div className="jh-score pk">
              <div className="jh-score-num">{parked.length}</div>
              <div className="jh-score-lbl">Parked</div>
            </div>
          )}
          <div className="jh-score og">
            <div className="jh-score-num">{activeJobs.length}</div>
            <div className="jh-score-lbl">Active</div>
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

      {/* parked / incoming jobs section */}
      {parked.length > 0 && (
        <div className="jh-parked-section">
          <div className="jh-parked-header">INCOMING JOBS</div>
          <div className="jh-list">
            {parked.map(j => {
              const isExpanded = expandedId === j.job_id
              return (
                <div key={j.job_id} className={`jh-card parked${isExpanded ? ' expanded' : ''}`}>
                  <div className="jh-card-hdr" onClick={() => toggleExpand(j)}>
                    <div className="jh-card-left">
                      <span className="jh-status-badge pk">Parked</span>
                      <div className="jh-card-title">
                        <span className="jh-card-num">{j.job_num}</span>
                        <span className="jh-card-name">{j.job_name}</span>
                      </div>
                    </div>
                    <div className="jh-card-right">
                      <span className="jh-expand-arrow">{isExpanded ? '\u25B2' : '\u25BC'}</span>
                    </div>
                  </div>
                  <div className="jh-card-body" onClick={() => toggleExpand(j)}>
                    <div className="jh-card-tags">
                      {renderTags(j.work_type)}
                      {isPW(j) && <span className="pw-tag">PW</span>}
                    </div>
                    <div className="jh-card-meta">
                      <span className="jh-parked-dates">
                        {effectiveStart(j) || '?'} → {effectiveEnd(j) || '?'}
                      </span>
                      {j.amount && parseFloat(j.amount) > 0 && (
                        <span className="jh-money">{fmtMoney(j.amount)}</span>
                      )}
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="jh-card-detail">
                      <div className="jh-parked-form" onClick={e => e.stopPropagation()}>
                        <div className="jh-detail-grid">
                          <div className="jh-detail-item">
                            <span className="jh-detail-label">Start</span>
                            <input
                              type="date"
                              className="jh-date-input"
                              value={effectiveStart(j) || ''}
                              onChange={async e => {
                                await updateJobField(j.job_id, 'scheduled_start', e.target.value || null, 'schedule_user')
                                setJobs(prev => prev.map(x => x.job_id === j.job_id ? { ...x, scheduled_start: e.target.value } : x))
                              }}
                            />
                          </div>
                          <div className="jh-detail-item">
                            <span className="jh-detail-label">End</span>
                            <input
                              type="date"
                              className="jh-date-input"
                              value={effectiveEnd(j) || ''}
                              onChange={async e => {
                                await updateJobField(j.job_id, 'scheduled_end', e.target.value || null, 'schedule_user')
                                setJobs(prev => prev.map(x => x.job_id === j.job_id ? { ...x, scheduled_end: e.target.value } : x))
                              }}
                            />
                          </div>
                          <div className="jh-detail-item">
                            <span className="jh-detail-label">Crew Needed</span>
                            <input
                              type="number"
                              className="jh-amount-input"
                              placeholder="0"
                              defaultValue={j.crew_needed || ''}
                              onBlur={async e => {
                                await updateJobField(j.job_id, 'crew_needed', e.target.value || null, 'schedule_user')
                                setJobs(prev => prev.map(x => x.job_id === j.job_id ? { ...x, crew_needed: e.target.value } : x))
                              }}
                            />
                          </div>
                          <div className="jh-detail-item">
                            <span className="jh-detail-label">Lead</span>
                            <input
                              type="text"
                              className="jh-amount-input"
                              placeholder="Crew lead"
                              defaultValue={j.lead || ''}
                              onBlur={async e => {
                                await updateJobField(j.job_id, 'lead', e.target.value || null, 'schedule_user')
                                setJobs(prev => prev.map(x => x.job_id === j.job_id ? { ...x, lead: e.target.value } : x))
                              }}
                            />
                          </div>
                        </div>
                        {/* field crew assignment */}
                        <div className="jh-field-crew">
                          <div className="jh-field-crew-title">Field Crew</div>
                          {crewLoading ? (
                            <div className="jh-empty">Loading...</div>
                          ) : (
                            <>
                              {fieldCrew.length > 0 && (
                                <div className="jh-field-crew-list">
                                  {fieldCrew.map(fc => (
                                    <div key={fc.id} className="jh-fc-chip">
                                      <span
                                        className={`jh-fc-role${fc.role === 'lead' ? ' lead' : ''}`}
                                        onClick={e => { e.stopPropagation(); toggleFieldCrewRole(fc.id, fc.role, j.job_id) }}
                                      >
                                        {fc.role === 'lead' ? 'L' : 'C'}
                                      </span>
                                      <span className="jh-fc-name">{fc.team_members?.name || '?'}</span>
                                      <button
                                        className="jh-fc-remove"
                                        onClick={e => { e.stopPropagation(); removeFieldCrew(fc.id, j.job_id) }}
                                      >×</button>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <select
                                className="jh-fc-select"
                                value=""
                                onChange={e => { if (e.target.value) assignFieldCrew(j.job_id, e.target.value) }}
                              >
                                <option value="">+ Assign crew member...</option>
                                {teamMembers
                                  .filter(tm => !fieldCrew.some(fc => fc.team_member_id === tm.id))
                                  .map(tm => (
                                    <option key={tm.id} value={tm.id}>{tm.name} ({tm.role})</option>
                                  ))
                                }
                              </select>
                            </>
                          )}
                        </div>
                        <button
                          className="jh-confirm-btn"
                          onClick={async () => {
                            await updateJobField(j.job_id, 'status', 'Scheduled', 'schedule_user')
                            if (j.call_log_id) {
                              await updateCallLogStage(j.call_log_id, 'Scheduled', 'schedule_user')
                            }
                            setJobs(prev => prev.map(x => x.job_id === j.job_id ? { ...x, status: 'Scheduled' } : x))
                            setExpandedId(null)
                          }}
                        >
                          Confirm &amp; Schedule
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* main job list (excludes parked) */}
      <div className="jh-list">
        {mainList.length === 0 && <div className="jh-empty">No jobs match this filter</div>}
        {mainList.map(j => {
          const status = getJobStatus(j)
          const statusClass = status === 'Ongoing' || status === 'Scheduled' || status === 'In Progress' ? 'og' : status === 'On Hold' ? 'oh' : 'cp'
          const billedPct = getBilledTotal(billingLog, j.job_id)
          const amount = j.amount ? parseFloat(j.amount) : 0
          const billedAmt = amount > 0 ? Math.round(amount * billedPct / 100) : 0
          const daysLeft = daysBetween(effectiveEnd(j), today)
          const flags = getJobFlags(j, billingLog, today)
          const isExpanded = expandedId === j.job_id

          return (
            <div key={j.job_id} className={`jh-card${isPW(j) ? ' pw-row' : ''}${isExpanded ? ' expanded' : ''}`}>
              {/* card header — always visible */}
              <div className="jh-card-hdr" onClick={() => toggleExpand(j)}>
                <div className="jh-card-left">
                  <span className={`jh-status-badge ${statusClass}`}>{status}</span>
                  <div className="jh-card-title">
                    <span className="jh-card-num">{j.job_num}</span>
                    <span className="jh-card-name">{j.job_name}</span>
                  </div>
                </div>
                <div className="jh-card-right">
                  {/* days until end */}
                  {daysLeft !== null && status !== 'Complete' && (
                    <span className={`jh-days${daysLeft < 0 ? ' overdue' : daysLeft <= 7 ? ' soon' : ''}`}>
                      {daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`}
                    </span>
                  )}
                  <span className="jh-expand-arrow">{isExpanded ? '\u25B2' : '\u25BC'}</span>
                </div>
              </div>

              {/* card body — always visible */}
              <div className="jh-card-body" onClick={() => toggleExpand(j)}>
                <div className="jh-card-tags">
                  {renderTags(j.work_type)}
                  {isPW(j) && <span className="pw-tag">PW</span>}
                  {j.no_bill === 'Yes' && <span className="nb-tag">NO BILL</span>}
                </div>

                {/* progress bar */}
                {amount > 0 && j.no_bill !== 'Yes' && (
                  <div className="jh-progress-row">
                    <div className="jh-progress-bar">
                      <div
                        className={`jh-progress-fill${billedPct >= 100 ? ' done' : ''}`}
                        style={{ width: `${Math.min(billedPct, 100)}%` }}
                      />
                    </div>
                    <span className={`jh-progress-lbl${billedPct >= 100 ? ' done' : ''}`}>
                      {Math.round(billedPct)}%
                    </span>
                  </div>
                )}

                {/* money + flags */}
                <div className="jh-card-meta">
                  {amount > 0 && (
                    <span className="jh-money">
                      {fmtMoney(billedAmt)} / {fmtMoney(amount)}
                    </span>
                  )}
                  {flags.map(f => (
                    <span key={f} className={`jh-flag ${f === 'OVERDUE' ? 'flag-red' : f === 'UNBILLED' ? 'flag-orange' : 'flag-cyan'}`}>
                      {f}
                    </span>
                  ))}
                </div>
              </div>

              {/* expanded detail */}
              {isExpanded && (
                <div className="jh-card-detail">
                  <div className="jh-detail-grid">
                    <div className="jh-detail-item">
                      <span className="jh-detail-label">Start</span>
                      <span className="jh-detail-value">{effectiveStart(j) || '-'}</span>
                    </div>
                    <div className="jh-detail-item">
                      <span className="jh-detail-label">End</span>
                      <span className="jh-detail-value">{effectiveEnd(j) || '-'}</span>
                    </div>
                    <div className="jh-detail-item">
                      <span className="jh-detail-label">Lead</span>
                      <span className="jh-detail-value">{j.lead || '-'}</span>
                    </div>
                    <div className="jh-detail-item">
                      <span className="jh-detail-label">Crew Needed</span>
                      <span className="jh-detail-value">{j.crew_needed || '-'}</span>
                    </div>
                    <div className="jh-detail-item">
                      <span className="jh-detail-label">Vehicle</span>
                      <span className="jh-detail-value">{j.vehicle || '-'}</span>
                    </div>
                    <div className="jh-detail-item">
                      <span className="jh-detail-label">Equipment</span>
                      <span className="jh-detail-value">{j.equipment || '-'}</span>
                    </div>
                    <div className="jh-detail-item">
                      <span className="jh-detail-label">Power Source</span>
                      <span className="jh-detail-value">{j.power_source || '-'}</span>
                    </div>
                    <div className="jh-detail-item">
                      <span className="jh-detail-label">Contract</span>
                      <div className="jh-amount-edit" onClick={e => e.stopPropagation()}>
                        <span className="jh-amount-dollar">$</span>
                        <input
                          type="number"
                          className="jh-amount-input"
                          placeholder="0"
                          value={amountInput}
                          onChange={e => setAmountInput(e.target.value)}
                        />
                        <button
                          className="jh-amount-save"
                          disabled={savingAmount}
                          onClick={() => saveAmount(j.job_id)}
                        >
                          {savingAmount ? '...' : 'Save'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {j.notes && (
                    <div className="jh-detail-notes">
                      <span className="jh-detail-label">Notes</span>
                      <p>{j.notes}</p>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    {j.sow && (
                      <a className="jh-sow-link" href={j.sow} target="_blank" rel="noopener noreferrer" style={{ marginBottom: 0 }}>SOW Link</a>
                    )}
                    {j.field_sow && j.field_sow.length > 0 && (
                      <button
                        className="jh-sow-link"
                        style={{ marginBottom: 0 }}
                        onClick={e => { e.stopPropagation(); setSowJob(j) }}
                      >
                        Field SOW
                      </button>
                    )}
                  </div>

                  {/* field crew assignment */}
                  <div className="jh-field-crew">
                    <div className="jh-field-crew-title">Field Crew</div>
                    {crewLoading ? (
                      <div className="jh-empty">Loading...</div>
                    ) : (
                      <>
                        {fieldCrew.length > 0 && (
                          <div className="jh-field-crew-list">
                            {fieldCrew.map(fc => (
                              <div key={fc.id} className="jh-fc-chip">
                                <span
                                  className={`jh-fc-role${fc.role === 'lead' ? ' lead' : ''}`}
                                  title={fc.role === 'lead' ? 'Job Lead — click to change to Crew' : 'Crew — click to change to Lead'}
                                  onClick={e => { e.stopPropagation(); toggleFieldCrewRole(fc.id, fc.role, j.job_id) }}
                                >
                                  {fc.role === 'lead' ? 'L' : 'C'}
                                </span>
                                <span className="jh-fc-name">{fc.team_members?.name || '?'}</span>
                                <button
                                  className="jh-fc-remove"
                                  title="Remove from job"
                                  onClick={e => { e.stopPropagation(); removeFieldCrew(fc.id, j.job_id) }}
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="jh-fc-add" onClick={e => e.stopPropagation()}>
                          <select
                            className="jh-fc-select"
                            value=""
                            onChange={e => { if (e.target.value) assignFieldCrew(j.job_id, e.target.value) }}
                          >
                            <option value="">+ Assign crew member...</option>
                            {teamMembers
                              .filter(tm => !fieldCrew.some(fc => fc.team_member_id === tm.id))
                              .map(tm => (
                                <option key={tm.id} value={tm.id}>{tm.name} ({tm.role})</option>
                              ))
                            }
                          </select>
                        </div>
                      </>
                    )}
                  </div>

                  {/* status + actions */}
                  <div className="jh-detail-actions">
                    <select
                      className="jh-status-sel"
                      value={j.status || 'Ongoing'}
                      onChange={e => updateStatus(j.job_id, e.target.value)}
                      onClick={e => e.stopPropagation()}
                    >
                      <option value="Scheduled">Scheduled</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Ongoing">Ongoing</option>
                      <option value="On Hold">On Hold</option>
                      <option value="Complete">Complete</option>
                    </select>

                    {/* % complete + add to bill list */}
                    {amount > 0 && j.no_bill !== 'Yes' && (
                      <div className="jh-bill-action">
                        <input
                          type="number"
                          className="jh-pct-input"
                          placeholder="% to bill"
                          min="1"
                          max="100"
                          value={pctInput}
                          onChange={e => setPctInput(e.target.value)}
                          onClick={e => e.stopPropagation()}
                        />
                        <button
                          className="jh-bill-btn"
                          disabled={saving}
                          onClick={e => { e.stopPropagation(); addToBillList(j) }}
                        >
                          {saving ? 'Saving...' : 'Add to Bill List'}
                        </button>
                      </div>
                    )}

                    <button
                      className="jh-view-btn"
                      onClick={e => { e.stopPropagation(); navigate(`/jobs/${j.job_id}`) }}
                    >
                      View Detail
                    </button>
                    <button
                      className="jh-del-btn"
                      onClick={e => { e.stopPropagation(); softDelete(j.job_id, `${j.job_num} - ${j.job_name}`) }}
                    >
                      {'\uD83D\uDDD1'} Delete
                    </button>
                  </div>

                  {/* assignment history */}
                  <div className="jh-hist-section">
                    <div className="jh-hist-section-title">Assignment History</div>
                    {loadingHistory ? (
                      <div className="jh-empty">Loading...</div>
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
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Field SOW Modal */}
      {sowJob && <FieldSowModal job={sowJob} onClose={() => setSowJob(null)} onUpdated={() => { loadData(); setSowJob(null) }} />}

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
