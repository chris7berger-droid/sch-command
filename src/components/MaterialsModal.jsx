import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
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

// ISO "2026-07-07" → "Jul 7" (local-parse, no TZ shift). null on empty/invalid.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDate(iso) {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`
}

// SOW-rollup grouping key (a material at a different kit size is a distinct row
// for quantity/spec purposes).
const matKey = (name, kit) => `${(name || '').trim().toLowerCase()}|${(kit || '').trim().toLowerCase()}`
// Order-tracking bridge key. The materials table only has name (no kit_size
// column), so status is matched/stored by name alone.
const nameKey = (name) => (name || '').trim().toLowerCase()

// Aggregate the Field SOW's per-day materials (job_wtcs[*].field_sow[day].materials,
// or legacy jobs.field_sow) into ONE row per material: summed quantity, which days
// it's needed (with per-day qty), and representative specs. This is the shop
// manager's "what do I order and when" view; order status is bridged separately
// to the materials table (see setTracking). Read-only against the SOW — the SOW
// stays the source of truth for specs/quantities.
function rollupSowMaterials(job) {
  const wtcs = Array.isArray(job?._wtcs) ? job._wtcs : []
  const sources = wtcs.length
    ? wtcs.map(w => ({ wtName: w.work_type_name || null, days: Array.isArray(w.field_sow) ? w.field_sow : [] }))
    : [{ wtName: null, days: Array.isArray(job?.field_sow) ? job.field_sow : [] }]

  const SPEC_KEYS = ['coverage_rate', 'mils', 'mix_time', 'mix_speed', 'cure_time']
  const byKey = new Map()
  for (const src of sources) {
    src.days.forEach((day, di) => {
      const dayLabel = day.day_label || `Day ${di + 1}`
      const dayDate = day.date || null
      for (const m of (day.materials || [])) {
        const name = (m?.name || '').trim()
        if (!name) continue
        const key = matKey(name, m.kit_size)
        let g = byKey.get(key)
        if (!g) {
          g = { key, name, kit_size: m.kit_size || '', totalQty: 0, days: [], coverage_rate: '', mils: '', mix_time: '', mix_speed: '', cure_time: '' }
          byKey.set(key, g)
        }
        const qty = parseFloat(m.qty_planned) || 0
        g.totalQty += qty
        g.days.push({ wtName: src.wtName, dayLabel, dayDate, qty })
        // First non-empty (and non-zero for numeric) value wins — specs are
        // usually identical per material across days.
        for (const spec of SPEC_KEYS) {
          if (!g[spec]) {
            const v = m[spec]
            if (v != null && String(v).trim() !== '' && String(v) !== '0') g[spec] = v
          }
        }
      }
    })
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export default function MaterialsModal({ job, onClose, onUpdated }) {
  const rollup = useMemo(() => rollupSowMaterials(job), [job])
  const [statusRows, setStatusRows] = useState([])   // materials table rows = order-tracking ledger
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Load the order-tracking ledger (materials table) for this job. The async work
  // lives inside an IIFE so no setState runs synchronously in the effect body.
  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('materials')
        .select('*')
        .eq('job_id', job.job_id)
        .order('ordinal', { ascending: true })
      if (!active) return
      if (error) setError(error.message)
      else setStatusRows(data || [])
      setLoading(false)
    })()
    return () => { active = false }
  }, [job.job_id])

  const rowByKey = useMemo(() => {
    const m = new Map()
    for (const r of statusRows) m.set(nameKey(r.name), r)
    return m
  }, [statusRows])

  const nextOrdinal = useMemo(
    () => statusRows.reduce((mx, r) => Math.max(mx, r.ordinal ?? 0), 0) + 1,
    [statusRows]
  )

  // Bridge an order-tracking field (status/arrival_date/notes) to the materials
  // table, keyed by material name+kit. Update the matched row, or lazily insert a
  // tracking row for a SOW material that has none yet. Specs are NOT copied here
  // (they live in the SOW; copying would drift) — the row only carries order state.
  const setTracking = useCallback(async (mat, field, value) => {
    const existing = rowByKey.get(nameKey(mat.name))
    if (existing) {
      const { error } = await supabase
        .from('materials')
        .update({ [field]: value })
        .eq('job_id', job.job_id)
        .eq('ordinal', existing.ordinal)
      if (error) { alert('Error updating: ' + error.message); return }
      setStatusRows(prev => prev.map(r => r.ordinal === existing.ordinal ? { ...r, [field]: value } : r))
    } else {
      // Only real materials columns (job_id, ordinal, name, status, arrival_date,
      // notes) — the table has no kit_size/spec columns; those stay in the SOW.
      const row = {
        job_id: job.job_id, ordinal: nextOrdinal,
        name: mat.name, status: 'Not Ordered', [field]: value,
      }
      const { data, error } = await supabase.from('materials').insert(row).select()
      if (error) { alert('Error saving: ' + error.message); return }
      setStatusRows(prev => [...prev, ...(data && data.length ? data : [row])])
    }
    onUpdated && onUpdated()
  }, [rowByKey, nextOrdinal, job.job_id, onUpdated])

  const undecided = rollup.filter(mat => {
    const st = rowByKey.get(nameKey(mat.name))?.status || 'Not Ordered'
    return st === 'Not Ordered' || st === 'Delayed'
  }).length

  return (
    <div className="mbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mdl mdl-wide" style={{ maxWidth: 760, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12 }}>
          <h3 style={{ margin: 0 }}>
            Materials — {job.job_num || ''} {job.job_name || ''}
            {rollup.length > 0 && (
              <span style={{ fontSize: 12, color: undecided ? '#c0392b' : '#27ae60', marginLeft: 10, fontFamily: "'JetBrains Mono', monospace" }}>
                {undecided ? `${undecided} to order` : 'all ordered'}
              </span>
            )}
          </h3>
          <button className="app-act-btn" onClick={onClose}>Close</button>
        </div>

        {loading && <div style={{ fontSize: 13, color: '#6b6358', padding: '20px 0' }}>Loading materials…</div>}
        {error && <div className="error-msg">Error: {error}</div>}

        {!loading && !error && rollup.length === 0 && (
          <div style={{ fontSize: 13, color: '#5a5249', padding: '20px 0' }}>
            No materials in this job&apos;s SOW yet. Add them under <strong>SOW → Materials for this day</strong>.
          </div>
        )}

        {!loading && !error && rollup.length > 0 && (
          <div className="mm-list">
            {rollup.map(mat => (
              <MaterialCard
                key={mat.key}
                mat={mat}
                track={rowByKey.get(nameKey(mat.name))}
                onSet={setTracking}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function specChips(mat) {
  const chips = []
  if (mat.coverage_rate) chips.push(['Coverage', mat.coverage_rate])
  if (mat.mils) chips.push(['Mils', mat.mils])
  if (mat.mix_time) chips.push(['Mix time', `${mat.mix_time} min`])
  if (mat.mix_speed) chips.push(['Mix speed', mat.mix_speed])
  if (mat.cure_time) chips.push(['Cure', mat.cure_time])
  return chips
}

function MaterialCard({ mat, track, onSet }) {
  const status = track?.status || 'Not Ordered'
  const [arrival, setArrival] = useState(track?.arrival_date || '')
  const [notes, setNotes] = useState(track?.notes || '')
  const arrivalTimer = useRef(null)
  const notesTimer = useRef(null)

  // Re-sync local editable fields when the underlying tracking row changes
  // (e.g. after a lazy insert or external refresh). Remounting via key would drop
  // focus mid-type, so a guarded effect is the right tool here.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setArrival(track?.arrival_date || '')
    setNotes(track?.notes || '')
  }, [track?.arrival_date, track?.notes])
  /* eslint-enable react-hooks/set-state-in-effect */

  const onArrival = (e) => {
    const val = e.target.value
    setArrival(val)
    clearTimeout(arrivalTimer.current)
    arrivalTimer.current = setTimeout(() => onSet(mat, 'arrival_date', val || null), 600)
  }
  const onNotes = (e) => {
    const val = e.target.value
    setNotes(val)
    clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(() => onSet(mat, 'notes', val), 600)
  }

  const color = statusColor(status)
  const chips = specChips(mat)

  return (
    <div className="mm-card">
      <div className="mm-card-head">
        <span className="mm-name">{mat.name}</span>
        {mat.kit_size && <span className="mm-kit">{mat.kit_size}</span>}
        <select
          className="mm-status"
          value={status}
          onChange={e => onSet(mat, 'status', e.target.value)}
          style={{ borderColor: color, color }}
        >
          {STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </div>

      <div className="mm-qty">
        <span className="mm-qty-total">{mat.totalQty}</span> kits total
        <span className="mm-qty-sub"> · needed on {mat.days.length} day{mat.days.length === 1 ? '' : 's'}</span>
      </div>

      <div className="mm-days">
        {mat.days.map((d, i) => (
          <span key={i} className="mm-day-chip">
            {d.wtName ? `${d.wtName} · ` : ''}{d.dayLabel}{fmtDate(d.dayDate) ? ` (${fmtDate(d.dayDate)})` : ''}
            <span className="mm-day-qty">×{d.qty}</span>
          </span>
        ))}
      </div>

      {chips.length > 0 && (
        <div className="mm-specs">
          {chips.map(([label, val]) => (
            <span key={label} className="mm-spec"><span className="mm-spec-lbl">{label}</span> {val}</span>
          ))}
        </div>
      )}

      <div className="mm-order">
        <label className="mm-order-field">
          <span className="mm-order-lbl">Arrival</span>
          <input type="date" className="mm-order-input" value={arrival} onChange={onArrival} />
        </label>
        <label className="mm-order-field mm-order-notes">
          <span className="mm-order-lbl">Notes</span>
          <input type="text" className="mm-order-input" value={notes} placeholder="e.g. from ACME, PO #123" onChange={onNotes} />
        </label>
      </div>
    </div>
  )
}
