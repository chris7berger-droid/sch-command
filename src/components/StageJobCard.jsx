import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { updateJobField, updateJobFields } from '../lib/queries'
import { getCardTitle, getWtcChips } from '../lib/jobCardLabel'
import { baseChecklistPasses } from '../lib/queries'
import { useUser } from '../lib/user'
import FieldSowModal from './FieldSowModal'

function effectiveStart(j) { return j.scheduled_start || j.start_date || null }
function effectiveEnd(j) { return j.scheduled_end || j.end_date || null }

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

function getBilledTotal(billingLog, jobId) {
  if (!billingLog || !billingLog.length) return 0
  return billingLog
    .filter(b => b.job_id === jobId)
    .reduce((sum, b) => sum + (parseFloat(b.percent) || 0), 0)
}

function totalWorkDays(job) {
  const start = effectiveStart(job)
  const end = effectiveEnd(job)
  if (!start || !end) return null
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  let count = 0
  const cursor = new Date(s)
  while (cursor <= e) {
    const dow = cursor.getDay()
    if (dow !== 0) count++
    cursor.setDate(cursor.getDate() + 1)
  }
  return count
}

function sowRowsForCard(job) {
  const wtcs = Array.isArray(job._wtcs) ? job._wtcs : []
  if (wtcs.length === 0) {
    const days = Array.isArray(job.field_sow) ? job.field_sow : []
    return days.length ? [{ label: null, days }] : []
  }
  return wtcs
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(w => ({ label: w.work_type_name, days: Array.isArray(w.field_sow) ? w.field_sow : [] }))
}

function formatDays(days) {
  if (days.length === 0) return '—'
  const labels = days.slice(0, 3).map(d => d.day_label || '?')
  const more = days.length > 3 ? ` … (${days.length} days)` : ` (${days.length} day${days.length !== 1 ? 's' : ''})`
  return labels.join(' · ') + more
}

function getPrtStatus(prts) {
  if (!prts || prts.length === 0) return { label: 'no PRTs yet', color: 'neutral' }
  if (prts.length === 1) return { label: '1 PRT submitted', color: 'neutral' }
  const recent = prts.slice(0, Math.min(prts.length, 3))
  let totalTarget = 0, totalActual = 0
  for (const prt of recent) {
    const tasks = Array.isArray(prt.tasks) ? prt.tasks : []
    for (const t of tasks) {
      totalTarget += parseFloat(t.pct_target || t.target || 0)
      totalActual += parseFloat(t.pct_complete || t.actual || 0)
    }
  }
  if (totalTarget === 0) return { label: `${prts.length} PRTs`, color: 'neutral' }
  const gap = totalTarget - totalActual
  const pctBehind = gap / totalTarget
  if (pctBehind > 0.10) {
    const daysBehind = Math.ceil(gap)
    return { label: `${daysBehind > 0 ? daysBehind + 'd behind' : 'behind target'}`, color: 'warn' }
  }
  return { label: 'on target', color: 'ok' }
}

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

function StageBanner({ job, stage, crewRows, matRows, billingLog, prtMap, today }) {
  const start = effectiveStart(job)
  const daysToKickoff = start ? daysBetween(start, today) : null
  const kickoffText = daysToKickoff !== null
    ? daysToKickoff < 0 ? `${Math.abs(daysToKickoff)}d overdue`
    : daysToKickoff === 0 ? 'kicks off today'
    : `kicks off in ${daysToKickoff}d`
    : null

  if (stage === 'staged') {
    const missing = []
    if (job.field_sow == null) missing.push('📋')
    if (crewRows.length === 0) missing.push('👷')
    if (matRows.length > 0 && matRows.some(m => ['Not Ordered', 'Delayed'].includes(m.status))) missing.push('📦')
    if ((job.scheduled_start || job.start_date) == null) missing.push('📅')
    return (
      <div className="sjc-banner sjc-banner-staged">
        <span className="sjc-banner-stage">STAGED</span>
        {missing.length > 0 && <span className="sjc-banner-missing">{missing.join(' ')}</span>}
        {kickoffText && <span className="sjc-banner-countdown">{kickoffText}</span>}
      </div>
    )
  }

  if (stage === 'ready') {
    return (
      <div className="sjc-banner sjc-banner-ready">
        <span className="sjc-banner-stage">READY</span>
        {kickoffText && <span className="sjc-banner-countdown">{kickoffText}</span>}
      </div>
    )
  }

  if (stage === 'active') {
    const end = effectiveEnd(job)
    const totalDays = start && end ? daysBetween(end, new Date(start + 'T00:00:00')) + 1 : null
    const elapsed = start ? daysBetween(new Date().toISOString().slice(0, 10), new Date(start + 'T00:00:00')) : null
    const dayText = totalDays && elapsed != null ? `day ${Math.max(1, elapsed + 1)} of ${totalDays}` : null
    const prts = prtMap instanceof Map ? (prtMap.get(job.call_log_id) || []) : []
    const prt = getPrtStatus(prts)
    return (
      <div className="sjc-banner sjc-banner-active">
        <span className="sjc-banner-stage">ACTIVE</span>
        {dayText && <span className="sjc-banner-countdown">{dayText}</span>}
        <span className={`sjc-banner-prt sjc-prt-${prt.color}`}>{prt.label}</span>
      </div>
    )
  }

  if (stage === 'on-hold') {
    const holdDays = job.status_changed_at ? daysBetween(new Date().toISOString().slice(0, 10), job.status_changed_at) : null
    return (
      <div className="sjc-banner sjc-banner-on-hold">
        <span className="sjc-banner-stage">ON HOLD</span>
        {holdDays != null && <span className="sjc-banner-countdown">{Math.abs(holdDays)}d</span>}
        {job.hold_reason && <span className="sjc-banner-reason">{job.hold_reason}</span>}
      </div>
    )
  }

  if (stage === 'complete') {
    const endDate = effectiveEnd(job)
    const ago = endDate ? daysBetween(new Date().toISOString().slice(0, 10), endDate) : null
    const billedPct = getBilledTotal(billingLog, job.job_id)
    const amount = job.amount ? parseFloat(job.amount) : 0
    const unbilled = amount > 0 && billedPct < 100
    return (
      <div className="sjc-banner sjc-banner-complete">
        <span className="sjc-banner-stage">COMPLETE</span>
        {ago != null && <span className="sjc-banner-countdown">finished {Math.abs(ago)}d ago</span>}
        {unbilled && <span className="sjc-banner-warn">{fmtMoney(amount - (amount * billedPct / 100))} unbilled</span>}
      </div>
    )
  }

  return null
}

function IdentityRow({ job }) {
  const wtcs = job._wtcs || []
  const chips = getWtcChips(wtcs)
  const workTypeLabel = chips.length > 1
    ? `${chips.length} work types`
    : chips.length === 1
      ? (wtcs[0]?.work_type_name || job.work_type || '—')
      : (job.work_type || '—')

  return (
    <div className="sjc-identity">
      <div className="sjc-id-bubble">
        <span className="sjc-id-label">JOB</span>
        <span className="sjc-id-value">{job.job_num || '—'} {job.job_name || ''}</span>
      </div>
      <div className="sjc-id-bubble">
        <span className="sjc-id-label">CUSTOMER</span>
        <span className="sjc-id-value">{job.customer_name || '—'}</span>
      </div>
      <div className="sjc-id-bubble">
        <span className="sjc-id-label">WORK TYPES</span>
        <span className="sjc-id-value">{workTypeLabel}</span>
      </div>
    </div>
  )
}

function PlanningPanel({ job, crewRows, matRows, onSowClick, onCrewClick, onMtrlClick, onDateClick }) {
  const hasSOW = job.field_sow != null
  const hasCrew = crewRows.length >= 1
  const undecidedMats = matRows.filter(m => ['Not Ordered', 'Delayed'].includes(m.status)).length
  const matsOk = matRows.length === 0 || undecidedMats === 0
  const start = job.scheduled_start || job.start_date || null
  const end = job.scheduled_end || job.end_date || null
  const hasDate = start != null
  const workDays = totalWorkDays(job)

  return (
    <div className="sjc-panel sjc-panel-planning">
      <div className="sjc-scorecards">
        <div className={`sjc-score sjc-score-click ${hasSOW ? 'sjc-score-ok' : 'sjc-score-bad'}`} onClick={onSowClick}>
          <span className="sjc-score-icon">{'📋'}</span>
          <span className="sjc-score-label">SOW</span>
          <span className="sjc-score-val">{hasSOW ? '✓' : '✗'}</span>
        </div>
        <div className={`sjc-score sjc-score-click ${matsOk ? 'sjc-score-ok' : 'sjc-score-bad'}`} onClick={onMtrlClick}>
          <span className="sjc-score-icon">{'📦'}</span>
          <span className="sjc-score-label">MTRL</span>
          <span className="sjc-score-val">{matsOk ? '✓' : undecidedMats}</span>
        </div>
        <div className={`sjc-score sjc-score-click ${hasCrew ? 'sjc-score-ok' : 'sjc-score-bad'}`} onClick={onCrewClick}>
          <span className="sjc-score-icon">{'👷'}</span>
          <span className="sjc-score-label">CREW</span>
          <span className="sjc-score-val">{crewRows.length} / {job.crew_needed || '?'}</span>
        </div>
        <div className={`sjc-score sjc-score-click sjc-score-wide ${hasDate ? 'sjc-score-neutral' : 'sjc-score-bad'}`} onClick={onDateClick}>
          <span className="sjc-score-icon">{'📅'}</span>
          <span className="sjc-score-label">DAYS</span>
          <span className="sjc-score-val">
            {hasDate
              ? <>{workDays || '?'}d <span className="sjc-score-dates">{start} — {end || '?'}</span></>
              : '✗'}
          </span>
        </div>
        <div className="sjc-score sjc-score-stub" title="Coming soon — mobilizations">
          <span className="sjc-score-icon">{'🚚'}</span>
          <span className="sjc-score-label">MOBS</span>
          <span className="sjc-score-val">—</span>
        </div>
      </div>
    </div>
  )
}

function ManagementPanel({ job, stage, logsCount = 0, billingLog, prtMap, onBilledClick, onPrtClick, onLogsClick, onNotesClick }) {
  const amount = job.amount ? parseFloat(job.amount) : 0
  const billedPct = getBilledTotal(billingLog, job.job_id)
  const billedClass = billedPct >= 100 ? 'sjc-score-ok'
    : billedPct > 0 ? 'sjc-score-warn'
    : stage === 'complete' && amount > 0 ? 'sjc-score-bad'
    : 'sjc-score-neutral'

  return (
    <div className="sjc-panel sjc-panel-management">
      <div className="sjc-scorecards">
        <div className="sjc-score sjc-score-neutral">
          <span className="sjc-score-icon">{'💵'}</span>
          <span className="sjc-score-label">PROP</span>
          <span className="sjc-score-val">{amount > 0 ? fmtMoney(amount) : '—'}</span>
        </div>
        <div className={`sjc-score sjc-score-click ${billedClass}`} onClick={onBilledClick}>
          <span className="sjc-score-icon">{'📊'}</span>
          <span className="sjc-score-label">BILLED</span>
          <span className="sjc-score-val">{amount > 0 ? `${Math.round(billedPct)}%` : '—'}</span>
        </div>
        {(() => {
          const prts = prtMap instanceof Map ? (prtMap.get(job.call_log_id) || []) : []
          const prt = getPrtStatus(prts)
          return (
            <div className={`sjc-score sjc-score-click sjc-score-${prt.color}`} onClick={onPrtClick}>
              <span className="sjc-score-icon">{'📊'}</span>
              <span className="sjc-score-label">PRT</span>
              <span className="sjc-score-val">{prt.label}</span>
            </div>
          )
        })()}
        <div className="sjc-score sjc-score-click sjc-score-neutral" onClick={onLogsClick}>
          <span className="sjc-score-icon">{'📅'}</span>
          <span className="sjc-score-label">LOGS</span>
          <span className="sjc-score-val">{logsCount > 0 ? logsCount : '—'}</span>
        </div>
        <div className="sjc-score sjc-score-stub" title="Coming soon — attachments">
          <span className="sjc-score-icon">{'📎'}</span>
          <span className="sjc-score-label">FILES</span>
          <span className="sjc-score-val">—</span>
        </div>
        <div className="sjc-score sjc-score-click sjc-score-neutral" onClick={onNotesClick}>
          <span className="sjc-score-icon">{'📝'}</span>
          <span className="sjc-score-label">NOTES</span>
          <span className="sjc-score-val">{job.notes ? `${job.notes.length}c` : '—'}</span>
        </div>
      </div>
    </div>
  )
}

function DetailsPanel({ job, crewRows }) {
  const crewNames = crewRows.map(c => c.name || c.team_member_id).join(' · ')
  const rows = sowRowsForCard(job)

  return (
    <div className="sjc-panel sjc-panel-details">
      <div className="sjc-detail-row">
        <span className="sjc-detail-label">CREW</span>
        <span className="sjc-detail-val">{crewNames || '—'}</span>
      </div>
      <div className="sjc-detail-row">
        <span className="sjc-detail-label">SOW</span>
        <div className="sjc-detail-val">
          {rows.length === 0 && '—'}
          {rows.map((r, i) => (
            <div key={i} className="sjc-sow-line">
              {r.label && <span className="sjc-sow-wtc">[{r.label}]</span>}
              <span>{formatDays(r.days)}</span>
            </div>
          ))}
        </div>
      </div>
      {job.notes && (
        <div className="sjc-detail-row">
          <span className="sjc-detail-label">NOTES</span>
          <span className="sjc-detail-val">{job.notes}</span>
        </div>
      )}
    </div>
  )
}

export default function StageJobCard({ job, stage, crewByCallLog = {}, matsByJobId = {}, logsByCallLog = {}, billingLog = [], prtMap = new Map(), today = new Date(), onJobUpdate }) {
  const navigate = useNavigate()
  const user = useUser()
  const changedBy = user?.name || 'unknown'

  const [panels, setPanels] = useState({ planning: false, management: false, details: false })
  const [acting, setActing] = useState(false)
  const [showSowModal, setShowSowModal] = useState(false)
  const [showNotes, setShowNotes] = useState(false)

  const crewRows = crewByCallLog[job.call_log_id] || []
  const matRows = matsByJobId[job.job_id] || []
  const logsCount = logsByCallLog[job.call_log_id] || 0

  const togglePanel = useCallback((key) => {
    setPanels(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const canPromote = baseChecklistPasses(job, crewRows, matRows)

  const handlePromote = useCallback(async () => {
    setActing(true)
    const { error } = await updateJobField(job.job_id, 'ready_confirmed_at', new Date().toISOString(), changedBy, 'manual_promotion')
    if (error) { console.error(error); setActing(false); return }
    if (onJobUpdate) onJobUpdate()
    setActing(false)
  }, [job.job_id, changedBy, onJobUpdate])

  const handleKickoff = useCallback(async () => {
    setActing(true)
    const { error } = await updateJobField(job.job_id, 'status', 'In Progress', changedBy)
    if (error) { console.error(error); setActing(false); return }
    if (onJobUpdate) onJobUpdate()
    setActing(false)
  }, [job.job_id, changedBy, onJobUpdate])

  const handleResume = useCallback(async () => {
    setActing(true)
    const { error } = await updateJobFields(
      job.job_id,
      { status: 'Scheduled', ready_confirmed_at: null },
      changedBy,
      'on_hold_resume',
      { skipAuditFields: ['ready_confirmed_at'] }
    )
    if (error) { console.error(error); setActing(false); return }
    if (onJobUpdate) onJobUpdate()
    setActing(false)
  }, [job.job_id, changedBy, onJobUpdate])

  const handleSendToBilling = useCallback(() => {
    navigate('/billing')
  }, [navigate])

  // Scorecard click handlers — navigate to JobDetail with the right tab
  const goJobTab = useCallback((tab) => {
    navigate(`/jobs/${job.job_id}?mode=planning&tab=${tab}`)
  }, [navigate, job.job_id])
  const goManagementTab = useCallback((tab) => {
    navigate(`/jobs/${job.job_id}?mode=management&tab=${tab}`)
  }, [navigate, job.job_id])
  const goSchedule = useCallback(() => {
    const s = effectiveStart(job)
    if (s) {
      const monday = getMonday(new Date(s + 'T00:00:00'))
      navigate(`/schedule?job=${job.job_id}&week=${fmtD(monday)}`)
    } else {
      navigate(`/jobs/${job.job_id}?mode=planning`)
    }
  }, [navigate, job])

  return (
    <div className="sjc-card">
      <StageBanner job={job} stage={stage} crewRows={crewRows} matRows={matRows} billingLog={billingLog} prtMap={prtMap} today={today} />

      <div className="sjc-header" onClick={() => navigate(`/jobs/${job.job_id}?mode=management`)}>
        <span className="sjc-header-title">{getCardTitle(job, job._wtcs)}</span>
      </div>

      <IdentityRow job={job} />

      <div className="sjc-toggles">
        <button className={`sjc-toggle${panels.planning ? ' open' : ''}`} onClick={() => togglePanel('planning')}>PLANNING</button>
        <button className={`sjc-toggle${panels.management ? ' open' : ''}`} onClick={() => togglePanel('management')}>MANAGEMENT</button>
        <button className={`sjc-toggle${panels.details ? ' open' : ''}`} onClick={() => togglePanel('details')}>DETAILS</button>
      </div>

      {panels.planning && (
        <PlanningPanel
          job={job}
          crewRows={crewRows}
          matRows={matRows}
          onSowClick={() => setShowSowModal(true)}
          onMtrlClick={() => goJobTab('materials')}
          onCrewClick={() => navigate(`/jobs/${job.job_id}?mode=planning`)}
          onDateClick={() => goSchedule()}
        />
      )}
      {panels.management && (
        <ManagementPanel
          job={job}
          stage={stage}
          logsCount={logsCount}
          billingLog={billingLog}
          prtMap={prtMap}
          onBilledClick={() => navigate('/billing')}
          onPrtClick={() => goManagementTab('production')}
          onLogsClick={() => goManagementTab('daily-log')}
          onNotesClick={() => setShowNotes(prev => !prev)}
        />
      )}
      {showNotes && job.notes && (
        <div className="sjc-panel sjc-panel-notes">
          <div className="sjc-detail-val">{job.notes}</div>
        </div>
      )}
      {panels.details && <DetailsPanel job={job} crewRows={crewRows} />}

      <div className="sjc-action">
        {stage === 'staged' && (
          <button className="sjc-action-btn sjc-promote" disabled={!canPromote || acting} onClick={handlePromote}>
            {acting ? 'Promoting…' : 'Promote to Ready'}
          </button>
        )}
        {stage === 'ready' && (
          <button className="sjc-action-btn sjc-kickoff" disabled={acting} onClick={handleKickoff}>
            {acting ? 'Starting…' : 'Kickoff'}
          </button>
        )}
        {stage === 'on-hold' && (
          <button className="sjc-action-btn sjc-resume" disabled={acting} onClick={handleResume}>
            {acting ? 'Resuming…' : 'Resume'}
          </button>
        )}
        {stage === 'complete' && (
          <button className="sjc-action-btn sjc-billing" onClick={handleSendToBilling}>
            Send to Billing
          </button>
        )}
      </div>

      {showSowModal && (
        <div className="mbg" onClick={e => { if (e.target === e.currentTarget) setShowSowModal(false) }}>
          <div className="mdl mdl-lg">
            <FieldSowModal
              job={job}
              onClose={() => setShowSowModal(false)}
              onUpdated={() => { setShowSowModal(false); if (onJobUpdate) onJobUpdate() }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
