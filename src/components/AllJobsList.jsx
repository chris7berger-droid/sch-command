import { useMemo } from 'react'
import { getJobStatus } from '../lib/jobStatus'
import { isReady } from '../lib/queries'
import StagedCardList from './StagedCardList'

// All Jobs is heterogeneous (every status at once), so it groups jobs into the
// same lifecycle stages as the picker and renders each group with the shared
// StageJobCard (via StagedCardList) — no more old-style JobCardList. Section
// order matches the picker tiles.
const STAGE_SECTIONS = [
  { stage: 'staged', label: 'Staged' },
  { stage: 'ready', label: 'Ready' },
  { stage: 'active', label: 'Active' },
  { stage: 'on-hold', label: 'On Hold' },
  { stage: 'complete', label: 'Production Complete' },
]

function stageOf(j, crewByCallLog, matsByJobId) {
  const s = getJobStatus(j)
  if (s === 'Scheduled') return isReady(j, crewByCallLog, matsByJobId) ? 'ready' : 'staged'
  if (s === 'On Hold') return 'on-hold'
  if (s === 'Complete') return 'complete'
  return 'active' // In Progress / Ongoing
}

export default function AllJobsList({
  jobs = [],
  crewByCallLog = {},
  matsByJobId = {},
  logsByCallLog = {},
  assignmentsByJobId = {},
  proposalMaterialsByCallLog = {},
  mobsByCallLog = {},
  prtMap = new Map(),
  today = new Date(),
  onJobUpdate,
  emptyText = 'No jobs match the current filters',
}) {
  const byStage = useMemo(() => {
    const groups = { staged: [], ready: [], active: [], 'on-hold': [], complete: [] }
    for (const j of jobs) groups[stageOf(j, crewByCallLog, matsByJobId)].push(j)
    return groups
  }, [jobs, crewByCallLog, matsByJobId])

  if (!jobs.length) return <div className="jh-empty">{emptyText}</div>

  return (
    <div className="jh-all-groups">
      {STAGE_SECTIONS.map(({ stage, label }) => {
        const groupJobs = byStage[stage]
        if (!groupJobs.length) return null
        return (
          <section key={stage} className="jh-all-group">
            <h3 className="jh-all-group-title">
              {label}<span className="jh-all-group-count">{groupJobs.length}</span>
            </h3>
            <StagedCardList
              jobs={groupJobs}
              stage={stage}
              crewByCallLog={crewByCallLog}
              matsByJobId={matsByJobId}
              logsByCallLog={logsByCallLog}
              assignmentsByJobId={assignmentsByJobId}
              proposalMaterialsByCallLog={proposalMaterialsByCallLog}
              mobsByCallLog={mobsByCallLog}
              prtMap={prtMap}
              today={today}
              onJobUpdate={onJobUpdate}
            />
          </section>
        )
      })}
    </div>
  )
}
