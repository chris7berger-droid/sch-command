// Read-only per-job schedule modal — plan §3.6: DAYS scorecard is
// informational (neutral). Shows the job's date range and the working days
// (Mon–Sat; Sunday excluded, matching totalWorkDays in StageJobCard).

function effectiveStart(j) { return j.scheduled_start || j.start_date || null }
function effectiveEnd(j) { return j.scheduled_end || j.end_date || null }

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Matches totalWorkDays in StageJobCard (plan §4.1): both weekend days excluded
// unless an assignment exists that day.
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

export default function DaysModal({ job, assignmentDates = null, onClose }) {
  const start = effectiveStart(job)
  const end = effectiveEnd(job)
  const days = workingDays(start, end, assignmentDates)

  return (
    <div className="mbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mdl" style={{ maxWidth: 480, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Schedule — {job.job_num || ''} {job.job_name || ''}</h3>
          <button className="app-act-btn" onClick={onClose}>Close</button>
        </div>

        {!start ? (
          <div style={{ fontSize: 13, color: '#5a5249', padding: '20px 0' }}>
            No date set for this job yet.
          </div>
        ) : (
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
                  <span key={i} style={{
                    background: '#a89b88', border: '1px solid rgba(28,24,20,0.25)', borderRadius: 6,
                    padding: '4px 10px', fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#1c1814',
                  }}>
                    {d.dow} {d.date}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
