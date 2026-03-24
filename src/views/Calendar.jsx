import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'

/* ---------- helpers ---------- */

const JOB_COLORS = [
  '#3498db','#e74c3c','#2ecc71','#9b59b6','#e67e22','#1abc9c',
  '#f39c12','#c0392b','#2980b9','#8e44ad','#27ae60','#d35400',
  '#16a085','#7f8c8d','#2c3e50','#d4a017',
]

function jCol(idx) {
  return JOB_COLORS[idx % JOB_COLORS.length]
}

function isPW(job) {
  return job.prevailing_wage === 'Yes' || job.prevailing_wage === true
}

function fmtD(d) {
  // format Date -> YYYY-MM-DD
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseDate(s) {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

/* Build the 6-row calendar grid for a given month */
function buildGrid(year, month) {
  const first = new Date(year, month, 1)
  const startDay = first.getDay() // 0=Sun
  const gridStart = new Date(year, month, 1 - startDay)
  const cells = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    cells.push(d)
  }
  return cells
}

/* ---------- styles (inline, prefixed cal-) ---------- */

const styles = {
  wrapper: {
    padding: '16px 24px',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    fontFamily: 'var(--font-heading)',
  },
  navBtn: {
    fontFamily: 'var(--font-heading)',
    fontWeight: 700,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    padding: '5px 12px',
    border: '2px solid var(--border)',
    borderRadius: 4,
    background: 'var(--bg-card)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
  },
  monthLabel: {
    fontFamily: 'var(--font-heading)',
    fontWeight: 700,
    fontSize: 22,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginLeft: 8,
    marginRight: 8,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    border: '2px solid var(--border)',
    borderRadius: 4,
    overflow: 'hidden',
    background: 'var(--border)',
    gap: 1,
  },
  dayHeader: {
    background: 'var(--header-dark)',
    color: 'var(--white)',
    fontFamily: 'var(--font-heading)',
    fontWeight: 700,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
    padding: '6px 0',
  },
  cell: {
    background: 'var(--bg-card)',
    minHeight: 100,
    padding: 4,
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  cellOutside: {
    opacity: 0.35,
  },
  cellToday: {
    background: '#fef9c3',
  },
  dayNum: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    fontWeight: 700,
    textAlign: 'right',
    marginBottom: 2,
    color: 'var(--text-secondary)',
  },
  bar: {
    fontSize: 10,
    fontFamily: 'var(--font-heading)',
    fontWeight: 600,
    color: '#fff',
    padding: '2px 5px',
    borderRadius: 3,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    lineHeight: '16px',
  },
  badge: {
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    fontWeight: 700,
    background: 'rgba(0,0,0,0.3)',
    color: '#fff',
    borderRadius: 3,
    padding: '0 4px',
    lineHeight: '14px',
    flexShrink: 0,
  },
  legendWrap: {
    marginTop: 16,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  legendTitle: {
    fontFamily: 'var(--font-heading)',
    fontWeight: 700,
    fontSize: 14,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 4,
    color: 'var(--text-secondary)',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    fontFamily: 'var(--font-body)',
  },
  legendSwatch: {
    width: 14,
    height: 14,
    borderRadius: 3,
    border: '1px solid rgba(0,0,0,0.15)',
    flexShrink: 0,
  },
  pwTag: {
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    fontWeight: 700,
    color: '#6d28d9',
    border: '1px solid #6d28d9',
    borderRadius: 3,
    padding: '0 3px',
    marginLeft: 4,
  },
  loading: {
    textAlign: 'center',
    padding: 40,
    fontFamily: 'var(--font-heading)',
    fontSize: 14,
    color: 'var(--text-light)',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
}

/* ---------- component ---------- */

export default function Calendar() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [jobs, setJobs] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)

  /* Fetch jobs + assignments */
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)

      // Get jobs that have start_date and are not deleted
      const { data: jobData, error: jobErr } = await supabase
        .from('jobs')
        .select('job_id, job_num, job_name, start_date, end_date, status, work_type, prevailing_wage, color, deleted')
        .or('deleted.is.null,deleted.eq.No')
        .not('start_date', 'is', null)

      if (jobErr) {
        console.error('jobs fetch error', jobErr)
      }

      // Build date range for assignments query — full grid (prev month tail through next month head)
      const gridCells = buildGrid(year, month)
      const rangeStart = fmtD(gridCells[0])
      const rangeEnd = fmtD(gridCells[gridCells.length - 1])

      const { data: assignData, error: assignErr } = await supabase
        .from('assignments')
        .select('job_id, crew_name, date')
        .gte('date', rangeStart)
        .lte('date', rangeEnd)

      if (assignErr) {
        console.error('assignments fetch error', assignErr)
      }

      if (!cancelled) {
        setJobs(jobData || [])
        setAssignments(assignData || [])
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [year, month])

  /* Build grid cells */
  const grid = useMemo(() => buildGrid(year, month), [year, month])

  /* Index: jobId -> colorIndex (stable ordering by job_num) */
  const jobColorMap = useMemo(() => {
    const sorted = [...jobs].sort((a, b) => {
      const an = a.job_num || ''
      const bn = b.job_num || ''
      return an.localeCompare(bn, undefined, { numeric: true })
    })
    const map = {}
    sorted.forEach((j, i) => {
      map[j.job_id] = i
    })
    return map
  }, [jobs])

  /* Index: "jobId|YYYY-MM-DD" -> crew count */
  const crewCountMap = useMemo(() => {
    const map = {}
    for (const a of assignments) {
      const key = `${a.job_id}|${a.date}`
      map[key] = (map[key] || 0) + 1
    }
    return map
  }, [assignments])

  /* For a given date, return jobs active on that day */
  function jobsForDate(d) {
    const ds = fmtD(d)
    return jobs.filter(j => {
      const s = j.start_date
      const e = j.end_date || j.start_date
      return ds >= s && ds <= e
    })
  }

  function getJobColor(job) {
    if (isPW(job)) return '#6d28d9'
    if (job.color) return job.color
    const idx = jobColorMap[job.job_id]
    return idx !== undefined ? jCol(idx) : '#7f8c8d'
  }

  function getCrewCount(jobId, d) {
    const key = `${jobId}|${fmtD(d)}`
    return crewCountMap[key] || 0
  }

  /* Nav handlers */
  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }

  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  function goToday() {
    setYear(today.getFullYear())
    setMonth(today.getMonth())
  }

  /* Legend jobs — all jobs with start_date, sorted */
  const legendJobs = useMemo(() => {
    return [...jobs].sort((a, b) => {
      const an = a.job_num || ''
      const bn = b.job_num || ''
      return an.localeCompare(bn, undefined, { numeric: true })
    })
  }, [jobs])

  if (loading) {
    return <div style={styles.loading}>Loading calendar...</div>
  }

  return (
    <div className="cal-wrapper" style={styles.wrapper}>
      {/* Toolbar */}
      <div className="cal-toolbar" style={styles.toolbar}>
        <button className="cal-nav-btn" style={styles.navBtn} onClick={prevMonth}>Prev</button>
        <button className="cal-nav-btn" style={styles.navBtn} onClick={goToday}>Today</button>
        <button className="cal-nav-btn" style={styles.navBtn} onClick={nextMonth}>Next</button>
        <span className="cal-month-label" style={styles.monthLabel}>
          {MONTH_NAMES[month]} {year}
        </span>
      </div>

      {/* Grid */}
      <div className="cal-grid" style={styles.grid}>
        {/* Day-name headers */}
        {DAY_NAMES.map(dn => (
          <div key={dn} className="cal-day-header" style={styles.dayHeader}>{dn}</div>
        ))}

        {/* Calendar cells */}
        {grid.map((d, i) => {
          const isOutside = d.getMonth() !== month
          const isToday = sameDay(d, today)
          const dayJobs = jobsForDate(d)

          const cellStyle = {
            ...styles.cell,
            ...(isOutside ? styles.cellOutside : {}),
            ...(isToday ? styles.cellToday : {}),
          }

          return (
            <div key={i} className="cal-cell" style={cellStyle}>
              <div className="cal-day-num" style={styles.dayNum}>{d.getDate()}</div>
              {dayJobs.map(job => {
                const cc = getCrewCount(job.job_id, d)
                const bgColor = getJobColor(job)
                const label = `${job.job_num || ''} ${job.job_name || ''}`.trim()
                return (
                  <div
                    key={job.job_id}
                    className="cal-bar"
                    style={{ ...styles.bar, background: bgColor }}
                    title={`${label}${isPW(job) ? ' (PW)' : ''}${cc ? ' — ' + cc + ' crew' : ''}`}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {label}
                    </span>
                    {cc > 0 && (
                      <span className="cal-badge" style={styles.badge}>{cc}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* Legend */}
      {legendJobs.length > 0 && (
        <>
          <div className="cal-legend-title" style={styles.legendTitle}>Jobs This Period</div>
          <div className="cal-legend" style={styles.legendWrap}>
            {legendJobs.map(job => (
              <div key={job.job_id} className="cal-legend-item" style={styles.legendItem}>
                <div
                  className="cal-legend-swatch"
                  style={{ ...styles.legendSwatch, background: getJobColor(job) }}
                />
                <span>
                  {job.job_num} - {job.job_name}
                </span>
                {isPW(job) && <span style={styles.pwTag}>PW</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
