import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { updateJobField, updateJobStatus } from '../lib/queries'
import { getCardTitle, getWtcChips } from '../lib/jobCardLabel'
import { baseChecklistPasses, hasFieldSow } from '../lib/queries'
import { useUser } from '../lib/user'
import FieldSowModal from './FieldSowModal'
import CardSowModal from './CardSowModal'
import MaterialsModal from './MaterialsModal'
import DaysModal from './DaysModal'

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


function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 'YYYY-MM-DD' → 'M/D' (no leading zeros) for compact scorecard dates.
function fmtMD(dateStr) {
  if (!dateStr) return null
  const [, m, d] = String(dateStr).split('-')
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`
}

// Plan §4.1: calendar days start→end, excluding BOTH weekend days unless an
// assignment exists on that weekend day. assignmentDates = Set of 'YYYY-MM-DD'
// for this job (null → no weekend exception applied).
function totalWorkDays(job, assignmentDates = null) {
  const start = effectiveStart(job)
  const end = effectiveEnd(job)
  if (!start || !end) return null
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  let count = 0
  const cursor = new Date(s)
  while (cursor <= e) {
    const dow = cursor.getDay()
    const isWeekend = dow === 0 || dow === 6
    if (!isWeekend) count++
    else if (assignmentDates && assignmentDates.has(ymd(cursor))) count++
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

function StageBanner({ job, stage, crewRows, matRows, prtMap, today }) {
  const start = effectiveStart(job)
  const daysToKickoff = start ? daysBetween(start, today) : null
  const kickoffText = daysToKickoff !== null
    ? daysToKickoff < 0 ? `${Math.abs(daysToKickoff)}d overdue`
    : daysToKickoff === 0 ? 'kicks off today'
    : `kicks off in ${daysToKickoff}d`
    : null

  if (stage === 'staged') {
    const missing = []
    if (!hasFieldSow(job)) missing.push('📋')
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
    // SJC-1 display cap: floor at 1, cap at totalDays so a stale past-end ACTIVE
    // job reads "day 5 of 5", never "day 129 of 5". (The real fix — elapsed from
    // first clock-punch + "Nd overdue" reframe — is deferred to Field Command.)
    const dayNum = totalDays && elapsed != null ? Math.min(totalDays, Math.max(1, elapsed + 1)) : null
    const dayText = dayNum != null ? `day ${dayNum} of ${totalDays}` : null
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
    return (
      <div className="sjc-banner sjc-banner-complete">
        <span className="sjc-banner-stage">COMPLETE</span>
        {ago != null && <span className="sjc-banner-countdown">finished {Math.abs(ago)}d ago</span>}
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
  // SCH4 (#11): a sent WTC with no calendar dates yet (job_wtcs.start_date null).
  const datesTbd = wtcs.length > 0 && wtcs.some(w => !w.start_date)

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
        <span className="sjc-id-value">
          {workTypeLabel}
          {datesTbd && (
            <span
              title="One or more work types still need calendar dates"
              style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '1px 7px', borderRadius: 9, background: '#1c1814', color: '#30cfac', whiteSpace: 'nowrap' }}
            >
              Dates TBD
            </span>
          )}
        </span>
      </div>
    </div>
  )
}

function PlanningPanel({ job, crewRows, matRows, assignmentDates, onSowClick, onCrewClick, onMtrlClick, onDateClick }) {
  const hasSOW = hasFieldSow(job)
  const hasCrew = crewRows.length >= 1
  const undecidedMats = matRows.filter(m => ['Not Ordered', 'Delayed'].includes(m.status)).length
  const matsOk = matRows.length === 0 || undecidedMats === 0
  const start = job.scheduled_start || job.start_date || null
  const end = job.scheduled_end || job.end_date || null
  const hasDate = start != null
  const workDays = totalWorkDays(job, assignmentDates)

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

function ManagementPanel({ job, logsCount = 0, prtMap, onBilledClick, onPrtClick, onLogsClick, onNotesClick }) {
  const amount = job.amount ? parseFloat(job.amount) : 0

  return (
    <div className="sjc-panel sjc-panel-management">
      <div className="sjc-scorecards">
        <div className="sjc-score sjc-score-neutral">
          <span className="sjc-score-icon">{'💵'}</span>
          <span className="sjc-score-label">PROP</span>
          <span className="sjc-score-val">{amount > 0 ? fmtMoney(amount) : '—'}</span>
        </div>
        <div className="sjc-score sjc-score-click sjc-score-neutral" onClick={onBilledClick}>
          <span className="sjc-score-icon">{'📊'}</span>
          <span className="sjc-score-label">BILLING</span>
          <span className="sjc-score-val">View &rarr;</span>
        </div>
        {(() => {
          // Deposit indicator (Cycle 2) — informational, no click. Hidden when the
          // job has no deposit requirement (job._deposit is null). Pure read of
          // sale-side state: Sales flags the deposit + marks the invoice; Schedule
          // only mirrors sent/days-since/due/paid here.
          const dep = job._deposit
          if (!dep) return null
          const color = dep.status === 'paid' ? 'ok' : dep.status === 'sent' ? 'neutral' : 'bad'
          const due = fmtMD(dep.dueDate)
          const val = dep.status === 'paid'
            ? 'Paid'
            : dep.status === 'sent'
              ? <>Sent {dep.daysSince}d{due && <span className="sjc-score-dates"> due {due}</span>}</>
              : 'Due'
          return (
            <div
              className={`sjc-score sjc-score-${color}`}
              title={dep.amount != null ? `Deposit ${fmtMoney(dep.amount)}` : 'Deposit'}
            >
              <span className="sjc-score-icon">{'🏦'}</span>
              <span className="sjc-score-label">DEPOSIT</span>
              <span className="sjc-score-val">{val}</span>
            </div>
          )
        })()}
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

// Budget tab — Bid side. Renders the frozen bid cost breakdown stamped by Sales
// onto each job_wtcs.bid_breakdown at Send-to-Schedule. The Actual/Δ columns are
// scaffolded but "pending" this loop (Field Command not connected). Reads only
// pre-computed numbers off job._wtcs — no math is re-derived here.
function BudgetPanel({ job }) {
  const wtcs = job._wtcs || []

  // Whole-job empty state applies ONLY when the job has zero WTCs.
  if (wtcs.length === 0) {
    return (
      <div className="sjc-panel sjc-panel-budget">
        <div className="sjc-detail-val" style={{ color: 'var(--text-secondary)' }}>
          No work types on this job yet.
        </div>
      </div>
    )
  }

  const mono = { fontFamily: 'var(--font-mono)' }

  // Roll-up: sum EXTENSIVE quantities only (rates and percentages are NOT
  // additive). Coalesce per-WTC so an unstamped sibling contributes 0, never
  // NaN. Then margin = Σprofit / Σprice (guarded).
  const stamped = wtcs.filter(w => w.bid_breakdown)
  const sum = (f) => stamped.reduce((s, w) => s + (w.bid_breakdown?.[f] ?? 0), 0)
  const roll = {
    regular_hours: sum('regular_hours'),
    ot_hours: sum('ot_hours'),
    labor_cost: sum('labor_cost'),
    material_cost: sum('material_cost'),
    travel_cost: sum('travel_cost'),
    total_cost: sum('total_cost'),
    profit: sum('profit'),
    price: sum('price'),
  }
  roll.margin_pct = roll.price > 0 ? (roll.profit / roll.price) * 100 : 0

  const marginCell = (profit, pct) => (
    <span style={mono}>
      {fmtMoney(profit)}{' '}
      <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>({pct.toFixed(1)}%)</span>
    </span>
  )

  // A single BID · ACTUAL · Δ row. Actual/Δ are pending/— this loop; the
  // three-column scaffold stays so Field data drops in without a 1→3 refactor.
  const BidRow = (label, bid, strong) => (
    <tr>
      <td>{label}</td>
      <td style={{ ...mono, textAlign: 'right', ...(strong ? { fontWeight: 700 } : {}) }}>{bid}</td>
      <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>pending</td>
      <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>—</td>
    </tr>
  )

  return (
    <div className="sjc-panel sjc-panel-budget">
      {/* Job-level roll-up across stamped WTCs */}
      {stamped.length > 0 && (
        <div className="jd-grid" style={{ marginBottom: 16 }}>
          <div className="jd-field"><span className="jd-label">Regular Hrs</span><span className="jd-value" style={mono}>{roll.regular_hours.toFixed(1)}</span></div>
          <div className="jd-field"><span className="jd-label">OT Hrs</span><span className="jd-value" style={mono}>{roll.ot_hours.toFixed(1)}</span></div>
          <div className="jd-field"><span className="jd-label">Labor</span><span className="jd-value" style={mono}>{fmtMoney(roll.labor_cost)}</span></div>
          <div className="jd-field"><span className="jd-label">Materials</span><span className="jd-value" style={mono}>{fmtMoney(roll.material_cost)}</span></div>
          {roll.travel_cost > 0 && (
            <div className="jd-field"><span className="jd-label">Travel</span><span className="jd-value" style={mono}>{fmtMoney(roll.travel_cost)}</span></div>
          )}
          <div className="jd-field"><span className="jd-label">Total Cost</span><span className="jd-value" style={mono}>{fmtMoney(roll.total_cost)}</span></div>
          <div className="jd-field"><span className="jd-label">Margin</span><span className="jd-value">{marginCell(roll.profit, roll.margin_pct)}</span></div>
        </div>
      )}

      {/* One table per WTC */}
      {wtcs.map((w, i) => {
        const name = w.work_type_name || job.work_type || 'Work Type'
        const b = w.bid_breakdown
        // Per-WTC empty state on an unstamped row — NOT an all-or-nothing gate.
        if (!b) {
          return (
            <div key={w.id || i} style={{ marginBottom: 16 }}>
              <div className="jd-label" style={{ marginBottom: 4 }}>{name}</div>
              <div className="jd-value" style={{ color: 'var(--text-secondary)' }}>Bid not yet stamped.</div>
            </div>
          )
        }
        return (
          <div key={w.id || i} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, gap: 8 }}>
              <span className="jd-label">{name}</span>
              <span className="jd-label" style={{ color: 'var(--text-secondary)' }}>
                Burden {fmtMoney(b.burden_rate)}/hr · OT {fmtMoney(b.ot_burden_rate)}/hr
              </span>
            </div>
            <table className="jobs-table">
              <thead>
                <tr>
                  <th></th>
                  <th style={{ textAlign: 'right' }}>Bid</th>
                  <th style={{ textAlign: 'right' }}>Actual</th>
                  <th style={{ textAlign: 'right' }}>Δ</th>
                </tr>
              </thead>
              <tbody>
                {BidRow('Regular hours', (b.regular_hours ?? 0).toFixed(1))}
                {BidRow('Overtime hours', (b.ot_hours ?? 0).toFixed(1))}
                {BidRow('Labor cost', fmtMoney(b.labor_cost ?? 0))}
                {BidRow('Materials', fmtMoney(b.material_cost ?? 0))}
                {BidRow('Added materials', fmtMoney(0))}
                {(b.travel_cost ?? 0) > 0 && BidRow('Travel', fmtMoney(b.travel_cost))}
                {BidRow('Total Cost', fmtMoney(b.total_cost ?? 0), true)}
                <tr>
                  <td>Margin</td>
                  <td style={{ textAlign: 'right' }}>{marginCell(b.profit ?? 0, b.margin_pct ?? 0)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>pending</td>
                  <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>—</td>
                </tr>
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}

function NotesPanel({ job, changedBy, onSaved }) {
  const [val, setVal] = useState(job.notes || '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    const { error } = await updateJobField(job.job_id, 'notes', val, changedBy)
    setSaving(false)
    if (error) { alert('Save failed: ' + error.message); return }
    if (onSaved) onSaved()
  }

  return (
    <div className="sjc-panel sjc-panel-notes">
      <textarea
        value={val}
        onChange={e => setVal(e.target.value)}
        placeholder="Add a note…"
        rows={3}
        style={{
          width: '100%', boxSizing: 'border-box', background: '#a89b88',
          border: '1px solid rgba(28,24,20,0.25)', borderRadius: 4, padding: '6px 8px',
          fontSize: 13, color: '#1c1814', fontFamily: "'Barlow', sans-serif", outline: 'none', resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
        <button className="app-act-btn app-act-primary" onClick={save} disabled={saving || val === (job.notes || '')}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

export default function StageJobCard({ job, stage, crewByCallLog = {}, matsByJobId = {}, logsByCallLog = {}, assignmentsByJobId = {}, proposalMaterialsByCallLog = {}, prtMap = new Map(), today = new Date(), onJobUpdate }) {
  const navigate = useNavigate()
  const user = useUser()
  const changedBy = user?.name || 'unknown'

  const [panels, setPanels] = useState({ planning: false, management: false, details: false, budget: false })
  const [acting, setActing] = useState(false)
  const [showSowModal, setShowSowModal] = useState(false)
  const [sowFocus, setSowFocus] = useState(null)        // { wtcId, dayIndex } from DaysModal handoff (Option 3)
  const [showPrintModal, setShowPrintModal] = useState(false)
  const [showMtrlModal, setShowMtrlModal] = useState(false)
  const [showDaysModal, setShowDaysModal] = useState(false)
  const [showNotes, setShowNotes] = useState(false)

  const crewRows = crewByCallLog[job.call_log_id] || []
  const matRows = matsByJobId[job.job_id] || []
  const proposalMaterials = proposalMaterialsByCallLog[job.call_log_id] || []
  const logsCount = logsByCallLog[job.call_log_id] || 0
  const assignmentDates = assignmentsByJobId[job.job_id] || null

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
    // Stage-sync chokepoint (SCH3): syncs call_log.stage → 'In Progress' too.
    const { error } = await updateJobStatus(job.job_id, 'In Progress', changedBy)
    if (error) { console.error(error); setActing(false); return }
    if (onJobUpdate) onJobUpdate()
    setActing(false)
  }, [job.job_id, changedBy, onJobUpdate])

  const handleResume = useCallback(async () => {
    setActing(true)
    // Stage-sync chokepoint (SCH3): resume writes status 'Scheduled' →
    // call_log.stage 'Scheduled' (in-filter). ready_confirmed_at is cleared as
    // a paired field; its audit row is still skipped (DB trigger handles it).
    const { error } = await updateJobStatus(
      job.job_id,
      'Scheduled',
      changedBy,
      'on_hold_resume',
      { extraFields: { ready_confirmed_at: null }, skipAuditFields: ['ready_confirmed_at'] }
    )
    if (error) { console.error(error); setActing(false); return }
    if (onJobUpdate) onJobUpdate()
    setActing(false)
  }, [job.job_id, changedBy, onJobUpdate])

  const handleSendToBilling = useCallback(() => {
    navigate('/billing?tab=worklist')
  }, [navigate])

  // Scorecard click handlers — navigate to JobDetail with the right tab
  const goManagementTab = useCallback((tab) => {
    navigate(`/jobs/${job.job_id}?mode=management&tab=${tab}`)
  }, [navigate, job.job_id])

  // CREW → existing Crew Schedule, deep-linked to this job's week (Schedule.jsx
  // reads ?job=&week= and highlights). The crew-build tool lives there.
  const goCrewSchedule = useCallback(() => {
    const s = effectiveStart(job)
    if (s) {
      const d = new Date(s + 'T00:00:00')
      const day = d.getDay()
      d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)) // Monday of that week
      navigate(`/schedule?job=${job.job_id}&week=${ymd(d)}`)
    } else {
      navigate(`/schedule?job=${job.job_id}`)
    }
  }, [navigate, job])

  return (
    <div className="sjc-card">
      <StageBanner job={job} stage={stage} crewRows={crewRows} matRows={matRows} prtMap={prtMap} today={today} />

      <div className="sjc-header" onClick={() => navigate(`/jobs/${job.job_id}?mode=management`)}>
        <span className="sjc-header-title">{getCardTitle(job, job._wtcs)}</span>
      </div>

      <IdentityRow job={job} />

      <div className="sjc-toggles">
        <button className={`sjc-toggle${panels.planning ? ' open' : ''}`} onClick={() => togglePanel('planning')}>PLANNING</button>
        <button className={`sjc-toggle${panels.management ? ' open' : ''}`} onClick={() => togglePanel('management')}>MANAGEMENT</button>
        <button className={`sjc-toggle${panels.details ? ' open' : ''}`} onClick={() => togglePanel('details')}>DETAILS</button>
        <button className={`sjc-toggle${panels.budget ? ' open' : ''}`} onClick={() => togglePanel('budget')}>BUDGET</button>
      </div>

      {panels.planning && (
        <PlanningPanel
          job={job}
          crewRows={crewRows}
          matRows={matRows}
          assignmentDates={assignmentDates}
          onSowClick={() => { setSowFocus(null); setShowSowModal(true) }}
          onMtrlClick={() => setShowMtrlModal(true)}
          onCrewClick={goCrewSchedule}
          onDateClick={() => setShowDaysModal(true)}
        />
      )}
      {panels.management && (
        <ManagementPanel
          job={job}
          stage={stage}
          logsCount={logsCount}
          prtMap={prtMap}
          onBilledClick={() => navigate('/billing?tab=worklist')}
          onPrtClick={() => goManagementTab('production')}
          onLogsClick={() => goManagementTab('daily-log')}
          onNotesClick={() => setShowNotes(prev => !prev)}
        />
      )}
      {showNotes && (
        <NotesPanel
          job={job}
          changedBy={changedBy}
          onSaved={() => { if (onJobUpdate) onJobUpdate() }}
        />
      )}
      {panels.details && <DetailsPanel job={job} crewRows={crewRows} />}
      {panels.budget && <BudgetPanel job={job} />}

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
        <CardSowModal
          job={job}
          proposalMaterials={proposalMaterials}
          changedBy={changedBy}
          initialWtcId={sowFocus?.wtcId ?? null}
          initialDayIndex={sowFocus?.dayIndex ?? null}
          onClose={() => setShowSowModal(false)}
          onUpdated={() => { if (onJobUpdate) onJobUpdate() }}
          onPrint={() => setShowPrintModal(true)}
        />
      )}

      {showPrintModal && (
        <div className="mbg" onClick={e => { if (e.target === e.currentTarget) setShowPrintModal(false) }}>
          <div className="mdl mdl-lg">
            <FieldSowModal
              job={job}
              onClose={() => setShowPrintModal(false)}
            />
          </div>
        </div>
      )}

      {showMtrlModal && (
        <MaterialsModal
          job={job}
          onClose={() => setShowMtrlModal(false)}
          onUpdated={() => { if (onJobUpdate) onJobUpdate() }}
        />
      )}

      {showDaysModal && (
        <DaysModal
          job={job}
          assignmentDates={assignmentDates}
          onClose={() => setShowDaysModal(false)}
          onDayClick={(wtcId, dayIndex) => {
            // Option-3 handoff: close DAYS, open the canonical SOW modal focused on
            // that WTC + day. DAYS modal writes nothing — it only navigates.
            setShowDaysModal(false)
            setSowFocus({ wtcId, dayIndex })
            setShowSowModal(true)
          }}
        />
      )}
    </div>
  )
}
