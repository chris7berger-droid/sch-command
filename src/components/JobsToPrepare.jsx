import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { stageOf, effectiveStart, effectiveEnd } from '../lib/queries'
import StageJobCard from './StageJobCard'

// "Jobs to Prepare" (§14) — the single flat list that replaces the /jobs picker-
// tiles→drilldown flow on Home. One list + ALL STAGES ▾ dropdown, month-default
// time chips + search + auto-fit widening, a 25-of-N cap, and compact rows that
// expand the real StageJobCard inline. Every stage predicate / status derivation
// is preserved via the shared stageOf.

const CAP = 25
const DATE_ORDER = ['week', 'month', 'quarter', 'all']

const FILTER_OPTIONS = [
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'quarter', label: 'This Quarter' },
  { key: 'all', label: 'All Time' },
]

const STAGE_OPTIONS = [
  { key: 'all', label: 'All Stages' },
  { key: 'staged', label: 'Staged' },
  { key: 'ready', label: 'Ready' },
  { key: 'active', label: 'Active' },
  { key: 'on-hold', label: 'On Hold' },
  { key: 'complete', label: 'Complete' },
]

function fmtD(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function getMonday(d) {
  const dt = new Date(d); const day = dt.getDay()
  dt.setDate(dt.getDate() - (day === 0 ? 6 : day - 1)); dt.setHours(0, 0, 0, 0); return dt
}
function rangeForKey(key, now) {
  switch (key) {
    case 'week': { const mon = getMonday(now); const fri = new Date(mon); fri.setDate(fri.getDate() + 4); return { from: fmtD(mon), to: fmtD(fri) } }
    case 'month': { const first = new Date(now.getFullYear(), now.getMonth(), 1); const last = new Date(now.getFullYear(), now.getMonth() + 1, 0); return { from: fmtD(first), to: fmtD(last) } }
    case 'quarter': { const q = Math.floor(now.getMonth() / 3) * 3; const first = new Date(now.getFullYear(), q, 1); const last = new Date(now.getFullYear(), q + 3, 0); return { from: fmtD(first), to: fmtD(last) } }
    default: return null
  }
}
function jobInRange(j, range) {
  if (!range) return true
  const start = effectiveStart(j); const end = effectiveEnd(j)
  if (!start && !end) return true
  return (start || '1900-01-01') <= range.to && (end || '2999-12-31') >= range.from
}
function matchesSearch(j, q) {
  if (!q) return true
  return (j.job_num || '').toLowerCase().includes(q) ||
    (j.job_name || '').toLowerCase().includes(q) ||
    (j.work_type || '').toLowerCase().includes(q)
}

export default function JobsToPrepare({
  jobs = [], crewByCallLog = {}, matsByJobId = {}, logsByCallLog = {},
  assignmentsByJobId = {}, proposalMaterialsByCallLog = {}, mobsByJobId = {},
  prtMap = new Map(), today = new Date(), onJobUpdate,
}) {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('month') // §14: Home default = month
  const [stageFilter, setStageFilter] = useState('all')
  const [manualDate, setManualDate] = useState(false)

  const q = search.toLowerCase().trim()

  // Stage + search filter (time applied after, so auto-fit can widen it).
  const stageSearched = useMemo(() => {
    return jobs.filter(j => {
      if (!matchesSearch(j, q)) return false
      if (stageFilter !== 'all' && stageOf(j, crewByCallLog, matsByJobId) !== stageFilter) return false
      return true
    })
  }, [jobs, q, stageFilter, crewByCallLog, matsByJobId])

  // Auto-fit widening (§14): when the current time window yields an empty list,
  // widen week→month→quarter→all to the narrowest range that has jobs. Skipped
  // once the user picks a chip manually. Re-armed when stage/search changes.
  useEffect(() => { setManualDate(false) }, [stageFilter, q])
  useEffect(() => {
    if (manualDate) return
    if (stageSearched.length === 0) return
    const now = new Date()
    const hasInCurrent = stageSearched.some(j => jobInRange(j, rangeForKey(dateFilter, now)))
    if (hasInCurrent) return
    const best = DATE_ORDER.find(k => stageSearched.some(j => jobInRange(j, rangeForKey(k, now)))) || 'all'
    setDateFilter(best)
  }, [stageSearched, manualDate, dateFilter])

  const filtered = useMemo(() => {
    const range = rangeForKey(dateFilter, new Date())
    return stageSearched
      .filter(j => jobInRange(j, range))
      .sort((a, b) => {
        const sa = effectiveStart(a), sb = effectiveStart(b)
        if (!sa && !sb) return 0; if (!sa) return 1; if (!sb) return -1
        return sa.localeCompare(sb)
      })
  }, [stageSearched, dateFilter])

  const shown = filtered.slice(0, CAP)
  const n = filtered.length
  const stageLabel = STAGE_OPTIONS.find(s => s.key === stageFilter)?.label || 'All Stages'

  return (
    <section className="jtp">
      <div className="jtp-head">
        <div className="jtp-head-left">
          <h2 className="jtp-title">Jobs to Prepare</h2>
          <p className="jtp-subtitle">Review, plan, and build upcoming job schedules.</p>
        </div>
        <div className="jtp-head-right">
          <span className="jtp-count">Showing {Math.min(CAP, n)} of {n} jobs</span>
          <button className="jtp-viewall" onClick={() => navigate('/jobs?tab=all')}>View All Jobs →</button>
        </div>
      </div>

      <div className="jtp-toolbar">
        <div className="jtp-toolbar-left">
          <input
            className="jtp-search"
            type="text"
            placeholder="Search jobs by name, number, or work type…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="jtp-chips">
            {FILTER_OPTIONS.map(f => (
              <button
                key={f.key}
                className={`jtp-chip${dateFilter === f.key ? ' active' : ''}`}
                onClick={() => { setManualDate(true); setDateFilter(f.key) }}
              >{f.label}</button>
            ))}
          </div>
        </div>
        <div className="jtp-toolbar-right">
          <select className="jtp-stage-select" value={stageFilter} onChange={e => setStageFilter(e.target.value)}>
            {STAGE_OPTIONS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <span className="jtp-viewing">Viewing {stageLabel}</span>
        </div>
      </div>

      <div className="jtp-list">
        {shown.length === 0 && <div className="jtp-empty">No jobs match the current filters.</div>}
        {shown.map(j => (
          <StageJobCard
            key={j.job_id}
            job={j}
            variant="home-compact"
            stage={stageOf(j, crewByCallLog, matsByJobId)}
            crewByCallLog={crewByCallLog}
            matsByJobId={matsByJobId}
            logsByCallLog={logsByCallLog}
            assignmentsByJobId={assignmentsByJobId}
            proposalMaterialsByCallLog={proposalMaterialsByCallLog}
            mobsByJobId={mobsByJobId}
            prtMap={prtMap}
            today={today}
            onJobUpdate={onJobUpdate}
          />
        ))}
      </div>
    </section>
  )
}
