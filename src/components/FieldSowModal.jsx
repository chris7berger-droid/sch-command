import { useRef } from 'react'

function flipName(n) {
  if (!n) return ''
  const p = n.split(',')
  return p.length === 2 ? p[1].trim() + ' ' + p[0].trim() : n
}

export default function FieldSowModal({ job, onClose }) {
  const printRef = useRef()

  if (!job || !job.field_sow || job.field_sow.length === 0) {
    return (
      <div className="mbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="mdl">
          <h3>Field SOW</h3>
          <div style={{ fontSize: 13, color: '#5a5249', padding: '20px 0' }}>
            No Field SOW data for this job.
          </div>
          <div className="macts">
            <button className="app-act-btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    )
  }

  const days = job.field_sow

  function handlePrint() {
    const el = printRef.current
    if (!el) return
    const win = window.open('', '_blank')
    win.document.write(`<!DOCTYPE html>
<html>
<head>
<title>Field SOW — ${job.job_num || ''} ${job.job_name || ''}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700&family=Barlow:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Barlow', sans-serif; color: #1c1814; background: #fff; }

  .sow-page { max-width: 800px; margin: 0 auto; padding: 24px; }

  .sow-header {
    background: #1c1814;
    color: #fff;
    padding: 16px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 3px solid #5BBD3F;
  }
  .sow-header-left h1 {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  .sow-header-left h1 span { color: #5BBD3F; }
  .sow-header-right {
    text-align: right;
    font-size: 11px;
    font-family: 'Barlow Condensed', sans-serif;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #b5a896;
  }
  .sow-header-right .sow-job-num {
    font-size: 18px;
    font-weight: 700;
    color: #5BBD3F;
    font-family: 'JetBrains Mono', monospace;
  }

  .sow-info {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    padding: 14px 0;
    border-bottom: 2px solid #1c1814;
    margin-bottom: 16px;
  }
  .sow-info-item label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #9a8d7d;
    display: block;
  }
  .sow-info-item span {
    font-size: 13px;
    font-weight: 500;
  }

  .sow-day {
    margin-bottom: 20px;
    border: 2px solid #1c1814;
    break-inside: avoid;
  }
  .sow-day-header {
    background: #1c1814;
    color: #fff;
    padding: 8px 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .sow-day-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 16px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .sow-day-meta {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: #5BBD3F;
  }
  .sow-day-body { padding: 12px 14px; background: #f5f0eb; }

  .sow-tasks-title, .sow-mats-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #9a8d7d;
    margin-bottom: 6px;
  }

  .sow-task {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    border-bottom: 1px solid rgba(28,24,20,0.08);
    font-size: 13px;
  }
  .sow-task:last-child { border-bottom: none; }
  .sow-task-check {
    width: 14px;
    height: 14px;
    border: 2px solid #1c1814;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .sow-task-desc { flex: 1; }

  .sow-mats { margin-top: 12px; }
  .sow-mat {
    display: grid;
    grid-template-columns: 1fr 80px 70px 70px;
    gap: 6px;
    padding: 4px 0;
    border-bottom: 1px solid rgba(28,24,20,0.08);
    font-size: 12px;
    align-items: center;
  }
  .sow-mat:last-child { border-bottom: none; }
  .sow-mat-hdr {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #9a8d7d;
  }
  .sow-mat-name { font-weight: 500; }
  .sow-mat-detail {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    text-align: center;
  }

  .sow-footer {
    margin-top: 24px;
    padding-top: 12px;
    border-top: 2px solid #1c1814;
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    color: #9a8d7d;
    font-family: 'Barlow Condensed', sans-serif;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

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

  return (
    <div className="mbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mdl mdl-wide" style={{ maxWidth: 860, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Field SOW</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="app-act-btn app-act-primary" onClick={handlePrint}>Print PDF</button>
            <button className="app-act-btn" onClick={onClose}>Close</button>
          </div>
        </div>

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
            {days.map((day, i) => (
              <div className="sow-day" key={day.id || i}>
                <div className="sow-day-header">
                  <div className="sow-day-title">{day.day_label || `Day ${i + 1}`}</div>
                  <div className="sow-day-meta">
                    {day.crew_count && <span>Crew: {day.crew_count}</span>}
                    {day.hours_planned && <span style={{ marginLeft: 12 }}>Hrs: {day.hours_planned}</span>}
                  </div>
                </div>
                <div className="sow-day-body">
                  {/* Tasks */}
                  {day.tasks && day.tasks.length > 0 && (
                    <>
                      <div className="sow-tasks-title">Tasks</div>
                      {day.tasks.map((t, ti) => (
                        <div className="sow-task" key={t.id || ti}>
                          <div className="sow-task-check" />
                          <div className="sow-task-desc">{t.description || 'Untitled task'}</div>
                        </div>
                      ))}
                    </>
                  )}

                  {/* Materials for this day */}
                  {day.materials && day.materials.length > 0 && (
                    <div className="sow-mats">
                      <div className="sow-mats-title">Materials</div>
                      <div className="sow-mat">
                        <div className="sow-mat-hdr">Product</div>
                        <div className="sow-mat-hdr" style={{ textAlign: 'center' }}>Kit Size</div>
                        <div className="sow-mat-hdr" style={{ textAlign: 'center' }}>Qty</div>
                        <div className="sow-mat-hdr" style={{ textAlign: 'center' }}>Mils</div>
                      </div>
                      {day.materials.map((m, mi) => (
                        <div className="sow-mat" key={m.wtc_material_id || mi}>
                          <div className="sow-mat-name">{m.name || m.product || '-'}</div>
                          <div className="sow-mat-detail">{m.kit_size || '-'}</div>
                          <div className="sow-mat-detail">{m.qty_planned || '-'}</div>
                          <div className="sow-mat-detail">{m.mils || '-'}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {(!day.tasks || day.tasks.length === 0) && (!day.materials || day.materials.length === 0) && (
                    <div style={{ fontSize: 12, color: '#9a8d7d', fontStyle: 'italic' }}>No tasks or materials assigned</div>
                  )}
                </div>
              </div>
            ))}

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
