import { useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { updateJobField, updateJobFields, updateCallLogStage } from '../../lib/queries'
import { useUser } from '../../lib/user'
import FieldSowModal from '../FieldSowModal'

/* ── helpers ─────────────────────────────────────────────────────── */

function fmtD(d) {
  const dt = d instanceof Date ? d : new Date(d)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
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

function getJobFlags(job, billingLog, today) {
  const flags = []
  const status = getJobStatus(job)

  const endDate = effectiveEnd(job)
  if ((status === 'Ongoing' || status === 'Scheduled' || status === 'In Progress') && endDate) {
    const daysLeft = daysBetween(endDate, today)
    if (daysLeft !== null && daysLeft < 0) flags.push('OVERDUE')
  }

  if (status !== 'Complete' && job.amount && parseFloat(job.amount) > 0 && job.no_bill !== 'Yes') {
    const billed = getBilledTotal(billingLog, job.job_id)
    if (billed === 0) flags.push('UNBILLED')
  }

  if (job.partial_billing === 'Yes' && job.billing_paused !== 'Yes' && job.amount && parseFloat(job.amount) > 0) {
    const billed = getBilledTotal(billingLog, job.job_id)
    if (billed < 100) flags.push('READY TO INVOICE')
  }

  return flags
}

/* ── component ──────────────────────────────────────────────────── */

export default function PipelineTab({ filteredJobs, jobs, setJobs, billingLog, setBillingLog, today, reload }) {
  const navigate = useNavigate()
  const user = useUser()
  const changedBy = user?.name || changedBy

  const [expandedId, setExpandedId] = useState(null)
  const [, setJobAssignments] = useState([])
  const [, setLoadingHistory] = useState(false)
  const [pctInput, setPctInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [amountInput, setAmountInput] = useState('')
  const [, setSavingAmount] = useState(false)

  const [sowJob, setSowJob] = useState(null)

  // tab buckets — split parked into its own section, rest into main list
  const parked = useMemo(() => filteredJobs.filter(j => getJobStatus(j) === 'Parked'), [filteredJobs])
  const mainList = useMemo(() => filteredJobs.filter(j => getJobStatus(j) !== 'Parked'), [filteredJobs])

  /* ── status update ──────────────────────────────────────────── */

  const updateStatus = useCallback(async (jobId, newStatus) => {
    const job = jobs.find(j => j.job_id === jobId)
    const { error: err } = await updateJobField(jobId, 'status', newStatus, changedBy)
    if (err) { console.error(err); return }
    if (job?.call_log_id) {
      const stageMap = { 'Scheduled': 'Scheduled', 'In Progress': 'In Progress', 'Complete': 'Complete' }
      if (stageMap[newStatus]) {
        await updateCallLogStage(job.call_log_id, stageMap[newStatus], changedBy)
      }
    }
    setJobs(prev => prev.map(j => j.job_id === jobId ? { ...j, status: newStatus } : j))
  }, [jobs, setJobs, changedBy])

  /* ── soft delete ────────────────────────────────────────────── */

  const softDelete = useCallback(async (jobId, jobName) => {
    if (!window.confirm(`Delete "${jobName}"? It can be restored within 24 hours.`)) return
    const now = new Date().toISOString()
    const { error: err } = await updateJobFields(jobId, { deleted: 'Yes', deleted_at: now }, changedBy)
    if (err) { console.error(err); return }
    setJobs(prev => prev.filter(j => j.job_id !== jobId))
    if (expandedId === jobId) setExpandedId(null)
  }, [expandedId, setJobs, changedBy])

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
    const { data, error } = await supabase
      .from('assignments')
      .select('crew_name, date')
      .eq('job_id', job.job_id)
      .order('date', { ascending: false })
    if (error) { console.error(error); setJobAssignments([]) }
    else { setJobAssignments(data || []) }
    setLoadingHistory(false)
  }, [expandedId])

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
    const { data } = await supabase.from('billing_log').select('*')
    if (data) setBillingLog(data)
    setPctInput('')
    setSaving(false)
  }, [pctInput, billingLog, setBillingLog])

  /* ── work type tags renderer ────────────────────────────────── */

  function renderTags(workType) {
    if (!workType) return null
    return workType.split(',').map(t => t.trim()).filter(Boolean).map(t => (
      <span key={t} className={`sch-tg ${gTagClass(t)}`}>{t}</span>
    ))
  }

  /* ── render ─────────────────────────────────────────────────── */

  return (
    <>
      {/* parked / incoming jobs section */}
      {parked.length > 0 && (
        <div className="jh-parked-section">
          <div className="jh-parked-header">INCOMING JOBS</div>
          <div className="jh-list">
            {parked.map(j => (
              <div key={j.job_id} className="jh-card parked">
                <div className="jh-card-hdr">
                  <div className="jh-card-left">
                    <span className="jh-status-badge pk">Parked</span>
                    <div className="jh-card-title">
                      <span className="jh-card-num">{j.job_num}</span>
                      <span className="jh-card-name">{j.job_name}</span>
                      {j.is_change_order && <span className="jh-co-tag">CO{j.co_number || ''}</span>}
                      {j.proposal_number && <span className="jh-proposal-tag">P{j.proposal_number}</span>}
                    </div>
                  </div>
                </div>
                <div className="jh-card-body">
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
                <div className="jh-parked-actions">
                  <button
                    className="jh-view-btn"
                    onClick={() => navigate(`/jobs/${j.job_id}?mode=planning`)}
                  >
                    Job Planning
                  </button>
                  <button
                    className="jh-view-btn"
                    onClick={() => navigate(`/jobs/${j.job_id}?mode=management`)}
                  >
                    Job Management
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* main job list (excludes parked) */}
      <div className="jh-list">
        {mainList.length === 0 && parked.length === 0 && <div className="jh-empty">No jobs match this filter</div>}
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
              <div className="jh-card-hdr" onClick={() => toggleExpand(j)}>
                <div className="jh-card-left">
                  <span className={`jh-status-badge ${statusClass}`}>{status}</span>
                  <div className="jh-card-title">
                    <span className="jh-card-num">{j.job_num}</span>
                    <span className="jh-card-name">{j.job_name}</span>
                    {j.is_change_order && <span className="jh-co-tag">CO{j.co_number || ''}</span>}
                    {j.proposal_number && <span className="jh-proposal-tag">P{j.proposal_number}</span>}
                  </div>
                </div>
                <div className="jh-card-right">
                  {daysLeft !== null && status !== 'Complete' && (
                    <span className={`jh-days${daysLeft < 0 ? ' overdue' : daysLeft <= 7 ? ' soon' : ''}`}>
                      {daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`}
                    </span>
                  )}
                  <span className="jh-expand-arrow">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </div>

              <div className="jh-card-body" onClick={() => toggleExpand(j)}>
                <div className="jh-card-tags">
                  {renderTags(j.work_type)}
                  {isPW(j) && <span className="pw-tag">PW</span>}
                  {j.no_bill === 'Yes' && <span className="nb-tag">NO BILL</span>}
                </div>

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

              {isExpanded && (
                <div className="jh-card-detail">
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
                      onClick={e => { e.stopPropagation(); navigate(`/jobs/${j.job_id}?mode=planning`) }}
                    >
                      Job Planning
                    </button>
                    <button
                      className="jh-view-btn"
                      onClick={e => { e.stopPropagation(); navigate(`/jobs/${j.job_id}?mode=management`) }}
                    >
                      Job Management
                    </button>
                    <button
                      className="jh-del-btn"
                      onClick={e => { e.stopPropagation(); softDelete(j.job_id, `${j.job_num} - ${j.job_name}`) }}
                    >
                      {'🗑'} Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {sowJob && <FieldSowModal job={sowJob} onClose={() => setSowJob(null)} onUpdated={() => { reload(); setSowJob(null) }} />}
    </>
  )
}
