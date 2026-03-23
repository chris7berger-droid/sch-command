import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function getWeekLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const mon = new Date(d)
  mon.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  const fri = new Date(mon)
  fri.setDate(mon.getDate() + 4)
  return `${mon.getMonth() + 1}/${mon.getDate()} – ${fri.getMonth() + 1}/${fri.getDate()}`
}

function groupByWeek(assignments) {
  const weeks = {}
  for (const a of assignments) {
    const label = getWeekLabel(a.date)
    if (!weeks[label]) weeks[label] = new Set()
    weeks[label].add(a.crew_name)
  }
  const sorted = Object.entries(weeks).sort((a, b) => {
    const parseStart = s => new Date(new Date().getFullYear() + '-' + s.split(' – ')[0].replace('/', '-') + 'T00:00:00')
    return parseStart(b[0]) - parseStart(a[0])
  })
  return sorted.map(([label, names]) => ({ label, crew: [...names].sort() }))
}

export default function Jobs() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function fetchJobs() {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .or('deleted.is.null,deleted.eq.No')
        .order('start_date', { ascending: false })

      if (error) {
        setError(error.message)
      } else {
        setJobs(data)
      }
      setLoading(false)
    }
    fetchJobs()
  }, [])

  if (loading) return <div className="loading">Loading jobs...</div>
  if (error) return <div className="error-msg">Error: {error}</div>

  const ongoing = jobs.filter(j => j.status === 'Ongoing')
  const onHold = jobs.filter(j => j.status === 'On Hold')
  const complete = jobs.filter(j => j.status === 'Complete')

  return (
    <div>
      <div className="jobs-scoreboard">
        <div className="score-card">
          <div className="label">Ongoing</div>
          <div className="count">{ongoing.length}</div>
        </div>
        <div className="score-card on-hold">
          <div className="label">On Hold</div>
          <div className="count">{onHold.length}</div>
        </div>
        <div className="score-card complete">
          <div className="label">Complete</div>
          <div className="count">{complete.length}</div>
        </div>
      </div>

      <JobSection title="Ongoing" jobs={ongoing} />
      <JobSection title="On Hold" jobs={onHold} />
      <JobSection title="Complete" jobs={complete} />
    </div>
  )
}

function JobSection({ title, jobs }) {
  const [expandedId, setExpandedId] = useState(null)

  if (jobs.length === 0) return null

  function toggle(jobId) {
    setExpandedId(prev => (prev === jobId ? null : jobId))
  }

  return (
    <div className="jobs-section">
      <div className="jobs-section-header">{title} ({jobs.length})</div>
      <table className="jobs-table">
        <thead>
          <tr>
            <th>Job #</th>
            <th>Job Name</th>
            <th>Work Type</th>
            <th>Dates</th>
            <th>Crew</th>
            <th>Lead</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map(job => (
            <JobRow
              key={job.job_id}
              job={job}
              title={title}
              expanded={expandedId === job.job_id}
              onToggle={() => toggle(job.job_id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function JobRow({ job, title, expanded, onToggle }) {
  const [assignments, setAssignments] = useState(null)
  const [loadingHistory, setLoadingHistory] = useState(false)

  useEffect(() => {
    if (!expanded) return
    if (assignments !== null) return
    setLoadingHistory(true)
    supabase
      .from('assignments')
      .select('crew_name, date')
      .eq('job_id', job.job_id)
      .order('date', { ascending: false })
      .then(({ data, error }) => {
        setAssignments(error ? [] : data)
        setLoadingHistory(false)
      })
  }, [expanded, job.job_id, assignments])

  const weeks = assignments ? groupByWeek(assignments) : []

  return (
    <>
      <tr className={`job-row${expanded ? ' expanded' : ''}`} onClick={onToggle}>
        <td className="job-num">{job.job_num}</td>
        <td className="job-name">{job.job_name}</td>
        <td className="work-type">{job.work_type || '—'}</td>
        <td className="dates">
          {formatDate(job.start_date)} – {formatDate(job.end_date)}
        </td>
        <td className="crew-count">{job.crew_needed || '—'}</td>
        <td>{job.lead || '—'}</td>
        <td>
          <span className={`status-badge status-${title.toLowerCase().replace(' ', '-')}`}>
            {job.status}
          </span>
        </td>
      </tr>
      {expanded && (
        <tr className="job-history-row">
          <td colSpan="7">
            <div className="job-history">
              <div className="job-history-header">Crew History</div>
              {loadingHistory ? (
                <div className="job-history-empty">Loading...</div>
              ) : weeks.length === 0 ? (
                <div className="job-history-empty">No crew assignments yet</div>
              ) : (
                <div className="crew-week-cards">
                  {weeks.map(week => (
                    <div key={week.label} className="crew-week-card">
                      <div className="crew-week-label">{week.label}</div>
                      <div className="crew-week-names">
                        {week.crew.map(name => (
                          <span key={name} className="crew-name-chip">{name}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
