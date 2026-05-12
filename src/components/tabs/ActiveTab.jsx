import { useMemo } from 'react'
import JobCardList from '../JobCardList'
import { getJobStatus } from '../../lib/jobStatus'

// Active = jobs the field crew is currently producing on (status = In Progress).
// M2's approval queue lands here when built — DPR/PRT review for in-flight jobs.
export default function ActiveTab({ filteredJobs, jobs, setJobs, billingLog, setBillingLog, today }) {
  const inProgress = useMemo(
    () => filteredJobs.filter(j => getJobStatus(j) === 'In Progress'),
    [filteredJobs]
  )

  return (
    <JobCardList
      jobs={inProgress}
      allJobs={jobs}
      setJobs={setJobs}
      billingLog={billingLog}
      setBillingLog={setBillingLog}
      today={today}
      emptyText="No active jobs in this date range"
    />
  )
}
