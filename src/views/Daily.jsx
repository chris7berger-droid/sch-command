import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/* ── helpers ── */

function getMonday(d) {
  const dt = new Date(d)
  const day = dt.getDay()
  const diff = dt.getDate() - day + (day === 0 ? -6 : 1)
  dt.setDate(diff)
  dt.setHours(0, 0, 0, 0)
  return dt
}

function fmtD(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function fmtWk(monday) {
  const ms = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const end = new Date(monday)
  end.setDate(end.getDate() + 5)
  return ms[monday.getMonth()] + ' ' + monday.getDate() + ' \u2013 ' + ms[end.getMonth()] + ' ' + end.getDate() + ', ' + end.getFullYear()
}

function wkDates(monday) {
  const r = []
  for (let i = 0; i < 6; i++) {
    const dt = new Date(monday)
    dt.setDate(dt.getDate() + i)
    r.push(fmtD(dt))
  }
  return r
}

function isPW(j) {
  return j.prevailing_wage === 'Yes' || j.prevailing_wage === 'true' || j.prevailing_wage === true
}

const JC = ['#3498db','#e74c3c','#2ecc71','#9b59b6','#e67e22','#1abc9c','#f39c12','#c0392b','#2980b9','#8e44ad','#27ae60','#d35400','#16a085','#7f8c8d','#2c3e50','#d4a017']

function jCol(idx) {
  return JC[idx % JC.length]
}

function flipName(n) {
  if (!n) return ''
  const p = n.split(',')
  return p.length === 2 ? p[1].trim() + ' ' + p[0].trim() : n
}

function gTagClass(t) {
  if (!t) return ''
  const tl = t.toLowerCase()
  if (tl.includes('flake')) return 'tg-fl'
  if (tl.includes('epoxy')) return 'tg-ep'
  if (tl.includes('caulk')) return 'tg-ca'
  if (tl.includes('demo')) return 'tg-de'
  if (tl.includes('joint') || tl.includes('fill') || tl.includes('seal')) return 'tg-jo'
  if (tl.includes('plenum')) return 'tg-pl'
  return ''
}

function shortDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return (d.getMonth() + 1) + '/' + d.getDate()
}

/* ── component ── */

export default function Daily() {
  const [monday, setMonday] = useState(() => getMonday(new Date()))
  const [jobs, setJobs] = useState([])
  const [crew, setCrew] = useState([])
  const [assignments, setAssignments] = useState([])
  const [crewStatus, setCrewStatus] = useState([])
  const [loading, setLoading] = useState(true)

  const dates = useMemo(() => wkDates(monday), [monday])
  const todayStr = useMemo(() => fmtD(new Date()), [])

  const load = useCallback(async () => {
    setLoading(true)
    const ds = dates
    const [jRes, cRes, aRes, sRes] = await Promise.all([
      supabase.from('jobs').select('*').in('status', ['Ongoing', 'On Hold']).or('deleted.is.null,deleted.neq.true'),
      supabase.from('crew').select('*'),
      supabase.from('assignments').select('*').in('date', ds),
      supabase.from('crew_status').select('*').in('date', ds),
    ])
    if (jRes.data) setJobs(jRes.data.filter(j => j.deleted !== true && j.deleted !== 'true' && j.deleted !== 'Yes'))
    if (cRes.data) setCrew(cRes.data.filter(c => c.archived !== 'Yes'))
    if (aRes.data) setAssignments(aRes.data)
    if (sRes.data) setCrewStatus(sRes.data)
    setLoading(false)
  }, [dates])

  useEffect(() => { load() }, [load])

  /* nav */
  function prevWeek() { const d = new Date(monday); d.setDate(d.getDate() - 7); setMonday(d) }
  function nextWeek() { const d = new Date(monday); d.setDate(d.getDate() + 7); setMonday(d) }
  function thisWeek() { setMonday(getMonday(new Date())) }

  /* build status map: { "crew_name|date" -> status } */
  const statusMap = useMemo(() => {
    const m = {}
    crewStatus.forEach(s => { m[s.crew_name + '|' + s.date] = s.status })
    return m
  }, [crewStatus])

  /* build assignment map: { "job_id|date" -> [crew_name, ...] } and crew->job: { "crew_name|date" -> [job_id, ...] } */
  const { jobAssignMap, crewJobMap, crewAssignedAnyDay } = useMemo(() => {
    const jam = {}
    const cjm = {}
    const cad = new Set()
    assignments.forEach(a => {
      const jk = a.job_id + '|' + a.date
      if (!jam[jk]) jam[jk] = []
      jam[jk].push(a.crew_name)

      const ck = a.crew_name + '|' + a.date
      if (!cjm[ck]) cjm[ck] = []
      cjm[ck].push(a.job_id)

      cad.add(a.crew_name)
    })
    return { jobAssignMap: jam, crewJobMap: cjm, crewAssignedAnyDay: cad }
  }, [assignments])

  /* jobs with crew this week vs unassigned */
  const { assignedJobs, unassignedJobs } = useMemo(() => {
    const assigned = []
    const unassigned = []
    jobs.forEach(j => {
      const hasCrew = dates.some(d => {
        const k = j.job_id + '|' + d
        return jobAssignMap[k] && jobAssignMap[k].length > 0
      })
      if (hasCrew) assigned.push(j)
      else unassigned.push(j)
    })
    assigned.sort((a, b) => (a.job_num || '').localeCompare(b.job_num || ''))
    unassigned.sort((a, b) => (a.job_num || '').localeCompare(b.job_num || ''))
    return { assignedJobs: assigned, unassignedJobs: unassigned }
  }, [jobs, dates, jobAssignMap])

  /* status sections */
  const { sickList, callInList, noShowList, availableList } = useMemo(() => {
    const sick = {}
    const callIn = {}
    const noShow = {}
    crewStatus.forEach(s => {
      if (s.status === 'sick') {
        if (!sick[s.crew_name]) sick[s.crew_name] = []
        sick[s.crew_name].push(s.date)
      } else if (s.status === 'off') {
        if (!callIn[s.crew_name]) callIn[s.crew_name] = []
        callIn[s.crew_name].push(s.date)
      } else if (s.status === 'noshow') {
        if (!noShow[s.crew_name]) noShow[s.crew_name] = []
        noShow[s.crew_name].push(s.date)
      }
    })

    const allStatusCrew = new Set()
    crewStatus.forEach(s => allStatusCrew.add(s.crew_name))

    const available = crew.filter(c => {
      if (crewAssignedAnyDay.has(c.name)) return false
      // check if they have any out status this week
      const hasOut = dates.some(d => {
        const st = statusMap[c.name + '|' + d]
        return st === 'sick' || st === 'off' || st === 'noshow'
      })
      // available if not assigned and not entirely out
      const allOut = dates.every(d => {
        const st = statusMap[c.name + '|' + d]
        return st === 'sick' || st === 'off' || st === 'noshow'
      })
      return !allOut
    })

    return {
      sickList: Object.entries(sick).sort((a, b) => a[0].localeCompare(b[0])),
      callInList: Object.entries(callIn).sort((a, b) => a[0].localeCompare(b[0])),
      noShowList: Object.entries(noShow).sort((a, b) => a[0].localeCompare(b[0])),
      availableList: available.sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    }
  }, [crew, crewStatus, dates, statusMap, crewAssignedAnyDay])

  /* render a dot for a crew member on a specific day for a specific job */
  function renderDot(crewName, date, jobId) {
    const st = statusMap[crewName + '|' + date]
    const jobCrewKey = jobId + '|' + date
    const assignedHere = jobAssignMap[jobCrewKey] && jobAssignMap[jobCrewKey].includes(crewName)
    const crewJobs = crewJobMap[crewName + '|' + date] || []
    const doubleBooked = crewJobs.length > 1

    if (!assignedHere) {
      // not assigned to this job on this day
      return <span className="dly-dot dly-dot-off" title="Not assigned">{'\u2014'}</span>
    }

    // assigned to this job
    if (st === 'sick') {
      return <span className="dly-dot dly-dot-sick" title="Sick">S</span>
    }
    if (st === 'off') {
      return <span className="dly-dot dly-dot-callin" title="Call-in">C</span>
    }
    if (st === 'noshow') {
      return <span className="dly-dot dly-dot-noshow" title="No show">N</span>
    }
    if (doubleBooked) {
      return <span className="dly-dot dly-dot-double" title="Double-booked">2X</span>
    }
    // on job and available
    return <span className="dly-dot dly-dot-ok" title="On job">{'\u2713'}</span>
  }

  /* gap calculation for a job on a given day */
  function getGap(job, date) {
    const jk = job.job_id + '|' + date
    const assignedCrew = jobAssignMap[jk] || []
    // count available crew (assigned minus those out)
    const availCount = assignedCrew.filter(cn => {
      const st = statusMap[cn + '|' + date]
      return st !== 'sick' && st !== 'off' && st !== 'noshow'
    }).length
    const needed = parseInt(job.crew_needed) || 0
    if (needed <= 0) return null
    if (availCount < needed) return { avail: availCount, needed }
    return null
  }

  /* border color for a job card */
  function jobBorder(job) {
    if (isPW(job)) return '#6d28d9'
    // check if any day has a gap
    const hasGap = dates.some(d => getGap(job, d) !== null)
    if (hasGap) return '#c0392b'
    return '#5BBD3F'
  }

  /* unique crew for a job across the week */
  function jobCrewList(job) {
    const names = new Set()
    dates.forEach(d => {
      const k = job.job_id + '|' + d
      const list = jobAssignMap[k] || []
      list.forEach(n => names.add(n))
    })
    const arr = Array.from(names).sort()
    // put lead first
    if (job.lead) {
      const leadIdx = arr.findIndex(n => n === job.lead || flipName(n) === job.lead)
      if (leadIdx > 0) {
        const [lead] = arr.splice(leadIdx, 1)
        arr.unshift(lead)
      }
    }
    return arr
  }

  /* total assigned crew count (unique across week) */
  function jobCrewCount(job) {
    const names = new Set()
    dates.forEach(d => {
      const k = job.job_id + '|' + d
      const list = jobAssignMap[k] || []
      list.forEach(n => names.add(n))
    })
    return names.size
  }

  if (loading) {
    return (
      <div className="dly-wrap">
        <div className="dly-loading">Loading daily view...</div>
      </div>
    )
  }

  return (
    <div className="dly-wrap">
      {/* Week nav */}
      <div className="dly-nav">
        <button className="dly-nav-btn" onClick={prevWeek}>{'\u25C0'} Prev</button>
        <button className="dly-nav-btn dly-nav-this" onClick={thisWeek}>This Week</button>
        <button className="dly-nav-btn" onClick={nextWeek}>Next {'\u25B6'}</button>
        <span className="dly-wk-label">{fmtWk(monday)}</span>
      </div>

      {/* Day headers */}
      <div className="dly-day-headers">
        <div className="dly-dh-label">Crew / Day</div>
        {dates.map((d, i) => {
          const isToday = d === todayStr
          return (
            <div key={d} className={`dly-dh${isToday ? ' dly-dh-today' : ''}`}>
              <span className="dly-dh-day">{DAYS[i]}</span>
              <span className="dly-dh-date">{shortDate(d)}</span>
            </div>
          )
        })}
      </div>

      {/* Assigned job cards */}
      {assignedJobs.map((job, jIdx) => {
        const crewNames = jobCrewList(job)
        const crewCount = jobCrewCount(job)
        const needed = parseInt(job.crew_needed) || 0
        const border = jobBorder(job)
        const workTypes = job.work_type ? job.work_type.split(',').map(s => s.trim()).filter(Boolean) : []
        const isLead = (cn) => job.lead && (cn === job.lead || flipName(cn) === job.lead)

        return (
          <div key={job.job_id} className="dly-card" style={{ borderLeftColor: border }}>
            {/* Card header */}
            <div className="dly-card-hdr">
              <div className="dly-card-title">
                <span className="dly-card-num">{job.job_num}</span>
                <span className="dly-card-sep">{' - '}</span>
                <span className="dly-card-name">{job.job_name}</span>
              </div>
              <div className="dly-card-tags">
                {workTypes.map(wt => (
                  <span key={wt} className={`dly-tag ${gTagClass(wt)}`}>{wt}</span>
                ))}
                {job.vehicle && <span className="dly-tag dly-tag-vehicle">{job.vehicle}</span>}
                {isPW(job) && <span className="dly-tag dly-tag-pw">PW</span>}
                <span className={`dly-crew-badge${crewCount < needed ? ' dly-crew-badge-gap' : ''}`}>
                  {crewCount}/{needed || '?'}
                </span>
              </div>
            </div>

            {/* Crew rows */}
            {crewNames.map(cn => {
              const lead = isLead(cn)
              return (
                <div key={cn} className={`dly-crew-row${lead ? ' dly-crew-lead' : ''}`}>
                  <div className="dly-crew-name">
                    {lead && <span className="dly-star" title="Lead">{'\u2605'}</span>}
                    {flipName(cn)}
                  </div>
                  <div className="dly-dots">
                    {dates.map(d => (
                      <div key={d} className="dly-dot-cell">
                        {renderDot(cn, d, job.job_id)}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}

            {/* Gap row */}
            {needed > 0 && (
              <div className="dly-gap-row">
                <div className="dly-gap-label">Gaps</div>
                <div className="dly-dots">
                  {dates.map(d => {
                    const gap = getGap(job, d)
                    return (
                      <div key={d} className="dly-dot-cell">
                        {gap
                          ? <span className="dly-gap-val">{gap.avail}/{gap.needed}</span>
                          : <span className="dly-gap-ok">{'\u2014'}</span>
                        }
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Unassigned jobs section */}
      {unassignedJobs.length > 0 && (
        <div className="dly-section">
          <div className="dly-section-hdr">Unassigned Jobs ({unassignedJobs.length})</div>
          {unassignedJobs.map(job => {
            const workTypes = job.work_type ? job.work_type.split(',').map(s => s.trim()).filter(Boolean) : []
            return (
              <div key={job.job_id} className="dly-card dly-card-unassigned">
                <div className="dly-card-hdr">
                  <div className="dly-card-title">
                    <span className="dly-card-num">{job.job_num}</span>
                    <span className="dly-card-sep">{' - '}</span>
                    <span className="dly-card-name">{job.job_name}</span>
                  </div>
                  <div className="dly-card-tags">
                    {workTypes.map(wt => (
                      <span key={wt} className={`dly-tag ${gTagClass(wt)}`}>{wt}</span>
                    ))}
                    {job.vehicle && <span className="dly-tag dly-tag-vehicle">{job.vehicle}</span>}
                    {isPW(job) && <span className="dly-tag dly-tag-pw">PW</span>}
                    <span className="dly-crew-badge dly-crew-badge-gap">0/{parseInt(job.crew_needed) || '?'}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Status sections */}
      <div className="dly-status-sections">
        {/* Sick */}
        {sickList.length > 0 && (
          <div className="dly-status-block">
            <div className="dly-status-hdr">
              <span className="dly-status-dot dly-sdot-sick" />
              Sick ({sickList.length})
            </div>
            {sickList.map(([name, daysOut]) => (
              <div key={name} className="dly-status-row">
                <span className="dly-status-name">{flipName(name)}</span>
                <span className="dly-status-days">
                  {daysOut.sort().map(d => shortDate(d)).join(', ')}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Call In */}
        {callInList.length > 0 && (
          <div className="dly-status-block">
            <div className="dly-status-hdr">
              <span className="dly-status-dot dly-sdot-callin" />
              Call In ({callInList.length})
            </div>
            {callInList.map(([name, daysOut]) => (
              <div key={name} className="dly-status-row">
                <span className="dly-status-name">{flipName(name)}</span>
                <span className="dly-status-days">
                  {daysOut.sort().map(d => shortDate(d)).join(', ')}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* No Show */}
        {noShowList.length > 0 && (
          <div className="dly-status-block">
            <div className="dly-status-hdr">
              <span className="dly-status-dot dly-sdot-noshow" />
              No Show ({noShowList.length})
            </div>
            {noShowList.map(([name, daysOut]) => (
              <div key={name} className="dly-status-row">
                <span className="dly-status-name">{flipName(name)}</span>
                <span className="dly-status-days">
                  {daysOut.sort().map(d => shortDate(d)).join(', ')}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Available Unassigned */}
        {availableList.length > 0 && (
          <div className="dly-status-block">
            <div className="dly-status-hdr">
              <span className="dly-status-dot dly-sdot-avail" />
              Available Unassigned ({availableList.length})
            </div>
            {availableList.map(c => (
              <div key={c.name} className="dly-status-row">
                <span className="dly-status-name">{flipName(c.name)}</span>
                <span className="dly-status-team">{c.team || 'Floater'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="dly-legend">
        <span className="dly-legend-title">Legend</span>
        <span className="dly-legend-item"><span className="dly-dot dly-dot-ok">{'\u2713'}</span> On job</span>
        <span className="dly-legend-item"><span className="dly-dot dly-dot-sick">S</span> Sick</span>
        <span className="dly-legend-item"><span className="dly-dot dly-dot-callin">C</span> Call-in</span>
        <span className="dly-legend-item"><span className="dly-dot dly-dot-noshow">N</span> No show</span>
        <span className="dly-legend-item"><span className="dly-dot dly-dot-off">{'\u2014'}</span> Off / Not assigned</span>
        <span className="dly-legend-item"><span className="dly-dot dly-dot-double">2X</span> Double-booked</span>
        <span className="dly-legend-item"><span className="dly-gap-val">X/N</span> Gap (avail/needed)</span>
      </div>

      <style>{`
        .dly-wrap {
          padding: 16px 24px;
          max-width: 1200px;
          margin: 0 auto;
        }
        .dly-loading {
          text-align: center;
          padding: 40px;
          font-family: var(--font-heading);
          font-size: 14px;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        /* Nav */
        .dly-nav {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 16px;
        }
        .dly-nav-btn {
          font-family: var(--font-heading);
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 6px 14px;
          border: 2px solid var(--border);
          border-radius: 4px;
          background: var(--bg-card);
          color: var(--text-primary);
          cursor: pointer;
        }
        .dly-nav-btn:hover {
          border-color: var(--command-green);
        }
        .dly-nav-this {
          background: var(--command-green);
          color: var(--header-dark);
          border-color: var(--command-green);
        }
        .dly-nav-this:hover {
          background: #4aa832;
        }
        .dly-wk-label {
          font-family: var(--font-heading);
          font-size: 18px;
          font-weight: 700;
          letter-spacing: 0.5px;
          margin-left: 12px;
          color: var(--text-primary);
        }

        /* Day headers */
        .dly-day-headers {
          display: grid;
          grid-template-columns: 160px repeat(6, 1fr);
          gap: 2px;
          margin-bottom: 12px;
          background: var(--header-dark);
          border: 2px solid var(--border);
          border-radius: 4px;
          overflow: hidden;
        }
        .dly-dh-label {
          font-family: var(--font-heading);
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 8px 10px;
          color: var(--sand-light);
          display: flex;
          align-items: center;
        }
        .dly-dh {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 6px 4px;
          color: var(--white);
        }
        .dly-dh-today {
          background: var(--danger);
        }
        .dly-dh-day {
          font-family: var(--font-heading);
          font-size: 13px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .dly-dh-date {
          font-family: var(--font-mono);
          font-size: 11px;
          opacity: 0.8;
        }

        /* Job card */
        .dly-card {
          border: 2px solid var(--border);
          border-left-width: 6px;
          border-left-color: var(--command-green);
          border-radius: 4px;
          background: var(--bg-card);
          margin-bottom: 10px;
          overflow: hidden;
        }
        .dly-card-unassigned {
          border-left-color: var(--danger);
          opacity: 0.75;
        }
        .dly-card-hdr {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: var(--header-dark);
          color: var(--white);
          flex-wrap: wrap;
          gap: 6px;
        }
        .dly-card-title {
          font-family: var(--font-heading);
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }
        .dly-card-num {
          color: var(--command-green);
        }
        .dly-card-sep {
          color: var(--sand-dark);
          margin: 0 2px;
        }
        .dly-card-name {
          color: var(--white);
        }
        .dly-card-tags {
          display: flex;
          gap: 4px;
          align-items: center;
          flex-wrap: wrap;
        }
        .dly-tag {
          font-family: var(--font-heading);
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 2px 8px;
          border-radius: 3px;
          background: rgba(255,255,255,0.15);
          color: var(--white);
        }
        .dly-tag.tg-fl { background: #e67e22; color: #fff; }
        .dly-tag.tg-ep { background: #3498db; color: #fff; }
        .dly-tag.tg-ca { background: #1abc9c; color: #fff; }
        .dly-tag.tg-de { background: #e74c3c; color: #fff; }
        .dly-tag.tg-jo { background: #9b59b6; color: #fff; }
        .dly-tag.tg-pl { background: #8e44ad; color: #fff; }
        .dly-tag-vehicle {
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.3);
        }
        .dly-tag-pw {
          background: var(--pw);
          color: #fff;
        }
        .dly-crew-badge {
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 3px;
          background: var(--command-green);
          color: var(--header-dark);
        }
        .dly-crew-badge-gap {
          background: var(--danger);
          color: #fff;
        }

        /* Crew rows */
        .dly-crew-row {
          display: grid;
          grid-template-columns: 160px 1fr;
          border-top: 1px solid rgba(0,0,0,0.1);
          min-height: 32px;
        }
        .dly-crew-row:hover {
          background: rgba(0,0,0,0.04);
        }
        .dly-crew-lead {
          background: rgba(52, 152, 219, 0.08);
        }
        .dly-crew-lead:hover {
          background: rgba(52, 152, 219, 0.14);
        }
        .dly-crew-name {
          font-family: var(--font-body);
          font-size: 12px;
          font-weight: 600;
          padding: 6px 10px;
          display: flex;
          align-items: center;
          gap: 4px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dly-star {
          color: #3498db;
          font-size: 14px;
        }
        .dly-dots {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 2px;
        }
        .dly-dot-cell {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 4px 0;
        }

        /* Dots */
        .dly-dot {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 22px;
          border-radius: 3px;
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 700;
        }
        .dly-dot-ok {
          background: var(--command-green);
          color: var(--header-dark);
        }
        .dly-dot-sick {
          background: var(--danger);
          color: #fff;
        }
        .dly-dot-callin {
          background: var(--warning);
          color: #fff;
        }
        .dly-dot-noshow {
          background: var(--danger);
          color: #fff;
        }
        .dly-dot-off {
          background: rgba(0,0,0,0.08);
          color: var(--text-light);
        }
        .dly-dot-double {
          background: var(--command-green);
          color: var(--header-dark);
          font-size: 9px;
          font-weight: 900;
        }

        /* Gap row */
        .dly-gap-row {
          display: grid;
          grid-template-columns: 160px 1fr;
          border-top: 2px dashed rgba(0,0,0,0.15);
          background: rgba(192, 57, 43, 0.05);
          min-height: 28px;
        }
        .dly-gap-label {
          font-family: var(--font-heading);
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 4px 10px;
          display: flex;
          align-items: center;
          color: var(--danger);
        }
        .dly-gap-val {
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 700;
          color: var(--danger);
          background: rgba(192, 57, 43, 0.12);
          padding: 2px 6px;
          border-radius: 3px;
        }
        .dly-gap-ok {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-light);
        }

        /* Section header */
        .dly-section {
          margin-top: 20px;
        }
        .dly-section-hdr {
          font-family: var(--font-heading);
          font-size: 14px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 1px;
          padding: 8px 12px;
          background: var(--header-dark);
          color: var(--danger);
          border: 2px solid var(--border);
          border-radius: 4px 4px 0 0;
          margin-bottom: 0;
        }
        .dly-section .dly-card {
          border-radius: 0;
          margin-bottom: 0;
          border-top: none;
        }
        .dly-section .dly-card:last-child {
          border-radius: 0 0 4px 4px;
        }

        /* Status sections */
        .dly-status-sections {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 12px;
          margin-top: 20px;
        }
        .dly-status-block {
          border: 2px solid var(--border);
          border-radius: 4px;
          background: var(--bg-card);
          overflow: hidden;
        }
        .dly-status-hdr {
          font-family: var(--font-heading);
          font-size: 13px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 8px 12px;
          background: var(--header-dark);
          color: var(--white);
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .dly-status-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          display: inline-block;
          flex-shrink: 0;
        }
        .dly-sdot-sick { background: var(--danger); }
        .dly-sdot-callin { background: var(--warning); }
        .dly-sdot-noshow { background: var(--warning); }
        .dly-sdot-avail { background: var(--command-green); }
        .dly-status-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 12px;
          border-top: 1px solid rgba(0,0,0,0.08);
          font-size: 13px;
        }
        .dly-status-row:hover {
          background: rgba(0,0,0,0.04);
        }
        .dly-status-name {
          font-weight: 600;
        }
        .dly-status-days {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-secondary);
        }
        .dly-status-team {
          font-family: var(--font-heading);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-secondary);
        }

        /* Legend */
        .dly-legend {
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
          margin-top: 20px;
          padding: 10px 16px;
          border: 2px solid var(--border);
          border-radius: 4px;
          background: var(--bg-card);
        }
        .dly-legend-title {
          font-family: var(--font-heading);
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--text-secondary);
        }
        .dly-legend-item {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: var(--text-secondary);
        }
      `}</style>
    </div>
  )
}
