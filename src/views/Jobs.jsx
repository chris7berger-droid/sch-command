import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'

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
  if (s === 'on hold' || s === 'hold') return 'On Hold'
  if (s === 'complete' || s === 'completed' || s === 'done') return 'Complete'
  return 'Ongoing'
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

  // Overdue: ongoing job past end_date
  if (status === 'Ongoing' && job.end_date) {
    const daysLeft = daysBetween(job.end_date, today)
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

  // Status weight: Ongoing first, On Hold next, Complete last
  if (status === 'Ongoing') score = 0
  else if (status === 'On Hold') score = 10000
  else score = 20000

  // Days until end date: overdue jobs float to top
  if (job.end_date) {
    const daysLeft = daysBetween(job.end_date, today)
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

  // restore bin
  const [showBin, setShowBin] = useState(false)
  const [deletedJobs, setDeletedJobs] = useState([])

  const today = useMemo(() => new Date(), [])

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

    // date range filter
    if (dateRange) {
      list = list.filter(j => {
        if (!j.start_date && !j.end_date) return true
        const start = j.start_date || '1900-01-01'
        const end = j.end_date || '2999-12-31'
        return start <= dateRange.to && end >= dateRange.from
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

  const ongoing = useMemo(() => filteredJobs.filter(j => getJobStatus(j) === 'Ongoing'), [filteredJobs])
  const onHold = useMemo(() => filteredJobs.filter(j => getJobStatus(j) === 'On Hold'), [filteredJobs])
  const complete = useMemo(() => filteredJobs.filter(j => getJobStatus(j) === 'Complete'), [filteredJobs])

  /* ── status update ──────────────────────────────────────────── */

  const updateStatus = useCallback(async (jobId, newStatus) => {
    const { error: err } = await supabase.from('jobs').update({ status: newStatus }).eq('job_id', jobId)
    if (err) { console.error(err); return }
    setJobs(prev => prev.map(j => j.job_id === jobId ? { ...j, status: newStatus } : j))
  }, [])

  /* ── soft delete ────────────────────────────────────────────── */

  const softDelete = useCallback(async (jobId, jobName) => {
    if (!window.confirm(`Delete "${jobName}"? It can be restored within 24 hours.`)) return
    const now = new Date().toISOString()
    const { error: err } = await supabase.from('jobs').update({ deleted: 'Yes', deleted_at: now }).eq('job_id', jobId)
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

  /* ── expand / collapse ──────────────────────────────────────── */

  const toggleExpand = useCallback(async (job) => {
    if (expandedId === job.job_id) {
      setExpandedId(null)
      return
    }
    setExpandedId(job.job_id)
    setPctInput('')
    setLoadingHistory(true)
    const { data, error: err } = await supabase
      .from('assignments')
      .select('crew_name, date')
      .eq('job_id', job.job_id)
      .order('date', { ascending: false })
    if (err) { console.error(err); setJobAssignments([]) }
    else { setJobAssignments(data || []) }
    setLoadingHistory(false)
  }, [expandedId])

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

      {/* single job list */}
      <div className="jh-list">
        {filteredJobs.length === 0 && <div className="jh-empty">No jobs match this filter</div>}
        {filteredJobs.map(j => {
          const status = getJobStatus(j)
          const statusClass = status === 'Ongoing' ? 'og' : status === 'On Hold' ? 'oh' : 'cp'
          const billedPct = getBilledTotal(billingLog, j.job_id)
          const amount = j.amount ? parseFloat(j.amount) : 0
          const billedAmt = amount > 0 ? Math.round(amount * billedPct / 100) : 0
          const daysLeft = daysBetween(j.end_date, today)
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
                      <span className="jh-detail-value">{j.start_date || '-'}</span>
                    </div>
                    <div className="jh-detail-item">
                      <span className="jh-detail-label">End</span>
                      <span className="jh-detail-value">{j.end_date || '-'}</span>
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
                      <span className="jh-detail-value">{fmtMoney(j.amount)}</span>
                    </div>
                  </div>

                  {j.notes && (
                    <div className="jh-detail-notes">
                      <span className="jh-detail-label">Notes</span>
                      <p>{j.notes}</p>
                    </div>
                  )}

                  {j.sow && (
                    <a className="jh-sow-link" href={j.sow} target="_blank" rel="noopener noreferrer">SOW Link</a>
                  )}

                  {/* status + actions */}
                  <div className="jh-detail-actions">
                    <select
                      className="jh-status-sel"
                      value={status}
                      onChange={e => updateStatus(j.job_id, e.target.value)}
                      onClick={e => e.stopPropagation()}
                    >
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
