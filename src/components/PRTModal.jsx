import { useEffect, useState } from 'react'
import { loadPRTsForJob } from '../lib/queries'

// Robust parse for a JSONB column that may come back as an array (clean) or a
// (possibly double-encoded) string from older writes.
function parseArr(v) {
  let out = v
  if (typeof out === 'string') { try { out = JSON.parse(out) } catch { return [] } }
  if (typeof out === 'string') { try { out = JSON.parse(out) } catch { return [] } }
  return Array.isArray(out) ? out : []
}

// Production Reports — the office production picture for a job: overall progress
// vs. where the plan says the job should be, then each day's PRT compared to the
// SOW plan (target vs actual) with the crew's notes.
export default function PRTModal({ job, onClose }) {
  const [prts, setPrts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await loadPRTsForJob(job.call_log_id)
      if (alive) { setPrts(data || []); setLoading(false) }
    })()
    return () => { alive = false }
  }, [job.call_log_id])

  // ── SOW plan: order the distinct SOW days and tag each task with its DAY INDEX
  // (day 1, 2, …). Progress is measured against the day the crew is ON — the
  // number of production days reported — NOT the literal calendar date, so a job
  // whose schedule hasn't reached its start date still tracks sensibly. ──
  const wtcs = Array.isArray(job._wtcs) ? job._wtcs : []
  const daysList = []
  for (const w of wtcs) {
    for (const d of (Array.isArray(w.field_sow) ? w.field_sow : [])) daysList.push(d)
  }
  daysList.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.day_label || '').localeCompare(b.day_label || ''))
  const dayIndexByKey = new Map() // distinct day (by date, else label) → 1-based index
  for (const d of daysList) {
    const key = d.date || d.day_label || `#${dayIndexByKey.size}`
    if (!dayIndexByKey.has(key)) dayIndexByKey.set(key, dayIndexByKey.size + 1)
  }
  const totalDays = dayIndexByKey.size
  const sowTaskMap = new Map()
  for (const d of daysList) {
    const dayIndex = dayIndexByKey.get(d.date || d.day_label || '') || 1
    for (const t of (d.tasks || [])) {
      const key = (t.description || '').trim()
      if (!key) continue
      const prev = sowTaskMap.get(key)
      if (!prev || dayIndex < prev.dayIndex) {
        sowTaskMap.set(key, { description: t.description, target: Number(t.pct_complete) || 0, dayIndex })
      }
    }
  }
  const sowTasks = [...sowTaskMap.values()]

  // ── Latest reported % per task, newest PRT first ──
  const sortedPrts = [...prts].sort((a, b) => (b.report_date || '').localeCompare(a.report_date || ''))
  const actualByTask = new Map()
  for (const p of sortedPrts) {
    for (const t of parseArr(p.tasks)) {
      const key = (t.description || '').trim()
      if (key && !actualByTask.has(key)) actualByTask.set(key, Number(t.pct_today) || 0)
    }
  }

  // ── Overall: where the job IS vs the plan through the current production day ──
  const denom = sowTasks.length || 1
  const reportedDays = new Set(prts.map(p => p.report_date).filter(Boolean)).size
  const currentDay = Math.min(reportedDays, totalDays || 1)
  const actualPct = Math.round(sowTasks.reduce((s, t) => s + (actualByTask.get(t.description.trim()) || 0), 0) / denom)
  const expectedPct = Math.round(sowTasks.reduce((s, t) => s + (t.dayIndex <= currentDay ? t.target : 0), 0) / denom)
  const delta = actualPct - expectedPct

  return (
    <div className="mbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mdl mdl-wide" style={{ maxWidth: 760, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Production — {job.job_num || job.job_name || ''}</h3>
          <button className="app-act-btn" onClick={onClose}>Close</button>
        </div>

        {loading ? (
          <div className="jh-empty">Loading…</div>
        ) : (
          <>
            {sowTasks.length > 0 && (
              <div className="jd-pp-overall">
                <div className="jd-pp-head">
                  <span className="jd-pp-title">JOB PROGRESS{totalDays > 0 ? ` · DAY ${currentDay} OF ${totalDays}` : ''}</span>
                  <span className={`jd-pp-delta ${delta >= 0 ? 'jd-pp-ahead' : 'jd-pp-behind'}`}>
                    {delta >= 0 ? `+${delta}% ahead of plan` : `${delta}% behind plan`}
                  </span>
                </div>
                <div className="jd-pp-bar-track">
                  <div className="jd-pp-bar-fill" style={{ width: `${Math.min(actualPct, 100)}%` }} />
                  <div className="jd-pp-bar-marker" style={{ left: `${Math.min(expectedPct, 100)}%` }} title={`Plan: ${expectedPct}%`} />
                </div>
                <div className="jd-pp-scale">
                  <span><strong>{actualPct}%</strong> complete</span>
                  <span className="jd-pp-plan">plan {expectedPct}%</span>
                </div>
              </div>
            )}

            {prts.length === 0 ? (
              <div className="jh-empty">No production reports submitted yet</div>
            ) : (
              <div className="jd-pp-days">
                {sortedPrts.map(p => {
                  const tasks = parseArr(p.tasks)
                  const submitter = p.team_members?.name || 'Unknown'
                  return (
                    <div key={p.id} className="jd-pp-day">
                      <div className="jd-pp-day-head">
                        <span className="jd-pp-day-date">{p.report_date}</span>
                        <span className="jd-pp-day-by">by {submitter}</span>
                        <span className={`jd-prt-status jd-prt-status-${p.status || 'submitted'}`}>{p.status || 'submitted'}</span>
                      </div>
                      {tasks.length === 0 ? (
                        <div className="jh-empty">No tasks reported</div>
                      ) : tasks.map((t, i) => {
                        const actual = Number(t.pct_today) || 0
                        const target = Number(t.target_pct) || 0
                        return (
                          <div key={i} className="jd-pp-task">
                            <div className="jd-pp-task-head">
                              <span className="jd-pp-task-name">{t.description}</span>
                            </div>
                            <div className="jd-pp-task-bar">
                              <div className="jd-pp-task-target" style={{ width: `${Math.min(target, 100)}%` }} />
                              <div className="jd-pp-task-actual jd-pp-fill-ok" style={{ width: `${Math.min(actual, 100)}%` }} />
                            </div>
                            <div className="jd-pp-task-nums">
                              <span>actual <strong>{actual}%</strong></span>
                              <span className="jd-pp-plan">plan {target}%</span>
                            </div>
                            {t.notes ? <div className="jd-pp-note">{t.notes}</div> : null}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
