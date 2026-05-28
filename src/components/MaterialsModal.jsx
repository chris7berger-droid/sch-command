import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const STATUS_OPTIONS = ['Not Ordered', 'Ordered', 'In Stock', 'Delayed']

function statusColor(status) {
  switch (status) {
    case 'Ordered': return '#2980b9'
    case 'In Stock': return '#27ae60'
    case 'Delayed': return '#e67e22'
    case 'Not Ordered': return '#c0392b'
    default: return '#8a7f73'
  }
}

export default function MaterialsModal({ job, onClose, onUpdated }) {
  const [mats, setMats] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    ;(async () => {
      const { data, error } = await supabase
        .from('materials')
        .select('*')
        .eq('job_id', job.job_id)
        .order('ordinal', { ascending: true })
      if (!active) return
      if (error) setError(error.message)
      else setMats(data || [])
      setLoading(false)
    })()
    return () => { active = false }
  }, [job.job_id])

  // Live-save a single field (matches Materials.jsx UX); refresh the board
  // so the card's MTRL signal recomputes after the change.
  async function updateField(ordinal, field, value) {
    const { error } = await supabase
      .from('materials')
      .update({ [field]: value })
      .eq('job_id', job.job_id)
      .eq('ordinal', ordinal)
    if (error) { alert('Error updating: ' + error.message); return }
    setMats(prev => prev.map(m => m.ordinal === ordinal ? { ...m, [field]: value } : m))
    onUpdated && onUpdated()
  }

  const undecided = mats.filter(m => m.status === 'Not Ordered' || m.status === 'Delayed').length

  return (
    <div className="mbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mdl mdl-wide" style={{ maxWidth: 820, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>
            Materials — {job.job_num || ''} {job.job_name || ''}
            {mats.length > 0 && (
              <span style={{ fontSize: 12, color: undecided ? '#c0392b' : '#27ae60', marginLeft: 10, fontFamily: "'JetBrains Mono', monospace" }}>
                {undecided ? `${undecided} undecided` : 'all decided'}
              </span>
            )}
          </h3>
          <button className="app-act-btn" onClick={onClose}>Close</button>
        </div>

        {loading && <div style={{ fontSize: 13, color: '#6b6358', padding: '20px 0' }}>Loading materials…</div>}
        {error && <div className="error-msg">Error: {error}</div>}

        {!loading && !error && mats.length === 0 && (
          <div style={{ fontSize: 13, color: '#5a5249', padding: '20px 0' }}>
            No materials for this job. Add them from the Materials page (Upload SOW).
          </div>
        )}

        {!loading && !error && mats.length > 0 && (
          <table className="mat-table">
            <thead>
              <tr>
                <th>Material</th>
                <th>Kit Size</th>
                <th>Qty</th>
                <th>Status</th>
                <th>Arrival</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {mats.map(m => (
                <MaterialRow key={m.ordinal} mat={m} onFieldUpdate={updateField} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function MaterialRow({ mat, onFieldUpdate }) {
  const [localNotes, setLocalNotes] = useState(mat.notes || '')
  const [localArrival, setLocalArrival] = useState(mat.arrival_date || '')
  const notesTimer = useRef(null)
  const arrivalTimer = useRef(null)

  useEffect(() => {
    setLocalNotes(mat.notes || '')
    setLocalArrival(mat.arrival_date || '')
  }, [mat.notes, mat.arrival_date])

  const handleNotesChange = (e) => {
    const val = e.target.value
    setLocalNotes(val)
    clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(() => onFieldUpdate(mat.ordinal, 'notes', val), 600)
  }

  const handleArrivalChange = (e) => {
    const val = e.target.value
    setLocalArrival(val)
    clearTimeout(arrivalTimer.current)
    arrivalTimer.current = setTimeout(() => onFieldUpdate(mat.ordinal, 'arrival_date', val || null), 600)
  }

  const color = statusColor(mat.status)

  return (
    <tr className="mat-row">
      <td className="mat-cell-name">{mat.name}</td>
      <td className="mat-cell-kit">{mat.kit_size || ''}</td>
      <td className="mat-cell-qty">{mat.qty_ordered ?? ''}</td>
      <td className="mat-cell-status">
        <select
          className="mat-status-select"
          value={mat.status || 'Not Ordered'}
          onChange={e => onFieldUpdate(mat.ordinal, 'status', e.target.value)}
          style={{ borderColor: color, color }}
        >
          {STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
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
