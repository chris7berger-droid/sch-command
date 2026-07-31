import LogisticsMaterials from './LogisticsMaterials'

// DMS-1 Phase 3 Step 3 — repointed off the dead `materials` table to
// job_material_lines. Now a thin modal wrapper around the shared
// LogisticsMaterials view (also used by the JobDetail "Logistics" tab).
// Kept (not deleted) per plan Step 3 REG-3 — this is the card's Logistics editor.
export default function MaterialsModal({ job, changedBy = 'unknown', onClose, onUpdated }) {
  return (
    <div className="mbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mdl mdl-wide" style={{ maxWidth: 900, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Logistics — {job.job_num || ''} {job.job_name || ''}</h3>
          <button className="app-act-btn" onClick={onClose}>Close</button>
        </div>
        <LogisticsMaterials job={job} changedBy={changedBy} onUpdated={onUpdated} />
      </div>
    </div>
  )
}
