import { useEffect, useState } from 'react'
import { loadPRT } from '../lib/queries'

function parseJSON(v, fallback) {
  if (v == null) return fallback
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return fallback }
}

export default function PRTDetail({ prtId, onBack }) {
  const [prt, setPrt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadPRT(prtId).then(({ data, error }) => {
      if (cancelled) return
      if (error) setError(error.message || 'Failed to load report')
      else setPrt(data)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [prtId])

  if (loading) return <div className="jh-empty">Loading...</div>
  if (error) return <div className="jh-empty">Error: {error}</div>
  if (!prt) return <div className="jh-empty">Report not found</div>

  const tasks = parseJSON(prt.tasks, [])
  const materials = parseJSON(prt.materials_used, [])
  const photos = parseJSON(prt.photos, [])
  const submitter = prt.team_members?.name || 'Unknown'
  const hoursR = prt.hours_regular != null ? Number(prt.hours_regular) : 0
  const hoursOT = prt.hours_ot != null ? Number(prt.hours_ot) : 0

  return (
    <div className="jd-prt-detail">
      <button className="jd-back" onClick={onBack}>{'< Back to reports'}</button>

      <div className="jd-prt-header">
        <div>
          <div className="jd-prt-detail-date">{prt.report_date}</div>
          <div className="jd-prt-detail-submitter">Submitted by {submitter}</div>
        </div>
        <span className={`jd-prt-status jd-prt-status-${prt.status || 'submitted'}`}>{prt.status || 'submitted'}</span>
      </div>

      <div className="jd-prt-hours">
        <span className="jd-prt-hours-pill"><strong>{hoursR.toFixed(1)}</strong> regular</span>
        {hoursOT > 0 && <span className="jd-prt-hours-pill jd-prt-hours-ot"><strong>{hoursOT.toFixed(1)}</strong> OT</span>}
      </div>

      <div className="jd-prt-block">
        <div className="jd-label">Tasks</div>
        {tasks.length === 0 ? (
          <div className="jh-empty">No tasks recorded</div>
        ) : (
          <div className="jd-prt-tasks">
            {tasks.map((t, i) => {
              const desc = t.description || t.name || t.task || `Task ${i + 1}`
              const target = t.target_pct ?? t.target ?? null
              const actual = t.actual_pct ?? t.actual ?? t.pct_complete ?? null
              const onTrack = target != null && actual != null && Number(actual) >= Number(target)
              return (
                <div key={i} className="jd-prt-task">
                  <div className="jd-prt-task-row">
                    <span className="jd-prt-task-desc">{desc}</span>
                    <span className="jd-prt-task-pcts">
                      {target != null && <span className="jd-prt-pct-target">target {target}%</span>}
                      {actual != null && <span className={`jd-prt-pct-actual${onTrack ? ' on-track' : ''}`}>actual {actual}%</span>}
                    </span>
                  </div>
                  {actual != null && (
                    <div className="jd-prt-task-bar">
                      <div className="jd-prt-task-fill" style={{ width: `${Math.min(Number(actual), 100)}%` }} />
                    </div>
                  )}
                  {t.notes && <div className="jd-prt-task-notes">{t.notes}</div>}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {materials.length > 0 && (
        <div className="jd-prt-block">
          <div className="jd-label">Materials Used</div>
          <table className="jd-table">
            <thead><tr><th>Material</th><th>Qty</th></tr></thead>
            <tbody>
              {materials.map((m, i) => (
                <tr key={i}>
                  <td>{m.name || m.product || '-'}</td>
                  <td>{m.qty ?? m.quantity ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {photos.length > 0 && (
        <div className="jd-prt-block">
          <div className="jd-label">Photos ({photos.length})</div>
          <div className="jd-prt-photos">
            {photos.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noreferrer" className="jd-prt-photo">
                <img src={url} alt={`PRT photo ${i + 1}`} loading="lazy" />
              </a>
            ))}
          </div>
        </div>
      )}

      {prt.notes && (
        <div className="jd-prt-block">
          <div className="jd-label">Notes</div>
          <p className="jd-prt-notes">{prt.notes}</p>
        </div>
      )}
    </div>
  )
}
