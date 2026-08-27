import { useEffect, useState } from 'react'
import { loadMaterialChecksForJob } from '../lib/queries'

function fmtTimestamp(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

// Load-Out — the office view of the crew's per-material "loaded in truck"
// confirmations. Field Command writes job_material_checks; we read them here and
// cross-reference against the job's canonical SOW materials (job._wtcs.field_sow),
// so every material shows confirmed (✓ + crew + time) or "Not confirmed" (○).
export default function LoadOutModal({ job, onClose }) {
  const [checks, setChecks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await loadMaterialChecksForJob(job.call_log_id)
      if (alive) { setChecks(data || []); setLoading(false) }
    })()
    return () => { alive = false }
  }, [job.call_log_id])

  // Flatten the SOW days that carry materials.
  const wtcs = Array.isArray(job._wtcs) ? job._wtcs : []
  const days = []
  for (const w of wtcs) {
    const sow = Array.isArray(w.field_sow) ? w.field_sow : []
    for (const d of sow) {
      const mats = Array.isArray(d.materials) ? d.materials : []
      if (mats.length) days.push({ ...d, work_type_name: w.work_type_name, materials: mats })
    }
  }
  days.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.day_label || '').localeCompare(b.day_label || ''))

  const checkByMat = new Map()
  for (const c of checks) checkByMat.set(c.wtc_material_id, c)
  const totalMats = days.reduce((n, d) => n + d.materials.length, 0)
  const confirmedCount = days.reduce((n, d) => n + d.materials.filter(m => checkByMat.get(m.wtc_material_id)?.checked).length, 0)

  return (
    <div className="mbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mdl mdl-wide" style={{ maxWidth: 720, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Load-Out — {job.job_num || job.job_name || ''}</h3>
          <button className="app-act-btn" onClick={onClose}>Close</button>
        </div>

        {loading ? (
          <div className="jh-empty">Loading…</div>
        ) : days.length === 0 ? (
          <div className="jh-empty">No materials on this job's SOW yet.</div>
        ) : (
          <>
            <div className="jd-mc-summary">
              Crew confirmed <strong>{confirmedCount}</strong> of <strong>{totalMats}</strong> materials loaded.
            </div>
            <div className="jd-mc-list">
              {days.map((d, i) => {
                const heading = [d.day_label, d.date].filter(Boolean).join(' · ') || `Day ${i + 1}`
                return (
                  <div key={d.id || i} className="jd-mc-group">
                    <div className="jd-mc-date">
                      {heading}
                      {d.work_type_name ? <span className="jd-mc-wt"> · {d.work_type_name}</span> : null}
                    </div>
                    <div className="jd-mc-items">
                      {d.materials.map((m, j) => {
                        const chk = checkByMat.get(m.wtc_material_id)
                        const confirmed = !!chk?.checked
                        return (
                          <div key={m.wtc_material_id || j} className={`jd-mc-row${confirmed ? ' jd-mc-row-ok' : ''}`}>
                            <span className="jd-mc-check">{confirmed ? '✓' : '○'}</span>
                            <span className="jd-mc-name">
                              {m.name || 'Unnamed material'}
                              {m.kit_size ? <span className="jd-mc-kit"> · {m.kit_size}</span> : null}
                            </span>
                            <span className="jd-mc-meta">
                              {confirmed
                                ? <>{chk.checked_by_name || 'Crew'}<span className="jd-mc-time"> · {fmtTimestamp(chk.updated_at)}</span></>
                                : <span className="jd-mc-pending">Not confirmed</span>}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
