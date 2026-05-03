import { useEffect, useState } from 'react'
import { loadRecentPRTs } from '../lib/queries'
import PRTDetail from '../components/PRTDetail'

function parseJSON(v, fallback) {
  if (v == null) return fallback
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return fallback }
}

function taskRateSummary(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return null
  let behind = 0
  let total = 0
  for (const t of tasks) {
    const target = t.target_pct ?? t.target ?? null
    const actual = t.actual_pct ?? t.actual ?? t.pct_complete ?? null
    if (target == null || actual == null) continue
    total++
    if (Number(actual) < Number(target)) behind++
  }
  if (total === 0) return null
  return { behind, total }
}

export default function ProductionRate() {
  const [prts, setPrts] = useState([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState(null)

  useEffect(() => {
    let cancelled = false
    loadRecentPRTs(14).then(({ data }) => {
      if (cancelled) return
      setPrts(data || [])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  if (openId) {
    return (
      <div className="pr-wrap">
        <div className="jh-back-bar">
          <button className="app-act-btn" onClick={() => setOpenId(null)}>{'< All reports'}</button>
        </div>
        <PRTDetail prtId={openId} onBack={() => setOpenId(null)} />
      </div>
    )
  }

  return (
    <div className="pr-wrap">
      <div className="pr-header">
        <h2 className="pr-title">Production Rate</h2>
        <div className="pr-sub">Recent field reports across all jobs — last 14 days</div>
      </div>

      {loading ? (
        <div className="jh-empty">Loading…</div>
      ) : prts.length === 0 ? (
        <div className="jh-empty">No production reports in the last 14 days.</div>
      ) : (
        <div className="jd-prt-list">
          {prts.map(p => {
            const tasks = parseJSON(p.tasks, [])
            const photos = parseJSON(p.photos, [])
            const submitter = p.team_members?.name || 'Unknown'
            const cl = p.call_log || {}
            const jobNum = cl.display_job_number || '—'
            const jobName = cl.job_name || 'Untitled'
            const hoursR = p.hours_regular != null ? Number(p.hours_regular) : 0
            const hoursOT = p.hours_ot != null ? Number(p.hours_ot) : 0
            const rate = taskRateSummary(tasks)
            const onTrack = rate && rate.behind === 0
            return (
              <div key={p.id} className="jd-prt-card" onClick={() => setOpenId(p.id)}>
                <div className="jd-prt-row">
                  <span className="jd-prt-date">{p.report_date}</span>
                  {rate ? (
                    <span className={`pr-rate${onTrack ? ' pr-rate-ok' : ' pr-rate-behind'}`}>
                      {onTrack ? `✓ ${rate.total}/${rate.total} on track` : `⚠ ${rate.behind}/${rate.total} behind target`}
                    </span>
                  ) : (
                    <span className="pr-rate pr-rate-na">no rate data</span>
                  )}
                </div>
                <div className="jd-prt-row">
                  <span className="pr-job"><strong>{jobNum}</strong> · {jobName}</span>
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
  )
}
