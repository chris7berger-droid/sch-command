import { useEffect, useState } from 'react'
import { loadDailyLogsForJob, loadTeamMemberMap } from '../lib/queries'

function fmtTimestamp(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

// Daily Log — office view of the crew's daily log entries (Field Command writes
// daily_log_entries). Opens on the job card; grouped by date.
export default function LogsModal({ job, onClose }) {
  const [dailyLogs, setDailyLogs] = useState([])
  const [teamMap, setTeamMap] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [dlRes, tmRes] = await Promise.all([
        loadDailyLogsForJob(job.call_log_id),
        loadTeamMemberMap(),
      ])
      if (alive) { setDailyLogs(dlRes.data || []); setTeamMap(tmRes.data || {}); setLoading(false) }
    })()
    return () => { alive = false }
  }, [job.call_log_id])

  return (
    <div className="mbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mdl mdl-wide" style={{ maxWidth: 720, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Daily Log — {job.job_num || job.job_name || ''}</h3>
          <button className="app-act-btn" onClick={onClose}>Close</button>
        </div>
        <div className="jd-section">
          {loading ? (
            <div className="jh-empty">Loading…</div>
          ) : dailyLogs.length === 0 ? (
            <div className="jh-empty">No daily log entries yet</div>
          ) : (
            <div className="jd-dl-list">
              {(() => {
                const groups = new Map()
                for (const e of dailyLogs) {
                  const date = (e.created_at || '').slice(0, 10) || 'undated'
                  if (!groups.has(date)) groups.set(date, [])
                  groups.get(date).push(e)
                }
                return [...groups.entries()].map(([date, entries]) => (
                  <div key={date} className="jd-dl-group">
                    <div className="jd-dl-date">{date}</div>
                    <div className="jd-dl-items">
                      {entries.map(e => {
                        const photos = (() => {
                          if (Array.isArray(e.photos)) return e.photos
                          if (typeof e.photos === 'string') {
                            try { const p = JSON.parse(e.photos); return Array.isArray(p) ? p : [] } catch { return [] }
                          }
                          return []
                        })()
                        const author = teamMap[e.employee_id]?.name || 'Unknown'
                        const type = (e.entry_type || 'OTHER').toUpperCase()
                        return (
                          <div key={e.id} className="jd-dl-card">
                            <div className="jd-dl-row">
                              <span className={`jd-dl-pill jd-dl-pill-${type.toLowerCase()}`}>{type}</span>
                              <span className="jd-dl-author">{author}</span>
                              <span className="jd-dl-time">{fmtTimestamp(e.created_at)}</span>
                            </div>
                            {e.notes && <div className="jd-dl-notes">{e.notes}</div>}
                            {photos.length > 0 && (
                              <div className="jd-dl-photos">
                                {photos.map((url, i) => (
                                  <a key={i} href={url} target="_blank" rel="noreferrer" className="jd-dl-photo">
                                    <img src={url} alt={`Daily log ${i + 1}`} loading="lazy" />
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
