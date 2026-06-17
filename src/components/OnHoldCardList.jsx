import { useMemo } from 'react'
import { getJobStatus } from '../lib/jobStatus'
import StageJobCard from './StageJobCard'

export default function OnHoldCardList({ filteredJobs, jobs, setJobs, billingLog, setBillingLog, today, crewByCallLog = {}, matsByJobId = {}, logsByCallLog = {}, assignmentsByJobId = {}, proposalMaterialsByCallLog = {}, prtMap = new Map(), onJobUpdate }) {
  const onHold = useMemo(
    () => filteredJobs.filter(j => getJobStatus(j) === 'On Hold'),
    [filteredJobs]
  )

  if (!onHold.length) {
    return <div className="jh-empty">No jobs on hold</div>
  }

  return (
    <div className="jh-list">
      {onHold.map(j => (
        <StageJobCard
          key={j.job_id}
          job={j}
          stage="on-hold"
          crewByCallLog={crewByCallLog}
          matsByJobId={matsByJobId}
          logsByCallLog={logsByCallLog}
          assignmentsByJobId={assignmentsByJobId}
          proposalMaterialsByCallLog={proposalMaterialsByCallLog}
          billingLog={billingLog}
          prtMap={prtMap}
          today={today}
          onJobUpdate={onJobUpdate}
        />
      ))}
    </div>
  )
}
