import StageJobCard from './StageJobCard'

function effectiveStart(j) { return j.scheduled_start || j.start_date || null }
function effectiveEnd(j) { return j.scheduled_end || j.end_date || null }

function getSorter(stage) {
  if (stage === 'staged' || stage === 'ready') {
    return (a, b) => {
      const aDate = effectiveStart(a)
      const bDate = effectiveStart(b)
      if (aDate === null && bDate === null) return 0
      if (aDate === null) return -1
      if (bDate === null) return 1
      return aDate.localeCompare(bDate)
    }
  }
  if (stage === 'active') {
    return (a, b) => {
      const aDate = effectiveEnd(a)
      const bDate = effectiveEnd(b)
      if (aDate === null && bDate === null) return 0
      if (aDate === null) return 1
      if (bDate === null) return -1
      return aDate.localeCompare(bDate)
    }
  }
  if (stage === 'on-hold') {
    return (a, b) => {
      const aDate = a.status_changed_at || effectiveStart(a) || ''
      const bDate = b.status_changed_at || effectiveStart(b) || ''
      return aDate.localeCompare(bDate)
    }
  }
  if (stage === 'complete') {
    return (a, b) => {
      const aDate = effectiveEnd(a) || ''
      const bDate = effectiveEnd(b) || ''
      return bDate.localeCompare(aDate)
    }
  }
  return () => 0
}

export default function StagedCardList({ jobs, stage = 'staged', crewByCallLog = {}, matsByJobId = {}, logsByCallLog = {}, assignmentsByJobId = {}, billingLog = [], prtMap = new Map(), today = new Date(), onJobUpdate, emptyText = 'No staged jobs' }) {
  const sorted = [...jobs].sort(getSorter(stage))

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
          logsByCallLog={logsByCallLog}
          assignmentsByJobId={assignmentsByJobId}
          billingLog={billingLog}
          prtMap={prtMap}
          today={today}
          onJobUpdate={onJobUpdate}
        />
      ))}
    </div>
  )
}
