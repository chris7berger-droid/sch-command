import { useEffect, useRef, useState } from 'react'
import { PRINT_CSS } from './FieldSowModal'
import { ScheduleCommandMark } from './Logo'
import { useToast } from '../lib/toast'
import { loadBidMaterialsForJob, summarizeBidMaterials } from '../lib/ticketMaterials'

// DMS-1 D2 — the WAREHOUSE RECEIVING TICKET (print). A page-1-only derivative of
// CrewTicket.jsx: the same whole-job Material Order Summary (shared load+summary
// from ../lib/ticketMaterials so the totals + row order can never diverge), trimmed
// to stand alone, relabeled for the warehouse, with a blank RECEIVED write-in column
// so the warehouse can check off + record what actually arrived. No per-day cards,
// no schedule footer — this is not a crew sheet. Paper write-in only; nothing is
// captured back to the DB. See docs/plans/warehouse_receiving_ticket.md §3.

// Receiving-only print styles. Same .ct-* language as the crew ticket, but the
// summary grid gains a 5th (RECEIVED) column and the material name ellipsizes so a
// long name can't blow out the tighter grid. Injected fresh into the print popup
// (a separate window from the crew ticket) — no collision with CrewTicket's ticketCss.
const receivingCss = `
  .ct-summary { border: 2px solid #1c1814; margin-top: 16px; break-inside: avoid; }
  .ct-summary-head { background: #1c1814; color: #fff; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; }
  .ct-summary-title { font-family: 'Barlow Condensed', sans-serif; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
  .ct-summary-count { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #30cfac; }
  .ct-cols { display: grid; grid-template-columns: 28px 34px 1fr 96px 72px; gap: 8px; padding: 8px 14px; border-bottom: 2px solid #1c1814; }
  .ct-col-hdr { font-family: 'Barlow Condensed', sans-serif; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #9a8d7d; }
  .ct-row { display: grid; grid-template-columns: 28px 34px 1fr 96px 72px; gap: 8px; align-items: center; padding: 8px 14px; border-bottom: 1px solid rgba(28,24,20,0.1); font-size: 13px; }
  .ct-row:nth-child(even) { background: rgba(28,24,20,0.04); }
  .ct-check { width: 16px; height: 16px; border: 2px solid #1c1814; border-radius: 3px; }
  .ct-idx { font-family: 'JetBrains Mono', monospace; color: #9a8d7d; font-size: 11px; }
  .ct-mat-name { font-weight: 600; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ct-qty { font-family: 'JetBrains Mono', monospace; font-weight: 700; text-align: right; }
  .ct-received { border: 1px solid #1c1814; border-radius: 3px; height: 24px; }
  .ct-empty { padding: 16px 14px; font-size: 13px; color: #5a5249; font-style: italic; }
  .ct-sign { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; padding: 40px 14px 16px; }
  .ct-sign-line { border-top: 1.5px solid #1c1814; padding-top: 4px; font-family: 'Barlow Condensed', sans-serif; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #9a8d7d; }
`

export default function ReceivingTicket({ jobId, onClose }) {
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
    // escaped) DOM via el.innerHTML; PRINT_CSS/receivingCss are static constants.
    const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    const title = `Warehouse Receiving — ${esc(job?.job_num)} ${esc(job?.job_name)}`.trim()
    win.document.write(`<!DOCTYPE html><html><head><title>${title}</title><style>${PRINT_CSS}${receivingCss}</style></head><body>${el.innerHTML}</body></html>`)
    win.document.close()
    setTimeout(() => { win.print() }, 400)
  }

  // Page-1 summary: same shared grouping+order as the crew ticket.
  const summary = summarizeBidMaterials(bidMaterials)

  return (
    <div className="mbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mdl mdl-wide" style={{ maxWidth: 860, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Warehouse Receiving</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="app-act-btn app-act-primary" onClick={handlePrint} disabled={loading || !!error}>Print Receiving List</button>
            <button className="app-act-btn" onClick={onClose}>Close</button>
          </div>
        </div>

        {loading ? (
          <div style={{ fontSize: 13, color: '#6b6358', padding: '20px 0' }}>Loading…</div>
        ) : error ? (
          <div className="error-msg">Error: {error}</div>
        ) : (
          <>
            {/* App-styled preview (linen) — so Chris can eyeball the bid numbers AND
                the RECEIVED column before printing. Print styles (sow-/ct- classes)
                live in PRINT_CSS/receivingCss, injected only into the popup. */}
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
                  <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto 72px', gap: 8, padding: '6px 12px', background: 'rgba(28,24,20,0.08)', fontFamily: "'Barlow Condensed', sans-serif", fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b6358' }}>
                    <span>#</span>
                    <span>Material</span>
                    <span style={{ textAlign: 'right' }}>Needed</span>
                    <span style={{ textAlign: 'right' }}>Received</span>
                  </div>
                  {summary.map((m, i) => (
                    <div key={m.name + i} style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto 72px', gap: 8, padding: '6px 12px', background: i % 2 ? 'rgba(28,24,20,0.05)' : 'transparent', fontSize: 13, alignItems: 'center' }}>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#9a8d7d' }}>{i + 1}</span>
                      <span style={{ fontWeight: 600, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, textAlign: 'right' }}>{m.qty ? `${m.qty}${m.kit_size ? ` (${m.kit_size})` : ''}` : '—'}</span>
                      <span style={{ border: '1px solid rgba(28,24,20,0.35)', borderRadius: 3, height: 18 }} />
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 12, color: '#6b6358' }}>
                Click <strong>Print Receiving List</strong> for the printable warehouse sheet — check off each line and write in what arrives.
              </div>
            </div>

            {/* Full receiving-sheet markup, kept OFF-SCREEN. Print source only:
                handlePrint copies printRef.innerHTML into a popup where PRINT_CSS +
                receivingCss are injected fresh. Off-screen (not display:none) so
                innerHTML is always populated. Page 1 ONLY — no per-day cards. */}
            <div ref={printRef} aria-hidden="true" style={{ position: 'absolute', left: -99999, top: 0, width: 800 }}>
              <div className="sow-page">
                <div className="sow-header">
                  <div className="sow-header-left" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <ScheduleCommandMark size={34} />
                    <div>
                      <h1>Warehouse <span>Receiving</span></h1>
                      <div style={{ fontSize: 11, color: '#b5a896', marginTop: 2, letterSpacing: '0.08em' }}>RECEIVING TICKET · CHECK IN EACH DELIVERY</div>
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
                  <div className="sow-info-item"><label>Received By</label><span>&nbsp;</span></div>
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
                        <div className="ct-col-hdr">Received</div>
                      </div>
                      {summary.map((m, i) => (
                        <div className="ct-row" key={m.name + i}>
                          <div className="ct-check" />
                          <div className="ct-idx">{i + 1}</div>
                          <div className="ct-mat-name">{m.name}</div>
                          <div className="ct-qty">{m.qty ? `${m.qty}${m.kit_size ? ` (${m.kit_size})` : ''}` : '—'}</div>
                          <div className="ct-received" />
                        </div>
                      ))}
                    </>
                  )}

                  <div className="ct-sign">
                    <div className="ct-sign-line">Received By&nbsp;&nbsp;·&nbsp;&nbsp;Date</div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
