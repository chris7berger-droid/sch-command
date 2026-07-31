import { useEffect, useState, useCallback } from 'react'
import { loadTenantAssets, loadJobAssets, addJobAsset, setJobAssetAvailable, removeJobAsset } from '../lib/queries'

// DMS-1 Phase 3 Step 5 — assign tenant vehicles/equipment/power to a job.
// Pick-many from the live tenant_* lists; each assignment carries a per-job
// Available/Unavailable toggle. Writes job_assets (a cross-tenant asset is blocked
// by the DB trigger). Old free-text jobs.vehicle/equipment/power_source stay
// readable elsewhere (Overview) — not stripped.

const TYPES = [
  { key: 'vehicle', label: 'Vehicles', listKey: 'vehicles' },
  { key: 'equipment', label: 'Equipment', listKey: 'equipment' },
  { key: 'power', label: 'Power', listKey: 'power' },
]

export default function LogisticsAssets({ job, changedBy }) {
  const [lists, setLists] = useState({ vehicles: [], equipment: [], power: [] })
  const [assigned, setAssigned] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reloadAssigned = useCallback(async () => {
    const { data, error } = await loadJobAssets(job.job_id)
    if (error) setError(error.message)
    else setAssigned(data)
  }, [job.job_id])

  useEffect(() => {
    let alive = true
    setLoading(true)
    ;(async () => {
      const [la, ja] = await Promise.all([loadTenantAssets(), loadJobAssets(job.job_id)])
      if (!alive) return
      if (la.error || ja.error) setError((la.error || ja.error).message)
      else { setLists({ vehicles: la.vehicles, equipment: la.equipment, power: la.power }); setAssigned(ja.data) }
      setLoading(false)
    })()
    return () => { alive = false }
  }, [job.job_id])

  const nameFor = (type, id) => {
    const lk = TYPES.find(t => t.key === type)?.listKey
    return (lists[lk] || []).find(a => String(a.id) === String(id))?.name || '(removed)'
  }

  const add = async (type, id) => {
    if (!id) return
    const { error } = await addJobAsset(job.job_id, type, id, changedBy)
    if (error) { alert('Error: ' + error.message); return }
    await reloadAssigned()
  }
  const toggle = async (row) => {
    const { error } = await setJobAssetAvailable(job.job_id, row.id, !row.available, changedBy)
    if (error) { alert('Error: ' + error.message); return }
    await reloadAssigned()
  }
  const remove = async (row) => {
    const { error } = await removeJobAsset(job.job_id, row.id, changedBy)
    if (error) { alert('Error: ' + error.message); return }
    await reloadAssigned()
  }

  if (loading) return <div style={{ fontSize: 13, color: '#6b6358', padding: '12px 0' }}>Loading assets…</div>
  if (error) return <div className="error-msg">Error: {error}</div>

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#1c1814', borderBottom: '2px solid #30cfac', paddingBottom: 4, marginBottom: 10 }}>
        Trucks · Equipment · Power
      </div>
      {TYPES.map(t => {
        const rowsForType = assigned.filter(a => a.asset_type === t.key)
        const assignedIds = new Set(rowsForType.map(a => String(a.asset_id)))
        const options = (lists[t.listKey] || []).filter(a => !assignedIds.has(String(a.id)))
        return (
          <div key={t.key} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#887c6e', marginBottom: 6 }}>{t.label}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              {rowsForType.map(row => (
                <span key={row.id} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 8, padding: '4px 8px 4px 12px',
                  border: `1px solid ${row.available ? 'rgba(28,24,20,0.2)' : '#c0392b'}`,
                  background: row.available ? 'var(--bg-card, #c8bcaa)' : 'rgba(192,57,34,0.08)',
                }}>
                  <span style={{ fontSize: 13, color: '#1c1814', textDecoration: row.available ? 'none' : 'line-through' }}>{nameFor(t.key, row.asset_id)}</span>
                  <button
                    onClick={() => toggle(row)}
                    title={row.available ? 'Mark unavailable' : 'Mark available'}
                    style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', border: '1px solid rgba(28,24,20,0.2)', borderRadius: 5, padding: '2px 6px', cursor: 'pointer', background: 'transparent', color: row.available ? '#5BBD3F' : '#c0392b' }}
                  >{row.available ? 'Available' : 'Unavailable'}</button>
                  <button onClick={() => remove(row)} title="Remove" style={{ background: 'none', border: 'none', color: '#887c6e', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>×</button>
                </span>
              ))}
              {rowsForType.length === 0 && <span style={{ fontSize: 12, color: '#887c6e' }}>None assigned</span>}
              <select
                value=""
                onChange={e => { add(t.key, e.target.value); e.target.value = '' }}
                style={{ border: '1.5px solid rgba(28,24,20,0.2)', borderRadius: 6, padding: '5px 8px', fontSize: 13, background: 'var(--input-bg, #bfb3a1)', color: '#1c1814', fontFamily: 'inherit', outline: 'none' }}
              >
                <option value="">+ Add {t.label.toLowerCase().replace(/s$/, '')}…</option>
                {options.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
        )
      })}
    </div>
  )
}
