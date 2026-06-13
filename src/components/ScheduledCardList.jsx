import { useNavigate } from 'react-router-dom'
import { getJobMultiWeekAlert } from '../lib/queries'
import { getCardTitle, getWtcChips } from '../lib/jobCardLabel'

function fmtD(d) {
  const dt = d instanceof Date ? d : new Date(d)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function getMonday(d) {
  const dt = d instanceof Date ? new Date(d) : new Date(d)
  const day = dt.getDay()
  dt.setDate(dt.getDate() - (day === 0 ? 6 : day - 1))
  dt.setHours(0, 0, 0, 0)
  return dt
}

function effectiveStart(j) { return j.scheduled_start || j.start_date || null }
function effectiveEnd(j) { return j.scheduled_end || j.end_date || null }

function daysBetween(dateStr, refDate) {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  const r = new Date(refDate)
  r.setHours(0, 0, 0, 0)
  return Math.ceil((d - r) / (1000 * 60 * 60 * 24))
}

function crewCoverage(job, assignments) {
  const start = effectiveStart(job)
  const end = effectiveEnd(job)
  if (!start || !end) return null
  const startD = new Date(start + 'T00:00:00')
  const endD = new Date(end + 'T00:00:00')
  const days = []
  const cursor = new Date(startD)
  while (cursor.getTime() <= endD.getTime()) {
    days.push(fmtD(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  const covered = days.filter(d =>
    (assignments || []).some(a => a.job_id === job.job_id && a.date === d)
  ).length
  return { covered, total: days.length }
}

// SCH4 calendar-readiness: true when the job has job_wtcs rows but any of them
// still lacks a start_date (Schedule hasn't assigned the calendar yet). Legacy
// jobs (no job_wtcs) are not badged — their dates live on jobs, not job_wtcs.
function hasUndatedWtc(job) {
  const wtcs = Array.isArray(job._wtcs) ? job._wtcs : []
  if (wtcs.length === 0) return false
  return wtcs.some(w => !w.start_date)
}

function fieldSowSummary(job) {
  const wtcs = Array.isArray(job._wtcs) ? job._wtcs : []
  // Prefer job_wtcs.field_sow if present; fall back to jobs.field_sow.
  const sow = wtcs.length > 0 ? wtcs[0].field_sow : job.field_sow
  if (!sow) return null
  const arr = Array.isArray(sow) ? sow : []
  if (arr.length === 0) return null
  const crewSize = arr[0]?.crew || arr[0]?.crew_size || null
  return crewSize
    ? `${arr.length} days · ${crewSize}-man crew`
    : `${arr.length} days`
}

export default function ScheduledCardList({ jobs, assignments = [], today = new Date(), emptyText = 'No scheduled jobs' }) {
  const navigate = useNavigate()

  if (!jobs.length) return <div className="jh-empty">{emptyText}</div>

  return (
    <div className="jh-list">
      {jobs.map(j => {
        const wtcs = j._wtcs || []
        const title = getCardTitle(j, wtcs)
        const chips = getWtcChips(wtcs)
        const start = effectiveStart(j)
        const daysToKickoff = start ? daysBetween(start, today) : null
        const coverage = crewCoverage(j, assignments)
        const sow = fieldSowSummary(j)
        const alertWeeks = getJobMultiWeekAlert(j, assignments, today)

        return (
          <div key={j.job_id} className="jh-card sch-card">
            <div className="jh-card-hdr">
              <div className="jh-card-left">
                <span className="jh-status-badge og">Scheduled</span>
                <div className="jh-card-title">
                  <span className="sch-card-title-text">{title}</span>
                </div>
              </div>
              <div className="jh-card-right">
                {hasUndatedWtc(j) && (
                  <span
                    className="sch-tbd-badge"
                    title="One or more work types still need calendar dates"
                    style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '2px 8px', borderRadius: 10, background: '#1c1814', color: '#30cfac' }}
                  >
                    Dates TBD
                  </span>
                )}
                {alertWeeks > 0 && (
                  <span className="jh-mw-badge" title={`${alertWeeks} week(s) need crew`}>
                    {alertWeeks}-wk · need crew
                  </span>
                )}
                {daysToKickoff !== null && (
                  <span className={`jh-days${daysToKickoff < 0 ? ' overdue' : daysToKickoff <= 7 ? ' soon' : ''}`}>
                    {daysToKickoff < 0
                      ? `${Math.abs(daysToKickoff)}d overdue`
                      : daysToKickoff === 0
                        ? 'kicks off today'
                        : `${daysToKickoff}d to kickoff`}
                  </span>
                )}
              </div>
            </div>

            <div className="jh-card-body sch-card-body">
              {chips.length > 0 && (
                <div className="sch-wtc-chips">
                  {chips.map(c => <span key={c} className="sch-wtc-chip">{c}</span>)}
                </div>
              )}
              <div className="sch-card-meta">
                {start && <span className="sch-meta-item">Starts {start}</span>}
                {coverage && (
                  <span className="sch-meta-item">
                    {coverage.covered === 0
                      ? 'No crew yet'
                      : `${coverage.covered} of ${coverage.total} days covered`}
                  </span>
                )}
                {sow && <span className="sch-meta-item">{sow}</span>}
              </div>
            </div>

            <div className="jh-card-detail">
              <div className="jh-detail-actions">
                <button
                  className="jh-view-btn jd-sched-link"
                  onClick={() => {
                    const s = effectiveStart(j)
                    if (!s) {
                      navigate(`/jobs/${j.job_id}?mode=planning`)
                      return
                    }
                    const monday = getMonday(new Date(s + 'T00:00:00'))
                    navigate(`/schedule?job=${j.job_id}&week=${fmtD(monday)}`)
                  }}
                >
                  Schedule this job →
                </button>
                <button
                  className="jh-view-btn"
                  onClick={() => navigate(`/jobs/${j.job_id}?mode=planning`)}
                >
                  Job Planning
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
