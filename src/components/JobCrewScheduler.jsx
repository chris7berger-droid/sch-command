import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'

/* ── helpers ────────────────────────────────────────────────────── */

function flipName(n) {
  if (!n) return ''
  const p = n.split(',')
  return p.length === 2 ? p[1].trim() + ' ' + p[0].trim() : n
}

function shortName(n) {
  const f = flipName(n)
  const parts = f.split(' ')
  if (parts.length < 2) return f
  return parts[0] + ' ' + parts[parts.length - 1][0] + '.'
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function getMonday(d) {
  const dt = new Date(d)
  const day = dt.getDay()
  const diff = day === 0 ? -6 : 1 - day
  dt.setDate(dt.getDate() + diff)
  return dt
}

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtShort(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function addDays(d, n) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function buildWeeks(startStr, endStr) {
  if (!startStr || !endStr) return []
  const start = new Date(startStr + 'T00:00:00')
  const end = new Date(endStr + 'T00:00:00')
  if (isNaN(start) || isNaN(end) || end < start) return []

  const weeks = []
  let monday = getMonday(start)

  while (monday <= end) {
    const days = []
    for (let i = 0; i < 6; i++) {
      const d = addDays(monday, i)
      const ds = fmtDate(d)
      const inRange = d >= start && d <= end
      days.push({ date: d, dateStr: ds, label: DAY_LABELS[i], short: fmtShort(d), inRange })
    }
    weeks.push({
      label: `Week of ${monday.toLocaleDateString('en-US', { month: 'short' })} ${monday.getDate()}`,
      monday: new Date(monday),
      days,
    })
    monday = addDays(monday, 7)
  }
  return weeks
}

/* ── component ──────────────────────────────────────────────────── */

export default function JobCrewScheduler({ job, onAssignmentsChange }) {
  const [crew, setCrew] = useState([])
  const [jobAssignments, setJobAssignments] = useState([])   // this job only
  const [allAssignments, setAllAssignments] = useState([])    // all jobs in date range
  const [jobLookup, setJobLookup] = useState({})              // job_id -> { job_num, job_name }
  const [loading, setLoading] = useState(true)
  const [weekPicker, setWeekPicker] = useState(null) // which week index has picker open

  const jobId = job?.job_id
  const startDate = job?.scheduled_start || job?.start_date
  const endDate = job?.scheduled_end || job?.end_date

  const weeks = useMemo(() => buildWeeks(startDate, endDate), [startDate, endDate])

  // All date strings in the full week range (including out-of-range days for context)
  const weekDateRange = useMemo(() => {
    if (!weeks.length) return { min: null, max: null }
    const first = weeks[0].days[0].dateStr
    const last = weeks[weeks.length - 1].days[5].dateStr
    return { min: first, max: last }
  }, [weeks])

  // In-range dates only (for auto-assign)
  const inRangeDates = useMemo(() => {
    const dates = []
    weeks.forEach(w => w.days.forEach(d => { if (d.inRange) dates.push(d.dateStr) }))
    return dates
  }, [weeks])

  const loadData = useCallback(async () => {
    if (!jobId || !weekDateRange.min) return
    const [crewRes, jobAsgnRes, allAsgnRes, jobsRes] = await Promise.all([
      supabase.from('crew').select('*').or('archived.is.null,archived.eq.No').order('name'),
      supabase.from('assignments').select('*').eq('job_id', jobId),
      supabase.from('assignments').select('crew_name, date, job_id').gte('date', weekDateRange.min).lte('date', weekDateRange.max),
      supabase.from('jobs').select('job_id, job_num, job_name'),
    ])
    setCrew(crewRes.data || [])
    setJobAssignments(jobAsgnRes.data || [])
    setAllAssignments(allAsgnRes.data || [])
    const jl = {}
    ;(jobsRes.data || []).forEach(j => { jl[j.job_id] = { job_num: j.job_num, job_name: j.job_name } })
    setJobLookup(jl)
    setLoading(false)
  }, [jobId, weekDateRange.min, weekDateRange.max])

  useEffect(() => { loadData() }, [loadData])

  // This job's assignment lookup: { "crew_name|date": true }
  const asgnMap = useMemo(() => {
    const m = {}
    jobAssignments.forEach(a => { m[a.crew_name + '|' + a.date] = true })
    return m
  }, [jobAssignments])

  // All assignments lookup: { "crew_name|date": [job_id, ...] }
  const allAsgnMap = useMemo(() => {
    const m = {}
    allAssignments.forEach(a => {
      const key = a.crew_name + '|' + a.date
      if (!m[key]) m[key] = []
      m[key].push(a.job_id)
    })
    return m
  }, [allAssignments])

  // Unique crew assigned to this job
  const assignedCrew = useMemo(() => {
    const names = new Set(jobAssignments.map(a => a.crew_name))
    return [...names].sort()
  }, [jobAssignments])

  // Count busy days per crew member (for dropdown)
  const crewBusyDays = useMemo(() => {
    const m = {}
    inRangeDates.forEach(ds => {
      allAssignments.forEach(a => {
        if (a.date === ds && a.job_id !== jobId) {
          if (!m[a.crew_name]) m[a.crew_name] = 0
          m[a.crew_name]++
        }
      })
    })
    return m
  }, [allAssignments, inRangeDates, jobId])

  // Reload just this job's assignments (no blink)
  const reloadAssignments = useCallback(async () => {
    const [jobRes, allRes] = await Promise.all([
      supabase.from('assignments').select('*').eq('job_id', jobId),
      supabase.from('assignments').select('crew_name, date, job_id').gte('date', weekDateRange.min).lte('date', weekDateRange.max),
    ])
    setJobAssignments(jobRes.data || [])
    setAllAssignments(allRes.data || [])
    if (onAssignmentsChange) onAssignmentsChange(jobRes.data || [])
  }, [jobId, weekDateRange.min, weekDateRange.max, onAssignmentsChange])

  const toggleDay = useCallback(async (crewName, dateStr) => {
    const key = crewName + '|' + dateStr
    if (asgnMap[key]) {
      await supabase.from('assignments').delete().eq('job_id', jobId).eq('crew_name', crewName).eq('date', dateStr)
    } else {
      await supabase.from('assignments').insert({ job_id: jobId, crew_name: crewName, date: dateStr })
    }
    await reloadAssignments()
  }, [jobId, asgnMap, reloadAssignments])

  // Add crew to specific dates (a week's in-range days)
  const addCrewToDates = useCallback(async (crewName, dates) => {
    if (!crewName || !dates.length) return
    const existing = new Set(jobAssignments.filter(a => a.crew_name === crewName).map(a => a.date))
    const toInsert = dates.filter(d => !existing.has(d)).map(d => ({ job_id: jobId, crew_name: crewName, date: d }))
    if (toInsert.length > 0) {
      await supabase.from('assignments').insert(toInsert)
    }
    await reloadAssignments()
  }, [jobId, jobAssignments, reloadAssignments])

  const removeCrew = useCallback(async (crewName) => {
    await supabase.from('assignments').delete().eq('job_id', jobId).eq('crew_name', crewName)
    await reloadAssignments()
  }, [jobId, reloadAssignments])

  // Add a single crew member to a single day
  const addCrewToDay = useCallback(async (crewName, dateStr) => {
    if (!crewName) return
    await supabase.from('assignments').insert({ job_id: jobId, crew_name: crewName, date: dateStr })
    await reloadAssignments()
  }, [jobId, reloadAssignments])

  // Copy crew pattern from previous week
  const copyFromPrevWeek = useCallback(async (prevWeek, thisWeek) => {
    const prevInRange = prevWeek.days.filter(d => d.inRange).map(d => d.dateStr)
    const thisInRange = thisWeek.days.filter(d => d.inRange)

    // Get crew assigned in previous week and their day-of-week pattern
    const prevCrew = {}
    jobAssignments.forEach(a => {
      if (prevInRange.includes(a.date)) {
        if (!prevCrew[a.crew_name]) prevCrew[a.crew_name] = new Set()
        const d = new Date(a.date + 'T00:00:00')
        prevCrew[a.crew_name].add(d.getDay()) // day of week (0=Sun)
      }
    })

    // Create assignments for this week matching the same day-of-week pattern
    const toInsert = []
    const existing = new Set(jobAssignments.map(a => a.crew_name + '|' + a.date))
    for (const [name, daySet] of Object.entries(prevCrew)) {
      thisInRange.forEach(d => {
        if (daySet.has(d.date.getDay()) && !existing.has(name + '|' + d.dateStr)) {
          toInsert.push({ job_id: jobId, crew_name: name, date: d.dateStr })
        }
      })
    }
    if (toInsert.length > 0) {
      await supabase.from('assignments').insert(toInsert)
      await reloadAssignments()
    }
  }, [jobId, jobAssignments, reloadAssignments])

  if (loading) return <div className="jcs-loading">Loading schedule...</div>
  if (!weeks.length) return <div className="jcs-empty">Set start and end dates to schedule crew</div>

  const totalInRange = inRangeDates.length

  // Format dates for the banner
  const startFormatted = startDate ? new Date(startDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '—'
  const endFormatted = endDate ? new Date(endDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '—'
  const totalDays = startDate && endDate ? Math.round((new Date(endDate + 'T00:00:00') - new Date(startDate + 'T00:00:00')) / (1000 * 60 * 60 * 24)) + 1 : 0

  return (
    <div className="jcs-wrap" onClick={e => e.stopPropagation()}>
      <div className="jcs-title">Crew Schedule</div>

      <div className="jcs-date-banner">
        <div className="jcs-date-banner-label">JOB SCHEDULE DATES</div>
        <div className="jcs-date-banner-range">
          <span className="jcs-date-banner-date">{startFormatted}</span>
          <span className="jcs-date-banner-arrow">{'\u2192'}</span>
          <span className="jcs-date-banner-date">{endFormatted}</span>
          {totalDays > 0 && <span className="jcs-date-banner-days">{totalDays} day{totalDays !== 1 ? 's' : ''}</span>}
        </div>
      </div>

      {weeks.map((week, wi) => {
        // Only show crew that have assignments in THIS week
        const weekDates = new Set(week.days.filter(d => d.inRange).map(d => d.dateStr))
        const weekCrew = [...new Set(
          jobAssignments
            .filter(a => weekDates.has(a.date))
            .map(a => a.crew_name)
        )].sort()

        const prevWeek = wi > 0 ? weeks[wi - 1] : null
        const prevWeekHasCrew = prevWeek && jobAssignments.some(a => {
          const prevDates = new Set(prevWeek.days.filter(d => d.inRange).map(d => d.dateStr))
          return prevDates.has(a.date)
        })

        return (
          <div key={wi} className="jcs-week">
            <div className="jcs-week-top">
              {weeks.length > 1 && <div className="jcs-week-label">{week.label}</div>}
              {prevWeekHasCrew && weekCrew.length === 0 && (
                <button className="jcs-copy-btn" onClick={() => copyFromPrevWeek(prevWeek, week)}>
                  Copy from previous week
                </button>
              )}
            </div>

            {/* Day headers */}
            <div className="jcs-grid">
              <div className="jcs-name-col" />
              {week.days.map(d => (
                <div
                  key={d.dateStr}
                  className={`jcs-day-hdr${!d.inRange ? ' out' : ''}`}
                >
                  <span className="jcs-day-label">{d.label}</span>
                  <span className="jcs-day-date">{d.short}</span>
                </div>
              ))}
            </div>

            {/* Crew rows — only crew assigned this week */}
            {weekCrew.map(name => (
              <div key={name} className="jcs-grid jcs-crew-row">
                <div className="jcs-name-col">
                  <span className="jcs-crew-name">{flipName(name)}</span>
                  <button className="jcs-remove" onClick={() => removeCrew(name)} title="Remove from all days">×</button>
                </div>
                {week.days.map(d => {
                  const assigned = asgnMap[name + '|' + d.dateStr]
                  const otherJobs = (allAsgnMap[name + '|' + d.dateStr] || []).filter(id => id !== jobId)
                  const otherJobNames = otherJobs.map(id => { const j = jobLookup[id]; return j ? `${j.job_num} - ${j.job_name}` : `Job ${id}` }).join(', ')
                  return (
                    <div
                      key={d.dateStr}
                      className={`jcs-cell${assigned ? ' on' : ''}${!d.inRange ? ' out' : ''}${otherJobs.length > 0 && !assigned ? ' busy' : ''}`}
                      onClick={() => d.inRange && toggleDay(name, d.dateStr)}
                      title={assigned ? 'Click to unassign' : otherJobs.length > 0 ? `On: ${otherJobNames}` : 'Click to assign'}
                    >
                      {assigned && <span className="jcs-bubble">{shortName(name)}</span>}
                    </div>
                  )
                })}
              </div>
            ))}

            {weekCrew.length === 0 && !prevWeekHasCrew && (
              <div className="jcs-empty-row">No crew assigned</div>
            )}

            {/* Per-week add crew button */}
            <button
              className="jcs-add-btn"
              onClick={() => setWeekPicker(weekPicker === wi ? null : wi)}
            >
              {weekPicker === wi ? '− Close' : '+ Add crew member...'}
            </button>

            {/* Per-week picker panel */}
            {weekPicker === wi && (() => {
              const weekInRange = week.days.filter(d => d.inRange)
              const weekDateStrs = weekInRange.map(d => d.dateStr)
              // Show all crew — checkmarks indicate who's booked
              const available = crew

              return (
                <div className="jcs-picker">
                  <div className="jcs-picker-hdr" style={{ gridTemplateColumns: `150px repeat(${weekInRange.length}, 1fr)` }}>
                    <div className="jcs-picker-name-col">Crew</div>
                    {weekInRange.map(d => (
                      <div key={d.dateStr} className="jcs-picker-day">
                        <span>{d.label}</span>
                        <span>{d.short}</span>
                      </div>
                    ))}
                  </div>

                  {available.map(c => {
                    const busyCount = weekDateStrs.filter(ds => {
                      const jobs = allAsgnMap[c.name + '|' + ds] || []
                      return jobs.some(id => id !== jobId)
                    }).length
                    const freeCount = weekDateStrs.length - busyCount

                    return (
                      <div key={c.name} className="jcs-picker-row" style={{ gridTemplateColumns: `150px repeat(${weekInRange.length}, 1fr)` }}>
                        <div className="jcs-picker-name-col">
                          <button
                            className="jcs-picker-add"
                            onClick={() => { addCrewToDates(c.name, weekDateStrs); setWeekPicker(null) }}
                            title="Add to all free days this week"
                          >+</button>
                          <span className="jcs-picker-cname">{flipName(c.name)}</span>
                          <span className="jcs-picker-avail">{freeCount}/{weekDateStrs.length}</span>
                        </div>
                        {weekDateStrs.map(ds => {
                          const alreadyOnThisJob = asgnMap[c.name + '|' + ds]
                          const otherJobs = (allAsgnMap[c.name + '|' + ds] || []).filter(id => id !== jobId)
                          const busy = otherJobs.length > 0
                          const busyJobNames = otherJobs.map(id => { const j = jobLookup[id]; return j ? `${j.job_num} - ${j.job_name}` : `Job ${id}` }).join(', ')
                          const booked = alreadyOnThisJob || busy
                          return (
                            <div
                              key={ds}
                              className={`jcs-picker-cell${alreadyOnThisJob ? ' assigned' : busy ? ' busy' : ' free'} clickable`}
                              onClick={e => { e.stopPropagation(); if (!alreadyOnThisJob) addCrewToDay(c.name, ds) }}
                              title={alreadyOnThisJob ? 'Assigned to this job' : busy ? `On: ${busyJobNames} — click to assign anyway` : 'Available — click to assign'}
                            >
                              {booked ? '✓' : '○'}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                  {available.length === 0 && (
                    <div className="jcs-empty-row">All crew assigned this week</div>
                  )}
                </div>
              )
            })()}
          </div>
        )
      })}
    </div>
  )
}
