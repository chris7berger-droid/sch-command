import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { loadJobs, updateJobField } from '../lib/queries'
import { useUser } from '../lib/user'

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const DAYS_LONG = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const JC = ['#3498db','#e74c3c','#2ecc71','#9b59b6','#e67e22','#1abc9c','#f39c12','#c0392b','#2980b9','#8e44ad','#27ae60','#d35400','#16a085','#7f8c8d','#2c3e50','#d4a017']

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
  return ms[monday.getMonth()] + ' ' + monday.getDate() + ' – ' + ms[end.getMonth()] + ' ' + end.getDate() + ', ' + end.getFullYear()
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

function wkEnd(monday) {
  const d = new Date(monday)
  d.setDate(d.getDate() + 5)
  return fmtD(d)
}

function effStart(j) { return j.scheduled_start || j.start_date || null }
function effEnd(j) { return j.scheduled_end || j.end_date || null }

function jobOverlapsWeek(j, wsStr, weStr) {
  const js = effStart(j) ? String(effStart(j)).split('T')[0] : ''
  const je = effEnd(j) ? String(effEnd(j)).split('T')[0] : ''
  if (!js && !je) return true
  const start = js || '0000-01-01'
  const end = je || '9999-12-31'
  return start <= weStr && end >= wsStr
}

function jobInRange(j, ds) {
  const js = effStart(j) ? String(effStart(j)).split('T')[0] : ''
  const je = effEnd(j) ? String(effEnd(j)).split('T')[0] : ''
  if (!js && !je) return false
  if (js && ds < js) return false
  if (je && ds > je) return false
  return true
}

function isPW(j) {
  return j.prevailing_wage === 'Yes' || j.prevailing_wage === 'true' || j.prevailing_wage === true
}

function jCol(idx) {
  return JC[idx % JC.length]
}

function flipName(n) {
  if (!n) return ''
  const p = n.split(',')
  return p.length === 2 ? p[1].trim() + ' ' + p[0].trim() : n
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

export default function Schedule() {
  const user = useUser()
  const changedBy = user?.name || changedBy
  const [jobs, setJobs] = useState([])
  const [crew, setCrew] = useState([])
  const [assignments, setAssignments] = useState([])
  const [crewStatus, setCrewStatus] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const [expandedJobs, setExpandedJobs] = useState({})
  const [expandedDefer, setExpandedDefer] = useState({})
  const [workTypes, setWorkTypes] = useState([])
  const [wtOpen, setWtOpen] = useState({})

  const monday = useMemo(() => {
    const m = getMonday(new Date())
    m.setDate(m.getDate() + weekOffset * 7)
    return m
  }, [weekOffset])

  const dates = useMemo(() => wkDates(monday), [monday])
  const wsStr = dates[0]
  const weStr = dates[5]
  const todayStr = fmtD(new Date())

  // Load static data once on mount
  useEffect(() => {
    async function loadStatic() {
      const [jobRes, crewRes, wtRes] = await Promise.all([
        loadJobs(),
        supabase.from('crew').select('*'),
        supabase.from('work_types').select('*'),
      ])
      if (jobRes.error || crewRes.error || wtRes.error) {
        setError((jobRes.error || crewRes.error || wtRes.error).message)
        return
      }
      setJobs(jobRes.data)
      setCrew(crewRes.data.filter(c => c.archived !== 'Yes'))
      setWorkTypes(wtRes.data.map(w => w.name))
    }
    loadStatic()
  }, [])

  // Load week-scoped data whenever week changes
  const loadWeekData = useCallback(async () => {
    const [asgnRes, csRes] = await Promise.all([
      supabase.from('assignments').select('*').gte('date', wsStr).lte('date', weStr),
      supabase.from('crew_status').select('*').gte('date', wsStr).lte('date', weStr),
    ])
    if (asgnRes.error || csRes.error) {
      setError((asgnRes.error || csRes.error).message)
      return
    }
    setAssignments(asgnRes.data)
    const csMap = {}
    for (const c of csRes.data) {
      csMap[c.crew_name + '|' + c.date] = c.status
    }
    setCrewStatus(csMap)
    setLoading(false)
  }, [wsStr, weStr])

  useEffect(() => { loadWeekData() }, [loadWeekData])

  const getCSt = useCallback((name, dateStr) => {
    return crewStatus[name + '|' + dateStr] || 'available'
  }, [crewStatus])

  // Build assignment lookup: job_id|date -> [crew_names]
  const asgnByJobDate = useMemo(() => {
    const map = {}
    for (const a of assignments) {
      const key = a.job_id + '|' + a.date
      if (!map[key]) map[key] = []
      if (!map[key].includes(a.crew_name)) map[key].push(a.crew_name)
    }
    return map
  }, [assignments])

  // Build crew -> { date -> [jobIds] } for double-booking detection
  const crewDayJobs = useMemo(() => {
    const map = {}
    for (const a of assignments) {
      if (!map[a.crew_name]) map[a.crew_name] = {}
      if (!map[a.crew_name][a.date]) map[a.crew_name][a.date] = []
      if (!map[a.crew_name][a.date].includes(a.job_id)) {
        map[a.crew_name][a.date].push(a.job_id)
      }
    }
    return map
  }, [assignments])

  function getDoubleBookedDays(name) {
    const dayMap = crewDayJobs[name] || {}
    const r = []
    for (const dk in dayMap) {
      if (dayMap[dk].length > 1) r.push(dk)
    }
    return r
  }

  function isDoubleBooked(name) {
    return getDoubleBookedDays(name).length > 0
  }

  // Crew assigned anywhere this week
  const wkAssignedNames = useMemo(() => {
    const s = {}
    for (const a of assignments) s[a.crew_name] = true
    return s
  }, [assignments])

  // Unique crew names assigned to a job this week
  function wkAsgnUnique(jobId) {
    const names = {}
    for (const a of assignments) {
      if (String(a.job_id) === String(jobId)) names[a.crew_name] = true
    }
    return Object.keys(names)
  }

  // Crew job days
  function crewJobDays(jobId, name) {
    const r = []
    for (const a of assignments) {
      if (String(a.job_id) === String(jobId) && a.crew_name === name && dates.includes(a.date)) {
        r.push(a.date)
      }
    }
    return r
  }

  // Week jobs: active jobs overlapping current week
  const weekJobs = useMemo(() => {
    return jobs.filter(j =>
      (j.status === 'Ongoing' || j.status === 'Scheduled' || j.status === 'In Progress' || j.status === 'On Hold') && jobOverlapsWeek(j, wsStr, weStr)
    )
  }, [jobs, wsStr, weStr])

  const { scheduled, unscheduled } = useMemo(() => {
    const sched = []
    const unsched = []
    for (const j of weekJobs) {
      const unames = wkAsgnUnique(j.job_id)
      if (unames.length > 0) sched.push(j)
      else unsched.push(j)
    }
    return { scheduled: sched, unscheduled: unsched }
  }, [weekJobs, assignments])

  // Stats: available and out counts per day
  const stats = useMemo(() => {
    return dates.map(d => {
      let out = 0
      let assigned = 0
      for (const c of crew) {
        const st = getCSt(c.name, d)
        if (st !== 'available') {
          out++
        } else {
          if (wkAssignedNames[c.name]) {
            // Check if assigned on this specific day
            const hasAsgn = assignments.some(a => a.crew_name === c.name && a.date === d)
            if (hasAsgn) assigned++
          }
        }
      }
      const avail = crew.length - out - assigned
      return { avail, out }
    })
  }, [dates, crew, getCSt, wkAssignedNames, assignments])

  // Crew pool grouped by team
  const crewByTeam = useMemo(() => {
    const teams = {}
    const floaters = []
    for (const c of crew) {
      const t = String(c.team || '')
      if (t.toLowerCase() === 'floater' || t === '0' || t === '') floaters.push(c)
      else {
        if (!teams[t]) teams[t] = []
        teams[t].push(c)
      }
    }
    const teamKeys = Object.keys(teams).sort((a, b) => a - b)
    return { teams, teamKeys, floaters }
  }, [crew])

  // Pool: count available unassigned
  const availCount = useMemo(() => {
    let av = 0
    for (const c of crew) {
      if (getCSt(c.name, todayStr) === 'available' && !wkAssignedNames[c.name]) av++
    }
    return av
  }, [crew, getCSt, todayStr, wkAssignedNames])

  // --- Mutations ---

  // Assignment day picker modal
  const [assignModal, setAssignModal] = useState(null) // { name, jobId, selectedDays }

  function handleAssignCrew(name, jobId) {
    const job = jobs.find(j => String(j.job_id) === String(jobId))
    if (!job) return
    const hasRange = !!(effStart(job) || effEnd(job))
    if (!hasRange) return
    const existing = crewJobDays(jobId, name)
    const inRange = dates.filter(d => jobInRange(job, d))
    // Pre-select: existing days + all in-range days not yet assigned
    const preSelected = [...new Set([...existing, ...inRange])]
    setAssignModal({ name, jobId, selectedDays: preSelected, job })
  }

  function toggleAssignDay(ds) {
    setAssignModal(prev => {
      if (!prev) return prev
      const sel = prev.selectedDays.includes(ds)
        ? prev.selectedDays.filter(d => d !== ds)
        : [...prev.selectedDays, ds]
      return { ...prev, selectedDays: sel }
    })
  }

  async function applyAssignModal() {
    if (!assignModal) return
    const { name, jobId, selectedDays } = assignModal
    const existing = crewJobDays(jobId, name)
    const toAdd = selectedDays.filter(d => !existing.includes(d))
    const toRemove = existing.filter(d => !selectedDays.includes(d))

    if (toAdd.length > 0) {
      const rows = toAdd.map(d => ({ job_id: jobId, crew_name: name, date: d }))
      await supabase.from('assignments').insert(rows)
    }
    for (const ds of toRemove) {
      await supabase.from('assignments').delete().eq('job_id', jobId).eq('crew_name', name).eq('date', ds)
    }
    setAssignModal(null)
    loadWeekData()
  }

  // Crew week popup
  const [crewWeekName, setCrewWeekName] = useState(null)

  async function handleRemoveCrew(jobId, name) {
    const { error: err } = await supabase
      .from('assignments')
      .delete()
      .eq('job_id', jobId)
      .eq('crew_name', name)
      .gte('date', wsStr)
      .lte('date', weStr)
    if (err) { console.error(err); return }
    loadWeekData()
  }

  async function handleToggleCrewDay(jobId, name, dateStr, turnOn) {
    if (turnOn) {
      const { error: err } = await supabase.from('assignments').insert([{ job_id: jobId, crew_name: name, date: dateStr }])
      if (err) { console.error(err); return }
    } else {
      const { error: err } = await supabase
        .from('assignments')
        .delete()
        .eq('job_id', jobId)
        .eq('crew_name', name)
        .eq('date', dateStr)
      if (err) { console.error(err); return }
    }
    loadWeekData()
  }

  async function handleUpdateJob(jobId, field, value) {
    // Optimistic: update local state immediately so UI reacts without waiting for DB
    setJobs(prev => prev.map(j => String(j.job_id) === String(jobId) ? { ...j, [field]: value } : j))
    const { error: err } = await updateJobField(jobId, field, value, changedBy)
    if (err) { console.error(err) }
  }

  async function handleSetCrewStatus(name, status, dateStr) {
    if (status === 'available') {
      await supabase.from('crew_status').delete().eq('crew_name', name).eq('date', dateStr)
    } else {
      await supabase.from('crew_status').upsert({ crew_name: name, status, date: dateStr }, { onConflict: 'crew_name,date' })
    }
    loadWeekData()
  }

  function handleSendJobSchedule(jobId) {
    // TODO: Opens crew card flipper modal filtered to this job's assigned crew
    // Matches Apps Script sendJobSchedule() which opens mCards modal
    const job = jobs.find(j => String(j.job_id) === String(jobId))
    const names = wkAsgnUnique(jobId)
    if (!names.length) return
    alert('Send schedule for ' + (job ? job.job_num + ' - ' + job.job_name : jobId) + '\nCrew: ' + names.map(flipName).join(', ') + '\n\n(Card flipper modal not yet built)')
  }

  function toggleJob(id) {
    setExpandedJobs(prev => ({ ...prev, [id]: !prev[id] }))
  }

  function toggleDefer(id) {
    setExpandedDefer(prev => ({ ...prev, [id]: !prev[id] }))
  }

  async function handleToggleDeferDay(jobId, ds) {
    const job = jobs.find(j => String(j.job_id) === String(jobId))
    if (!job) return
    const cur = job.deferred_days ? String(job.deferred_days).split(',').filter(Boolean) : []
    const idx = cur.indexOf(ds)
    if (idx >= 0) cur.splice(idx, 1)
    else cur.push(ds)
    handleUpdateJob(jobId, 'deferred_days', cur.join(','))
  }

  async function handleClearDefer(jobId) {
    await updateJobField(jobId, 'deferred_time', null, changedBy)
    await updateJobField(jobId, 'deferred_days', null, changedBy)
    setJobs(prev => prev.map(j => String(j.job_id) === String(jobId) ? { ...j, deferred_time: null, deferred_days: null } : j))
  }

  // Status day-picker modal: { name, status, selectedDays: [] }
  const [statusModal, setStatusModal] = useState(null)

  function openStatusModal(name, status) {
    const existing = dates.filter(ds => getCSt(name, ds) === status)
    setStatusModal({ name, status, selectedDays: existing, originalDays: existing })
  }

  function toggleStatusDay(ds) {
    setStatusModal(prev => {
      if (!prev) return prev
      const sel = prev.selectedDays.includes(ds)
        ? prev.selectedDays.filter(d => d !== ds)
        : [...prev.selectedDays, ds]
      return { ...prev, selectedDays: sel }
    })
  }

  async function applyStatusModal() {
    if (!statusModal) return
    const { name, status, selectedDays, originalDays } = statusModal
    // Days that were removed (unchecked)
    const toRemove = originalDays.filter(d => !selectedDays.includes(d))
    // Days that were added (newly checked)
    const toAdd = selectedDays.filter(d => !originalDays.includes(d))

    if (toRemove.length === 0 && toAdd.length === 0) { setStatusModal(null); return }

    // Delete unchecked days
    for (const ds of toRemove) {
      await supabase.from('crew_status').delete().eq('crew_name', name).eq('date', ds)
    }
    // Upsert newly checked days
    if (toAdd.length > 0) {
      const rows = toAdd.map(ds => ({ crew_name: name, status, date: ds }))
      await supabase.from('crew_status').upsert(rows, { onConflict: 'crew_name,date' })
    }
    setStatusModal(null)
    loadWeekData()
  }

  // Day detail modal (clicked from scoreboard)
  const [dayDetailDate, setDayDetailDate] = useState(null)

  const dayDetail = useMemo(() => {
    if (!dayDetailDate) return null
    const ds = dayDetailDate
    const available = []
    const assigned = []
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
            assigned.push({ name: c.name, job })
          }
        } else {
          available.push({ name: c.name })
        }
      }
    }
    return { available, assigned, out }
  }, [dayDetailDate, crew, getCSt, assignments, jobs])

  // Drag state
  const [dragName, setDragName] = useState(null)

  if (loading) return <div className="loading">Loading schedule...</div>
  if (error) return <div className="error-msg">Error: {error}</div>

  function renderBoardRow(j, idx, dimmed) {
    const nd = parseInt(j.crew_needed) || 0
    const pw = isPW(j)
    const unames = wkAsgnUnique(j.job_id)
    const ct = unames.length
    const co = pw ? 'var(--pw)' : (j.color || jCol(idx))
    const expanded = expandedJobs[String(j.job_id)]
    const ddays = j.deferred_days ? String(j.deferred_days).split(',').filter(Boolean) : []

    return (
      <div key={j.job_id} className="sch-board-row-wrap">
        {/* Job label + 6 day cells */}
        <div className="sch-board-row" style={dimmed ? { opacity: 0.45 } : undefined}>
          <div className="sch-brd-job-label" onClick={() => toggleJob(j.job_id)}>
            <div className="sch-brd-job-name">{j.job_num} - {j.job_name}</div>
            <div className="sch-brd-job-meta">
              {j.work_type && String(j.work_type).split(',').map(t => t.trim()).filter(Boolean).map(t => (
                <span key={t} className={`sch-tg ${gTagClass(t)}`}>{t}</span>
              ))}
              {pw && <span className="sch-pw-tag">PW</span>}
              {j.partial_billing === 'Yes' && <span className="sch-rtb-tag">RTB</span>}
              {j.no_bill === 'Yes' && <span className="sch-nb-tag">NO BILL</span>}
              {j.vehicle && <span className="sch-tg sch-tg-vh">{j.vehicle}</span>}
            </div>
            <div className="sch-brd-crew-info">
              {ct}/{nd} crew
              {j.deferred_time && j.deferred_days && (
                <span className="sch-defer-badge">{'\u23F0'} {fmt12(j.deferred_time)}</span>
              )}
            </div>
          </div>
          {dates.map(ds => {
            const dayCrew = asgnByJobDate[j.job_id + '|' + ds] || []
            const inRange = jobInRange(j, ds)
            const isDefer = ddays.includes(ds)
            const hasDb = dayCrew.some(name => getDoubleBookedDays(name).includes(ds))

            return (
              <div
                key={ds}
                className={`sch-brd-cell${ds === todayStr ? ' sch-brd-today' : ''}`}
                onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('sch-brd-drop') }}
                onDragLeave={e => e.currentTarget.classList.remove('sch-brd-drop')}
                onDrop={e => {
                  e.preventDefault()
                  e.currentTarget.classList.remove('sch-brd-drop')
                  if (dragName) handleAssignCrew(dragName, j.job_id)
                }}
              >
                {dayCrew.length > 0 ? (
                  <div
                    className={`sch-brd-bar${pw ? ' sch-brd-bar-pw' : ''}${hasDb ? ' sch-brd-bar-db' : ''}${isDefer ? ' sch-brd-bar-defer' : ''}`}
                    style={isDefer ? { background: '#FFE600' } : { background: co }}
                    title={dayCrew.map(flipName).join(', ')}
                  >
                    <div className={`sch-brd-cnt${isDefer ? ' sch-defer-text' : ''}`}>{dayCrew.length}</div>
                    {nd > 0 && dayCrew.length < nd && (
                      <div className={`sch-brd-sub${isDefer ? ' sch-defer-text' : ''}`}>need {nd - dayCrew.length}</div>
                    )}
                    {hasDb && !(nd > 0 && dayCrew.length < nd) && (
                      <div className="sch-brd-sub">{'\u26A0'}2X</div>
                    )}
                  </div>
                ) : inRange ? (
                  <div className="sch-brd-needs-crew" />
                ) : (
                  <div className="sch-brd-empty">&mdash;</div>
                )}
              </div>
            )
          })}
        </div>

        {/* Expanded detail panel */}
        {expanded && (
          <div className="sch-brd-detail">
            <div className="sch-det-grid">
              <div>
                <label>Vehicle</label>
                <input className="sch-dinp" defaultValue={j.vehicle || ''} onBlur={e => handleUpdateJob(j.job_id, 'vehicle', e.target.value)} />
              </div>
              <div>
                <label>Equipment</label>
                <input className="sch-dinp" defaultValue={j.equipment || ''} onBlur={e => handleUpdateJob(j.job_id, 'equipment', e.target.value)} />
              </div>
              <div>
                <label>Power</label>
                <input className="sch-dinp" defaultValue={j.power_source || ''} onBlur={e => handleUpdateJob(j.job_id, 'power_source', e.target.value)} />
              </div>
              <div>
                <label>Lead</label>
                <input className="sch-dinp" defaultValue={j.lead || ''} onBlur={e => handleUpdateJob(j.job_id, 'lead', e.target.value)} />
              </div>
            </div>
            <div className="sch-det-grid">
              <div>
                <label>Start</label>
                <input className="sch-dinp" type="date" defaultValue={effStart(j) || ''} onBlur={e => handleUpdateJob(j.job_id, 'scheduled_start', e.target.value)} />
              </div>
              <div>
                <label>End</label>
                <input className="sch-dinp" type="date" defaultValue={effEnd(j) || ''} onBlur={e => handleUpdateJob(j.job_id, 'scheduled_end', e.target.value)} />
              </div>
              <div>
                <label>Scope / SOW</label>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input className="sch-dinp" style={{ flex: 1 }} defaultValue={j.sow || ''} placeholder="Paste Drive link..." onBlur={e => handleUpdateJob(j.job_id, 'sow', e.target.value)} />
                  {j.sow && (j.sow.startsWith('http') || j.sow.startsWith('www')) && (
                    <a href={j.sow.startsWith('http') ? j.sow : 'https://' + j.sow} target="_blank" rel="noopener noreferrer" className="sch-sow-link" title="Open SOW">{'\uD83D\uDCC4'}</a>
                  )}
                </div>
              </div>
              <div>
                <label>Crew#</label>
                <input className="sch-dinp" type="number" min="1" defaultValue={nd || ''} style={{ width: 60 }} onBlur={e => handleUpdateJob(j.job_id, 'crew_needed', e.target.value)} />
              </div>
            </div>
            <div className="sch-det-notes-wrap">
              <label>Job Notes</label>
              <textarea className="sch-job-notes" defaultValue={j.notes || ''} placeholder="Internal notes for this job..." onBlur={e => handleUpdateJob(j.job_id, 'notes', e.target.value)} />
            </div>

            {/* Deferred start */}
            <div className="sch-det-defer-wrap">
              <button
                className="sch-btn-sm"
                style={j.deferred_time ? { background: '#FFE600', color: '#000', borderColor: '#ccb800' } : undefined}
                onClick={e => { e.stopPropagation(); toggleDefer(j.job_id) }}
              >
                {'\u23F0'} Deferred Start{j.deferred_time ? ` (${fmt12(j.deferred_time)})` : ''}
              </button>
              {expandedDefer[String(j.job_id)] && (
                <div className="sch-defer-drawer">
                  <div>
                    <label>Start Time</label>
                    <input className="sch-dinp" type="time" defaultValue={j.deferred_time || ''} style={{ width: 110 }} onBlur={e => handleUpdateJob(j.job_id, 'deferred_time', e.target.value)} />
                  </div>
                  <div>
                    <label>On These Days</label>
                    <div className="sch-defer-days">
                      {dates.map((ds, di) => {
                        if (!jobInRange(j, ds)) return null
                        const isOn = ddays.includes(ds)
                        return (
                          <div key={ds} className={`sch-defer-day${isOn ? ' sch-defer-day-on' : ''}`} onClick={() => handleToggleDeferDay(j.job_id, ds)}>
                            {DAYS[di]}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  {(j.deferred_time || ddays.length > 0) && (
                    <button className="sch-btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleClearDefer(j.job_id)}>Clear</button>
                  )}
                </div>
              )}
            </div>

            {/* Prevailing Wage checkbox */}
            <label className="sch-chk-pw">
              <input type="checkbox" checked={pw} onChange={e => handleUpdateJob(j.job_id, 'prevailing_wage', e.target.checked ? 'Yes' : 'No')} />
              Prevailing Wage
            </label>

            {/* Partial Billing */}
            <label className="sch-chk-bill">
              <input type="checkbox" checked={j.partial_billing === 'Yes'} onChange={e => handleUpdateJob(j.job_id, 'partial_billing', e.target.checked ? 'Yes' : 'No')} />
              Partial Billing
            </label>
            {j.partial_billing === 'Yes' && (
              <div className="sch-bill-fields">
                <div>
                  <label>Next Bill Date</label>
                  <input className="sch-dinp" type="date" defaultValue={j.partial_bill_date || ''} style={{ width: 130 }} onBlur={e => handleUpdateJob(j.job_id, 'partial_bill_date', e.target.value)} />
                </div>
                <div>
                  <label>Partial %</label>
                  <input className="sch-dinp" type="number" min="1" max="100" defaultValue={j.partial_percent || ''} style={{ width: 70 }} onBlur={e => handleUpdateJob(j.job_id, 'partial_percent', e.target.value)} />
                </div>
                <div>
                  <label>Billed To Date %</label>
                  <input className="sch-dinp" type="number" min="0" max="100" defaultValue={parseFloat(j.billed_to_date) || 0} style={{ width: 70, fontWeight: 700, color: 'var(--cyan)' }} onBlur={e => handleUpdateJob(j.job_id, 'billed_to_date', e.target.value)} />
                </div>
                <div>
                  <label>Paused</label>
                  <input type="checkbox" checked={j.billing_paused === 'Yes'} onChange={e => handleUpdateJob(j.job_id, 'billing_paused', e.target.checked ? 'Yes' : 'No')} style={{ width: 16, height: 16, accentColor: 'var(--ylw)' }} />
                </div>
                <div>
                  <label>Notes</label>
                  <input className="sch-dinp" defaultValue={j.billing_notes || ''} style={{ width: 160 }} placeholder="Billing notes" onBlur={e => handleUpdateJob(j.job_id, 'billing_notes', e.target.value)} />
                </div>
              </div>
            )}

            {/* No Bill */}
            <label className="sch-chk-nb">
              <input type="checkbox" checked={j.no_bill === 'Yes'} onChange={e => handleUpdateJob(j.job_id, 'no_bill', e.target.checked ? 'Yes' : 'No')} />
              No Bill
            </label>
            {j.no_bill === 'Yes' && (
              <div className="sch-bill-fields">
                <div style={{ flex: 1 }}>
                  <label>Reason (required)</label>
                  <input className="sch-dinp" defaultValue={j.no_bill_reason || ''} placeholder="Why is this job not billed?" style={{ width: '100%', borderColor: j.no_bill_reason ? undefined : 'var(--danger)' }} onBlur={e => handleUpdateJob(j.job_id, 'no_bill_reason', e.target.value)} />
                </div>
              </div>
            )}

            {/* Work Types */}
            <div className="sch-wt-row">
              <button className="sch-wt-btn" onClick={() => setWtOpen(p => ({ ...p, [j.job_id]: !p[j.job_id] }))}>
                Work Types {wtOpen[j.job_id] ? '\u25B4' : '\u25BE'}
              </button>
              {(() => {
                const sel = (j.work_type || '').split(',').map(t => t.trim()).filter(Boolean)
                return sel.length > 0 && (
                  <div className="sch-wt-tags">
                    {sel.map(t => <span key={t} className="sch-wt-tag">{t}</span>)}
                  </div>
                )
              })()}
            </div>
            {wtOpen[j.job_id] && (
              <div className="sch-wt-select">
                {workTypes.map(wt => {
                  const curTypes = (j.work_type || '').split(',').map(t => t.trim()).filter(Boolean)
                  const isOn = curTypes.includes(wt)
                  return (
                    <div key={wt} className={`sch-wt-option${isOn ? ' sch-wt-option-on' : ''}`} onClick={() => {
                      const updated = isOn
                        ? curTypes.filter(t => t !== wt).join(',')
                        : [...curTypes, wt].join(',')
                      handleUpdateJob(j.job_id, 'work_type', updated)
                    }}>
                      <span className="sch-wt-check">{isOn ? '\u2611' : '\u2610'}</span>
                      {wt}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Crew drop zone with day toggles */}
            <div className="sch-det-section-label">
              {(effStart(j) || effEnd(j))
                ? 'Scheduled Days Available'
                : <span style={{ color: 'var(--danger)' }}>{'\u26A0'} Set Start/End dates to enable crew assignment</span>
              }
            </div>
            <div
              className="sch-dzone"
              onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('sch-dzone-over') }}
              onDragLeave={e => e.currentTarget.classList.remove('sch-dzone-over')}
              onDrop={e => {
                e.preventDefault()
                e.currentTarget.classList.remove('sch-dzone-over')
                if (dragName && (effStart(j) || effEnd(j))) handleAssignCrew(dragName, j.job_id)
              }}
            >
              {unames.length > 0 ? (
                <div style={{ width: '100%' }}>
                  {/* Day header */}
                  <div className="sch-tg-header">
                    <div className="sch-tg-name-col" />
                    <div className="sch-tg-days">
                      {DAYS.map(d => <div key={d} className="sch-tg-day-hdr">{d}</div>)}
                    </div>
                    <div style={{ width: 22 }} />
                  </div>
                  {/* Crew rows */}
                  {unames.map(name => {
                    const cdays = crewJobDays(j.job_id, name)
                    return (
                      <div key={name} className="sch-tg-row">
                        <div className="sch-tg-name" title={name}>{flipName(name)}</div>
                        <div className="sch-tg-days">
                          {dates.map((ds, di) => {
                            const onDay = cdays.includes(ds)
                            const inRng = jobInRange(j, ds)
                            if (!inRng) return <div key={ds} style={{ width: 32, flexShrink: 0 }} />
                            return (
                              <div
                                key={ds}
                                className={`sch-tg-day${onDay ? ' sch-tg-day-on' : ''}`}
                                onClick={() => handleToggleCrewDay(j.job_id, name, ds, !onDay)}
                              >
                                {DAYS[di]}
                              </div>
                            )
                          })}
                        </div>
                        <button className="sch-tg-x" onClick={() => handleRemoveCrew(j.job_id, name)} title="Remove">{'\u2715'}</button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="sch-dzone-mt">Drop crew here</div>
              )}
            </div>
            {unames.length > 0 && (
              <button className="sch-btn-sm sch-btn-send" onClick={e => { e.stopPropagation(); handleSendJobSchedule(j.job_id) }}>
                {'\uD83D\uDCE4'} Send This Job's Schedule
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  // Crew chip for pool
  function renderCrewChip(c) {
    const anyOut = dates.some(d => getCSt(c.name, d) !== 'available')
    const allOut = dates.every(d => getCSt(c.name, d) !== 'available')
    const out = allOut && anyOut
    let worstSt = 'available'
    for (const d of dates) {
      const st = getCSt(c.name, d)
      if (st !== 'available') worstSt = st
    }
    const asg = !!wkAssignedNames[c.name]
    const db = !out && asg && isDoubleBooked(c.name)

    let dotCls = 'sch-dot '
    if (out) {
      dotCls += worstSt === 'sick' ? 'sch-dot-si' : worstSt === 'off' ? 'sch-dot-of' : 'sch-dot-no'
    } else if (asg) {
      dotCls += 'sch-dot-as'
    } else if (anyOut) {
      dotCls += 'sch-dot-no'
    } else {
      dotCls += 'sch-dot-av'
    }

    // Crew day dots for assigned crew
    let detail = null
    if (asg) {
      const jobMap = {}
      for (const a of assignments) {
        if (a.crew_name === c.name && dates.includes(a.date)) {
          if (!jobMap[a.job_id]) {
            const job = jobs.find(j => String(j.job_id) === String(a.job_id))
            jobMap[a.job_id] = { job, dates: [] }
          }
          if (!jobMap[a.job_id].dates.includes(a.date)) jobMap[a.job_id].dates.push(a.date)
        }
      }
      detail = (
        <div className="sch-crew-days-wrap">
          {Object.entries(jobMap).map(([jid, jm]) => {
            const jco = jm.job ? (isPW(jm.job) ? '#6d28d9' : (jm.job.color || jCol(parseInt(jid) % 16))) : '#888'
            return (
              <div key={jid} className="sch-crew-days">
                <div className="sch-crew-days-lbl">{jm.job ? jm.job.job_num : '?'}</div>
                <div className="sch-crew-dots">
                  {dates.map(ds => {
                    const daySt = getCSt(c.name, ds)
                    const onDay = jm.dates.includes(ds)
                    if (daySt === 'sick') return <div key={ds} className="sch-cdot sch-cdot-sick" />
                    if (daySt === 'off' || daySt === 'noshow') return <div key={ds} className="sch-cdot sch-cdot-call" />
                    if (onDay) return <div key={ds} className="sch-cdot sch-cdot-on" style={{ background: jco }} />
                    return <div key={ds} className="sch-cdot sch-cdot-off" />
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )
    } else if (out) {
      detail = <div className="sch-chip-status">{worstSt}</div>
    }

    return (
      <div
        key={c.name}
        className={`sch-chip${out ? ' sch-chip-out' : ''}${db ? ' sch-chip-db' : ''}`}
        draggable={!out}
        onDragStart={() => setDragName(c.name)}
        onDragEnd={() => setDragName(null)}
        onClick={() => setCrewWeekName(c.name)}
      >
        <span className={dotCls} />
        <span className="sch-chip-name">{flipName(c.name)}</span>
        {db && <span className="sch-db-tag">2X</span>}
        {!out && (
          <div className="sch-sbtns">
            <button className="sch-sbtn" onClick={e => { e.stopPropagation(); openStatusModal(c.name, 'sick') }}>S</button>
            <button className="sch-sbtn" onClick={e => { e.stopPropagation(); openStatusModal(c.name, 'off') }}>O</button>
            <button className="sch-sbtn" onClick={e => { e.stopPropagation(); openStatusModal(c.name, 'noshow') }}>N</button>
          </div>
        )}
        {detail}
      </div>
    )
  }

  return (
    <div className="sch-layout">
      <div className="sch-wrap">
        {/* Crew pool sidebar */}
        <div className="sch-pool">
          <div className="sch-ptitle">
            Crew <span className="sch-ptitle-av">{availCount} avail</span>
          </div>
          {crewByTeam.teamKeys.map(tk => (
            <div key={tk}>
              <div className="sch-tlbl">Team {tk}</div>
              {crewByTeam.teams[tk].map(c => renderCrewChip(c))}
            </div>
          ))}
          {crewByTeam.floaters.length > 0 && (
            <div>
              <div className="sch-tlbl">Floaters</div>
              {crewByTeam.floaters.map(c => renderCrewChip(c))}
            </div>
          )}
        </div>

        {/* Main board */}
        <div className="sch-main">
          <div className="sch-wknav">
            <button className="sch-btn" onClick={() => setWeekOffset(w => w - 1)}>Prev</button>
            <div className="sch-wklbl">{fmtWk(monday)}</div>
            <button className="sch-btn" onClick={() => setWeekOffset(w => w + 1)}>Next</button>
            <button className="sch-btn" onClick={() => setWeekOffset(0)}>This Week</button>
          </div>

          <div className="sch-job-count">Jobs This Week ({weekJobs.length})</div>

          <div className="sch-brd">
            {/* Header row */}
            <div className="sch-brd-hdr-job">Job</div>
            {dates.map((d, i) => (
              <div key={d} className={`sch-brd-hdr${d === todayStr ? ' sch-brd-hdr-today' : ''}`}>
                {DAYS[i]}<br />
                <span className="sch-brd-hdr-date">{d.split('-')[1]}/{d.split('-')[2]}</span>
              </div>
            ))}

            {/* Scheduled jobs */}
            {scheduled.map((j, idx) => renderBoardRow(j, idx, false))}

            {/* Divider */}
            {unscheduled.length > 0 && (
              <div className="sch-brd-divider">
                <div className="sch-brd-divider-line" />
                <span>Unscheduled this week</span>
                <div className="sch-brd-divider-line" />
              </div>
            )}

            {/* Unscheduled jobs */}
            {unscheduled.map((j, idx) => renderBoardRow(j, scheduled.length + idx, true))}

            {weekJobs.length === 0 && (
              <div className="sch-brd-empty-msg">No jobs this week</div>
            )}
          </div>
        </div>
      </div>

      {/* Status day-picker modal */}
      {statusModal && (
        <div className="sch-modal-overlay" onClick={() => setStatusModal(null)}>
          <div className="sch-modal" onClick={e => e.stopPropagation()}>
            <div className="sch-modal-title">
              {flipName(statusModal.name)} — {statusModal.status.toUpperCase()}
            </div>
            <div className="sch-modal-label">Select days:</div>
            <div className="sch-modal-days">
              {dates.map((ds, i) => (
                <div
                  key={ds}
                  className={`sch-modal-day${statusModal.selectedDays.includes(ds) ? ' sch-modal-day-on' : ''}`}
                  onClick={() => toggleStatusDay(ds)}
                >
                  {DAYS_LONG[i]}
                </div>
              ))}
            </div>
            <div className="sch-modal-actions">
              <button className="sch-btn" onClick={applyStatusModal}>DONE</button>
            </div>
          </div>
        </div>
      )}

      {/* Assignment day picker modal */}
      {assignModal && (
        <div className="sch-modal-overlay" onClick={() => setAssignModal(null)}>
          <div className="sch-modal" onClick={e => e.stopPropagation()}>
            <div className="sch-modal-title">Assign {flipName(assignModal.name)}</div>
            <div className="sch-modal-label">
              to <strong style={{ color: '#1565c0' }}>{assignModal.job ? assignModal.job.job_num + ' - ' + assignModal.job.job_name : 'Job'}</strong>
            </div>
            <div className="sch-modal-label" style={{ marginTop: 8 }}>Select days:</div>
            <div className="sch-modal-days">
              {dates.map((ds, i) => {
                const inRange = assignModal.job ? jobInRange(assignModal.job, ds) : false
                if (!inRange) return <div key={ds} className="sch-modal-day" style={{ opacity: 0.3 }}>{DAYS_LONG[i]}</div>
                return (
                  <div
                    key={ds}
                    className={`sch-modal-day${assignModal.selectedDays.includes(ds) ? ' sch-modal-day-on' : ''}`}
                    onClick={() => toggleAssignDay(ds)}
                  >
                    {DAYS_LONG[i]}
                    <div style={{ fontSize: 8, opacity: 0.7 }}>{ds.split('-')[2]}</div>
                  </div>
                )
              })}
            </div>
            <div className="sch-modal-actions">
              <button className="sch-btn" onClick={() => setAssignModal(null)}>Cancel</button>
              <button className="sch-btn" style={{ background: 'var(--command-green)', color: '#fff', borderColor: 'var(--command-green)' }} onClick={applyAssignModal}>Assign</button>
            </div>
          </div>
        </div>
      )}

      {/* Crew week popup */}
      {crewWeekName && (() => {
        const c = crew.find(cr => cr.name === crewWeekName)
        if (!c) return null
        const crewAsgns = {}
        for (const a of assignments) {
          if (a.crew_name === crewWeekName && dates.includes(a.date)) {
            if (!crewAsgns[a.job_id]) crewAsgns[a.job_id] = []
            if (!crewAsgns[a.job_id].includes(a.date)) crewAsgns[a.job_id].push(a.date)
          }
        }
        const jobIds = Object.keys(crewAsgns)
        return (
          <div className="sch-modal-overlay" onClick={() => setCrewWeekName(null)}>
            <div className="sch-modal sch-modal-detail" onClick={e => e.stopPropagation()}>
              <div className="sch-modal-title">{flipName(crewWeekName)}</div>
              <div style={{ fontSize: 11, color: 'var(--sand-dark)', marginBottom: 4 }}>
                Team: {c.team || '\u2014'}
                {c.phone && <>{' | Phone: '}<a href={'tel:' + c.phone} style={{ color: '#1565c0' }}>{c.phone}</a></>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--sand-dark)', marginBottom: 10 }}>Week: {fmtWk(monday)}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto repeat(6, 1fr)', gap: 0 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--sand-dark)' }} />
                {DAYS_LONG.map((d, i) => (
                  <div key={d} style={{ fontSize: 9, fontWeight: 700, textAlign: 'center', color: dates[i] === todayStr ? 'var(--danger)' : 'var(--sand-dark)', textTransform: 'uppercase' }}>
                    {d}<br /><span style={{ fontSize: 8, opacity: 0.7 }}>{dates[i].split('-')[2]}</span>
                  </div>
                ))}
                <div style={{ fontSize: 9, color: 'var(--sand-dark)', fontWeight: 600, padding: '6px 8px 6px 0' }}>STATUS</div>
                {dates.map(ds => {
                  const st = getCSt(crewWeekName, ds)
                  const lbl = st === 'sick' ? 'SICK' : st === 'off' ? 'CALL' : st === 'noshow' ? 'N/S' : '\u2713'
                  const sty = st === 'available' ? { color: 'var(--command-green)' } : { color: 'var(--danger)', fontWeight: 700 }
                  return <div key={ds} style={{ textAlign: 'center', padding: '4px 2px', fontSize: 10, ...sty }}>{lbl}</div>
                })}
                {jobIds.length > 0 ? jobIds.map(jid => {
                  const job = jobs.find(j => String(j.job_id) === String(jid))
                  return (
                    <React.Fragment key={jid}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#1565c0', padding: '6px 8px 6px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {job ? job.job_num + ' ' + job.job_name : 'Job ' + jid}
                      </div>
                      {dates.map(ds => {
                        const onDay = crewAsgns[jid] && crewAsgns[jid].includes(ds)
                        return (
                          <div key={ds} style={{ textAlign: 'center', padding: '4px 2px' }}>
                            {onDay
                              ? <span style={{ color: 'var(--command-green)', fontWeight: 700 }}>{'\u2713'}</span>
                              : <span style={{ color: 'var(--sand-dark)' }}>{'\u2014'}</span>
                            }
                          </div>
                        )
                      })}
                    </React.Fragment>
                  )
                }) : (
                  <>
                    <div style={{ fontSize: 11, color: 'var(--sand-dark)', padding: '6px 8px 6px 0' }}>No assignments</div>
                    {dates.map(ds => <div key={ds} style={{ textAlign: 'center', padding: '4px 2px', color: 'var(--sand-dark)' }}>{'\u2014'}</div>)}
                  </>
                )}
              </div>
              <div className="sch-modal-actions">
                <button className="sch-btn" onClick={() => setCrewWeekName(null)}>Close</button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
