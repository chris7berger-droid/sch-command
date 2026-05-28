import StageJobCard from './StageJobCard'

export default function StagedCardList({ jobs, stage = 'staged', crewByCallLog = {}, matsByJobId = {}, billingLog = [], prtMap = new Map(), today = new Date(), onJobUpdate, emptyText = 'No staged jobs' }) {
  const sorted = [...jobs].sort((a, b) => {
    const aDate = a.scheduled_start || a.start_date || null
    const bDate = b.scheduled_start || b.start_date || null
    if (aDate === null && bDate === null) return 0
    if (aDate === null) return -1
    if (bDate === null) return 1
    return aDate.localeCompare(bDate)
  })

  if (!sorted.length) return <div className="jh-empty">{emptyText}</div>

  return (
    <div className="jh-list">
      {sorted.map(j => (
        <StageJobCard
          key={j.job_id}
          job={j}
          stage={stage}
          crewByCallLog={crewByCallLog}
          matsByJobId={matsByJobId}
          billingLog={billingLog}
          prtMap={prtMap}
          today={today}
          onJobUpdate={onJobUpdate}
        />
      ))}
    </div>
  )
}
