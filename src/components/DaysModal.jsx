// At-a-glance schedule calendar. Renders the month(s) this job touches with its
// scheduled work days highlighted, so you can see where it sits in the month and
// week without reading raw dates. View-only — editing lives in the SOW modal.
// Scheduled days come from the canonical per-WTC job_wtcs[*].field_sow rows;
// legacy zero-WTC jobs fall back to working days across the job span.

function effectiveStart(j) { return j.scheduled_start || j.start_date || null }
function effectiveEnd(j) { return j.scheduled_end || j.end_date || null }

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ISO "2026-06-16" → "Mon Jun 16" (local-parse, no TZ shift). null on empty/invalid.
function fmtDate(iso) {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return `${DOW[d.getDay()]} ${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`
}

// Gather the set of 'YYYY-MM-DD' scheduled work days for this job.
function collectScheduledDates(job, assignmentDates) {
  const set = new Set()
  const wtcs = Array.isArray(job._wtcs) ? job._wtcs : []
  for (const wtc of wtcs) {
    const sow = Array.isArray(wtc.field_sow) ? wtc.field_sow : []
    for (const day of sow) {
      const m = day && typeof day.date === 'string' && /^(\d{4}-\d{2}-\d{2})/.exec(day.date)
      if (m) set.add(m[1])
    }
  }
  if (set.size === 0) {
    // Legacy zero-WTC fallback: working days (Mon–Sat) across the job span,
    // plus any weekend days that actually have a crew assignment.
    const start = effectiveStart(job)
    const end = effectiveEnd(job)
    if (start && end) {
      const s = new Date(start + 'T00:00:00')
      const e = new Date(end + 'T00:00:00')
      const cur = new Date(s)
      while (cur <= e) {
        const dow = cur.getDay()
        const weekend = dow === 0 || dow === 6
        if (!weekend || (assignmentDates && assignmentDates.has(ymd(cur)))) set.add(ymd(cur))
        cur.setDate(cur.getDate() + 1)
      }
    } else if (start) {
      set.add(start.slice(0, 10))
    }
  }
  return set
}

function MonthCalendar({ year, month, scheduledSet, todayYmd }) {
  const startDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="days-cal">
      <div className="days-cal-month">{MONTHS_FULL[month]} {year}</div>
      <div className="days-cal-grid">
        {DOW.map(d => <div key={d} className="days-cal-dow">{d[0]}</div>)}
        {cells.map((d, i) => {
          if (d === null) return <div key={`b${i}`} className="days-cal-cell days-cal-blank" />
          const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
          const on = scheduledSet.has(iso)
          const isToday = iso === todayYmd
          return (
            <div
              key={iso}
              className={`days-cal-cell${on ? ' days-cal-on' : ''}${isToday ? ' days-cal-today' : ''}`}
            >
              {d}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function DaysModal({ job, assignmentDates = null, onClose }) {
  const scheduledSet = collectScheduledDates(job, assignmentDates)
  const sorted = [...scheduledSet].sort()

  // Unique months present, in order.
  const months = []
  const seen = new Set()
  for (const iso of sorted) {
    const key = iso.slice(0, 7)
    if (!seen.has(key)) {
      seen.add(key)
      months.push({ year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) - 1 })
    }
  }

  const todayYmd = ymd(new Date())
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const rangeLabel = sorted.length === 0
    ? null
    : first === last
      ? fmtDate(first)
      : `${fmtDate(first)} – ${fmtDate(last)}`

  return (
    <div className="mbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mdl" style={{ maxWidth: 480, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Schedule — {job.job_num || ''} {job.job_name || ''}</h3>
          <button className="app-act-btn" onClick={onClose}>Close</button>
        </div>

        {sorted.length === 0 ? (
          <div style={{ fontSize: 13, color: '#5a5249', padding: '20px 0' }}>No work days scheduled yet.</div>
        ) : (
          <>
            <div className="days-cal-summary">
              <span className="days-cal-count">{sorted.length}d</span>
              <span className="days-cal-range">{rangeLabel}</span>
            </div>
            <div className="days-cal-wrap">
              {months.map(m => (
                <MonthCalendar
                  key={`${m.year}-${m.month}`}
                  year={m.year}
                  month={m.month}
                  scheduledSet={scheduledSet}
                  todayYmd={todayYmd}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
