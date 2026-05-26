import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getJobStatus } from '../lib/jobStatus'
import { getJobMultiWeekAlert } from '../lib/queries'

function getMonday(d) {
  const dt = new Date(d)
  const day = dt.getDay()
  dt.setDate(dt.getDate() - (day === 0 ? 6 : day - 1))
  dt.setHours(0, 0, 0, 0)
  return dt
}

function isThisWeek(dateStr, today) {
  if (!dateStr) return false
  const d = new Date(dateStr + 'T00:00:00')
  const mon = getMonday(today)
  const sun = new Date(mon)
  sun.setDate(sun.getDate() + 6)
  return d >= mon && d <= sun
}

export default function JobsPicker({ jobs = [], assignments = [], billingLog = [], today = new Date(), onPick }) {
  const counts = useMemo(() => {
    const buckets = { Scheduled: 0, 'In Progress': 0, Complete: 0, 'On Hold': 0, Ongoing: 0 }
    jobs.forEach(j => { buckets[getJobStatus(j)] = (buckets[getJobStatus(j)] || 0) + 1 })
    const startingThisWeek = jobs.filter(j => {
      if (getJobStatus(j) !== 'Scheduled') return false
      return isThisWeek(j.scheduled_start || j.start_date, today)
    }).length
    const readyToBill = jobs.filter(j => {
      const billed = (billingLog || [])
        .filter(b => b.job_id === j.job_id)
        .reduce((s, b) => s + (parseFloat(b.percent) || 0), 0)
      return getJobStatus(j) === 'Complete' && billed < 100
    }).length
    return {
      scheduled: buckets.Scheduled,
      inProgress: buckets['In Progress'],
      complete: buckets.Complete,
      onHold: buckets['On Hold'],
      total: jobs.length,
      startingThisWeek,
      readyToBill,
    }
  }, [jobs, billingLog, today])

  const multiWeekAlertCount = useMemo(() =>
    jobs.filter(j =>
      getJobStatus(j) === 'Scheduled' &&
      getJobMultiWeekAlert(j, assignments, today) > 0
    ).length
  , [jobs, assignments, today])

  const navigate = useNavigate()
  const goTab = (key) => onPick ? onPick(key) : navigate(`/jobs?tab=${key}`)
  const goSchedule = () => navigate('/schedule')
  const goBilling = () => navigate('/billing')
  const goProductionRate = () => navigate('/production-rate')
  const goBudget = () => navigate('/budget')
  const goDaily = () => navigate('/daily')

  return (
    <div className="jh-picker">
      <div className="jh-picker-intro">
        <h2 className="jh-picker-title">What do you want to look at?</h2>
        <div className="jh-picker-sub">Pick a stage to focus on, or view everything at once.</div>
      </div>

      <section className="jh-picker-section">
        <h3 className="jh-picker-section-title">Job Crew & Schedule Stages</h3>
        <div className="jh-picker-grid">

          <button className="jh-tile jh-tile-scheduled" onClick={() => goTab('scheduled')}>
            <div className="jh-tile-head">
              <div className="jh-tile-name"><span className="jh-tile-dot" />Ready</div>
              <div className="jh-tile-count">{counts.scheduled}</div>
            </div>
            <div className="jh-tile-desc">Date set, materials decided. Awaiting crew assignment + kickoff.</div>
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

          <button className="jh-tile jh-tile-all" onClick={() => goTab('all')}>
            <div className="jh-tile-head">
              <div className="jh-tile-name">All Jobs</div>
              <div className="jh-tile-count">{counts.total}</div>
            </div>
            <div className="jh-tile-desc">Every active job in one view, segmented by lifecycle stage.</div>
            <div className="jh-tile-foot">
              <span className="jh-tile-attn">4 stages &middot; all jobs</span>
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
