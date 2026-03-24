import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const DAYS_LONG = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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

function wkDates(monday) {
  const r = []
  for (let i = 0; i < 6; i++) {
    const dt = new Date(monday)
    dt.setDate(dt.getDate() + i)
    r.push(fmtD(dt))
  }
  return r
}

function flipName(n) {
  if (!n) return ''
  const p = n.split(',')
  return p.length === 2 ? p[1].trim() + ' ' + p[0].trim() : n
}

export default function StatsBar() {
  const [crew, setCrew] = useState([])
  const [assignments, setAssignments] = useState([])
  const [crewStatus, setCrewStatus] = useState({})
  const [jobs, setJobs] = useState([])
  const [dayDetailDate, setDayDetailDate] = useState(null)

  const monday = useMemo(() => getMonday(new Date()), [])
  const dates = useMemo(() => wkDates(monday), [monday])
  const wsStr = dates[0]
  const weStr = dates[5]
  const todayStr = fmtD(new Date())

  const loadData = useCallback(async () => {
    const [crewRes, asgnRes, csRes, jobRes] = await Promise.all([
      supabase.from('crew').select('*'),
      supabase.from('assignments').select('*').gte('date', wsStr).lte('date', weStr),
      supabase.from('crew_status').select('*').gte('date', wsStr).lte('date', weStr),
      supabase.from('jobs').select('*').or('deleted.is.null,deleted.eq.No'),
    ])
    if (crewRes.data) setCrew(crewRes.data.filter(c => c.archived !== 'Yes'))
    if (asgnRes.data) setAssignments(asgnRes.data)
    if (jobRes.data) setJobs(jobRes.data)
    if (csRes.data) {
      const csMap = {}
      for (const c of csRes.data) csMap[c.crew_name + '|' + c.date] = c.status
      setCrewStatus(csMap)
    }
  }, [wsStr, weStr])

  useEffect(() => { loadData() }, [loadData])

  const getCSt = (name, ds) => crewStatus[name + '|' + ds] || 'available'

  const stats = useMemo(() => {
    return dates.map(d => {
      let out = 0
      let assigned = 0
      for (const c of crew) {
        const st = getCSt(c.name, d)
        if (st !== 'available') {
          out++
        } else {
          const hasAsgn = assignments.some(a => a.crew_name === c.name && a.date === d)
          if (hasAsgn) assigned++
        }
      }
      const avail = crew.length - out - assigned
      return { avail, out }
    })
  }, [dates, crew, crewStatus, assignments])

  // Day detail
  const dayDetail = useMemo(() => {
    if (!dayDetailDate) return null
    const ds = dayDetailDate
    const available = []
    const assignedList = []
    const out = []
    for (const c of crew) {
      const st = getCSt(c.name, ds)
      if (st !== 'available') {
        out.push({ name: c.name, status: st })
      } else {
        const crewAsgns = assignments.filter(a => a.crew_name === c.name && a.date === ds)
        if (crewAsgns.length > 0) {
          for (const a of crewAsgns) {
            const job = jobs.find(j => String(j.job_id) === String(a.job_id))
            assignedList.push({ name: c.name, job })
          }
        } else {
          available.push({ name: c.name })
        }
      }
    }
    return { available, assigned: assignedList, out }
  }, [dayDetailDate, crew, crewStatus, assignments, jobs])

  if (crew.length === 0) return null

  return (
    <>
      <div className="statsbar">
        <div className="statsbar-label" />
        {dates.map((d, i) => (
          <div key={d} className={`statsbar-day${d === todayStr ? ' statsbar-today' : ''}`}>
            {DAYS_LONG[i]}<br />
            <span className="statsbar-date">{d.split('-')[1]}/{d.split('-')[2]}</span>
          </div>
        ))}
        <div className="statsbar-label" style={{ color: 'var(--command-green)' }}>Avail</div>
        {stats.map((s, i) => (
          <div key={'a' + i} className={`statsbar-val statsbar-click ${s.avail <= 1 ? 'statsbar-warn' : s.avail <= 3 ? 'statsbar-ok' : 'statsbar-good'}`} onClick={() => setDayDetailDate(dates[i])}>{s.avail}</div>
        ))}
        <div className="statsbar-label" style={{ color: 'var(--danger)' }}>Out</div>
        {stats.map((s, i) => (
          <div key={'o' + i} className={`statsbar-val statsbar-click ${s.out > 0 ? 'statsbar-out' : 'statsbar-none'}`} onClick={() => setDayDetailDate(dates[i])}>{s.out}</div>
        ))}
      </div>

      {dayDetailDate && dayDetail && (() => {
        const di = dates.indexOf(dayDetailDate)
        const dayLabel = DAYS_LONG[di] || ''
        const dateLabel = dayDetailDate.split('-')[1] + '/' + dayDetailDate.split('-')[2]
        return (
          <div className="sch-modal-overlay" onClick={() => setDayDetailDate(null)}>
            <div className="sch-modal sch-modal-detail" onClick={e => e.stopPropagation()}>
              <div className="sch-modal-title">{dayLabel} {dateLabel}</div>
              <div className="sch-dd-section-hdr" style={{ color: 'var(--command-green)' }}>Available ({dayDetail.available.length})</div>
              {dayDetail.available.map(c => (
                <div key={c.name} className="sch-dd-row">{'\u2022'} {flipName(c.name)}</div>
              ))}
              <div className="sch-dd-section-hdr" style={{ color: '#3498db' }}>Assigned ({dayDetail.assigned.length})</div>
              {dayDetail.assigned.map((c, i) => (
                <div key={c.name + i} className="sch-dd-row">
                  {'\u2022'} {flipName(c.name)} <span className="sch-dd-arrow">{'\u2192'}</span> {c.job ? c.job.job_num + ' - ' + c.job.job_name : '?'}
                </div>
              ))}
              <div className="sch-dd-section-hdr" style={{ color: 'var(--danger)' }}>Out ({dayDetail.out.length})</div>
              {dayDetail.out.map(c => (
                <div key={c.name} className="sch-dd-row">{'\u2022'} {flipName(c.name)} <span className="sch-dd-status">({c.status})</span></div>
              ))}
              <div className="sch-modal-actions">
                <button className="sch-btn" onClick={() => setDayDetailDate(null)}>CLOSE</button>
              </div>
            </div>
          </div>
        )
      })()}
    </>
  )
}
