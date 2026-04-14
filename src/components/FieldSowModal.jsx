import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

function flipName(n) {
  if (!n) return ''
  const p = n.split(',')
  return p.length === 2 ? p[1].trim() + ' ' + p[0].trim() : n
}

function deepClone(o) { return JSON.parse(JSON.stringify(o)) }

const inputStyle = {
  background: '#a89b88', border: '1px solid rgba(28,24,20,0.25)', borderRadius: 4,
  padding: '4px 8px', fontSize: 13, color: '#1c1814', fontFamily: "'Barlow', sans-serif",
  outline: 'none', width: '100%', boxSizing: 'border-box',
}
const smallInput = { ...inputStyle, fontSize: 11, fontFamily: "'JetBrains Mono', monospace", textAlign: 'center', width: 60 }
const removeBtn = { background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b', fontSize: 14, padding: '0 4px', lineHeight: 1 }
const addBtn = {
  background: 'none', border: '1px dashed rgba(28,24,20,0.3)', borderRadius: 4,
  cursor: 'pointer', color: '#6b6358', fontSize: 11, padding: '4px 10px', marginTop: 6,
  fontFamily: "'Barlow Condensed', sans-serif", textTransform: 'uppercase', letterSpacing: '0.06em',
}

export default function FieldSowModal({ job, onClose, onUpdated }) {
  const printRef = useRef()
  const [editing, setEditing] = useState(false)
  const [days, setDays] = useState(() => deepClone(job?.field_sow || []))
  const [saving, setSaving] = useState(false)

  if (!job) return null

  const hasFieldSow = job.field_sow && job.field_sow.length > 0

  // Empty state — allow creating from scratch
  if (!hasFieldSow && !editing) {
    return (
      <div className="mbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="mdl">
          <h3>Field SOW and Production Rate Tracker</h3>
          <div style={{ fontSize: 13, color: '#5a5249', padding: '20px 0' }}>
            No Field SOW data for this job.
          </div>
          <div className="macts" style={{ display: 'flex', gap: 6 }}>
            <button className="app-act-btn app-act-primary" onClick={() => { setDays([{ id: Date.now(), day_label: 'Day 1', tasks: [], materials: [], crew_count: 0, hours_planned: 0 }]); setEditing(true) }}>Create Field SOW</button>
            <button className="app-act-btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Edit helpers ──
  function updateDay(i, field, value) {
    setDays(prev => { const n = deepClone(prev); n[i][field] = value; return n })
  }
  function addDay() {
    setDays(prev => [...prev, { id: Date.now(), day_label: `Day ${prev.length + 1}`, tasks: [], materials: [], crew_count: 0, hours_planned: 0 }])
  }
  function removeDay(i) {
    if (!confirm(`Remove ${days[i].day_label || 'this day'}?`)) return
    setDays(prev => prev.filter((_, idx) => idx !== i))
  }
  function updateTask(di, ti, field, value) {
    setDays(prev => { const n = deepClone(prev); n[di].tasks[ti][field] = value; return n })
  }
  function addTask(di) {
    setDays(prev => { const n = deepClone(prev); n[di].tasks.push({ id: Date.now(), description: '', pct_complete: 0 }); return n })
  }
  function removeTask(di, ti) {
    setDays(prev => { const n = deepClone(prev); n[di].tasks.splice(ti, 1); return n })
  }
  function updateMat(di, mi, field, value) {
    setDays(prev => { const n = deepClone(prev); n[di].materials[mi][field] = value; return n })
  }
  function addMat(di) {
    setDays(prev => { const n = deepClone(prev); n[di].materials.push({ name: '', kit_size: '', qty_planned: '', mils: '' }); return n })
  }
  function removeMat(di, mi) {
    setDays(prev => { const n = deepClone(prev); n[di].materials.splice(mi, 1); return n })
  }

  async function handleSave() {
    setSaving(true)
    // Clean up empty tasks
    const cleaned = days.map(d => ({
      ...d,
      tasks: (d.tasks || []).filter(t => t.description?.trim()),
      crew_count: parseInt(d.crew_count) || 0,
      hours_planned: parseInt(d.hours_planned) || 0,
    }))
    const { error } = await supabase.from('jobs').update({ field_sow: cleaned }).eq('job_id', job.job_id)
    setSaving(false)
    if (error) { alert('Save failed: ' + error.message); return }
    setEditing(false)
    onUpdated && onUpdated()
  }

  function handleCancel() {
    setDays(deepClone(job.field_sow || []))
    setEditing(false)
  }

  // ── Print ──
  function handlePrint() {
    const el = printRef.current
    if (!el) return
    const win = window.open('', '_blank')
    win.document.write(`<!DOCTYPE html>
<html>
<head>
<title>Field SOW and Production Rate Tracker — ${job.job_num || ''} ${job.job_name || ''}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700&family=Barlow:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Barlow', sans-serif; color: #1c1814; background: #fff; }
  .sow-page { max-width: 800px; margin: 0 auto; padding: 24px; }
  .sow-header { background: #1c1814; color: #fff; padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #30cfac; }
  .sow-header-left h1 { font-family: 'Barlow Condensed', sans-serif; font-size: 22px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
  .sow-header-left h1 span { color: #30cfac; }
  .sow-header-right { text-align: right; font-size: 11px; font-family: 'Barlow Condensed', sans-serif; text-transform: uppercase; letter-spacing: 0.5px; color: #b5a896; }
  .sow-header-right .sow-job-num { font-size: 18px; font-weight: 700; color: #30cfac; font-family: 'JetBrains Mono', monospace; }
  .sow-info { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; padding: 14px 0; border-bottom: 2px solid #1c1814; margin-bottom: 16px; }
  .sow-info-item label { font-family: 'Barlow Condensed', sans-serif; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #9a8d7d; display: block; }
  .sow-info-item span { font-size: 13px; font-weight: 500; }
  .sow-day { margin-bottom: 20px; border: 2px solid #1c1814; break-inside: avoid; }
  .sow-day-header { background: #1c1814; color: #fff; padding: 8px 14px; display: flex; justify-content: space-between; align-items: center; }
  .sow-day-title { font-family: 'Barlow Condensed', sans-serif; font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
  .sow-day-meta { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #30cfac; }
  .sow-day-body { padding: 12px 14px; background: #f5f0eb; }
  .sow-tasks-title, .sow-mats-title { font-family: 'Barlow Condensed', sans-serif; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #9a8d7d; margin-bottom: 6px; }
  .sow-task { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid rgba(28,24,20,0.08); font-size: 13px; }
  .sow-task:last-child { border-bottom: none; }
  .sow-task-check { width: 14px; height: 14px; border: 2px solid #1c1814; border-radius: 2px; flex-shrink: 0; }
  .sow-task-desc { flex: 1; }
  .sow-task-pct { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; color: #30cfac; }
  .sow-mats { margin-top: 12px; }
  .sow-mat { display: grid; grid-template-columns: 1fr 70px 50px 50px 55px 55px 55px 65px; gap: 6px; padding: 4px 0; border-bottom: 1px solid rgba(28,24,20,0.08); font-size: 12px; align-items: center; }
  .sow-mat:last-child { border-bottom: none; }
  .sow-mat-hdr { font-family: 'Barlow Condensed', sans-serif; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #9a8d7d; }
  .sow-mat-name { font-weight: 500; }
  .sow-mat-detail { font-family: 'JetBrains Mono', monospace; font-size: 11px; text-align: center; }
  .sow-footer { margin-top: 24px; padding-top: 12px; border-top: 2px solid #1c1814; display: flex; justify-content: space-between; font-size: 10px; color: #9a8d7d; font-family: 'Barlow Condensed', sans-serif; text-transform: uppercase; letter-spacing: 0.5px; }
  @media print {
    body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .sow-page { padding: 0; }
    .sow-day { break-inside: avoid; }
  }
</style>
</head>
<body>
${el.innerHTML}
</body>
</html>`)
    win.document.close()
    setTimeout(() => { win.print() }, 400)
  }

  const viewDays = editing ? days : (job.field_sow || [])

  return (
    <div className="mbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mdl mdl-wide" style={{ maxWidth: 860, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Field SOW and Production Rate Tracker</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            {editing ? (
              <>
                <button className="app-act-btn" onClick={handleCancel} disabled={saving}>Cancel</button>
                <button className="app-act-btn app-act-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
              </>
            ) : (
              <>
                <button className="app-act-btn" onClick={() => { setDays(deepClone(job.field_sow || [])); setEditing(true) }}>Edit</button>
                <button className="app-act-btn app-act-primary" onClick={handlePrint}>Print PDF</button>
                <button className="app-act-btn" onClick={onClose}>Close</button>
              </>
            )}
          </div>
        </div>

        <style>{`
          .sow-page { max-width: 800px; margin: 0 auto; }
          .sow-header { background: #1c1814; color: #fff; padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #30cfac; border-radius: 8px 8px 0 0; }
          .sow-header-left h1 { font-family: 'Barlow Condensed', sans-serif; font-size: 22px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin: 0; }
          .sow-header-left h1 span { color: #30cfac; }
          .sow-header-right { text-align: right; font-size: 11px; font-family: 'Barlow Condensed', sans-serif; text-transform: uppercase; letter-spacing: 0.5px; color: #b5a896; }
          .sow-header-right .sow-job-num { font-size: 18px; font-weight: 700; color: #30cfac; font-family: 'JetBrains Mono', monospace; }
          .sow-info { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; padding: 14px 0; border-bottom: 2px solid #1c1814; margin-bottom: 16px; }
          .sow-info-item label { font-family: 'Barlow Condensed', sans-serif; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #9a8d7d; display: block; }
          .sow-info-item span { font-size: 13px; font-weight: 500; }
          .sow-day { margin-bottom: 20px; border: 2px solid #1c1814; border-radius: 6px; overflow: hidden; }
          .sow-day-header { background: #1c1814; color: #fff; padding: 8px 14px; display: flex; justify-content: space-between; align-items: center; }
          .sow-day-title { font-family: 'Barlow Condensed', sans-serif; font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
          .sow-day-meta { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #30cfac; }
          .sow-day-body { padding: 12px 14px; background: #c8bcaa; }
          .sow-tasks-title, .sow-mats-title { font-family: 'Barlow Condensed', sans-serif; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #9a8d7d; margin-bottom: 6px; }
          .sow-task { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid rgba(28,24,20,0.08); font-size: 13px; }
          .sow-task:last-child { border-bottom: none; }
          .sow-task-check { width: 14px; height: 14px; border: 2px solid #1c1814; border-radius: 2px; flex-shrink: 0; }
          .sow-task-desc { flex: 1; }
          .sow-task-pct { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; color: #30cfac; background: #1c1814; border-radius: 6px; padding: 3px 10px; white-space: nowrap; }
          .sow-mats { margin-top: 12px; }
          .sow-mat { display: grid; grid-template-columns: 1fr 70px 50px 50px 55px 55px 55px 65px; gap: 6px; padding: 4px 0; border-bottom: 1px solid rgba(28,24,20,0.08); font-size: 12px; align-items: center; }
          .sow-mat:last-child { border-bottom: none; }
          .sow-mat:nth-child(odd) { background: rgba(28,24,20,0.06); }
          .sow-mat:nth-child(even) { background: rgba(28,24,20,0.02); }
          .sow-mat-hdr { font-family: 'Barlow Condensed', sans-serif; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #9a8d7d; }
          .sow-mat-name { font-weight: 500; }
          .sow-mat-detail { font-family: 'JetBrains Mono', monospace; font-size: 11px; text-align: center; }
          .sow-footer { margin-top: 24px; padding-top: 12px; border-top: 2px solid #1c1814; display: flex; justify-content: space-between; font-size: 10px; color: #9a8d7d; font-family: 'Barlow Condensed', sans-serif; text-transform: uppercase; letter-spacing: 0.5px; }
        `}</style>

        <div ref={printRef}>
          <div className="sow-page">
            {/* Header */}
            <div className="sow-header">
              <div className="sow-header-left">
                <h1>Schedule <span>Commander</span></h1>
                <div style={{ fontSize: 11, color: '#b5a896', marginTop: 2 }}>FIELD STATEMENT OF WORK</div>
              </div>
              <div className="sow-header-right">
                <div className="sow-job-num">{job.job_num}</div>
                <div>{job.job_name}</div>
              </div>
            </div>

            {/* Info bar */}
            <div className="sow-info">
              <div className="sow-info-item">
                <label>Work Type</label>
                <span>{job.work_type || '-'}</span>
              </div>
              <div className="sow-info-item">
                <label>Size</label>
                <span>{job.size ? `${Number(job.size).toLocaleString()} ${job.size_unit || 'SF'}` : '-'}</span>
              </div>
              <div className="sow-info-item">
                <label>Lead</label>
                <span>{job.lead ? flipName(job.lead) : '-'}</span>
              </div>
              <div className="sow-info-item">
                <label>Start</label>
                <span>{job.start_date || '-'}</span>
              </div>
              <div className="sow-info-item">
                <label>End</label>
                <span>{job.end_date || '-'}</span>
              </div>
            </div>

            {/* Days */}
            {viewDays.map((day, i) => (
              <div className="sow-day" key={day.id || i}>
                <div className="sow-day-header">
                  {editing ? (
                    <input value={day.day_label || ''} onChange={e => updateDay(i, 'day_label', e.target.value)}
                      style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 4, padding: '2px 8px', color: '#fff', fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', outline: 'none', width: 120 }} />
                  ) : (
                    <div className="sow-day-title">{day.day_label || `Day ${i + 1}`}</div>
                  )}
                  <div className="sow-day-meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {editing ? (
                      <>
                        <span>Crew:</span>
                        <input type="number" value={day.crew_count || ''} onChange={e => updateDay(i, 'crew_count', e.target.value)}
                          style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 4, padding: '2px 6px', color: '#30cfac', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, width: 40, textAlign: 'center', outline: 'none' }} />
                        <span style={{ marginLeft: 6 }}>Hrs:</span>
                        <input type="number" value={day.hours_planned || ''} onChange={e => updateDay(i, 'hours_planned', e.target.value)}
                          style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 4, padding: '2px 6px', color: '#30cfac', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, width: 40, textAlign: 'center', outline: 'none' }} />
                        <button onClick={() => removeDay(i)} style={{ ...removeBtn, color: '#e74c3c', marginLeft: 8, fontSize: 12 }} title="Remove day">X</button>
                      </>
                    ) : (
                      <>
                        {day.crew_count ? <span>Crew: {day.crew_count}</span> : null}
                        {day.hours_planned ? <span style={{ marginLeft: 12 }}>Hrs: {day.hours_planned}</span> : null}
                      </>
                    )}
                  </div>
                </div>
                <div className="sow-day-body">
                  {/* Tasks */}
                  {(editing || (day.tasks && day.tasks.length > 0)) && (
                    <>
                      <div className="sow-tasks-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Tasks</span>
                        <span>Expected Production</span>
                      </div>
                      {(day.tasks || []).map((t, ti) => (
                        <div className="sow-task" key={t.id || ti}>
                          {editing ? (
                            <>
                              <button onClick={() => removeTask(i, ti)} style={removeBtn} title="Remove task">X</button>
                              <input value={t.description || ''} onChange={e => updateTask(i, ti, 'description', e.target.value)}
                                placeholder="Task description" style={{ ...inputStyle, flex: 1 }} />
                              <input type="number" value={t.pct_complete ?? ''} onChange={e => updateTask(i, ti, 'pct_complete', parseInt(e.target.value) || 0)}
                                style={{ ...smallInput, width: 50 }} min={0} max={100} />
                              <span style={{ fontSize: 11, color: '#6b6358' }}>%</span>
                            </>
                          ) : (
                            <>
                              <div className="sow-task-check" />
                              <div className="sow-task-desc">{t.description || 'Untitled task'}</div>
                              {t.pct_complete != null && <div className="sow-task-pct">{t.pct_complete}%</div>}
                            </>
                          )}
                        </div>
                      ))}
                      {editing && <button onClick={() => addTask(i)} style={addBtn}>+ Add Task</button>}
                    </>
                  )}

                  {/* Materials */}
                  {(editing || (day.materials && day.materials.length > 0)) && (
                    <div className="sow-mats">
                      <div className="sow-mats-title">Materials</div>
                      {(!editing || (day.materials && day.materials.length > 0)) && (
                        <div className="sow-mat">
                          <div className="sow-mat-hdr">{editing ? '' : 'Product'}</div>
                          <div className="sow-mat-hdr" style={{ textAlign: 'center' }}>Kit Size</div>
                          <div className="sow-mat-hdr" style={{ textAlign: 'center' }}>Qty</div>
                          <div className="sow-mat-hdr" style={{ textAlign: 'center' }}>Mils</div>
                          <div className="sow-mat-hdr" style={{ textAlign: 'center' }}>Mix Time</div>
                          <div className="sow-mat-hdr" style={{ textAlign: 'center' }}>Mix Spd</div>
                          <div className="sow-mat-hdr" style={{ textAlign: 'center' }}>Cure</div>
                          <div className="sow-mat-hdr" style={{ textAlign: 'center' }}>Coverage</div>
                        </div>
                      )}
                      {(day.materials || []).map((m, mi) => (
                        <div className="sow-mat" key={m.wtc_material_id || mi} style={editing ? { gridTemplateColumns: '20px 1fr 70px 50px 50px 55px 55px 55px 65px' } : undefined}>
                          {editing && <button onClick={() => removeMat(i, mi)} style={removeBtn} title="Remove material">X</button>}
                          {editing ? (
                            <>
                              <input value={m.name || ''} onChange={e => updateMat(i, mi, 'name', e.target.value)} placeholder="Product name" style={inputStyle} />
                              <input value={m.kit_size || ''} onChange={e => updateMat(i, mi, 'kit_size', e.target.value)} style={{ ...smallInput, width: '100%' }} />
                              <input type="number" value={m.qty_planned || ''} onChange={e => updateMat(i, mi, 'qty_planned', e.target.value)} style={{ ...smallInput, width: '100%' }} />
                              <input type="number" value={m.mils || ''} onChange={e => updateMat(i, mi, 'mils', e.target.value)} style={{ ...smallInput, width: '100%' }} />
                              <input value={m.mix_time ?? ''} onChange={e => updateMat(i, mi, 'mix_time', e.target.value)} style={{ ...smallInput, width: '100%' }} />
                              <input value={m.mix_speed || ''} onChange={e => updateMat(i, mi, 'mix_speed', e.target.value)} style={{ ...smallInput, width: '100%' }} />
                              <input value={m.cure_time || ''} onChange={e => updateMat(i, mi, 'cure_time', e.target.value)} style={{ ...smallInput, width: '100%' }} />
                              <input value={m.coverage_rate || ''} onChange={e => updateMat(i, mi, 'coverage_rate', e.target.value)} style={{ ...smallInput, width: '100%' }} />
                            </>
                          ) : (
                            <>
                              <div className="sow-mat-name">{m.name || m.product || '-'}</div>
                              <div className="sow-mat-detail">{m.kit_size || '-'}</div>
                              <div className="sow-mat-detail">{m.qty_planned || '-'}</div>
                              <div className="sow-mat-detail">{m.mils || '-'}</div>
                              <div className="sow-mat-detail">{m.mix_time || '-'}</div>
                              <div className="sow-mat-detail">{m.mix_speed || '-'}</div>
                              <div className="sow-mat-detail">{m.cure_time || '-'}</div>
                              <div className="sow-mat-detail">{m.coverage_rate || '-'}</div>
                            </>
                          )}
                        </div>
                      ))}
                      {editing && <button onClick={() => addMat(i)} style={addBtn}>+ Add Material</button>}
                    </div>
                  )}

                  {!editing && (!day.tasks || day.tasks.length === 0) && (!day.materials || day.materials.length === 0) && (
                    <div style={{ fontSize: 12, color: '#9a8d7d', fontStyle: 'italic' }}>No tasks or materials assigned</div>
                  )}
                </div>
              </div>
            ))}

            {editing && <button onClick={addDay} style={{ ...addBtn, width: '100%', padding: '10px', fontSize: 13 }}>+ Add Day</button>}

            {/* Footer */}
            <div className="sow-footer">
              <div>Schedule Commander — YES</div>
              <div>Printed {new Date().toLocaleDateString()}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
