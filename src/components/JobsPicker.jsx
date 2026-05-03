import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

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

export default function JobsPicker({ jobs = [], today = new Date(), onPick }) {
  const counts = useMemo(() => {
    const buckets = { Parked: 0, Scheduled: 0, 'In Progress': 0, Complete: 0, 'On Hold': 0, Ongoing: 0 }
    jobs.forEach(j => { buckets[getJobStatus(j)] = (buckets[getJobStatus(j)] || 0) + 1 })
    const startingThisWeek = jobs.filter(j => {
      if (getJobStatus(j) !== 'Scheduled') return false
      return isThisWeek(j.scheduled_start || j.start_date, today)
    }).length
    return {
      parked: buckets.Parked,
      scheduled: buckets.Scheduled,
      inProgress: buckets['In Progress'],
      complete: buckets.Complete,
      total: jobs.length,
      startingThisWeek,
    }
  }, [jobs, today])

  const navigate = useNavigate()
  const goTab = (key) => onPick ? onPick(key) : navigate(`/jobs?tab=${key}`)
  const goSchedule = () => navigate('/schedule')
  const goProductionRate = () => navigate('/production-rate')

  return (
    <div className="jh-picker">
      <div className="jh-picker-intro">
        <h2 className="jh-picker-title">What do you want to look at?</h2>
        <div className="jh-picker-sub">Pick a stage to focus on, or view everything at once.</div>
      </div>

      <div className="jh-picker-grid">

        <button className="jh-tile jh-tile-parked" onClick={() => goTab('pipeline')}>
          <div className="jh-tile-head">
            <div className="jh-tile-name"><span className="jh-tile-dot" />Parked</div>
            <div className="jh-tile-count">{counts.parked}</div>
          </div>
          <div className="jh-tile-desc">Inquiries waiting on readiness — permits, materials, deposit, crew, date.</div>
          <div className="jh-tile-foot">
            <span className="jh-tile-attn">— ready to schedule</span>
            <span className="jh-tile-arrow">→</span>
          </div>
        </button>

        <button className="jh-tile jh-tile-ready" onClick={() => goTab('ready')}>
          <div className="jh-tile-head">
            <div className="jh-tile-name"><span className="jh-tile-dot" />Ready</div>
            <div className="jh-tile-count">{counts.scheduled}</div>
          </div>
          <div className="jh-tile-desc">Date set, crew assigned, good to go. Kickoff upcoming.</div>
          <div className="jh-tile-foot">
            <span className="jh-tile-attn">{counts.startingThisWeek} starting this week</span>
            <span className="jh-tile-arrow">→</span>
          </div>
        </button>

        <button className="jh-tile jh-tile-active" onClick={() => goTab('active')}>
          <div className="jh-tile-head">
            <div className="jh-tile-name"><span className="jh-tile-dot" />Active</div>
            <div className="jh-tile-count">{counts.inProgress}</div>
          </div>
          <div className="jh-tile-desc">Production in progress. Daily PRTs, photos, and progress tracking.</div>
          <div className="jh-tile-foot">
            <span className="jh-tile-attn">— behind target</span>
            <span className="jh-tile-arrow">→</span>
          </div>
        </button>

        <button className="jh-tile jh-tile-billing" onClick={() => goTab('billing')}>
          <div className="jh-tile-head">
            <div className="jh-tile-name"><span className="jh-tile-dot" />Billing</div>
            <div className="jh-tile-count">{counts.complete}</div>
          </div>
          <div className="jh-tile-desc">Production complete. Awaiting handoff to finance for invoicing.</div>
          <div className="jh-tile-foot">
            <span className="jh-tile-attn">— waiting 2+ days</span>
            <span className="jh-tile-arrow">→</span>
          </div>
        </button>

        <button className="jh-tile jh-tile-all" onClick={() => goTab('all')}>
          <div className="jh-tile-head">
            <div className="jh-tile-name">All Jobs</div>
            <div className="jh-tile-count">{counts.total}</div>
          </div>
          <div className="jh-tile-desc">Every active job in one view, segmented by lifecycle stage.</div>
          <div className="jh-tile-foot">
            <span className="jh-tile-attn">4 stages · all jobs</span>
            <span className="jh-tile-arrow">→</span>
          </div>
        </button>

        <button className="jh-tile jh-tile-schedule" onClick={goSchedule}>
          <div className="jh-tile-head">
            <div className="jh-tile-name"><span className="jh-tile-dot" />Live Schedule</div>
            <div className="jh-tile-count">{counts.scheduled + counts.inProgress}</div>
          </div>
          <div className="jh-tile-desc">This week's crew board — who's where, day by day.</div>
          <div className="jh-tile-foot">
            <span className="jh-tile-attn">Open weekly grid</span>
            <span className="jh-tile-arrow">→</span>
          </div>
        </button>

        <button className="jh-tile jh-tile-rate" onClick={goProductionRate}>
          <div className="jh-tile-head">
            <div className="jh-tile-name"><span className="jh-tile-dot" />Production Rate</div>
            <div className="jh-tile-count">{counts.inProgress}</div>
          </div>
          <div className="jh-tile-desc">Recent field reports across all jobs — target vs actual progress.</div>
          <div className="jh-tile-foot">
            <span className="jh-tile-attn">Open recent reports</span>
            <span className="jh-tile-arrow">→</span>
          </div>
        </button>

      </div>
    </div>
  )
}
