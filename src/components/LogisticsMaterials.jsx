import { useEffect, useRef, useState, useCallback } from 'react'
import { loadJobMaterialLines, syncJobMaterialLines, updateJobMaterialLineField, addWarehouseMaterialLine, loadMaterialsCatalog } from '../lib/queries'
import CrewTicket from './CrewTicket'
import ReceivingTicket from './ReceivingTicket'

// DMS-1 Phase 3 Step 3 — the warehouse Logistics materials view. Reused by both
// the card's modal (MaterialsModal) and the JobDetail "Logistics" tab (one source
// of truth). Reads job_material_lines (seeded/refreshed from the SOW rollup on
// open) and edits the warehouse-owned columns; Needed + Flag are read-only.

export const STATUS_OPTIONS = ['Not Ordered', 'Ordered', 'In Stock', 'Delayed']

export function statusColor(status) {
  switch (status) {
    case 'Ordered': return '#2980b9'
    case 'In Stock': return '#27ae60'
    case 'Delayed': return '#e67e22'
    case 'Not Ordered': return '#c0392b'
    default: return '#8a7f73'
  }
}

// coverage_status (OK/SHORT/VERIFY|null) → the tri-state flag (§2 item 8).
function flagFor(coverageStatus) {
  switch (coverageStatus) {
    case 'OK': return { icon: '✓', color: '#27ae60', label: 'Covered' }
    case 'SHORT': return { icon: '⚠', color: '#c0392b', label: 'Short' }
    default: return { icon: '?', color: '#e67e22', label: "Can't tell" } // VERIFY / null
  }
}

// coverage_reason enum → a plain-English tooltip.
const REASON_TEXT = {
  NO_TASK_TAG: "Material isn't tagged to a task, so we can't compute how much is needed.",
  NO_TASK_SIZE: 'The tagged task has no size entered.',
  NO_COVERAGE: "The material's coverage rate is blank or unreadable.",
  UNIT_MISMATCH: "The coverage rate's unit doesn't match the task's unit.",
  UNIT_UNSUPPORTED: "The task's unit isn't SQFT or LF.",
}

// Needed display: exact quotient rounded for readability; '—' when can't-tell.
function fmtNeeded(qty) {
  if (qty == null) return '—'
  return Number.isInteger(qty) ? String(qty) : (Math.round(qty * 100) / 100).toString()
}

export default function LogisticsMaterials({ job, changedBy, onUpdated }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [catalog, setCatalog] = useState([])
  const [addOpen, setAddOpen] = useState(false)
  const [addQuery, setAddQuery] = useState('')
  const [ticketOpen, setTicketOpen] = useState(false)
  const [receivingOpen, setReceivingOpen] = useState(false)

  const reload = useCallback(async () => {
    const { data, error } = await loadJobMaterialLines(job.job_id)
    if (error) setError(error.message)
    else setRows(data)
  }, [job.job_id])

  // On open: seed/refresh the tracker from the current SOW, then read it back.
  useEffect(() => {
    let active = true
    setLoading(true)
    ;(async () => {
      const { error: syncErr } = await syncJobMaterialLines(job.job_id, changedBy)
      if (syncErr) { if (active) { setError(syncErr.message); setLoading(false) }; return }
      const { data, error: loadErr } = await loadJobMaterialLines(job.job_id)
      if (!active) return
      if (loadErr) setError(loadErr.message)
      else setRows(data)
      setLoading(false)
    })()
    return () => { active = false }
  }, [job.job_id, changedBy])

  const updateField = useCallback(async (materialKey, field, value) => {
    const { error } = await updateJobMaterialLineField(job.job_id, materialKey, { [field]: value }, changedBy)
    if (error) { alert('Error updating: ' + error.message); return }
    await reload()               // qty_ordered edits re-derive coverage_status → reload
    onUpdated && onUpdated()
  }, [job.job_id, changedBy, reload, onUpdated])

  // Warehouse-add (Step 4, R5): catalog pick → direct unassigned tracker row.
  useEffect(() => {
    let alive = true
    loadMaterialsCatalog().then(({ data }) => { if (alive) setCatalog(data || []) })
    return () => { alive = false }
  }, [])

  const addMaterial = useCallback(async (item) => {
    const { error } = await addWarehouseMaterialLine(job.job_id, item, changedBy)
    if (error) { alert('Error adding: ' + error.message); return }
    setAddOpen(false); setAddQuery('')
    await reload()
    onUpdated && onUpdated()
  }, [job.job_id, changedBy, reload, onUpdated])

  const undecided = rows.filter(m => m.status == null || ['Not Ordered', 'Delayed'].includes(m.status)).length

  if (loading) return <div style={{ fontSize: 13, color: '#6b6358', padding: '20px 0' }}>Loading logistics…</div>
  if (error) return <div className="error-msg">Error: {error}</div>

  const catalogMatches = (catalog || [])
    .filter(m => m && m.name)
    .filter(m => {
      const query = addQuery.trim().toLowerCase()
      if (!query) return true
      return `${m.name} ${m.kit_size || ''} ${m.supplier || ''}`.toLowerCase().includes(query)
    })
    .slice(0, 12)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 10 }}>
        <button className="app-act-btn" onClick={() => setReceivingOpen(true)}>Print Receiving List</button>
        <button className="app-act-btn app-act-primary" onClick={() => setTicketOpen(true)}>Print Ticket</button>
      </div>
      {ticketOpen && <CrewTicket jobId={job.job_id} onClose={() => setTicketOpen(false)} />}
      {receivingOpen && <ReceivingTicket jobId={job.job_id} onClose={() => setReceivingOpen(false)} />}
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: '#5a5249', padding: '12px 0' }}>
          No materials on this job's SOW yet. Add them in the Field SOW, or use “Add material” below.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: undecided ? '#c0392b' : '#27ae60', marginBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            {undecided ? `${undecided} undecided` : 'all decided'}
          </div>
          <table className="mat-table">
            <thead>
              <tr>
                <th>Material</th>
                <th>Kit</th>
                <th>Needed</th>
                <th>Ordered</th>
                <th>Status</th>
                <th title="Coverage flag">Flag</th>
                <th>Arrival</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(m => <LogisticsRow key={m.material_key} mat={m} onFieldUpdate={updateField} />)}
            </tbody>
          </table>
        </>
      )}

      {/* Step 4 — warehouse add (unassigned; enter Ordered directly) */}
      <div style={{ marginTop: 10 }}>
        {!addOpen ? (
          <button className="app-act-btn" onClick={() => setAddOpen(true)}>+ Add material</button>
        ) : (
          <div style={{ border: '1px solid rgba(28,24,20,0.18)', borderRadius: 8, padding: 10, background: 'var(--bg-card, #c8bcaa)' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <input
                autoFocus type="text" placeholder="Search catalog…" value={addQuery}
                onChange={e => setAddQuery(e.target.value)}
                style={{ flex: 1, border: '1.5px solid rgba(28,24,20,0.2)', borderRadius: 6, padding: '6px 10px', fontSize: 13, background: 'var(--input-bg, #bfb3a1)', color: '#1c1814', outline: 'none' }}
              />
              <button className="app-act-btn" onClick={() => { setAddOpen(false); setAddQuery('') }}>Cancel</button>
            </div>
            <div style={{ maxHeight: 220, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {catalogMatches.length === 0 ? (
                <div style={{ fontSize: 12, color: '#6b6358', padding: '6px 2px' }}>
                  {addQuery.trim() ? 'No catalog materials match.' : 'No saved materials in the catalog.'}
                </div>
              ) : catalogMatches.map(item => (
                <button
                  key={item.id}
                  onClick={() => addMaterial(item)}
                  style={{ textAlign: 'left', border: '1px solid rgba(28,24,20,0.15)', borderRadius: 6, padding: '6px 10px', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: '#1c1814' }}
                >
                  <strong>{item.name}</strong>{item.kit_size ? ` · ${item.kit_size}` : ''}{item.supplier ? ` · ${item.supplier}` : ''}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: '#6b6358', marginTop: 6 }}>
              Added materials aren't tagged to a task — they show “can't-tell” and you enter Ordered directly.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function LogisticsRow({ mat, onFieldUpdate }) {
  const [localNotes, setLocalNotes] = useState(mat.notes || '')
  const [localArrival, setLocalArrival] = useState(mat.arrival_date || '')
  const [localOrdered, setLocalOrdered] = useState(mat.qty_ordered ?? '')
  const notesTimer = useRef(null)
  const orderedTimer = useRef(null)

  useEffect(() => {
    setLocalNotes(mat.notes || '')
    setLocalArrival(mat.arrival_date || '')
    setLocalOrdered(mat.qty_ordered ?? '')
  }, [mat.notes, mat.arrival_date, mat.qty_ordered])

  // Clear pending debounced writes on unmount (T5 hardening).
  useEffect(() => () => { clearTimeout(notesTimer.current); clearTimeout(orderedTimer.current) }, [])

  const handleNotesChange = (e) => {
    const val = e.target.value
    setLocalNotes(val)
    clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(() => onFieldUpdate(mat.material_key, 'notes', val), 600)
  }
  const handleArrivalChange = (e) => {
    const val = e.target.value
    setLocalArrival(val)
    onFieldUpdate(mat.material_key, 'arrival_date', val || null)
  }
  const handleOrderedChange = (e) => {
    const val = e.target.value
    setLocalOrdered(val)
    clearTimeout(orderedTimer.current)
    // Clamp ≥ 0 (T5): the DB qty_nonneg_chk rejects negatives — never send one.
    orderedTimer.current = setTimeout(() => onFieldUpdate(mat.material_key, 'qty_ordered', val === '' ? null : Math.max(0, parseFloat(val) || 0)), 600)
  }

  const color = statusColor(mat.status)
  const flag = flagFor(mat.coverage_status)
  const reason = mat.coverage_status === 'OK' || mat.coverage_status === 'SHORT'
    ? flag.label
    : (REASON_TEXT[mat.coverage_reason] || "Can't compute how much is needed.")

  return (
    <tr className="mat-row">
      <td className="mat-cell-name">{mat.name}</td>
      <td className="mat-cell-kit">{mat.kit_size || ''}</td>
      <td className="mat-cell-qty" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{fmtNeeded(mat.qty_needed)}</td>
      <td className="mat-cell-qty">
        <input
          type="number" min="0" className="mat-notes-input" value={localOrdered} onChange={handleOrderedChange}
          placeholder="0" style={{ width: 64, textAlign: 'center' }}
        />
      </td>
      <td className="mat-cell-status">
        <select
          className="mat-status-select"
          value={mat.status || 'Not Ordered'}
          onChange={e => onFieldUpdate(mat.material_key, 'status', e.target.value)}
          style={{ borderColor: color, color }}
        >
          {STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </td>
      <td className="mat-cell-flag" style={{ textAlign: 'center' }}>
        <span title={reason} style={{ color: flag.color, fontWeight: 700, fontSize: 15, cursor: 'help' }}>{flag.icon}</span>
      </td>
      <td className="mat-cell-arrival">
        <input type="date" className="mat-arrival-input" value={localArrival} onChange={handleArrivalChange} />
      </td>
      <td className="mat-cell-notes">
        <input type="text" className="mat-notes-input" value={localNotes} onChange={handleNotesChange} placeholder="Notes..." />
      </td>
    </tr>
  )
}
