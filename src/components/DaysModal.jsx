// Per-job schedule modal (remediation step 4 / Option 3). Reads CANONICAL
// per-WTC job_wtcs[*].field_sow day rows, grouped by work type, with TBD state
// per day. Each day row is CLICK-TO-EDIT: it deep-links into the in-card SOW
// modal focused on that WTC + day (onDayClick). DaysModal performs NO write —
// it only navigates. Legacy zero-WTC jobs fall back to the read-only job-span view.

function effectiveStart(j) { return j.scheduled_start || j.start_date || null }
function effectiveEnd(j) { return j.scheduled_end || j.end_date || null }

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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

// Legacy fallback (zero-WTC jobs): working days across the job span (Mon–Sat).
function workingDays(start, end, assignmentDates) {
  if (!start || !end) return []
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  const out = []
  const cursor = new Date(s)
  while (cursor <= e) {
    const dow = cursor.getDay()
    const isWeekend = dow === 0 || dow === 6
    if (!isWeekend || (assignmentDates && assignmentDates.has(ymd(cursor)))) {
      out.push({ dow: DOW[dow], date: `${cursor.getMonth() + 1}/${cursor.getDate()}` })
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

export default function DaysModal({ job, assignmentDates = null, onClose, onDayClick }) {
  const wtcs = Array.isArray(job._wtcs) ? job._wtcs : []

  return (
    <div className="mbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mdl" style={{ maxWidth: 520, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Schedule — {job.job_num || ''} {job.job_name || ''}</h3>
          <button className="app-act-btn" onClick={onClose}>Close</button>
        </div>

        {wtcs.length > 0 ? (
          <>
            <div style={{ fontSize: 11, color: '#887c6e', marginBottom: 12 }}>
              Click a day to edit its date in the Field SOW.
            </div>
            {wtcs.map(wtc => {
              const sow = Array.isArray(wtc.field_sow) ? wtc.field_sow : []
              return (
                <div key={wtc.id} style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-primary)' }}>
                      {wtc.work_type_name || 'Work Type'}
                    </span>
                    {!wtc.start_date && (
                      <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '1px 7px', borderRadius: 9, background: '#1c1814', color: '#30cfac' }}>
                        Dates TBD
                      </span>
                    )}
                  </div>
                  {sow.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#887c6e', fontStyle: 'italic' }}>No days planned yet.</div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {sow.map((day, dayIndex) => {
                        const label = fmtDate(day.date)
                        return (
                          <button
                            key={day.id ?? dayIndex}
                            onClick={() => onDayClick && onDayClick(wtc.id, dayIndex)}
                            title="Edit this day in the Field SOW"
                            style={{
                              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                              background: label ? '#a89b88' : 'var(--bg-card)',
                              border: `1px solid ${label ? 'rgba(28,24,20,0.25)' : '#30cfac'}`,
                              borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit',
                            }}
                          >
                            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6b6358' }}>
                              {day.day_label || `Day ${dayIndex + 1}`}
                            </span>
                            <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: label ? '#1c1814' : '#887c6e' }}>
                              {label || 'TBD'}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </>
        ) : (
          // Legacy zero-WTC fallback: read-only job-span working days.
          <LegacyDays job={job} assignmentDates={assignmentDates} />
        )}
      </div>
    </div>
  )
}

function LegacyDays({ job, assignmentDates }) {
  const start = effectiveStart(job)
  const end = effectiveEnd(job)
  const days = workingDays(start, end, assignmentDates)
  if (!start) {
    return <div style={{ fontSize: 13, color: '#5a5249', padding: '20px 0' }}>No date set for this job yet.</div>
  }
  return (
    <>
      <div style={{ display: 'flex', gap: 24, marginBottom: 16, fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
        <div>
          <div style={{ fontSize: 9, color: '#9a8d7d', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Start</div>
          <div>{start}</div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: '#9a8d7d', textTransform: 'uppercase', letterSpacing: '0.06em' }}>End</div>
          <div>{end || '—'}</div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: '#9a8d7d', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Work Days</div>
          <div>{days.length || '—'}</div>
        </div>
      </div>
      {days.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {days.map((d, i) => (
            <span key={i} style={{ background: '#a89b88', border: '1px solid rgba(28,24,20,0.25)', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#1c1814' }}>
              {d.dow} {d.date}
            </span>
          ))}
        </div>
      )}
    </>
  )
}
