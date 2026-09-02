// Mobilizations editor (Phase F, F2a). A mobilization = one trip to site
// (Mob 1, Mob 2…). Schedule OWNS the live job's trips post-send: this modal
// adds/edits them on job_mobilizations directly, never touching the frozen
// proposal or its lock. Two add actions (D3):
//   • + Add trip     — reschedules / adds sold work (is_go_back = false)
//   • + Add Go Back  — a tracked return trip: warranty / added work (is_go_back = true)
//
// The editable row list reads job_mobilizations rows DIRECTLY (loadJobMobilizationRows)
// — NOT the day-derived getJobMobilizations array (audit C1) — so a freshly-added
// dayless go-back is visible and taggable. The day-derived `mobs` prop is used only
// to enrich each row with its tagged-day count.

import { useEffect, useState, useCallback } from 'react'
import { loadJobMobilizationRows, addJobMobilization, updateJobMobilization, deleteJobMobilization, countPullTicketsForMob, loadMaterialsCatalog, computeMobCosts } from '../lib/queries'
import { useUser } from '../lib/user'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtMoney(n) {
  if (n == null || isNaN(n)) return '$0'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

// ISO "2026-07-28" → "Jul 28" (local-parse, no TZ shift). null on empty/invalid.
function fmtShort(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  if (!m) return null
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`
}

function rangeLabel(row) {
  const a = fmtShort(row.start_date)
  const b = fmtShort(row.end_date)
  if (!a && !b) return 'Dates TBD'
  return a && b && row.start_date === row.end_date ? a : `${a || 'TBD'} – ${b || 'TBD'}`
}

// Every mobilization_seq tagged on the job's field-SOW days (across all WTCs; legacy
// flat jobs.field_sow when a job has no WTCs). Used for (a) seq = max+1 over rows AND
// day tags (audit O2), and (b) the delete-time tagged-day scan.
function collectDaySeqs(job) {
  const out = []
  const wtcs = Array.isArray(job?._wtcs) ? job._wtcs : []
  const pushFrom = arr => { if (Array.isArray(arr)) for (const d of arr) { const s = d?.mobilization_seq; if (s != null) out.push(Number(s)) } }
  if (wtcs.length) for (const w of wtcs) pushFrom(w.field_sow)
  else pushFrom(job?.field_sow)
  return out
}

export default function MobsModal({ job, mobs = [], onClose, onUpdated }) {
  const user = useUser()
  const changedBy = user?.name || 'unknown'

  const [rows, setRows] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // The row being edited: { id | null(new), seq, label, start_date, end_date, is_go_back }.
  const [draft, setDraft] = useState(null)

  // Tagged-day count per seq, from the day-derived list (read-only enrichment).
  const dayCountBySeq = new Map((mobs || []).map(m => [m.seq, m.dayCount]))

  // Catalog for the go-back cost rollup (F3). Loaded once; cost is derived on read.
  const [catalog, setCatalog] = useState([])
  useEffect(() => {
    let alive = true
    loadMaterialsCatalog().then(({ data }) => { if (alive) setCatalog(data || []) })
    return () => { alive = false }
  }, [])
  const costsBySeq = computeMobCosts(job, catalog)

  const reload = useCallback(async () => {
    const { data } = await loadJobMobilizationRows(job.job_id)
    setRows(data)
    setLoaded(true)
  }, [job.job_id])

  useEffect(() => { reload() }, [reload])

  const nextSeq = () => Math.max(0, ...rows.map(r => r.seq || 0), ...collectDaySeqs(job)) + 1

  function startAdd(isGoBack) {
    setError(null)
    setDraft({ id: null, seq: nextSeq(), label: '', start_date: null, end_date: null, is_go_back: isGoBack })
  }

  function startEdit(row) {
    setError(null)
    setDraft({ id: row.id, seq: row.seq, label: row.label || '', start_date: row.start_date, end_date: row.end_date, is_go_back: row.is_go_back })
  }

  async function saveDraft() {
    if (!draft || busy) return
    // Validate the range (the <input min> is only a hint, T5 #3): a bad end can't persist.
    if (draft.start_date && draft.end_date && draft.end_date < draft.start_date) {
      setError('End date can’t be before the start date.')
      return
    }
    setBusy(true); setError(null)
    const payload = { label: draft.label, start_date: draft.start_date, end_date: draft.end_date }
    const res = draft.id == null
      ? await addJobMobilization(job.job_id, { seq: draft.seq, ...payload, is_go_back: draft.is_go_back }, changedBy)
      : await updateJobMobilization(job.job_id, { id: draft.id, seq: draft.seq, label: rows.find(r => r.id === draft.id)?.label }, payload, changedBy)
    if (res.error) { setError(res.error.message); setBusy(false); return }
    setDraft(null); setBusy(false)
    await reload()
    onUpdated?.()
  }

  async function removeRow(row) {
    if (busy) return
    setBusy(true); setError(null)
    // Part 1 (irreversible pull_tickets CASCADE) is the HARD BLOCK — check it FIRST,
    // before asking the user to confirm anything, so a blocked mob never shows a
    // pointless "delete anyway?" prompt (T5 #1). deleteJobMobilization re-checks it
    // as the authority regardless.
    const { count: ptCount, error: ptErr } = await countPullTicketsForMob(row.id)
    if (ptErr) { setError(ptErr.message); setBusy(false); return }
    if (ptCount > 0) {
      setBusy(false)
      window.alert(
        `Can't delete Mob ${row.seq} — it has ${ptCount} pull ticket${ptCount === 1 ? '' : 's'}. ` +
        `Deleting it would destroy those pull tickets and their numbering. Remove the pull tickets first.`
      )
      return
    }
    // Part 2 (recoverable): warn + confirm on field-SOW day tags.
    const taggedDays = collectDaySeqs(job).filter(s => s === row.seq).length
    if (taggedDays > 0 && !window.confirm(
      `Mob ${row.seq} — ${row.label || '(no label)'} is tagged on ${taggedDays} field-SOW day${taggedDays === 1 ? '' : 's'}. ` +
      `Deleting it leaves those days without a mobilization (you can re-tag them). Delete anyway?`
    )) { setBusy(false); return }
    const res = await deleteJobMobilization(job.job_id, row, changedBy)
    if (res.blocked) {
      // Race: a pull ticket appeared between the pre-check and here. Still honored.
      setBusy(false)
      window.alert(`Can't delete Mob ${row.seq} — it now has ${res.pullTicketCount} pull ticket(s). Remove them first.`)
      return
    }
    if (res.error) { setError(res.error.message); setBusy(false); return }
    setBusy(false)
    await reload()
    onUpdated?.()
  }

  const inp = {
    padding: '6px 8px', fontSize: 12, borderRadius: 5, boxSizing: 'border-box',
    background: 'var(--bg-card)', border: '1px solid rgba(28,24,20,0.22)', color: 'var(--text-primary)',
    fontFamily: 'var(--font-body, inherit)', WebkitAppearance: 'none',
  }
  const lbl = { fontSize: 10, fontWeight: 700, color: 'var(--text-light)', fontFamily: 'var(--font-heading)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }
  const secondaryBtn = { background: 'none', border: '1px solid rgba(28,24,20,0.28)', borderRadius: 6, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-heading)', color: 'var(--text-primary)', flexShrink: 0 }
  const deleteBtn = { ...secondaryBtn, border: '1px solid var(--danger)', color: 'var(--danger)' }

  const anyEditing = draft != null

  return (
    <div className="mbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mdl" style={{ maxWidth: 560, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0 }}>Mobilizations — {job.job_num || ''} {job.job_name || ''}</h3>
          <button className="app-act-btn" onClick={onClose}>Close</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-light)', fontFamily: 'var(--font-body, inherit)', marginBottom: 12 }}>
          Trips to site for this live job. Add a go-back (a tracked return trip — warranty or added work) or another trip to reschedule sold work. The signed proposal is never changed.
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button className="app-act-btn app-act-primary" disabled={!loaded || anyEditing || busy} onClick={() => startAdd(true)}>+ Add Go Back</button>
          <button className="app-act-btn" disabled={!loaded || anyEditing || busy} onClick={() => startAdd(false)}>+ Add trip</button>
        </div>

        {error && <div style={{ fontSize: 12, color: 'var(--danger)', fontFamily: 'var(--font-body, inherit)', marginBottom: 10 }}>{error}</div>}

        {!loaded ? (
          <div style={{ fontSize: 13, color: 'var(--text-light)', padding: '20px 0' }}>Loading…</div>
        ) : rows.length === 0 && !anyEditing ? (
          <div style={{ fontSize: 13, color: 'var(--text-light)', padding: '16px 0' }}>
            No mobilizations on this job yet. Add a trip or a go-back above.
          </div>
        ) : (
          <div className="mobs-list">
            {rows.map(row => {
              if (draft && draft.id === row.id) return renderEditor(row.seq)
              const dayCount = dayCountBySeq.get(row.seq)
              return (
                <div key={row.id} className="mobs-row" style={{ borderLeftColor: row.is_go_back ? 'var(--warning)' : 'var(--command-green)' }}>
                  <div className="mobs-seq">Mob {row.seq}</div>
                  <div className="mobs-body">
                    <div className="mobs-label">
                      {row.label || <span style={{ color: 'var(--text-light)', fontWeight: 400 }}>(no label)</span>}
                      {row.is_go_back && (
                        <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 5, background: 'var(--header-dark)', color: 'var(--teal, #30cfac)', fontFamily: 'var(--font-heading)' }}>Go Back</span>
                      )}
                    </div>
                    <div className="mobs-meta">{dayCount != null ? `${dayCount} day${dayCount === 1 ? '' : 's'} tagged` : 'No days tagged yet'}</div>
                    <div className="mobs-dates">{rangeLabel(row)}</div>
                    {row.is_go_back && (() => {
                      const c = costsBySeq[row.seq]
                      if (!c || c.dayCount === 0) return <div className="mobs-dates" style={{ color: 'var(--text-light)' }}>No cost yet — tag days to this go-back</div>
                      return (
                        <div className="mobs-dates" style={{ color: 'var(--command-green)', fontWeight: 600 }}>
                          Go-back cost: {fmtMoney(c.total)} <span style={{ color: 'var(--text-light)', fontWeight: 400 }}>({fmtMoney(c.materialCost)} materials + {fmtMoney(c.laborCost)} labor)</span>
                          {c.needsRate && <span style={{ color: 'var(--warning)', fontWeight: 700 }}> · needs labor rate</span>}
                          {c.unpriced && <span style={{ color: 'var(--warning)', fontWeight: 700 }}> · some materials unpriced</span>}
                        </div>
                      )
                    })()}
                  </div>
                  <button style={secondaryBtn} disabled={anyEditing || busy} onClick={() => startEdit(row)}>Edit</button>
                  <button style={deleteBtn} disabled={anyEditing || busy} onClick={() => removeRow(row)}>Delete</button>
                </div>
              )
            })}
            {draft && draft.id == null && renderEditor(draft.seq)}
          </div>
        )}
      </div>
    </div>
  )

  // Inline editor row (shared by add + edit). Teal-ish border marks the open row.
  function renderEditor(seq) {
    return (
      <div key={`edit-${draft.id ?? 'new'}`} className="mobs-row" style={{ alignItems: 'flex-end', gap: 8, borderLeftColor: draft.is_go_back ? 'var(--warning)' : 'var(--command-green)' }}>
        <div style={{ width: 46, flexShrink: 0 }}>
          <div style={lbl}>Mob</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--command-green)', fontFamily: 'var(--font-heading)' }}>{seq}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={lbl}>Label{draft.is_go_back ? ' (go back)' : ''}</div>
          <input autoFocus value={draft.label || ''} placeholder={draft.is_go_back ? 'e.g. Warranty return' : 'e.g. Punch list'} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} style={{ ...inp, width: '100%' }} />
        </div>
        <div style={{ width: 128, flexShrink: 0 }}>
          <div style={lbl}>Start</div>
          <input type="date" value={draft.start_date || ''} onChange={e => setDraft(d => ({ ...d, start_date: e.target.value || null }))} style={{ ...inp, width: '100%' }} />
        </div>
        <div style={{ width: 128, flexShrink: 0 }}>
          <div style={lbl}>End</div>
          <input type="date" value={draft.end_date || ''} min={draft.start_date || ''} onChange={e => setDraft(d => ({ ...d, end_date: e.target.value || null }))} style={{ ...inp, width: '100%' }} />
        </div>
        <button className="app-act-btn app-act-primary" disabled={busy} onClick={saveDraft}>Save</button>
        <button style={secondaryBtn} disabled={busy} onClick={() => { setDraft(null); setError(null) }}>Cancel</button>
      </div>
    )
  }
}
