import { useEffect, useState } from 'react'
import { loadPRTsForJob } from '../lib/queries'
import PRTDetail from './PRTDetail'

// Production Reports — office view of the crew's PRTs (Field Command writes
// daily_production_reports). Opens on the job card; a row expands to PRTDetail.
export default function PRTModal({ job, onClose }) {
  const [prts, setPrts] = useState([])
  const [loading, setLoading] = useState(true)
  const [openPrtId, setOpenPrtId] = useState(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await loadPRTsForJob(job.call_log_id)
      if (alive) { setPrts(data || []); setLoading(false) }
    })()
    return () => { alive = false }
  }, [job.call_log_id])

  return (
    <div className="mbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mdl mdl-wide" style={{ maxWidth: 720, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Production Reports — {job.job_num || ''} {job.job_name || ''}</h3>
          <button className="app-act-btn" onClick={onClose}>Close</button>
        </div>
        <div className="jd-section">
          {loading ? (
            <div className="jh-empty">Loading…</div>
          ) : openPrtId ? (
            <PRTDetail prtId={openPrtId} onBack={() => setOpenPrtId(null)} />
          ) : prts.length === 0 ? (
            <div className="jh-empty">No production reports submitted yet</div>
          ) : (
            <div className="jd-prt-list">
              {prts.map(p => {
                const tasks = Array.isArray(p.tasks) ? p.tasks : (p.tasks ? JSON.parse(p.tasks) : [])
                const photos = Array.isArray(p.photos) ? p.photos : (p.photos ? JSON.parse(p.photos) : [])
                const submitter = p.team_members?.name || 'Unknown'
                const hoursR = p.hours_regular != null ? Number(p.hours_regular) : 0
                const hoursOT = p.hours_ot != null ? Number(p.hours_ot) : 0
                return (
                  <div key={p.id} className="jd-prt-card" onClick={() => setOpenPrtId(p.id)}>
                    <div className="jd-prt-row">
                      <span className="jd-prt-date">{p.report_date}</span>
                      <span className={`jd-prt-status jd-prt-status-${p.status || 'submitted'}`}>{p.status || 'submitted'}</span>
                    </div>
                    <div className="jd-prt-row">
                      <span className="jd-prt-submitter">by {submitter}</span>
                    </div>
                    <div className="jd-prt-meta">
                      <span className="jd-prt-meta-item"><strong>{tasks.length}</strong> task{tasks.length !== 1 ? 's' : ''}</span>
                      <span className="jd-prt-meta-item"><strong>{photos.length}</strong> photo{photos.length !== 1 ? 's' : ''}</span>
                      <span className="jd-prt-meta-item"><strong>{(hoursR + hoursOT).toFixed(1)}</strong>h{hoursOT > 0 ? ` (${hoursOT}OT)` : ''}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
