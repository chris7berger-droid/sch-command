import { useMemo, useCallback } from 'react'
import JobCardList from './JobCardList'
import { getJobStatus } from '../lib/jobStatus'
import { updateJobField } from '../lib/queries'
import { useUser } from '../lib/user'

// On Hold list — reuses JobCardList for billing/contract visibility, since
// held jobs often have prior partial billing that's still relevant.
// Adds a "Resume to Scheduled" affordance per the IA return-path requirement.
export default function OnHoldCardList({ filteredJobs, jobs, setJobs, billingLog, setBillingLog, today }) {
  const user = useUser()
  const changedBy = user?.name || 'unknown'

  const onHold = useMemo(
    () => filteredJobs.filter(j => getJobStatus(j) === 'On Hold'),
    [filteredJobs]
  )

  const resume = useCallback(async (jobId) => {
    const { error: err } = await updateJobField(jobId, 'status', 'Scheduled', changedBy)
    if (err) { console.error(err); return }
    setJobs(prev => prev.map(j => j.job_id === jobId ? { ...j, status: 'Scheduled' } : j))
  }, [setJobs, changedBy])

  if (!onHold.length) {
    return <div className="jh-empty">No jobs on hold</div>
  }

  return (
    <>
      <div className="oh-resume-row">
        <span className="oh-resume-hint">Use "Resume" to return a held job to the Scheduled tab.</span>
      </div>
      <div className="jh-list">
        {onHold.map(j => (
          <div key={j.job_id} className="oh-card-wrap">
            <button
              className="oh-resume-btn"
              onClick={() => resume(j.job_id)}
              title="Move this job back to Scheduled"
            >
              ↶ Resume to Scheduled
            </button>
            <JobCardList
              jobs={[j]}
              allJobs={jobs}
              setJobs={setJobs}
              billingLog={billingLog}
              setBillingLog={setBillingLog}
              today={today}
              emptyText=""
            />
          </div>
        ))}
      </div>
    </>
  )
}
