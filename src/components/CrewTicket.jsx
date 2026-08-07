import { useEffect, useRef, useState } from 'react'
import { materialBlocksPrint } from './FieldSowBuilder'
import { PRINT_CSS } from './FieldSowModal'
import { ScheduleCommandMark } from './Logo'
import { useToast } from '../lib/toast'
import { loadBidMaterialsForJob, summarizeBidMaterials, uname } from '../lib/ticketMaterials'

// DMS-1 Phase 4 — the crew ticket (print). SELF-CONTAINED by design (2026-08-02
// reset): it loads its OWN data and renders its OWN markup, so it shares NOTHING
// mutable with the live SOW print (FieldSowModal). The only borrow is the exported
// PRINT_CSS string (.sow-* class styles) — read-only, so the SOW print stays byte-
// for-byte identical. See docs/plans/daily_material_schedule_phase4_build.md.
//
// Two surfaces on one sheet:
//   1. Page 1 — Material Order Summary: the salesperson's BID quantities
//      (proposal_wtc.materials, summed across this job's scheduled WTCs) as a
//      sign-off checklist. This is the warehouse order.
//   2. Per-day cards — grouped by WTC: work-to-complete (tasks + %), scope notes,
//      and the day's materials as text (specs, NO per-day qty — totals live on
//      page 1 per locked decision A).

// Build the material spec line ("Mils: 3/16" · Coverage: 45 Sqft per kit · …").
// Truthy-guarded per segment so a blank spec never prints an empty "Key: ".
function specText(m = {}) {
  const segs = []
  if (m.mils) segs.push(`Mils: ${m.mils}`)
  const cov = m.coverage_rate || m.coverage
  if (cov) segs.push(`Coverage: ${cov}`)
  if (m.mix_time) segs.push(`Mix time: ${m.mix_time}`)
  if (m.mix_speed) segs.push(`Mix speed: ${m.mix_speed}`)
  if (m.cure_time) segs.push(`Cure: ${m.cure_time}`)
  return segs.join(' · ')
}

// Ticket-local styles: page-1 summary + task tags + material-as-text + the
// ticket-only page break after the cover. Layered on top of the borrowed .sow-*
// classes (PRINT_CSS). Prefixed .ct-* so nothing here can touch the SOW print.
const ticketCss = `
  .ct-cover { break-after: page; }
  .ct-summary { border: 2px solid #1c1814; margin-top: 16px; break-inside: avoid; }
  .ct-summary-head { background: #1c1814; color: #fff; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; }
  .ct-summary-title { font-family: 'Barlow Condensed', sans-serif; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
  .ct-summary-count { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #30cfac; }
  .ct-cols { display: grid; grid-template-columns: 28px 34px 1fr 96px; gap: 8px; padding: 8px 14px; border-bottom: 2px solid #1c1814; }
  .ct-col-hdr { font-family: 'Barlow Condensed', sans-serif; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #9a8d7d; }
  .ct-row { display: grid; grid-template-columns: 28px 34px 1fr 96px; gap: 8px; align-items: center; padding: 8px 14px; border-bottom: 1px solid rgba(28,24,20,0.1); font-size: 13px; }
  .ct-row:nth-child(even) { background: rgba(28,24,20,0.04); }
  .ct-check { width: 16px; height: 16px; border: 2px solid #1c1814; border-radius: 3px; }
  .ct-idx { font-family: 'JetBrains Mono', monospace; color: #9a8d7d; font-size: 11px; }
  .ct-mat-name { font-weight: 600; }
  .ct-qty { font-family: 'JetBrains Mono', monospace; font-weight: 700; text-align: right; }
  .ct-empty { padding: 16px 14px; font-size: 13px; color: #5a5249; font-style: italic; }
  .ct-sign { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; padding: 40px 14px 16px; }
  .ct-sign-line { border-top: 1.5px solid #1c1814; padding-top: 4px; font-family: 'Barlow Condensed', sans-serif; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #9a8d7d; }
  .ct-subline { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #5a5249; margin-bottom: 10px; }
  .ct-work-title { font-family: 'Barlow Condensed', sans-serif; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #9a8d7d; margin-bottom: 6px; }
  .ct-task { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid rgba(28,24,20,0.08); font-size: 13px; }
  .ct-task:last-child { border-bottom: none; }
  .ct-tasktag { display: inline-block; background: #1c1814; color: #fff; font-family: 'Barlow Condensed', sans-serif; font-size: 9px; font-weight: 700; letter-spacing: 0.5px; padding: 2px 7px; border-radius: 4px; white-space: nowrap; }
  .ct-task-desc { flex: 1; }
  .ct-pct { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px; white-space: nowrap; }
  .ct-mats { margin-top: 12px; }
  .ct-mat { padding: 6px 0; border-bottom: 1px solid rgba(28,24,20,0.08); font-size: 12px; }
  .ct-mat:last-child { border-bottom: none; }
  .ct-mat-kit { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #6b6358; margin-left: 8px; }
  .ct-mat-specs { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #6b6358; margin-top: 2px; }
  .ct-unconfirmed { display: inline-block; background: #e67e22; color: #fff; font-family: 'Barlow Condensed', sans-serif; font-size: 8px; font-weight: 700; letter-spacing: 0.5px; padding: 1px 5px; border-radius: 3px; margin-left: 6px; text-transform: uppercase; }
`

// Colored % badge: 100% = green (done-defined), partial = amber (split day).
function pctStyle(pct) {
  const done = Number(pct) >= 100
  return { background: done ? '#5BBD3F' : '#c8a415', color: '#1c1814' }
}

// One per-day card. OWN markup (does NOT reuse the shared DayCard) — reuses only
// the .sow-day* structural classes for visual parity. NO per-day qty (decision A).
function DayCard({ day, index }) {
  const tasks = Array.isArray(day.tasks) ? day.tasks : []
  const materials = Array.isArray(day.materials) ? day.materials : []
  const items = materials.length
  const subline = [
    day.crew_count ? `Crew: ${day.crew_count}` : null,
    day.hours_planned ? `Hours: ${day.hours_planned}` : null,
    day.sq_ft ? `Sq ft: ${Number(day.sq_ft).toLocaleString()}` : null,
    day.linear_ft ? `Linear ft: ${Number(day.linear_ft).toLocaleString()}` : null,
  ].filter(Boolean).join('  ·  ')

  return (
    <div className="sow-day">
      <div className="sow-day-header">
        <div className="sow-day-title">{day.day_label || `Day ${index + 1}`}</div>
        <div className="sow-day-meta">{items} {items === 1 ? 'ITEM' : 'ITEMS'}</div>
      </div>
      <div className="sow-day-body">
        {subline && <div className="ct-subline">{subline}</div>}

        {tasks.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div className="ct-work-title">Work to Complete</div>
            {tasks.map((t, ti) => (
              <div className="ct-task" key={t.id || ti}>
                <span className="ct-tasktag">TASK {ti + 1}</span>
                <span className="ct-task-desc">{t.description || 'Untitled task'}</span>
                {t.pct_complete != null && <span className="ct-pct" style={pctStyle(t.pct_complete)}>{t.pct_complete}%</span>}
              </div>
            ))}
          </div>
        )}

        {day.scope_notes && String(day.scope_notes).trim() !== '' && (
          <div className="sow-scope-notes">
            <div className="ct-work-title">Scope Notes</div>
            <div className="sow-scope-notes-body">{day.scope_notes}</div>
          </div>
        )}

        {materials.length > 0 && (
          <div className="ct-mats">
            <div className="ct-work-title">Materials Needed</div>
            {materials.map((m, mi) => {
              const specs = specText(m)
              return (
                <div className="ct-mat" key={m.wtc_material_id || mi}>
                  <div>
                    <span className="ct-mat-name">{uname(m)}</span>
                    {m.kit_size && <span className="ct-mat-kit">kit: {m.kit_size}</span>}
                    {materialBlocksPrint(m) && <span className="ct-unconfirmed">Specs unconfirmed</span>}
                  </div>
                  {specs && <div className="ct-mat-specs">{specs}</div>}
                </div>
              )
            })}
          </div>
        )}

        {tasks.length === 0 && materials.length === 0 && (
          <div style={{ fontSize: 12, color: '#9a8d7d', fontStyle: 'italic' }}>No tasks or materials for this day</div>
        )}
      </div>
    </div>
  )
}

export default function CrewTicket({ jobId, onClose }) {
  const toast = useToast()
  const printRef = useRef()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [job, setJob] = useState(null)
  const [bidMaterials, setBidMaterials] = useState([]) // flattened proposal_wtc.materials rows

  useEffect(() => {
    let active = true
    setLoading(true)
    ;(async () => {
      const { job: jobData, bidMaterials: mats, error: loadErr } = await loadBidMaterialsForJob(jobId)
      if (!active) return
      if (loadErr) { setError(loadErr.message); setLoading(false); return }
      setJob(jobData)
      setBidMaterials(mats)
      setLoading(false)
    })()
    return () => { active = false }
  }, [jobId])

  function handlePrint() {
    const el = printRef.current
    if (!el) return
    const win = window.open('', '_blank')
    if (!win) { toast('Allow pop-ups to print', 'err'); return }
    // Escape the only raw string concatenated into document.write — the <title>
    // (job name/num are Sales-entered). The body is React-rendered (already
    // escaped) DOM via el.innerHTML; PRINT_CSS/ticketCss are static constants.
    // (T6 security-review #2.)
    const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    const title = `Crew Ticket — ${esc(job?.job_num)} ${esc(job?.job_name)}`.trim()
    win.document.write(`<!DOCTYPE html><html><head><title>${title}</title><style>${PRINT_CSS}${ticketCss}</style></head><body>${el.innerHTML}</body></html>`)
    win.document.close()
    setTimeout(() => { win.print() }, 400)
  }

  // Page-1 summary: group identical bid materials across WTCs, sum qty (shared
  // with the warehouse receiving ticket — see src/lib/ticketMaterials.js).
  const summary = summarizeBidMaterials(bidMaterials)

  // Per-day cards grouped by WTC; legacy zero-WTC job → flat jobs.field_sow.
  const wtcs = Array.isArray(job?._wtcs) ? job._wtcs : []
  const sections = wtcs.length > 0
    ? wtcs.map((w, i) => ({ key: w.id, label: w.work_type_name || `WTC ${i + 1}`, days: Array.isArray(w.field_sow) ? w.field_sow : [] }))
    : [{ key: 'legacy', label: null, days: Array.isArray(job?.field_sow) ? job.field_sow : [] }]
  const totalDays = sections.reduce((n, s) => n + s.days.length, 0)

  return (
    <div className="mbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mdl mdl-wide" style={{ maxWidth: 860, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Crew Ticket — Daily Material Schedule</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="app-act-btn app-act-primary" onClick={handlePrint} disabled={loading || !!error}>Print Ticket</button>
            <button className="app-act-btn" onClick={onClose}>Close</button>
          </div>
        </div>

        {loading ? (
          <div style={{ fontSize: 13, color: '#6b6358', padding: '20px 0' }}>Loading…</div>
        ) : error ? (
          <div className="error-msg">Error: {error}</div>
        ) : (
          <>
            {/* App-styled preview (linen) — so Chris can eyeball the bid numbers
                before printing. The print styles (sow- and ct- classes) live in
                PRINT_CSS, which is NOT injected on-screen (it carries global resets
                that would wreck the app while the modal is open). The pixel-accurate
                render is the PRINTED sheet (printRef then handlePrint). */}
            <div style={{ fontSize: 13, color: '#2d2720' }}>
              <div style={{ marginBottom: 10, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {job?.job_num ? `#${job.job_num} · ` : ''}{job?.job_name || 'Job'}{job?.customer_name ? ` · ${job.customer_name}` : ''}
              </div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b6358', marginBottom: 6 }}>
                Material Order Summary — {summary.length} material{summary.length === 1 ? '' : 's'}
              </div>
              {summary.length === 0 ? (
                <div style={{ fontStyle: 'italic', color: '#5a5249', marginBottom: 10 }}>No bid materials on file.</div>
              ) : (
                <div style={{ border: '1px solid rgba(28,24,20,0.18)', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
                  {summary.map((m, i) => (
                    <div key={m.name + i} style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 8, padding: '6px 12px', background: i % 2 ? 'rgba(28,24,20,0.05)' : 'transparent', fontSize: 13 }}>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#9a8d7d' }}>{i + 1}</span>
                      <span style={{ fontWeight: 600 }}>{m.name}</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{m.qty ? `${m.qty}${m.kit_size ? ` (${m.kit_size})` : ''}` : '—'}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 12, color: '#6b6358' }}>
                {totalDays} scheduled day{totalDays === 1 ? '' : 's'}{sections.filter(s => s.days.length > 0 && s.label).length ? ` across ${sections.filter(s => s.days.length > 0 && s.label).length} WTC${sections.filter(s => s.days.length > 0 && s.label).length === 1 ? '' : 's'}` : ''}. Click <strong>Print Ticket</strong> for the full crew sheet.
              </div>
            </div>

            {/* Full crew-ticket markup, kept OFF-SCREEN. It is the print source only:
                handlePrint copies printRef.innerHTML into a popup where PRINT_CSS +
                ticketCss are injected fresh. Off-screen (not display:none) so innerHTML
                is always populated. */}
            <div ref={printRef} aria-hidden="true" style={{ position: 'absolute', left: -99999, top: 0, width: 800 }}>
              <div className="sow-page">
                {/* ── Page 1 — Material Order Summary ── */}
              <div className="ct-cover">
                <div className="sow-header">
                  <div className="sow-header-left" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <ScheduleCommandMark size={34} />
                    <div>
                      <h1>Daily <span>Material Schedule</span></h1>
                      <div style={{ fontSize: 11, color: '#b5a896', marginTop: 2, letterSpacing: '0.08em' }}>JOB TICKET · PRINT ONE PER CREW</div>
                    </div>
                  </div>
                  <div className="sow-header-right">
                    <div className="sow-job-num">{job?.job_num || '—'}</div>
                    <div>{job?.job_name || ''}</div>
                  </div>
                </div>

                <div className="sow-info">
                  <div className="sow-info-item"><label>Job / Project</label><span>{job?.job_name || '—'}</span></div>
                  <div className="sow-info-item"><label>Job Number</label><span>{job?.job_num || '—'}</span></div>
                  <div className="sow-info-item"><label>Customer</label><span>{job?.customer_name || '—'}</span></div>
                  <div className="sow-info-item"><label>Prepared By</label><span>&nbsp;</span></div>
                </div>

                <div className="ct-summary">
                  <div className="ct-summary-head">
                    <div className="ct-summary-title">Material Order Summary</div>
                    <div className="ct-summary-count">{summary.length} material{summary.length === 1 ? '' : 's'}</div>
                  </div>

                  {summary.length === 0 ? (
                    <div className="ct-empty">No bid materials on file.</div>
                  ) : (
                    <>
                      <div className="ct-cols">
                        <div className="ct-col-hdr" />
                        <div className="ct-col-hdr" />
                        <div className="ct-col-hdr">Material</div>
                        <div className="ct-col-hdr" style={{ textAlign: 'right' }}>Total Needed</div>
                      </div>
                      {summary.map((m, i) => (
                        <div className="ct-row" key={m.name + i}>
                          <div className="ct-check" />
                          <div className="ct-idx">{i + 1}</div>
                          <div className="ct-mat-name">{m.name}</div>
                          <div className="ct-qty">{m.qty ? `${m.qty}${m.kit_size ? ` (${m.kit_size})` : ''}` : '—'}</div>
                        </div>
                      ))}
                    </>
                  )}

                  <div className="ct-sign">
                    <div className="ct-sign-line">Lead Signature&nbsp;&nbsp;·&nbsp;&nbsp;Date</div>
                    <div className="ct-sign-line">Sales Signature&nbsp;&nbsp;·&nbsp;&nbsp;Date</div>
                  </div>
                </div>
              </div>

              {/* ── Per-day cards, grouped by WTC ── */}
              {totalDays === 0 ? (
                <div style={{ fontSize: 13, color: '#5a5249', padding: '20px 0' }}>No scheduled days on this job's Field SOW.</div>
              ) : (
                sections.map(section => (
                  section.days.length === 0 ? null : (
                    <div key={section.key}>
                      {section.label && <div className="sow-wtc-section">{section.label}</div>}
                      {section.days.map((day, i) => <DayCard key={day.id || i} day={day} index={i} />)}
                    </div>
                  )
                ))
              )}

                <div className="sow-footer">
                  <div>{totalDays} DAY{totalDays === 1 ? '' : 'S'} SCHEDULED</div>
                  <div>GENERATED {new Date().toLocaleDateString()}</div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
