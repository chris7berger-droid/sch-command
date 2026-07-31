import { useEffect, useState, useCallback } from 'react'
import { loadTenantAssetList, addTenantAsset, renameTenantAsset, deactivateTenantAsset } from '../lib/queries'

// DMS-1 Phase 3 Step 6 — minimal per-tenant asset-list editor over the live
// tenant_vehicles/equipment/power tables (no schema work). "Delete" is a
// soft-delete (active=false) — a forbid-hard-delete guard blocks real deletes.
// Feeds the Step-5 asset picker in the Logistics tab.

const LISTS = [
  { type: 'vehicle', label: 'Vehicles', hint: 'e.g. F-350 + trailer' },
  { type: 'equipment', label: 'Equipment', hint: 'e.g. Ride-on grinder' },
  { type: 'power', label: 'Power', hint: 'e.g. 20kW generator' },
]

function AssetList({ type, label, hint }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [newName, setNewName] = useState('')
  const [editId, setEditId] = useState(null)
  const [editName, setEditName] = useState('')

  const reload = useCallback(async () => {
    const { data, error } = await loadTenantAssetList(type)
    if (error) setError(error.message)
    else setItems(data)
    setLoading(false)
  }, [type])

  useEffect(() => { reload() }, [reload])

  const add = async () => {
    if (!newName.trim()) return
    const { error } = await addTenantAsset(type, newName)
    if (error) { alert('Error adding: ' + error.message); return }
    setNewName(''); await reload()
  }
  const saveRename = async (id) => {
    if (!editName.trim()) { setEditId(null); return }
    const { error } = await renameTenantAsset(type, id, editName)
    if (error) { alert('Error renaming: ' + error.message); return }
    setEditId(null); await reload()
  }
  const remove = async (id, name) => {
    if (!confirm(`Remove "${name}" from ${label}? It stays on jobs already using it.`)) return
    const { error } = await deactivateTenantAsset(type, id)
    if (error) { alert('Error removing: ' + error.message); return }
    await reload()
  }

  return (
    <div className="jd-section" style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 15, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#1c1814', marginBottom: 10 }}>{label}</div>
      {error && <div className="error-msg">Error: {error}</div>}
      {loading ? (
        <div style={{ fontSize: 13, color: '#6b6358' }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {items.length === 0 && <div style={{ fontSize: 13, color: '#887c6e' }}>None yet.</div>}
          {items.map(it => (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {editId === it.id ? (
                <>
                  <input
                    autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveRename(it.id); if (e.key === 'Escape') setEditId(null) }}
                    style={{ flex: 1, border: '1.5px solid rgba(28,24,20,0.2)', borderRadius: 6, padding: '5px 8px', fontSize: 13, background: 'var(--input-bg, #bfb3a1)', color: '#1c1814', outline: 'none' }}
                  />
                  <button className="app-act-btn app-act-primary" onClick={() => saveRename(it.id)}>Save</button>
                  <button className="app-act-btn" onClick={() => setEditId(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontSize: 14, color: '#1c1814' }}>{it.name}</span>
                  <button className="app-act-btn" onClick={() => { setEditId(it.id); setEditName(it.name) }}>Rename</button>
                  <button className="app-act-btn" onClick={() => remove(it.id, it.name)} title="Soft-delete">Remove</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={newName} onChange={e => setNewName(e.target.value)} placeholder={`Add — ${hint}`}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          style={{ flex: 1, border: '1.5px solid rgba(28,24,20,0.2)', borderRadius: 6, padding: '6px 10px', fontSize: 13, background: 'var(--input-bg, #bfb3a1)', color: '#1c1814', outline: 'none' }}
        />
        <button className="app-act-btn app-act-primary" onClick={add} disabled={!newName.trim()}>Add</button>
      </div>
    </div>
  )
}

export default function Settings() {
  return (
    <div className="jd-wrap" style={{ maxWidth: 720 }}>
      <div className="jd-header">
        <div className="jd-title-row">
          <span className="jd-name">Logistics Assets</span>
        </div>
      </div>
      <div style={{ fontSize: 13, color: '#6b6358', margin: '0 0 16px' }}>
        Manage the trucks, equipment, and power your crews can be assigned. These feed the Logistics picker on each job.
      </div>
      {LISTS.map(l => <AssetList key={l.type} {...l} />)}
    </div>
  )
}
