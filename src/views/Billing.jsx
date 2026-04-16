import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { loadJobs, updateJobField as auditUpdateJobField, updateJobFields } from '../lib/queries'
import { useUser } from '../lib/user'

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
  const sat = new Date(mon)
  sat.setDate(mon.getDate() + 5)
  const mStr = `${MONTHS[mon.getMonth()]} ${mon.getDate()}`
  const sStr = `${MONTHS[sat.getMonth()]} ${sat.getDate()}`
  return `${mStr} \u2013 ${sStr}, ${sat.getFullYear()}`
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

function getBilledToDate(logs, jobId) {
  let total = 0
  for (let i = 0; i < logs.length; i++) {
    if (String(logs[i].job_id) === String(jobId)) {
      total += parseFloat(logs[i].percent) || 0
    }
  }
  return Math.min(total, 100)
}

function wkEnd(monday) {
  const sat = new Date(monday)
  sat.setDate(monday.getDate() + 5)
  return sat
}

function workTypeTags(wt) {
  if (!wt) return null
  return wt.split(',').filter(Boolean).map(t => (
    <span key={t} className={`rtb-tag ${gTagClass(t)}`}>{t.trim()}</span>
  ))
}

/* ── component ───────────────────────────────────────────────────── */

export default function Billing() {
  const user = useUser()
  const changedBy = user?.name || changedBy
  const [wkStart, setWkStart] = useState(() => getMonday(new Date()))
  const [jobs, setJobs] = useState([])
  const [billingLog, setBillingLog] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNoBill, setShowNoBill] = useState(false)

  /* ── data loading ──────────────────────────────────────────────── */

  const loadData = useCallback(async () => {
    setLoading(true)
    const [jRes, blRes] = await Promise.all([
      loadJobs(),
      supabase.from('billing_log').select('*'),
    ])
    if (jRes.data) setJobs(jRes.data)
    if (blRes.data) setBillingLog(blRes.data)
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  /* ── week nav ──────────────────────────────────────────────────── */

  function navWeek(dir) {
    setWkStart(prev => {
      const d = new Date(prev)
      d.setDate(d.getDate() + dir * 7)
      return d
    })
  }

  function goThisWeek() {
    setWkStart(getMonday(new Date()))
  }

  /* ── derive week boundaries ────────────────────────────────────── */

  const ws = fmtD(wkStart)
  const we = fmtD(wkEnd(wkStart))

  /* ── build pending list ────────────────────────────────────────── */

  const pendingRaw = []
  const noBillJobs = []

  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i]
    const billed = getBilledToDate(billingLog, j.job_id)

    // No-bill jobs: collect separately
    if (j.no_bill === 'Yes') {
      const ed = j.scheduled_end || j.end_date
      if (ed) {
        const je = String(ed).split('T')[0]
        if (je <= we) noBillJobs.push(j)
      }
      continue
    }

    // Complete: end_date within week and not fully billed
    const endDate = j.scheduled_end || j.end_date
    if (endDate) {
      const je = String(endDate).split('T')[0]
      if (je <= we && billed < 100) {
        pendingRaw.push({
          job: j,
          type: 'Complete',
          pct: 100 - billed,
          billed,
          trigger: 'End: ' + je + (je < ws ? ' (overdue)' : ''),
          paused: false,
        })
      }
    }

    // Partial: partial billing enabled, bill date within week, not paused
    if (j.partial_billing === 'Yes' && j.partial_bill_date && j.billing_paused !== 'Yes') {
      const pbd = String(j.partial_bill_date).split('T')[0]
      if (pbd <= we && billed < 100) {
        pendingRaw.push({
          job: j,
          type: 'Partial',
          pct: parseFloat(j.partial_percent) || 0,
          billed,
          trigger: 'Bill: ' + pbd + (pbd < ws ? ' (overdue)' : ''),
          paused: false,
        })
      }
    }

    // Paused partial
    if (j.billing_paused === 'Yes' && j.partial_billing === 'Yes' && billed < 100) {
      pendingRaw.push({
        job: j,
        type: 'Partial',
        pct: parseFloat(j.partial_percent) || 0,
        billed,
        trigger: 'PAUSED' + (j.partial_bill_date ? ' - was: ' + j.partial_bill_date : ''),
        paused: true,
      })
    }
  }

  // Deduplicate by job_id
  const seen = {}
  const pending = []
  for (let i = 0; i < pendingRaw.length; i++) {
    const k = String(pendingRaw[i].job.job_id)
    if (!seen[k]) {
      seen[k] = true
      pending.push(pendingRaw[i])
    }
  }

  /* ── build confirmed + invoiced from billing_log ───────────────── */

  const confirmedBill = []
  const confirmedNB = []
  const invoiced = []

  for (let i = 0; i < billingLog.length; i++) {
    const lg = billingLog[i]
    const ld = String(lg.date).split('T')[0]
    if (ld >= ws && ld <= we) {
      const j2 = jobs.find(j => String(j.job_id) === String(lg.job_id)) || null
      if (lg.invoiced === 'Yes') {
        invoiced.push({ log: lg, job: j2 })
      } else {
        if (j2 && j2.no_bill === 'Yes') {
          confirmedNB.push({ log: lg, job: j2 })
        } else {
          confirmedBill.push({ log: lg, job: j2 })
        }
      }
    }
  }

  /* ── scoreboard counts ─────────────────────────────────────────── */

  let pendingPartialCt = 0
  let pendingCompleteCt = 0
  let pausedCt = 0
  for (let i = 0; i < pending.length; i++) {
    if (pending[i].paused) pausedCt++
    else if (pending[i].type === 'Complete') pendingCompleteCt++
    else pendingPartialCt++
  }

  /* ── actions ───────────────────────────────────────────────────── */

  async function confirmBill(jobId, pct, type) {
    if (!confirm(`Confirm billing ${pct}% (${type})?`)) return
    const today = fmtD(new Date())
    const oldBilled = getBilledToDate(billingLog, jobId)
    const newBilled = Math.min(oldBilled + pct, 100)

    // Insert billing_log row
    const { error: logErr } = await supabase.from('billing_log').insert([{
      job_id: jobId,
      date: today,
      percent: pct,
      cumulative_percent: newBilled,
      type,
      notes: '',
    }])
    if (logErr) { console.error(logErr); return }

    // Update the job
    const updates = { billed_to_date: String(newBilled) }
    if (type === 'Partial' && newBilled < 100) {
      updates.partial_bill_date = null
      updates.partial_percent = null
    }
    if (newBilled >= 100) {
      updates.partial_billing = 'No'
      updates.partial_bill_date = null
      updates.partial_percent = null
    }
    await updateJobFields(jobId, updates, changedBy)
    await loadData()
  }

  async function pauseBill(jobId) {
    await auditUpdateJobField(jobId, 'billing_paused', 'Yes', changedBy)
    await loadData()
  }

  async function unpauseBill(jobId) {
    await auditUpdateJobField(jobId, 'billing_paused', 'No', changedBy)
    await loadData()
  }

  async function rescheduleBill(jobId) {
    const nd = prompt('New billing date (YYYY-MM-DD):')
    if (!nd) return
    await updateJobFields(jobId, { partial_bill_date: nd, billing_paused: 'No' }, changedBy)
    await loadData()
  }

  async function handleUpdateBillingField(jobId, field, value) {
    await auditUpdateJobField(jobId, field, value, changedBy)
    await loadData()
  }

  async function markInvoiced(jobId, date) {
    if (!confirm('Mark this entry as invoiced?')) return
    const today = fmtD(new Date())
    await supabase
      .from('billing_log')
      .update({ invoiced: 'Yes', invoiced_date: today })
      .eq('job_id', jobId)
      .eq('date', date)
    await loadData()
  }

  async function deleteBillLog(jobId, date, pct) {
    if (!confirm(`Delete billing record: ${pct}% on ${date}?`)) return

    // Find and delete the specific log entry
    // We need to find the exact row; use all three fields to identify it
    const { data: matches } = await supabase
      .from('billing_log')
      .select('*')
      .eq('job_id', jobId)
      .eq('date', date)
      .eq('percent', pct)
      .limit(1)

    if (matches && matches.length > 0) {
      const row = matches[0]
      // Delete by all identifying columns
      await supabase
        .from('billing_log')
        .delete()
        .eq('job_id', row.job_id)
        .eq('date', row.date)
        .eq('percent', row.percent)
        .eq('cumulative_percent', row.cumulative_percent)
    }

    // Recalculate billed_to_date for the job
    const { data: remainingLogs } = await supabase
      .from('billing_log')
      .select('percent')
      .eq('job_id', jobId)
    let newBilled = 0
    if (remainingLogs) {
      for (const lg of remainingLogs) newBilled += parseFloat(lg.percent) || 0
    }
    newBilled = Math.min(newBilled, 100)
    await auditUpdateJobField(jobId, 'billed_to_date', String(newBilled), changedBy)
    await loadData()
  }

  /* ── render helpers ────────────────────────────────────────────── */

  function renderPendingCard(it, idx) {
    const j = it.job
    const isPsd = it.paused
    const newTotal = Math.min(it.billed + it.pct, 100)

    // Billing history for this job
    const jobLogs = billingLog.filter(lg => String(lg.job_id) === String(j.job_id))

    return (
      <div
        key={`p-${j.job_id}-${idx}`}
        className={`rtb-card${isPsd ? ' paused' : ''}${it.type === 'Complete' && !isPsd ? ' complete' : ''}`}
      >
        <div className="rtb-hdr">
          <div className="rtb-info">
            <div className="rtb-name">{j.job_num} - {j.job_name}</div>
            <div className="rtb-meta">
              <span style={{ fontWeight: 700, color: it.type === 'Complete' ? 'var(--grn)' : 'var(--cyan)' }}>
                {it.type}{isPsd ? ' (PAUSED)' : ''}
              </span>
              <span>{it.trigger}</span>
              {j.amount && <span>{j.amount}</span>}
              {workTypeTags(j.work_type)}
              {isPW(j) && <span className="pw-tag">PW</span>}
            </div>
          </div>
          <div className="rtb-pct">
            <div className="rtb-bar">
              <div
                className={`rtb-bar-fill${newTotal >= 100 ? ' done' : ''}`}
                style={{ width: `${newTotal}%` }}
              />
            </div>
            <div className={`rtb-pct-lbl${newTotal >= 100 ? ' done' : ''}`}>
              {it.pct}%
            </div>
          </div>
        </div>

        {/* Partial edit fields */}
        {it.type === 'Partial' && (
          <div className="rtb-edit">
            <div className="rtb-edit-grid">
              <div>
                <label>Next Bill Date</label>
                <input
                  className="dinp"
                  type="date"
                  value={j.partial_bill_date || ''}
                  onChange={e => handleUpdateBillingField(j.job_id, 'partial_bill_date', e.target.value)}
                />
              </div>
              <div>
                <label>Bill %</label>
                <input
                  className="dinp"
                  type="number"
                  min="1"
                  max="100"
                  value={j.partial_percent || ''}
                  onChange={e => handleUpdateBillingField(j.job_id, 'partial_percent', e.target.value)}
                />
              </div>
              <div>
                <label>Notes</label>
                <input
                  className="dinp"
                  value={j.billing_notes || ''}
                  onChange={e => handleUpdateBillingField(j.job_id, 'billing_notes', e.target.value)}
                  placeholder="Notes"
                />
              </div>
            </div>
          </div>
        )}

        {/* Billing notes for non-partial */}
        {j.billing_notes && it.type !== 'Partial' && (
          <div style={{ padding: '4px 14px', fontSize: 10, color: 'var(--orn)' }}>
            {j.billing_notes}
          </div>
        )}

        {/* Action buttons */}
        <div className="rtb-acts">
          {!isPsd ? (
            <>
              <button
                className="rtb-btn confirm"
                onClick={() => confirmBill(j.job_id, it.pct, it.type)}
              >
                Confirm
              </button>
              <button className="rtb-btn" onClick={() => pauseBill(j.job_id)}>Pause</button>
            </>
          ) : (
            <>
              <button
                className="rtb-btn unpause"
                onClick={() => unpauseBill(j.job_id)}
              >
                Unpause
              </button>
              <button className="rtb-btn" onClick={() => rescheduleBill(j.job_id)}>
                Reschedule
              </button>
            </>
          )}
        </div>

        {/* History log */}
        {jobLogs.length > 0 && (
          <div className="rtb-log">
            <div className="rtb-log-title">History ({it.billed}% billed)</div>
            {jobLogs.map((lg2, li) => (
              <div key={li} className="rtb-log-row">
                <span className="rtb-log-date">{lg2.date}</span>
                <span>{lg2.percent}% {lg2.type}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  function renderConfirmedCard(c, idx) {
    const lg = c.log
    const j = c.job
    const cumPct = parseFloat(lg.cumulative_percent) || 0

    return (
      <div key={`c-${lg.job_id}-${lg.date}-${idx}`} className="rtb-card complete">
        <div className="rtb-hdr">
          <div className="rtb-info">
            <div className="rtb-name">
              {j ? `${j.job_num} - ${j.job_name}` : `Job ${lg.job_id}`}
            </div>
            <div className="rtb-meta">
              <span style={{ fontWeight: 700, color: 'var(--grn)' }}>{lg.type}</span>
              <span>Confirmed {lg.date}</span>
              {j && j.amount && <span>{j.amount}</span>}
              {j && workTypeTags(j.work_type)}
              {j && isPW(j) && <span className="pw-tag">PW</span>}
            </div>
          </div>
          <div className="rtb-pct">
            <div className="rtb-bar">
              <div
                className={`rtb-bar-fill${cumPct >= 100 ? ' done' : ''}`}
                style={{ width: `${cumPct}%` }}
              />
            </div>
            <div className={`rtb-pct-lbl${cumPct >= 100 ? ' done' : ''}`}>
              {lg.percent}%
            </div>
          </div>
        </div>
        <div className="rtb-acts">
          <div style={{ fontSize: 10, color: 'var(--muted)', flex: 1 }}>
            Cumulative: {cumPct}%{cumPct >= 100 ? ' FULLY BILLED' : ''}
          </div>
          <button
            className="rtb-btn invoiced"
            onClick={() => markInvoiced(lg.job_id, lg.date)}
          >
            Mark Invoiced
          </button>
          <button
            className="rtb-btn delete"
            onClick={() => deleteBillLog(lg.job_id, lg.date, lg.percent)}
          >
            X Delete
          </button>
        </div>
      </div>
    )
  }

  function renderConfirmedNBCard(c, idx) {
    const lg = c.log
    const j = c.job
    const cumPct = parseFloat(lg.cumulative_percent) || 0

    return (
      <div key={`cnb-${lg.job_id}-${lg.date}-${idx}`} className="rtb-card complete" style={{ opacity: 0.5 }}>
        <div className="rtb-hdr">
          <div className="rtb-info">
            <div className="rtb-name">
              {j ? `${j.job_num} - ${j.job_name}` : `Job ${lg.job_id}`}
            </div>
            <div className="rtb-meta">
              <span style={{ fontWeight: 700, color: 'var(--grn)' }}>{lg.type}</span>
              <span>Confirmed {lg.date}</span>
              {j && j.amount && <span>{j.amount}</span>}
              {j && workTypeTags(j.work_type)}
              {j && isPW(j) && <span className="pw-tag">PW</span>}
              <span className="rtb-nb-tag">NO BILL</span>
            </div>
          </div>
          <div className="rtb-pct">
            <div className="rtb-bar">
              <div
                className={`rtb-bar-fill${cumPct >= 100 ? ' done' : ''}`}
                style={{ width: `${cumPct}%` }}
              />
            </div>
            <div className={`rtb-pct-lbl${cumPct >= 100 ? ' done' : ''}`}>
              {lg.percent}%
            </div>
          </div>
        </div>
        <div className="rtb-acts">
          <div style={{ fontSize: 10, color: 'var(--muted)', flex: 1 }}>
            Cumulative: {cumPct}%{cumPct >= 100 ? ' FULLY BILLED' : ''}
          </div>
          <button
            className="rtb-btn delete"
            onClick={() => deleteBillLog(lg.job_id, lg.date, lg.percent)}
          >
            X Delete
          </button>
        </div>
      </div>
    )
  }

  function renderInvoicedCard(c, idx) {
    const lg = c.log
    const j = c.job
    const cumPct = parseFloat(lg.cumulative_percent) || 0

    return (
      <div
        key={`i-${lg.job_id}-${lg.date}-${idx}`}
        className="rtb-card complete"
        style={{ borderLeftColor: 'var(--orn)' }}
      >
        <div className="rtb-hdr">
          <div className="rtb-info">
            <div className="rtb-name">
              {j ? `${j.job_num} - ${j.job_name}` : `Job ${lg.job_id}`}
            </div>
            <div className="rtb-meta">
              <span style={{ fontWeight: 700, color: 'var(--orn)' }}>Invoiced</span>
              <span>{lg.date}</span>
              {j && j.amount && <span>{j.amount}</span>}
              {j && workTypeTags(j.work_type)}
              {j && isPW(j) && <span className="pw-tag">PW</span>}
            </div>
          </div>
          <div className="rtb-pct">
            <div className="rtb-bar">
              <div className="rtb-bar-fill done" style={{ width: `${cumPct}%` }} />
            </div>
            <div className="rtb-pct-lbl done">{lg.percent}%</div>
          </div>
        </div>
        <div className="rtb-acts">
          <div style={{ fontSize: 10, color: 'var(--muted)', flex: 1 }}>
            Invoiced: {lg.invoiced_date || lg.date}
          </div>
          <button
            className="rtb-btn delete"
            onClick={() => deleteBillLog(lg.job_id, lg.date, lg.percent)}
          >
            X Delete
          </button>
        </div>
      </div>
    )
  }

  /* ── main render ───────────────────────────────────────────────── */

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div className="rtb-wrap">
      {/* Week nav */}
      <div className="rtb-wknav">
        <button className="app-act-btn" onClick={() => navWeek(-1)}>Prev</button>
        <div className="rtb-wklbl">{fmtWk(wkStart)}</div>
        <button className="app-act-btn" onClick={() => navWeek(1)}>Next</button>
        <button className="app-act-btn" onClick={goThisWeek}>This Week</button>
      </div>

      {/* Scoreboard */}
      <div className="rtb-scores">
        <div className="rtb-score">
          <div className="rtb-score-num" style={{ color: 'var(--cyan)' }}>{pendingPartialCt}</div>
          <div className="rtb-score-lbl">Pending Partial</div>
        </div>
        <div className="rtb-score">
          <div className="rtb-score-num" style={{ color: 'var(--grn)' }}>{pendingCompleteCt}</div>
          <div className="rtb-score-lbl">Pending Complete</div>
        </div>
        <div className="rtb-score">
          <div className="rtb-score-num" style={{ color: 'var(--ylw)' }}>{pausedCt}</div>
          <div className="rtb-score-lbl">Paused</div>
        </div>
        <div className="rtb-score">
          <div className="rtb-score-num" style={{ color: 'var(--grn)' }}>{confirmedBill.length}</div>
          <div className="rtb-score-lbl">Confirmed</div>
        </div>
        <div className="rtb-score">
          <div className="rtb-score-num" style={{ color: 'var(--orn)' }}>{invoiced.length}</div>
          <div className="rtb-score-lbl">Invoiced</div>
        </div>
        <div className="rtb-score">
          <div className="rtb-score-num" style={{ color: '#999' }}>{noBillJobs.length}</div>
          <div className="rtb-score-lbl">No Bill</div>
        </div>
      </div>

      {/* 3-column pipeline */}
      <div className="rtb-cols">
        {/* Pending column */}
        <div>
          <div className="rtb-col-hdr pending">Pending ({pending.length})</div>
          {pending.length === 0 && (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--dim)', fontSize: 12 }}>
              No items pending
            </div>
          )}
          {pending.map((it, idx) => renderPendingCard(it, idx))}

          {/* No Bill section at bottom of pending column */}
          {noBillJobs.length > 0 && (
            <div style={{ marginTop: 16, borderTop: '1px solid var(--brd)', paddingTop: 12 }}>
              <div
                className="rtb-nb-toggle"
                onClick={() => setShowNoBill(!showNoBill)}
              >
                No Bill Jobs ({noBillJobs.length}) {showNoBill ? '\u25B4' : '\u25BE'}
              </div>
              {showNoBill && noBillJobs.map((nj, ni) => (
                <div
                  key={`nb-${nj.job_id}-${ni}`}
                  className="rtb-card"
                  style={{ borderLeftColor: '#999', opacity: 0.7 }}
                >
                  <div className="rtb-hdr">
                    <div className="rtb-info">
                      <div className="rtb-name">{nj.job_num} - {nj.job_name}</div>
                      <div className="rtb-meta">
                        <span className="rtb-nb-tag">NO BILL</span>
                        {workTypeTags(nj.work_type)}
                        {isPW(nj) && <span className="pw-tag">PW</span>}
                        {nj.amount && <span>{nj.amount}</span>}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--orn)', marginTop: 3 }}>
                        Reason: {nj.no_bill_reason || <em style={{ color: 'var(--red)' }}>No reason provided</em>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Confirmed column */}
        <div>
          <div className="rtb-col-hdr confirmed">Confirmed This Week ({confirmedBill.length})</div>
          {confirmedBill.length === 0 && (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--dim)', fontSize: 12 }}>
              Nothing confirmed yet
            </div>
          )}
          {confirmedBill.map((c, idx) => renderConfirmedCard(c, idx))}

          {/* No-bill confirmed divider */}
          {confirmedNB.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0 6px', marginTop: 8 }}>
                <div style={{ flex: 1, height: 1, background: 'var(--brd)' }} />
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--dim)', whiteSpace: 'nowrap', letterSpacing: '.04em' }}>
                  No bill — confirmed
                </div>
                <div style={{ flex: 1, height: 1, background: 'var(--brd)' }} />
              </div>
              {confirmedNB.map((c, idx) => renderConfirmedNBCard(c, idx))}
            </>
          )}
        </div>

        {/* Invoiced column */}
        <div>
          <div className="rtb-col-hdr invoiced">Invoiced This Week ({invoiced.length})</div>
          {invoiced.length === 0 && (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--dim)', fontSize: 12 }}>
              None invoiced yet
            </div>
          )}
          {invoiced.map((c, idx) => renderInvoicedCard(c, idx))}
        </div>
      </div>
    </div>
  )
}
