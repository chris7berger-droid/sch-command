import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getJobStatus } from '../lib/jobStatus'
import { getJobMultiWeekAlert, isReady, hasFieldSow } from '../lib/queries'
import { getMonday } from '../lib/weeks'

function isThisWeek(dateStr, today) {
  if (!dateStr) return false
  const d = new Date(dateStr + 'T00:00:00')
  const mon = getMonday(today)
  const sun = new Date(mon)
  sun.setDate(sun.getDate() + 6)
  return d >= mon && d <= sun
}

export default function JobsPicker({ jobs = [], assignments = [], billingWorklist = [], crewByCallLog = {}, matsByJobId = {}, syncWarning, today = new Date(), onPick }) {
  const counts = useMemo(() => {
    const buckets = { Scheduled: 0, 'In Progress': 0, Complete: 0, 'On Hold': 0, Ongoing: 0 }
    jobs.forEach(j => { buckets[getJobStatus(j)] = (buckets[getJobStatus(j)] || 0) + 1 })

    const scheduled = jobs.filter(j => getJobStatus(j) === 'Scheduled')
    const readyCount = scheduled.filter(j => isReady(j, crewByCallLog, matsByJobId)).length
    const stagedCount = scheduled.length - readyCount

    let missingSow = 0, missingMats = 0, missingCrew = 0, missingDate = 0
    scheduled.filter(j => !isReady(j, crewByCallLog, matsByJobId)).forEach(j => {
      if (!hasFieldSow(j)) missingSow++
      const mats = matsByJobId[j.job_id] || []
      if (mats.length > 0 && mats.some(m => ['Not Ordered', 'Delayed'].includes(m.status))) missingMats++
      if ((crewByCallLog[j.call_log_id] || []).length === 0) missingCrew++
      if ((j.scheduled_start || j.start_date) == null) missingDate++
    })

    const startingThisWeek = scheduled.filter(j =>
      isReady(j, crewByCallLog, matsByJobId) && isThisWeek(j.scheduled_start || j.start_date, today)
    ).length
    // Lightweight landing proxy (D2): Complete jobs not manually marked
    // "nothing to bill". Uses the cheap billing_worklist signal — NO invoice
    // join on first paint. The exact invoice-reconciled needs-triage count
    // lives on the /billing worklist surface itself.
    const nothingToBill = new Set(
      (billingWorklist || []).filter(o => o.nothing_to_bill).map(o => String(o.job_id))
    )
    const readyToBill = jobs.filter(j =>
      getJobStatus(j) === 'Complete' && !nothingToBill.has(String(j.job_id))
    ).length
    return {
      scheduled: buckets.Scheduled,
      staged: stagedCount,
      ready: readyCount,
      inProgress: buckets['In Progress'],
      complete: buckets.Complete,
      onHold: buckets['On Hold'],
      total: jobs.length,
      startingThisWeek,
      readyToBill,
      missingSow, missingMats, missingCrew, missingDate,
    }
  }, [jobs, billingWorklist, crewByCallLog, matsByJobId, today])

  const multiWeekAlertCount = useMemo(() =>
    jobs.filter(j =>
      getJobStatus(j) === 'Scheduled' &&
      isReady(j, crewByCallLog, matsByJobId) &&
      getJobMultiWeekAlert(j, assignments, today) > 0
    ).length
  , [jobs, assignments, crewByCallLog, matsByJobId, today])

  const navigate = useNavigate()
  const goTab = (key) => onPick ? onPick(key) : navigate(`/jobs?tab=${key}`)
  const goSchedule = () => navigate('/schedule')
  const goBilling = () => navigate('/billing')
  const goForecast = () => navigate('/billing/forecast')
  const goProductionRate = () => navigate('/production-rate')
  const goBudget = () => navigate('/budget')
  const goDaily = () => navigate('/daily')

  return (
    <div className="jh-picker">
      <div className="jh-picker-intro">
        <h2 className="jh-picker-title">What do you want to look at?</h2>
        <div className="jh-picker-sub">Pick a stage to focus on, or view everything at once.</div>
      </div>

      {syncWarning && (
        <div className="jh-sync-warning">{syncWarning}</div>
      )}

      <section className="jh-picker-section">
        <h3 className="jh-picker-section-title">Job Crew & Schedule Stages</h3>
        <div className="jh-picker-grid">

          <button className="jh-tile jh-tile-staged" onClick={() => goTab('staged')}>
            <div className="jh-tile-head">
              <div className="jh-tile-name"><span className="jh-tile-dot" />Staged</div>
              <div className="jh-tile-count">{counts.staged}</div>
            </div>
            <div className="jh-tile-desc">Just arrived from Sales. Build Field SOW, assign crew, decide materials.</div>
            <div className="jh-tile-foot">
              <span className="jh-tile-attn jh-tile-attn-icons">
                {counts.missingSow > 0 && <span>{'📋'} {counts.missingSow}</span>}
                {counts.missingMats > 0 && <span>{'📦'} {counts.missingMats}</span>}
                {counts.missingCrew > 0 && <span>{'👷'} {counts.missingCrew}</span>}
                {counts.missingDate > 0 && <span>{'📅'} {counts.missingDate}</span>}
                {counts.staged === 0 && <span>All prepped</span>}
              </span>
              <span className="jh-tile-arrow">&rarr;</span>
            </div>
          </button>

          <button className="jh-tile jh-tile-scheduled" onClick={() => goTab('scheduled')}>
            <div className="jh-tile-head">
              <div className="jh-tile-name"><span className="jh-tile-dot" />Ready</div>
              <div className="jh-tile-count">{counts.ready}</div>
            </div>
            <div className="jh-tile-desc">All prep complete. Awaiting kickoff.</div>
            <div className="jh-tile-foot">
              <span className="jh-tile-attn">
                {multiWeekAlertCount > 0
                  ? `${multiWeekAlertCount} multi-week need crew`
                  : `${counts.startingThisWeek} starting this week`}
              </span>
              <span className="jh-tile-arrow">&rarr;</span>
            </div>
          </button>

          <button className="jh-tile jh-tile-active" onClick={() => goTab('active')}>
            <div className="jh-tile-head">
              <div className="jh-tile-name"><span className="jh-tile-dot" />Active</div>
              <div className="jh-tile-count">{counts.inProgress}</div>
            </div>
            <div className="jh-tile-desc">Production in progress. Daily PRTs, photos, and progress tracking.</div>
            <div className="jh-tile-foot">
              <span className="jh-tile-attn">&mdash; behind target</span>
              <span className="jh-tile-arrow">&rarr;</span>
            </div>
          </button>

          <button className="jh-tile jh-tile-on-hold" onClick={() => goTab('on-hold')}>
            <div className="jh-tile-head">
              <div className="jh-tile-name"><span className="jh-tile-dot" />On Hold</div>
              <div className="jh-tile-count">{counts.onHold}</div>
            </div>
            <div className="jh-tile-desc">Paused mid-pipeline. Resume back to Scheduled when ready.</div>
            <div className="jh-tile-foot">
              <span className="jh-tile-attn">&mdash; return path</span>
              <span className="jh-tile-arrow">&rarr;</span>
            </div>
          </button>

          <button className="jh-tile jh-tile-all" onClick={() => goTab('all')}>
            <div className="jh-tile-head">
              <div className="jh-tile-name">All Jobs</div>
              <div className="jh-tile-count">{counts.total}</div>
            </div>
            <div className="jh-tile-desc">Every active job in one view, segmented by lifecycle stage.</div>
            <div className="jh-tile-foot">
              <span className="jh-tile-attn">5 stages &middot; all jobs</span>
              <span className="jh-tile-arrow">&rarr;</span>
            </div>
          </button>

          <button className="jh-tile jh-tile-schedule" onClick={goSchedule}>
            <div className="jh-tile-head">
              <div className="jh-tile-name"><span className="jh-tile-dot" />Live Schedule</div>
              <div className="jh-tile-count">{counts.scheduled + counts.inProgress}</div>
            </div>
            <div className="jh-tile-desc">This week's crew board &mdash; who's where, day by day.</div>
            <div className="jh-tile-foot">
              <span className="jh-tile-attn">Open weekly grid</span>
              <span className="jh-tile-arrow">&rarr;</span>
            </div>
          </button>

        </div>
      </section>

      <section className="jh-picker-section">
        <h3 className="jh-picker-section-title">Job Management Stages</h3>
        <div className="jh-picker-grid">

          <button className="jh-tile jh-tile-complete" onClick={() => goTab('complete')}>
            <div className="jh-tile-head">
              <div className="jh-tile-name"><span className="jh-tile-dot" />Production Complete</div>
              <div className="jh-tile-count">{counts.complete}</div>
            </div>
            <div className="jh-tile-desc">Crew off site, work finished. Hand off to billing.</div>
            <div className="jh-tile-foot">
              <span className="jh-tile-attn">{counts.readyToBill} ready to bill</span>
              <span className="jh-tile-arrow">&rarr;</span>
            </div>
          </button>

          <button className="jh-tile jh-tile-billing" onClick={goBilling}>
            <div className="jh-tile-head">
              <div className="jh-tile-name"><span className="jh-tile-dot" />Ready to Bill</div>
              <div className="jh-tile-count">{counts.readyToBill}</div>
            </div>
            <div className="jh-tile-desc">Complete, not fully billed. Awaiting handoff to finance for invoicing.</div>
            <div className="jh-tile-foot">
              <span className="jh-tile-attn">{counts.readyToBill} pending</span>
              <span className="jh-tile-arrow">&rarr;</span>
            </div>
          </button>

          <button className="jh-tile jh-tile-forecast" onClick={goForecast}>
            <div className="jh-tile-head">
              <div className="jh-tile-name"><span className="jh-tile-dot" />90-Day Forecast</div>
              <div className="jh-tile-count">&mdash;</div>
            </div>
            <div className="jh-tile-desc">When cash lands — payments forecast on sent invoices, next 90 days.</div>
            <div className="jh-tile-foot">
              <span className="jh-tile-attn">Open cash forecast</span>
              <span className="jh-tile-arrow">&rarr;</span>
            </div>
          </button>

          <button className="jh-tile jh-tile-budget" onClick={goBudget}>
            <div className="jh-tile-head">
              <div className="jh-tile-name"><span className="jh-tile-dot" />Budget</div>
              <div className="jh-tile-count">&mdash;</div>
            </div>
            <div className="jh-tile-desc">Real-time margin per job. Coming soon &mdash; wired to Field Command DPRs.</div>
            <div className="jh-tile-foot">
              <span className="jh-tile-attn">Coming soon</span>
              <span className="jh-tile-arrow">&rarr;</span>
            </div>
          </button>

          <button className="jh-tile jh-tile-rate" onClick={goProductionRate}>
            <div className="jh-tile-head">
              <div className="jh-tile-name"><span className="jh-tile-dot" />Production Rate Trackers</div>
              <div className="jh-tile-count">{counts.inProgress}</div>
            </div>
            <div className="jh-tile-desc">Recent field reports across all jobs &mdash; target vs actual progress.</div>
            <div className="jh-tile-foot">
              <span className="jh-tile-attn">Open recent reports</span>
              <span className="jh-tile-arrow">&rarr;</span>
            </div>
          </button>

          <button className="jh-tile jh-tile-daily" onClick={goDaily}>
            <div className="jh-tile-head">
              <div className="jh-tile-name"><span className="jh-tile-dot" />Daily Logs</div>
              <div className="jh-tile-count">&mdash;</div>
            </div>
            <div className="jh-tile-desc">Daily crew status, photos, notes from the field.</div>
            <div className="jh-tile-foot">
              <span className="jh-tile-attn">Open daily view</span>
              <span className="jh-tile-arrow">&rarr;</span>
            </div>
          </button>

        </div>
      </section>
    </div>
  )
}
