import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { updateJobStatus, updateJobFields } from '../lib/queries'
import { useUser } from '../lib/user'
import { getJobStatus } from '../lib/jobStatus'
import { getCardTitle, getWtcChips } from '../lib/jobCardLabel'

/* ── helpers ─────────────────────────────────────────────────────── */

function isPW(j) {
  return j && (j.prevailing_wage === 'Yes' || j.prevailing_wage === true)
}

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

function getJobFlags(job, today) {
  const flags = []
  const status = getJobStatus(job)

  const endDate = effectiveEnd(job)
  if ((status === 'Ongoing' || status === 'Scheduled' || status === 'In Progress') && endDate) {
    const daysLeft = daysBetween(endDate, today)
    if (daysLeft !== null && daysLeft < 0) flags.push('OVERDUE')
  }

  // Billing-derived flags (UNBILLED / READY TO INVOICE) removed: they were
  // computed off the retired billing_log percent placeholder. Billing status
  // now lives on the /billing worklist.
  return flags
}

function renderTags(workType) {
  if (!workType) return null
  return workType.split(',').map(t => t.trim()).filter(Boolean).map(t => (
    <span key={t} className={`sch-tg ${gTagClass(t)}`}>{t}</span>
  ))
}

/* ── component ──────────────────────────────────────────────────── */

export default function JobCardList({ jobs, setJobs, today, emptyText = 'No jobs match this filter' }) {
  const navigate = useNavigate()
  const user = useUser()
  const changedBy = user?.name || changedBy

  const [expandedId, setExpandedId] = useState(null)

  const toggleExpand = useCallback((job) => {
    setExpandedId(prev => prev === job.job_id ? null : job.job_id)
  }, [])

  const updateStatus = useCallback(async (jobId, newStatus) => {
    // Stage-sync chokepoint (SCH3): updateJobStatus resolves + writes the paired
    // call_log.stage internally, so the old inline stageMap (which omitted On
    // Hold and dropped held jobs from the crew) is gone.
    const { error: err } = await updateJobStatus(jobId, newStatus, changedBy)
    if (err) { console.error(err); return }
    setJobs(prev => prev.map(j => j.job_id === jobId ? { ...j, status: newStatus } : j))
  }, [setJobs, changedBy])

  const softDelete = useCallback(async (jobId, jobName) => {
    if (!window.confirm(`Delete "${jobName}"? It can be restored within 24 hours.`)) return
    const now = new Date().toISOString()
    const { error: err } = await updateJobFields(jobId, { deleted: 'Yes', deleted_at: now }, changedBy)
    if (err) { console.error(err); return }
    setJobs(prev => prev.filter(j => j.job_id !== jobId))
    if (expandedId === jobId) setExpandedId(null)
  }, [expandedId, setJobs, changedBy])

  if (!jobs.length) return <div className="jh-empty">{emptyText}</div>

  return (
    <div className="jh-list">
      {jobs.map(j => {
        const status = getJobStatus(j)
        const statusClass = status === 'Ongoing' || status === 'Scheduled' || status === 'In Progress' ? 'og' : status === 'On Hold' ? 'oh' : 'cp'
        const amount = j.amount ? parseFloat(j.amount) : 0
        const daysLeft = daysBetween(effectiveEnd(j), today)
        const flags = getJobFlags(j, today)
        const isExpanded = expandedId === j.job_id

        return (
          <div key={j.job_id} className={`jh-card${isPW(j) ? ' pw-row' : ''}${isExpanded ? ' expanded' : ''}`}>
            <div className="jh-card-hdr" onClick={() => toggleExpand(j)}>
              <div className="jh-card-left">
                <span className={`jh-status-badge ${statusClass}`}>{status}</span>
                <div className="jh-card-title">
                  <span className="jh-card-name">{getCardTitle(j, j._wtcs)}</span>
                  {j.is_change_order && <span className="jh-co-tag">CO{j.co_number || ''}</span>}
                  {j.proposal_number && <span className="jh-proposal-tag">P{j.proposal_number}</span>}
                </div>
                {getWtcChips(j._wtcs).length > 0 && (
                  <div className="sch-wtc-chips">
                    {getWtcChips(j._wtcs).map(c => (
                      <span key={c} className="sch-wtc-chip">{c}</span>
                    ))}
                  </div>
                )}
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

              <div className="jh-card-meta">
                {amount > 0 && (
                  <span className="jh-money">{fmtMoney(amount)}</span>
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
                    value={status}
                    onChange={e => updateStatus(j.job_id, e.target.value)}
                    onClick={e => e.stopPropagation()}
                  >
                    <option value="Scheduled">Scheduled</option>
                    <option value="In Progress">In Progress</option>
                    <option value="On Hold">On Hold</option>
                    <option value="Complete">Complete</option>
                  </select>

                  {/* "Job Planning" deep-link removed (remediation step 3) — JobDetail
                      planning is deprecated; SOW edits happen in the in-card modal. */}
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
  )
}
