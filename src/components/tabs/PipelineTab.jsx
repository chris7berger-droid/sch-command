import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import FieldSowModal from '../FieldSowModal'
import JobCardList from '../JobCardList'

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

function fmtMoney(n) {
  if (n == null || n === '' || isNaN(n)) return '-'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function renderTags(workType) {
  if (!workType) return null
  return workType.split(',').map(t => t.trim()).filter(Boolean).map(t => (
    <span key={t} className={`sch-tg ${gTagClass(t)}`}>{t}</span>
  ))
}

export default function PipelineTab({ filteredJobs, jobs, setJobs, billingLog, setBillingLog, today, reload }) {
  const navigate = useNavigate()
  const [sowJob, setSowJob] = useState(null)

  // Pipeline = incoming work that hasn't started: Parked + Scheduled.
  // Parked renders as the "INCOMING JOBS" card section; Scheduled goes through
  // the standard expandable JobCardList.
  const parked = useMemo(() => filteredJobs.filter(j => getJobStatus(j) === 'Parked'), [filteredJobs])
  const scheduled = useMemo(() => filteredJobs.filter(j => getJobStatus(j) === 'Scheduled'), [filteredJobs])

  const isEmpty = parked.length === 0 && scheduled.length === 0

  return (
    <>
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

      {scheduled.length > 0 ? (
        <JobCardList
          jobs={scheduled}
          allJobs={jobs}
          setJobs={setJobs}
          billingLog={billingLog}
          setBillingLog={setBillingLog}
          today={today}
        />
      ) : (
        isEmpty && <div className="jh-empty">No incoming jobs match this filter</div>
      )}

      {sowJob && <FieldSowModal job={sowJob} onClose={() => setSowJob(null)} onUpdated={() => { reload(); setSowJob(null) }} />}
    </>
  )
}
