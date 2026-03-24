import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/* ── constants ────────────────────────────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const WEEKDAY_ORDER = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const JOB_COLORS = [
  '#3498db', '#e74c3c', '#2ecc71', '#9b59b6', '#e67e22', '#1abc9c',
  '#f39c12', '#c0392b', '#2980b9', '#8e44ad', '#27ae60', '#d35400',
  '#16a085', '#7f8c8d', '#2c3e50', '#d4a017'
]

/* ── helpers ──────────────────────────────────────────────────────── */

function getMonday(d) {
  const dt = new Date(d)
  const day = dt.getDay()
  const diff = (day === 0 ? -6 : 1) - day
  dt.setDate(dt.getDate() + diff)
  dt.setHours(0, 0, 0, 0)
  return dt
}

function fmtD(d) {
  const dt = d instanceof Date ? d : new Date(d)
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const day = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function fmtWk(monday) {
  const mon = monday instanceof Date ? monday : new Date(monday + 'T00:00:00')
  const sat = new Date(mon)
  sat.setDate(mon.getDate() + 5)
  const mStr = `${MONTHS[mon.getMonth()]} ${mon.getDate()}`
  const sStr = `${MONTHS[sat.getMonth()]} ${sat.getDate()}`
  return `${mStr} \u2013 ${sStr}, ${sat.getFullYear()}`
}

function wkDates(monday) {
  const mon = monday instanceof Date ? monday : new Date(monday + 'T00:00:00')
  const dates = []
  for (let i = 0; i < 6; i++) {
    const d = new Date(mon)
    d.setDate(mon.getDate() + i)
    dates.push(fmtD(d))
  }
  return dates
}

function flipName(n) {
  if (!n) return ''
  const p = n.split(',')
  return p.length === 2 ? p[1].trim() + ' ' + p[0].trim() : n
}

function isPW(j) {
  return j && (j.prevailing_wage === 'Yes' || j.prevailing_wage === true)
}

function fmt12(t) {
  if (!t) return ''
  const p = t.split(':')
  let h = parseInt(p[0])
  const m = p[1] || '00'
  const ap = h >= 12 ? 'pm' : 'am'
  h = h % 12 || 12
  return h + ':' + m + ap
}

function dayLabel(dates, monday) {
  if (!dates || dates.length === 0) return ''
  const labels = dates.map(ds => {
    const d = new Date(ds + 'T00:00:00')
    return DAY_NAMES[d.getDay()]
  })
  const unique = [...new Set(labels)]
  const sorted = unique.sort((a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b))

  if (sorted.length >= 2) {
    const indices = sorted.map(s => WEEKDAY_ORDER.indexOf(s))
    let consecutive = true
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] !== indices[i - 1] + 1) { consecutive = false; break }
    }
    if (consecutive) return `${sorted[0]}-${sorted[sorted.length - 1]}`
  }
  return sorted.join(',')
}

function jCol(idx) {
  return JOB_COLORS[idx % JOB_COLORS.length]
}

function getDoubleBookedDays(allAssignments, crewName, weekDates) {
  const dayCounts = {}
  for (const a of allAssignments) {
    if (a.crew_name !== crewName) continue
    if (!weekDates.includes(a.date)) continue
    dayCounts[a.date] = (dayCounts[a.date] || 0) + 1
  }
  return Object.keys(dayCounts).filter(d => dayCounts[d] > 1)
}

/* ── component ───────────────────────────────────────────────────── */

export default function Schedules() {
  const [monday, setMonday] = useState(() => getMonday(new Date()))
  const [crewIdx, setCrewIdx] = useState(0)
  const [jobs, setJobs] = useState([])
  const [crew, setCrew] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [copyMsg, setCopyMsg] = useState('')

  /* ── fetch data ── */
  const fetchData = useCallback(async () => {
    setLoading(true)
    const dates = wkDates(monday)
    const monStr = dates[0]
    const satStr = dates[dates.length - 1]

    const [jobsRes, crewRes, asgnRes] = await Promise.all([
      supabase
        .from('jobs')
        .select('*')
        .or(`deleted.is.null,deleted.eq.false`)
        .or(`end_date.is.null,end_date.gte.${monStr}`)
        .or(`start_date.is.null,start_date.lte.${satStr}`),
      supabase
        .from('crew')
        .select('*')
        .or('archived.is.null,archived.eq.false'),
      supabase
        .from('assignments')
        .select('*')
        .gte('date', monStr)
        .lte('date', satStr)
    ])

    setJobs(jobsRes.data || [])
    setCrew(crewRes.data || [])
    setAssignments(asgnRes.data || [])
    setLoading(false)
  }, [monday])

  useEffect(() => { fetchData() }, [fetchData])

  /* ── derived data ── */
  const dates = useMemo(() => wkDates(monday), [monday])

  const jobMap = useMemo(() => {
    const m = {}
    for (const j of jobs) m[j.job_id] = j
    return m
  }, [jobs])

  // crew list: active crew who have assignments this week, sorted alpha
  const crewList = useMemo(() => {
    const assignedNames = new Set(assignments.map(a => a.crew_name))
    const activeCrew = crew.filter(c => assignedNames.has(c.name))
    activeCrew.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    return activeCrew
  }, [crew, assignments])

  // reset index if it exceeds list
  useEffect(() => {
    if (crewIdx >= crewList.length && crewList.length > 0) setCrewIdx(0)
  }, [crewList, crewIdx])

  const currentCrew = crewList[crewIdx] || null

  // build job groups for current crew member
  const cardData = useMemo(() => {
    if (!currentCrew) return []
    const name = currentCrew.name
    const myAsgn = assignments.filter(a => a.crew_name === name)
    const grouped = {}
    for (const a of myAsgn) {
      if (!grouped[a.job_id]) grouped[a.job_id] = []
      grouped[a.job_id].push(a.date)
    }

    const dbDays = getDoubleBookedDays(assignments, name, dates)

    return Object.keys(grouped).map((jobId, idx) => {
      const job = jobMap[jobId]
      if (!job) return null
      const jobDates = grouped[jobId].sort()

      const deferredDays = job.deferred_days
        ? String(job.deferred_days).split(',').filter(x => x.trim())
        : []
      const regularDates = jobDates.filter(d => !deferredDays.includes(d))
      const deferredDates = jobDates.filter(d => deferredDays.includes(d))

      const hasDoubleBook = jobDates.some(d => dbDays.includes(d))

      // other crew on this job this week
      const othersOnJob = [
        ...new Set(
          assignments
            .filter(a => String(a.job_id) === String(jobId) && a.crew_name !== name)
            .map(a => a.crew_name)
        )
      ].sort()

      return {
        job,
        jobDates,
        regularDates,
        deferredDates,
        hasDoubleBook,
        othersOnJob,
        colorIdx: idx
      }
    }).filter(Boolean)
  }, [currentCrew, assignments, jobMap, dates])

  /* ── handlers ── */
  function navWeek(dir) {
    const next = new Date(monday)
    next.setDate(monday.getDate() + dir * 7)
    setMonday(next)
    setCrewIdx(0)
  }

  function navCrew(dir) {
    if (!crewList.length) return
    let next = crewIdx + dir
    if (next < 0) next = crewList.length - 1
    if (next >= crewList.length) next = 0
    setCrewIdx(next)
  }

  function buildCopyText() {
    if (!currentCrew) return ''
    const name = currentCrew.name
    let t = flipName(name) + '\nWeek of ' + fmtWk(monday) + '\n---------------------\n'

    for (const cd of cardData) {
      const j = cd.job
      const pw = isPW(j)
      t += '\n' + (j.job_num || '') + ' - ' + (j.job_name || '') + (pw ? ' [PW]' : '') + '\n'

      if (cd.regularDates.length) {
        t += '\u{1F7E2} ' + dayLabel(cd.regularDates, monday) + ': Shop 6:30am\n'
      }
      if (cd.deferredDates.length) {
        t += '\u{1F7E1} ' + dayLabel(cd.deferredDates, monday) + ': Delayed start ' + fmt12(j.deferred_time) + '\n'
      }
      if (!cd.regularDates.length && !cd.deferredDates.length) {
        t += 'Days: ' + dayLabel(cd.jobDates, monday) + '\n'
      }

      const meta = []
      if (j.work_type) meta.push(j.work_type)
      if (j.vehicle) meta.push(j.vehicle)
      if (j.equipment) meta.push(j.equipment)
      if (j.power_source) meta.push(j.power_source)
      if (meta.length) t += meta.join(' \u00B7 ') + '\n'

      if (cd.othersOnJob.length) {
        t += 'With: ' + cd.othersOnJob.map(flipName).join(', ') + '\n'
      }
      if (j.sow) t += 'SOW: ' + j.sow + '\n'
    }

    if (!cardData.length) t += '\nNo assignments this week\n'
    return t
  }

  async function handleCopy() {
    const text = buildCopyText()
    try {
      await navigator.clipboard.writeText(text)
      setCopyMsg('Copied!')
      setTimeout(() => setCopyMsg(''), 2000)
    } catch {
      setCopyMsg('Copy failed')
      setTimeout(() => setCopyMsg(''), 2000)
    }
  }

  /* ── render ── */
  return (
    <div className="sc-wrap">
      {/* week nav */}
      <div className="sc-wk-nav">
        <button className="sc-wk-btn" onClick={() => navWeek(-1)}>&larr; Prev Week</button>
        <div className="sc-wk-lbl">{fmtWk(monday)}</div>
        <button className="sc-wk-btn" onClick={() => navWeek(1)}>Next Week &rarr;</button>
      </div>

      {loading && <div className="sc-loading">Loading...</div>}

      {!loading && !crewList.length && (
        <div className="sc-empty">No crew assigned this week</div>
      )}

      {!loading && crewList.length > 0 && (
        <>
          {/* card flipper nav */}
          <div className="sc-nav">
            <button className="sc-nav-btn" onClick={() => navCrew(-1)}>&larr; Prev</button>
            <div className="sc-counter">{crewIdx + 1} of {crewList.length}</div>
            <button className="sc-nav-btn" onClick={() => navCrew(1)}>Next &rarr;</button>
          </div>

          {/* crew card */}
          <div className="cc">
            <div className="cc-name">{flipName(currentCrew.name)}</div>
            <div className="cc-week">Week of {fmtWk(monday)}</div>

            {cardData.length === 0 && (
              <div className="cc-none">No assignments this week</div>
            )}

            {cardData.map((cd, idx) => {
              const j = cd.job
              return (
                <div
                  key={j.job_id}
                  className={'cc-job' + (cd.hasDoubleBook ? ' cc-db' : '')}
                  style={{ borderLeftColor: jCol(cd.colorIdx) }}
                >
                  <div className="cc-jname">
                    <span>{j.job_num} - {j.job_name}</span>
                    {isPW(j) && <span className="cc-pw">PW</span>}
                    {cd.hasDoubleBook && <span className="cc-db-tag">2X BOOKED</span>}
                  </div>

                  <div className="cc-jdays">
                    {cd.regularDates.length > 0 && (
                      <span className="cc-day-line">
                        <span className="cc-dot cc-dot-green">{'\u{1F7E2}'}</span>
                        {dayLabel(cd.regularDates, monday)} &rarr; Shop 6:30am
                      </span>
                    )}
                    {cd.deferredDates.length > 0 && (
                      <span className="cc-day-line">
                        <span className="cc-dot cc-dot-yellow">{'\u{1F7E1}'}</span>
                        {dayLabel(cd.deferredDates, monday)} &rarr; Delayed start {fmt12(j.deferred_time)}
                      </span>
                    )}
                    {!cd.regularDates.length && !cd.deferredDates.length && (
                      <span className="cc-day-line">{dayLabel(cd.jobDates, monday)}</span>
                    )}
                  </div>

                  {(j.work_type || j.vehicle || j.equipment || j.power_source) && (
                    <div className="cc-jmeta">
                      {[j.work_type, j.vehicle, j.equipment, j.power_source]
                        .filter(Boolean)
                        .join(' \u00B7 ')}
                    </div>
                  )}

                  {cd.othersOnJob.length > 0 && (
                    <div className="cc-jwith">
                      With: {cd.othersOnJob.map(flipName).join(', ')}
                    </div>
                  )}

                  {j.sow && (
                    <div className="cc-jsow">
                      SOW: <a href={j.sow} target="_blank" rel="noopener noreferrer">{j.sow}</a>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* copy button */}
          <button className="sc-copy" onClick={handleCopy}>
            {copyMsg || 'Copy This Schedule'}
          </button>
        </>
      )}

      <style>{`
        /* ── Schedules view (sc-) ── */
        .sc-wrap {
          max-width: 480px;
          margin: 0 auto;
          padding: 16px 12px 40px;
        }

        .sc-wk-nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 14px;
        }

        .sc-wk-btn {
          font-family: var(--font-heading);
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 8px 14px;
          border: 2px solid var(--border);
          border-radius: 4px;
          background: var(--bg-card);
          color: var(--text-primary);
          cursor: pointer;
        }

        .sc-wk-btn:hover {
          background: var(--header-dark);
          color: var(--white);
        }

        .sc-wk-lbl {
          font-family: var(--font-heading);
          font-size: 16px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          text-align: center;
          flex: 1;
        }

        .sc-loading {
          text-align: center;
          padding: 40px 0;
          font-size: 14px;
          color: var(--text-secondary);
        }

        .sc-empty {
          text-align: center;
          padding: 40px 20px;
          font-size: 14px;
          color: var(--text-secondary);
          background: var(--bg-card);
          border: 2px solid rgba(28, 24, 20, 0.15);
          border-radius: 6px;
        }

        .sc-nav {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
          margin-bottom: 12px;
        }

        .sc-nav-btn {
          font-family: var(--font-heading);
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 6px 12px;
          border: 2px solid var(--border);
          border-radius: 4px;
          background: var(--bg-card);
          color: var(--text-primary);
          cursor: pointer;
        }

        .sc-nav-btn:hover {
          background: var(--header-dark);
          color: var(--white);
        }

        .sc-counter {
          font-family: var(--font-mono);
          font-size: 13px;
          font-weight: 600;
          min-width: 60px;
          text-align: center;
        }

        /* ── Crew card (cc-) ── */
        .cc {
          background: var(--bg-card);
          border: 2px solid rgba(28, 24, 20, 0.2);
          border-radius: 8px;
          overflow: hidden;
          margin-bottom: 12px;
        }

        .cc-name {
          background: var(--command-green);
          color: var(--header-dark);
          font-family: var(--font-heading);
          font-size: 20px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 1px;
          padding: 12px 16px 4px;
        }

        .cc-week {
          background: var(--command-green);
          color: rgba(28, 24, 20, 0.7);
          font-family: var(--font-heading);
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 0 16px 10px;
        }

        .cc-none {
          padding: 24px 16px;
          text-align: center;
          font-size: 13px;
          color: var(--text-secondary);
        }

        .cc-job {
          padding: 12px 16px;
          border-bottom: 1px solid rgba(28, 24, 20, 0.1);
          border-left: 4px solid #3498db;
        }

        .cc-job:last-child {
          border-bottom: none;
        }

        .cc-job.cc-db {
          background: rgba(231, 76, 60, 0.06);
        }

        .cc-jname {
          font-family: var(--font-heading);
          font-size: 15px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          margin-bottom: 6px;
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }

        .cc-pw {
          display: inline-block;
          font-size: 9px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 1px 5px;
          border-radius: 3px;
          background: var(--pw);
          color: var(--white);
          vertical-align: middle;
        }

        .cc-db-tag {
          display: inline-block;
          font-size: 9px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 1px 5px;
          border-radius: 3px;
          background: var(--danger);
          color: var(--white);
          vertical-align: middle;
        }

        .cc-jdays {
          display: flex;
          flex-direction: column;
          gap: 3px;
          margin-bottom: 6px;
        }

        .cc-day-line {
          font-size: 13px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .cc-dot {
          font-size: 12px;
          line-height: 1;
        }

        .cc-jmeta {
          font-size: 12px;
          color: var(--text-secondary);
          margin-bottom: 4px;
        }

        .cc-jwith {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 2px;
        }

        .cc-jsow {
          font-size: 11px;
          color: var(--text-secondary);
          word-break: break-all;
        }

        .cc-jsow a {
          color: #2980b9;
          text-decoration: underline;
        }

        /* ── Copy button ── */
        .sc-copy {
          display: block;
          width: 100%;
          font-family: var(--font-heading);
          font-size: 14px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 12px;
          border: 2px solid var(--command-green);
          border-radius: 6px;
          background: var(--command-green);
          color: var(--header-dark);
          cursor: pointer;
          text-align: center;
        }

        .sc-copy:hover {
          background: #4aa832;
          border-color: #4aa832;
        }

        .sc-copy:active {
          transform: scale(0.98);
        }
      `}</style>
    </div>
  )
}
