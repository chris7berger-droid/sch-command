import { useState, useEffect } from 'react'
import FieldSowBuilder from './FieldSowBuilder'
import { updateJobWtcFieldSow, updateJobField, hasFieldSow, loadMaterialsCatalog } from '../lib/queries'

// In-card Field SOW editor (remediation §6.1 step 1). The card path users
// actually reach. Hosts ONE FieldSowBuilder per job_wtcs row (WTC tabs), each
// writing canonical job_wtcs via updateJobWtcFieldSow. Legacy zero-WTC jobs
// fall back to a single builder bound to jobs.field_sow (Finding E). This is
// the design's intended in-card SOW modal (staged_ready_card_design.md §3.5),
// replacing the merged-jobs.field_sow FieldSowModal editor.
export default function CardSowModal({
  job, proposalMaterials = [], changedBy,
  initialWtcId = null, initialDayIndex = null,   // Option-3 focus (DaysModal handoff, step 4)
  onClose, onUpdated, onPrint,
}) {
  const wtcs = Array.isArray(job._wtcs) ? job._wtcs : []

  // Local copies so in-place saves re-render the tabs without a full reload.
  const [localWtcs, setLocalWtcs] = useState(wtcs)
  const [localFieldSow, setLocalFieldSow] = useState(job.field_sow)  // legacy fallback
  const [activeWtcId, setActiveWtcId] = useState(() => {
    if (initialWtcId != null && wtcs.some(w => String(w.id) === String(initialWtcId))) return initialWtcId
    return wtcs[0]?.id ?? null
  })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)

  // Material Memory (Sales-owned materials_catalog), loaded once for every day's
  // materials picker so Schedule reuses the same saved materials as Sales.
  const [catalog, setCatalog] = useState([])
  useEffect(() => {
    let alive = true
    loadMaterialsCatalog().then(({ data }) => { if (alive) setCatalog(data || []) })
    return () => { alive = false }
  }, [])

  // Finding F: a save that empties a Ready job's SOW also clears
  // ready_confirmed_at (handler-side, NOT a trigger) + toasts. "Empties" =
  // hasFieldSow(post-save job) is false. [L1] on clear error, surface (log) —
  // the UI self-corrects via the WTC-aware predicate; only the stored flag is at risk.
  const maybeDemote = async (nextWtcs, nextParentSow) => {
    if (job.ready_confirmed_at == null) return
    const postSaveJob = { ...job, _wtcs: nextWtcs, field_sow: nextParentSow }
    if (hasFieldSow(postSaveJob)) return
    const { error } = await updateJobField(job.job_id, 'ready_confirmed_at', null, changedBy)
    if (error) console.error('SOW-empty demote: ready_confirmed_at clear failed', error)
    setToast('All SOW removed — this job has moved back to Staged.')
  }

  const saveWtc = async (wtc, next) => {
    setSaving(true)
    const { error } = await updateJobWtcFieldSow(wtc.id, next, changedBy)
    if (error) { console.error(error); setSaving(false); return }
    const nextWtcs = localWtcs.map(w => w.id === wtc.id ? { ...w, field_sow: next } : w)
    setLocalWtcs(nextWtcs)
    await maybeDemote(nextWtcs, job.field_sow)
    setSaving(false)
    if (onUpdated) onUpdated()
  }

  const saveLegacy = async (next) => {
    setSaving(true)
    // Allowlisted legacy/mirror writer (§7.1) — zero-WTC jobs only.
    const { error } = await updateJobField(job.job_id, 'field_sow', next, changedBy)
    if (error) { console.error(error); setSaving(false); return }
    setLocalFieldSow(next)
    await maybeDemote([], next)
    setSaving(false)
    if (onUpdated) onUpdated()
  }

  const activeWtc = localWtcs.find(w => String(w.id) === String(activeWtcId)) || localWtcs[0] || null
  const matsFor = (wtc) => proposalMaterials.filter(m => String(m._wtc_id) === String(wtc.proposal_wtc_id))

  return (
    <div className="mbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mdl mdl-lg">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#1c1814', padding: '14px 20px', borderRadius: '8px 8px 0 0', borderBottom: '3px solid #30cfac' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', letterSpacing: '0.04em' }}>
            FIELD SOW <span style={{ color: '#30cfac' }}>{job.job_num || job.job_name || ''}</span>
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {onPrint && <button className="app-act-btn" onClick={onPrint}>Print PDF</button>}
            <button className="app-act-btn" onClick={onClose}>Close</button>
          </div>
        </div>

        {toast && (
          <div style={{ background: '#1c1814', color: '#30cfac', fontSize: 12.5, fontWeight: 600, padding: '8px 20px', letterSpacing: '0.02em' }}>
            {toast}
          </div>
        )}

        <div style={{ padding: 16 }}>
          {localWtcs.length > 0 ? (
            <>
              {localWtcs.length > 1 && (
                <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                  {localWtcs.map(w => {
                    const active = String(w.id) === String(activeWtc?.id)
                    return (
                      <button
                        key={w.id}
                        onClick={() => setActiveWtcId(w.id)}
                        style={{
                          fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                          padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                          border: active ? '1px solid #30cfac' : '1px solid var(--border)',
                          background: active ? '#1c1814' : 'var(--bg-card)',
                          color: active ? '#30cfac' : 'var(--text-secondary)',
                        }}
                      >
                        {w.work_type_name || 'Work Type'}
                      </button>
                    )
                  })}
                </div>
              )}
              {activeWtc && (
                <FieldSowBuilder
                  key={activeWtc.id}                 /* Finding B — force remount on tab switch */
                  value={activeWtc.field_sow}
                  saving={saving}
                  availableMaterials={matsFor(activeWtc)}
                  catalog={catalog}
                  focusDayIndex={String(activeWtc.id) === String(initialWtcId) ? initialDayIndex : null}
                  onSave={(next) => saveWtc(activeWtc, next)}
                />
              )}
            </>
          ) : (
            /* Finding E — zero-WTC legacy fallback (binds jobs.field_sow) */
            <FieldSowBuilder
              key={job.job_id}
              value={localFieldSow}
              saving={saving}
              availableMaterials={proposalMaterials}
              catalog={catalog}
              onSave={saveLegacy}
            />
          )}
        </div>
      </div>
    </div>
  )
}
