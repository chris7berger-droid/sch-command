import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { loadJobs } from '../lib/queries'

/* ── Daily view — faithful port of the Apps Script rDaily() (Schedule Commander v2).
   Job cards with a crew × day check grid, gap row, status sections, and legend.
   Colors are scoped locally (linen palette) so the view matches the prototype
   regardless of the app's global theme tokens. ── */

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
  return ms[monday.getMonth()] + ' ' + monday.getDate() + ' - ' + ms[end.getMonth()] + ' ' + end.getDate() + ', ' + end.getFullYear()
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

function dayNumLabel(ds, i) {
  const p = ds.split('-')
  return DAYS[i] + ' ' + parseInt(p[1], 10) + '/' + parseInt(p[2], 10)
}

function isPW(j) {
  return j.prevailing_wage === 'Yes' || j.prevailing_wage === 'true' || j.prevailing_wage === true
}

function gTag(t) {
  if (!t) return ''
  t = t.toLowerCase()
  if (t.indexOf('flake') >= 0) return 'fl'
  if (t.indexOf('epoxy') >= 0) return 'ep'
  if (t.indexOf('caulk') >= 0) return 'ca'
  if (t.indexOf('demo') >= 0) return 'de'
  if (t.indexOf('joint') >= 0 || t.indexOf('fill') >= 0 || t.indexOf('seal') >= 0) return 'jo'
  if (t.indexOf('plenum') >= 0) return 'pl'
  return ''
}

function jobTitle(j) {
  // display_job_number (→ job_num) is already "<number> - <job_name>", so rendering
  // job_num + job_name would repeat the name. Use job_num when it already contains it.
  const num = j.job_num || ''
  const name = j.job_name || ''
  if (!name) return num || '—'
  if (num && num.indexOf(name) >= 0) return num
  return num ? num + ' - ' + name : name
}

function WorkTags({ wt }) {
  if (!wt) return null
  const types = String(wt).split(',').map(t => t.trim()).filter(Boolean)
  return types.map(t => <span key={t} className={'dly-tg ' + gTag(t)}>{t}</span>)
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
    const ds = wkDates(monday)
    const [jRes, cRes, aRes, sRes] = await Promise.all([
      loadJobs(),
      supabase.from('crew').select('*'),
      supabase.from('assignments').select('*').in('date', ds),
      supabase.from('crew_status').select('*').in('date', ds),
    ])
    if (jRes.data) setJobs(jRes.data.filter(j =>
      j.deleted !== true && j.deleted !== 'true' && j.deleted !== 'Yes' &&
      ['Ongoing', 'Scheduled', 'In Progress', 'On Hold'].includes(j.status)
    ))
    if (cRes.data) setCrew(cRes.data.filter(c => c.archived !== 'Yes'))
    if (aRes.data) setAssignments(aRes.data)
    if (sRes.data) setCrewStatus(sRes.data)
    setLoading(false)
  }, [monday])

  useEffect(() => { load() }, [load])

  /* nav */
  function prevWeek() { const d = new Date(monday); d.setDate(d.getDate() - 7); setMonday(d) }
  function nextWeek() { const d = new Date(monday); d.setDate(d.getDate() + 7); setMonday(d) }
  function thisWeek() { setMonday(getMonday(new Date())) }

  /* status map: "name|date" -> status (default 'available') */
  const statusMap = useMemo(() => {
    const m = {}
    crewStatus.forEach(s => { m[s.crew_name + '|' + s.date] = s.status })
    return m
  }, [crewStatus])
  const getCSt = useCallback((name, date) => statusMap[name + '|' + date] || 'available', [statusMap])

  /* assignment-derived maps (this week's assignments only) */
  const { jobCrew, crewJobDates, dbDaysByCrew, assignedNames } = useMemo(() => {
    const jc = {}            // String(job_id) -> [crew_name, ...] unique, in order
    const cjd = {}           // String(job_id)|name -> [date, ...] unique
    const byCrewDate = {}    // name|date -> Set(String(job_id))
    const an = {}            // crew_name -> true (assigned any day this week)
    assignments.forEach(a => {
      const jid = String(a.job_id)
      const name = a.crew_name
      const d = a.date
      if (!jc[jid]) jc[jid] = []
      if (jc[jid].indexOf(name) < 0) jc[jid].push(name)
      const ck = jid + '|' + name
      if (!cjd[ck]) cjd[ck] = []
      if (cjd[ck].indexOf(d) < 0) cjd[ck].push(d)
      const bk = name + '|' + d
      if (!byCrewDate[bk]) byCrewDate[bk] = new Set()
      byCrewDate[bk].add(jid)
      an[name] = true
    })
    const dbDays = {}
    Object.keys(byCrewDate).forEach(bk => {
      if (byCrewDate[bk].size > 1) {
        const idx = bk.lastIndexOf('|')
        const name = bk.slice(0, idx)
        const d = bk.slice(idx + 1)
        if (!dbDays[name]) dbDays[name] = []
        dbDays[name].push(d)
      }
    })
    return { jobCrew: jc, crewJobDates: cjd, dbDaysByCrew: dbDays, assignedNames: an }
  }, [assignments])

  const wkAsgnUnique = useCallback(j => jobCrew[String(j.job_id)] || [], [jobCrew])
  const crewJobDays = useCallback((j, name) => crewJobDates[String(j.job_id) + '|' + name] || [], [crewJobDates])

  /* jobs overlapping this week (or with no dates) */
  const wkJobs = useMemo(() => {
    const ws = dates[0], we = dates[5]
    return jobs.filter(j => {
      const js = j.start_date ? String(j.start_date).split('T')[0] : ''
      const je = j.end_date ? String(j.end_date).split('T')[0] : ''
      if (!js && !je) return true
      const s = js || '0000-01-01'
      const e = je || '9999-12-31'
      return s <= we && e >= ws
    })
  }, [jobs, dates])

  if (loading) {
    return (
      <div className="dly-v">
        <div className="dly-inner"><div className="dly-loading">Loading daily view…</div></div>
        <DailyStyle />
      </div>
    )
  }

  const assignedJobs = wkJobs.filter(j => wkAsgnUnique(j).length > 0)
  const noCrewJobs = wkJobs.filter(j => wkAsgnUnique(j).length === 0)

  /* status sections */
  const sickList = [], callList = [], nsList = [], availList = []
  crew.forEach(c => {
    const cn = c.name
    let hasSick = false, hasCall = false, hasNS = false
    for (let di = 0; di < 6; di++) {
      const st = getCSt(cn, dates[di])
      if (st === 'sick') hasSick = true
      if (st === 'off') hasCall = true
      if (st === 'noshow') hasNS = true
    }
    if (hasSick) sickList.push(cn)
    if (hasCall) callList.push(cn)
    if (hasNS) nsList.push(cn)
    if (!assignedNames[cn] && !hasSick && !hasCall && !hasNS) availList.push(cn)
  })

  /* ── renderers ── */

  function dayCell(cn, ds, cjdays, dbDays) {
    const onJob = cjdays.indexOf(ds) >= 0
    if (!onJob) return <div className="dly-cell" key={ds}><div className="dly-d dly-empty">—</div></div>
    const st = getCSt(cn, ds)
    if (st === 'sick') return <div className="dly-cell" key={ds}><div className="dly-d dly-sick">S</div></div>
    if (st === 'off') return <div className="dly-cell" key={ds}><div className="dly-d dly-call">C</div></div>
    if (st === 'noshow') return <div className="dly-cell" key={ds}><div className="dly-d dly-noshow">N</div></div>
    if (dbDays.indexOf(ds) >= 0) return <div className="dly-cell" key={ds}><div className="dly-d dly-2x">2X</div></div>
    return <div className="dly-cell" key={ds}><div className="dly-d dly-on">✓</div></div>
  }

  function jobCard(j) {
    const unames = wkAsgnUnique(j)
    const nd = parseInt(j.crew_needed, 10) || 0
    let hasGap = false
    const gaps = dates.map(ds => {
      let dc = 0
      unames.forEach(u => {
        if (crewJobDays(j, u).indexOf(ds) >= 0 && getCSt(u, ds) === 'available') dc++
      })
      if (nd > 0 && dc < nd) { hasGap = true; return { gap: true, dc } }
      return { gap: false, dc }
    })
    const pw = isPW(j)
    return (
      <div className={'dly-card' + (hasGap ? ' dly-card-gap' : '') + (pw ? ' dly-card-pw' : '')} key={j.job_id}>
        <div className="dly-card-hdr">
          <div className="dly-card-info">
            <span className="dly-card-name">{jobTitle(j)}</span>
            <WorkTags wt={j.work_type} />
            {j.vehicle && <span className="dly-tg vh">{j.vehicle}</span>}
            {pw && <span className="dly-pw-tag">PW</span>}
          </div>
          <div className="dly-card-badge" style={{ color: hasGap ? 'var(--red)' : 'var(--grn)' }}>
            {unames.length}/{nd}
          </div>
        </div>
        {unames.map(cn => {
          const isLead = j.lead && cn.toLowerCase().indexOf(String(j.lead).toLowerCase()) >= 0
          const dbDays = dbDaysByCrew[cn] || []
          const crewDb = dbDays.length > 0
          const cjdays = crewJobDays(j, cn)
          return (
            <div className="dly-row" key={cn} style={crewDb ? { background: 'rgba(91,189,63,.08)' } : undefined}>
              <div className={'dly-cell-name' + (isLead ? ' dly-lead' : '')}>
                <span className="dly-dot-nm" style={{ background: crewDb ? 'var(--neon)' : isLead ? 'var(--blu)' : 'var(--grn)' }} />
                {cn}{isLead ? ' ★' : ''}{crewDb ? <span className="dly-db-tag">2X</span> : null}
              </div>
              {dates.map(ds => dayCell(cn, ds, cjdays, dbDays))}
            </div>
          )
        })}
        {hasGap && (
          <div className="dly-row dly-gap-row">
            <div className="dly-cell-name dly-gap-name">⚠ Gaps</div>
            {gaps.map((g, i) => (
              <div className="dly-cell" key={dates[i]}>
                {g.gap ? <div className="dly-d dly-alert">{g.dc}/{nd}</div> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  function statusCard(title, dotColor, list, stKey) {
    if (!list.length) return null
    const letter = stKey === 'sick' ? 'S' : stKey === 'off' ? 'C' : 'N'
    const dClass = stKey === 'sick' ? 'dly-sick' : stKey === 'off' ? 'dly-call' : 'dly-noshow'
    return (
      <div className="dly-status" key={title}>
        <div className="dly-status-hdr"><span className="dly-status-dot" style={{ background: dotColor }} />{title}</div>
        <div className="dly-hdr dly-hdr-sm">
          <div className="dly-hdr-name" />
          {dates.map((ds, i) => <div key={ds} className={'dly-hdr-day' + (ds === todayStr ? ' dly-today' : '')}>{DAYS[i]}</div>)}
        </div>
        {list.map(name => (
          <div className="dly-row" key={name}>
            <div className="dly-cell-name">{name}</div>
            {dates.map(ds => (
              <div className="dly-cell" key={ds}>
                {getCSt(name, ds) === stKey
                  ? <div className={'dly-d ' + dClass}>{letter}</div>
                  : <div className="dly-d dly-empty">—</div>}
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="dly-v">
     <div className="dly-inner">
      {/* Week nav */}
      <div className="dly-wknav">
        <button className="dly-btn" onClick={prevWeek}>Prev</button>
        <div className="dly-wklbl">{fmtWk(monday)}</div>
        <button className="dly-btn" onClick={nextWeek}>Next</button>
        <button className="dly-btn" onClick={thisWeek}>This Week</button>
      </div>

      {/* Day headers */}
      <div className="dly-hdr">
        <div className="dly-hdr-name" />
        {dates.map((ds, i) => (
          <div key={ds} className={'dly-hdr-day' + (ds === todayStr ? ' dly-today' : '')}>{dayNumLabel(ds, i)}</div>
        ))}
      </div>

      {/* Assigned job cards */}
      {assignedJobs.map(jobCard)}

      {/* Unassigned jobs */}
      {noCrewJobs.length > 0 && (
        <>
          <div className="dly-section">Unassigned Jobs</div>
          {noCrewJobs.map(j => (
            <div className="dly-card dly-card-gap" key={j.job_id}>
              <div className="dly-card-hdr">
                <div className="dly-card-info">
                  <span className="dly-card-name">{jobTitle(j)}</span>
                  <WorkTags wt={j.work_type} />
                  {isPW(j) && <span className="dly-pw-tag">PW</span>}
                </div>
                <div className="dly-card-badge" style={{ color: 'var(--red)' }}>0/{parseInt(j.crew_needed, 10) || '?'}</div>
              </div>
            </div>
          ))}
        </>
      )}

      {/* Status sections */}
      {statusCard('Sick', 'var(--red)', sickList, 'sick')}
      {statusCard('Call In', 'var(--orn)', callList, 'off')}
      {statusCard('No Show', 'var(--orn)', nsList, 'noshow')}
      {availList.length > 0 && (
        <div className="dly-status">
          <div className="dly-status-hdr"><span className="dly-status-dot" style={{ background: 'var(--grn)' }} />Available (Unassigned)</div>
          <div className="dly-hdr dly-hdr-sm">
            <div className="dly-hdr-name" />
            {dates.map((ds, i) => <div key={ds} className={'dly-hdr-day' + (ds === todayStr ? ' dly-today' : '')}>{DAYS[i]}</div>)}
          </div>
          {availList.map(name => (
            <div className="dly-row" key={name}>
              <div className="dly-cell-name">{name}</div>
              {dates.map(ds => <div className="dly-cell" key={ds}><div className="dly-d dly-on">✓</div></div>)}
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="dly-legend">
        <div className="dly-leg"><div className="dly-d dly-on dly-d-lg">✓</div> On job</div>
        <div className="dly-leg"><div className="dly-d dly-sick dly-d-lg">S</div> Sick</div>
        <div className="dly-leg"><div className="dly-d dly-call dly-d-lg">C</div> Call-in</div>
        <div className="dly-leg"><div className="dly-d dly-noshow dly-d-lg">N</div> No show</div>
        <div className="dly-leg"><div className="dly-d dly-empty dly-d-lg">—</div> Off</div>
        <div className="dly-leg"><span className="dly-gap-legend">⚠ 2/3</span> Gap</div>
      </div>
     </div>
      <DailyStyle />
    </div>
  )
}

/* ── scoped styles (ported from the Apps Script .dly-* + linen palette) ── */
function DailyStyle() {
  return (
    <style>{`
      .dly-v {
        --surface:#d0c5b4; --surface-h:#d8cebe; --s2:#c8bcaa; --bg:#b5a896;
        --brd:rgba(28,24,20,0.22); --brdl:rgba(28,24,20,0.32); --brd3:rgba(28,24,20,0.14);
        --txt:#141110; --muted:#554d42; --dim:#746a5c;
        --grn:#2e7d32; --red:#c62828; --orn:#e65100; --pw:#6d28d9; --neon:#5BBD3F;
        --blu:#1565c0; --pop:#5BBD3F; --pop-dk:#3D8A2A;
        color:var(--txt);
        font-family:'Barlow',sans-serif;
        position:relative;
        min-height:100%;
        background-color:var(--bg);
      }
      .dly-inner { position:relative; z-index:1; max-width:1100px; margin:0 auto; padding:16px; }
      /* Linen weave — same crosshatch as the original, but at half opacity with a
         warm radial wash, so it reads as woven linen rather than graph paper. */
      .dly-v::before {
        content:''; position:absolute; inset:0; pointer-events:none; z-index:0; opacity:0.5;
        background:
          repeating-linear-gradient(0deg,rgba(60,50,35,0.04) 0px,rgba(60,50,35,0.04) 1px,transparent 1px,transparent 4px),
          repeating-linear-gradient(90deg,rgba(60,50,35,0.04) 0px,rgba(60,50,35,0.04) 1px,transparent 1px,transparent 4px),
          radial-gradient(ellipse at 20% 50%,rgba(255,250,240,0.08),transparent 60%),
          radial-gradient(ellipse at 80% 50%,rgba(255,250,240,0.05),transparent 60%);
      }
      .dly-loading { text-align:center; padding:40px; color:var(--dim); font-family:'Barlow Condensed',sans-serif; text-transform:uppercase; letter-spacing:1px; font-size:14px; }

      .dly-wknav { display:flex; align-items:center; gap:12px; margin-bottom:12px; padding:8px 12px; background:var(--surface); border-radius:4px; border:2px solid var(--brd); }
      .dly-wklbl { font-family:'Barlow Condensed',sans-serif; font-size:14px; font-weight:700; flex:1; text-align:center; text-transform:uppercase; letter-spacing:1px; }
      .dly-btn { font-family:'Barlow Condensed',sans-serif; font-size:12px; font-weight:600; padding:6px 12px; border-radius:4px; border:2px solid var(--brdl); background:var(--surface); color:var(--txt); cursor:pointer; text-transform:uppercase; letter-spacing:0.3px; }
      .dly-btn:hover { background:var(--surface-h); }

      .dly-hdr { display:grid; grid-template-columns:130px repeat(6,1fr); gap:0; padding:0 14px 6px; margin-bottom:2px; }
      .dly-hdr-sm { padding:0 0 4px; margin:0; }
      .dly-hdr-day { font-size:9px; font-weight:700; text-transform:uppercase; color:var(--muted); text-align:center; }
      .dly-today { color:var(--red); }

      .dly-card { background:var(--surface); border:1px solid var(--brd); border-radius:6px; margin-bottom:8px; overflow:hidden; border-left:4px solid var(--grn); padding-bottom:4px; }
      .dly-card-gap { border-left-color:var(--red); }
      .dly-card-pw { border-left-color:var(--pw); background:linear-gradient(90deg,#f3e8ff,var(--surface) 30%); }
      .dly-card-hdr { padding:10px 14px 6px; display:flex; align-items:center; gap:10px; }
      .dly-card-info { flex:1; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .dly-card-name { font-size:14px; font-weight:700; }
      .dly-card-badge { font-size:10px; font-weight:600; padding:3px 8px; border-radius:4px; background:var(--s2); border:1px solid var(--brd); flex-shrink:0; }

      .dly-row { display:grid; grid-template-columns:130px repeat(6,1fr); gap:0; align-items:center; padding:3px 14px; border-bottom:1px solid var(--brd); }
      .dly-row:last-child { border-bottom:none; }
      .dly-gap-row { border-bottom:none; }
      .dly-gap-name { font-size:9px; color:var(--red); font-weight:600; }
      .dly-cell-name { font-size:11px; font-weight:600; display:flex; align-items:center; gap:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .dly-lead { color:var(--blu); }
      .dly-dot-nm { width:6px; height:6px; border-radius:50%; flex-shrink:0; }
      .dly-cell { display:flex; align-items:center; justify-content:center; }

      .dly-d { width:24px; height:18px; border-radius:3px; font-size:8px; font-weight:700; display:flex; align-items:center; justify-content:center; border:1px solid var(--brd); }
      .dly-d-lg { width:20px; height:14px; font-size:7px; }
      .dly-on { background:#eaf7ef; color:var(--grn); border-color:#c8ecd0; }
      .dly-sick { background:#fde8e5; color:var(--red); border-color:#f5c6c0; }
      .dly-call { background:#fef3c7; color:var(--orn); border-color:#f0d88a; }
      .dly-noshow { background:#fee2e2; color:var(--red); border-color:#f5c6c0; }
      .dly-empty { background:var(--surface); color:var(--dim); border:1px dashed var(--brdl); }
      .dly-2x { background:var(--neon); color:#000; border-color:#2be012; font-weight:700; }
      .dly-alert { background:none; border:none; font-size:9px; font-weight:700; color:var(--red); }

      .dly-section { font-size:9px; font-weight:700; text-transform:uppercase; color:var(--red); padding:12px 0 4px; letter-spacing:0.5px; border-top:1px solid var(--brd); margin-top:8px; }

      .dly-status { background:var(--surface); border:1px solid var(--brd); border-radius:6px; margin-bottom:8px; overflow:hidden; padding:8px 14px; }
      .dly-status-hdr { font-size:12px; font-weight:700; display:flex; align-items:center; gap:8px; margin-bottom:6px; }
      .dly-status-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }

      .dly-legend { display:flex; gap:14px; flex-wrap:wrap; padding:14px; margin-top:8px; background:var(--surface); border-radius:6px; border:1px solid var(--brd); }
      .dly-leg { display:flex; align-items:center; gap:5px; font-size:10px; color:var(--muted); }
      .dly-gap-legend { color:var(--red); font-weight:700; font-size:10px; }

      .dly-tg { font-size:9px; font-weight:600; padding:1px 6px; border-radius:3px; text-transform:uppercase; }
      .dly-tg.ep { background:#f0e6ff; color:#7c3aed; }
      .dly-tg.ca { background:#fef3c7; color:#b45309; }
      .dly-tg.de { background:#fee2e2; color:#dc2626; }
      .dly-tg.jo { background:#e0f7fa; color:#0e7490; }
      .dly-tg.fl { background:#d1fae5; color:#059669; }
      .dly-tg.pl { background:#dbeafe; color:#2563eb; }
      .dly-tg.vh { background:#dbeafe; color:var(--blu); }
      .dly-pw-tag { font-size:8px; font-weight:700; padding:1px 5px; border-radius:3px; background:var(--pw); color:#fff; text-transform:uppercase; letter-spacing:.5px; }
      .dly-db-tag { font-family:'JetBrains Mono',monospace; font-size:8px; font-weight:700; padding:1px 5px; border-radius:3px; background:var(--neon); color:#000; text-transform:uppercase; letter-spacing:.5px; margin-left:4px; }
    `}</style>
  )
}
