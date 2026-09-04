// ─────────────────────────────────────────────────────────────────────────────
// Customer Onboarding / Import — match-to-existing mode (plan §4)
// ─────────────────────────────────────────────────────────────────────────────
// Upload the old schedule (YESv2 CSV tabs) → validate headers → match each old
// job to a real master record (call_log) with smart-assist candidates → save a
// draft that survives refresh → Apply (additive load). This screen NEVER deletes
// anything (R3-3); the one-time HDSP test-data wipe is a separate script.
//
// UX note: the plan sketches "drag left onto right"; we implement click-to-
// confirm from the ranked candidate list instead — same one-link result with the
// smart-assist confirm the plan requires, and far faster/steadier across ~120
// rows than drag. A right-pane search covers anything smart-assist misses.

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { useToast } from '../lib/toast'
import {
  YESV2_TABS, validateHeaders, transformJob, rankCandidates, tokenOverlap, baseNumber,
} from '../lib/yesv2Import.js'
import {
  loadRightPane, loadDraft, saveDraft, applyImport,
} from '../lib/importData.js'

const TAB_ORDER = ['Jobs', 'Assignments', 'BillingLog', 'CrewStatus']
const TAB_LABEL = { Jobs: 'Jobs', Assignments: 'Assignments', BillingLog: 'Billing Log', CrewStatus: 'Crew Status' }

// Parse an uploaded CSV/XLSX file → { headers, rows } using SheetJS. CSV cells
// come back as strings (dates stay as the sheet's text — the engine's wallDate
// tolerates both ISO and M/D/YYYY). Header keys preserve exact text incl. the
// real trailing space in 'Notes '.
function parseFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the file'))
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const headerMatrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })
        const headers = (headerMatrix[0] || []).map(h => String(h))
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false })
        resolve({ headers, rows })
      } catch (err) { reject(err) }
    }
    reader.readAsArrayBuffer(file)
  })
}

const DECISION = { UNMATCHED: null, INTERNAL: 'internal' } // else a call_log.id

export default function Import() {
  const toast = useToast()

  // uploaded[tab] = { fileName, headers, rows, validation }
  const [uploaded, setUploaded] = useState({})
  const [rightPane, setRightPane] = useState([])
  const [rightErr, setRightErr] = useState(null)
  const [loadingRight, setLoadingRight] = useState(true)
  // decisions: { [oldJobId]: call_log.id | 'internal' | undefined(unmatched) }
  const [decisions, setDecisions] = useState({})
  const [search, setSearch] = useState('')
  const [activeJob, setActiveJob] = useState(null) // oldJobId currently focused
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState(null)
  const [draftLoaded, setDraftLoaded] = useState(false)
  const saveTimer = useRef(null)

  // ── load right pane + any saved draft on mount ──
  useEffect(() => {
    let alive = true
    ;(async () => {
      const [{ data: cl, error }, { data: draft }] = await Promise.all([loadRightPane(), loadDraft()])
      if (!alive) return
      if (error) setRightErr(error.message || String(error))
      setRightPane(cl || [])
      setLoadingRight(false)
      if (draft && typeof draft === 'object') {
        if (draft.decisions) setDecisions(draft.decisions)
        if (draft.uploaded) setUploaded(draft.uploaded)
      }
      setDraftLoaded(true)
    })()
    return () => { alive = false }
  }, [])

  // ── autosave draft (debounced) once the initial draft load has happened ──
  useEffect(() => {
    if (!draftLoaded) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      // Persist decisions + a light record of what was uploaded (names/headers +
      // rows so a refresh keeps the matched set without re-uploading).
      const { error } = await saveDraft({ decisions, uploaded })
      if (error) console.warn('[import] draft save failed:', error.message)
    }, 800)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [decisions, uploaded, draftLoaded])

  // ── upload handler ──
  async function onUpload(tab, file) {
    if (!file) return
    try {
      const { headers, rows } = await parseFile(file)
      const validation = validateHeaders(tab, headers)
      setUploaded(prev => ({ ...prev, [tab]: { fileName: file.name, headers, rows, validation } }))
      if (!validation.ok) {
        toast(`${TAB_LABEL[tab]}: missing columns — ${validation.missing.join(', ')}`, 'err')
      } else {
        toast(`${TAB_LABEL[tab]}: ${rows.length} rows loaded`, 'ok')
      }
    } catch (err) {
      toast(`Could not read ${file.name}: ${err.message}`, 'err')
    }
  }

  function clearUpload(tab) {
    setUploaded(prev => { const n = { ...prev }; delete n[tab]; return n })
    if (tab === 'Jobs') { setDecisions({}); setActiveJob(null) }
  }

  // ── the left-pane jobs (transformed) ──
  const jobs = useMemo(() => {
    const raw = uploaded.Jobs?.rows || []
    return raw.map(transformJob).filter(j => j._oldJobId)
  }, [uploaded.Jobs])

  const jobsHeaderOk = uploaded.Jobs?.validation?.ok

  // ── duplicate-target detection (N4 hard block) ──
  const dupTargets = useMemo(() => {
    const seen = new Map()
    const dups = new Set()
    for (const [oldId, dec] of Object.entries(decisions)) {
      if (dec == null || dec === DECISION.INTERNAL) continue
      if (seen.has(dec)) { dups.add(dec) } else seen.set(dec, oldId)
    }
    return dups
  }, [decisions])

  // ── row states ──
  const stats = useMemo(() => {
    let matched = 0, internal = 0, unmatched = 0
    for (const j of jobs) {
      const d = decisions[j._oldJobId]
      if (d === DECISION.INTERNAL) internal++
      else if (d == null) unmatched++
      else matched++
    }
    return { matched, internal, unmatched, total: jobs.length }
  }, [jobs, decisions])

  const rightById = useMemo(() => {
    const m = new Map()
    for (const r of rightPane) m.set(r.id, r)
    return m
  }, [rightPane])

  // ── candidate ranking for the focused job ──
  const activeJobObj = useMemo(() => jobs.find(j => j._oldJobId === activeJob) || null, [jobs, activeJob])
  const candidates = useMemo(() => {
    if (!activeJobObj) return []
    return rankCandidates(activeJobObj, rightPane, { limit: 8 })
  }, [activeJobObj, rightPane])

  // ── right-pane search results (when smart-assist misses) ──
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    const base = baseNumber(q)
    return rightPane
      .map(r => {
        const hay = `${r.display_job_number || ''} ${r.job_name || ''} ${r.customer_name || ''}`.toLowerCase()
        const numHit = base && String(r.job_number ?? '').startsWith(base) ? 1 : 0
        const textHit = hay.includes(q) ? 1 : 0
        const tok = activeJobObj ? tokenOverlap(activeJobObj.job_name, r.job_name) : 0
        return { r, rank: numHit * 2 + textHit + tok }
      })
      .filter(x => x.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 20)
      .map(x => x.r)
  }, [search, rightPane, activeJobObj])

  const setDecision = useCallback((oldJobId, value) => {
    setDecisions(prev => {
      const n = { ...prev }
      if (value === undefined) delete n[oldJobId]
      else n[oldJobId] = value
      return n
    })
  }, [])

  // advance focus to the next unmatched job after a decision
  const focusNextUnmatched = useCallback((fromId) => {
    const idx = jobs.findIndex(j => j._oldJobId === fromId)
    for (let i = idx + 1; i < jobs.length; i++) {
      if (decisions[jobs[i]._oldJobId] == null) { setActiveJob(jobs[i]._oldJobId); return }
    }
    setActiveJob(null)
  }, [jobs, decisions])

  function confirmMatch(oldJobId, callLogId) {
    setDecision(oldJobId, callLogId)
    setSearch('')
    focusNextUnmatched(oldJobId)
  }

  // ── Apply ──
  const canApply = jobsHeaderOk && stats.total > 0 && stats.unmatched === 0 && dupTargets.size === 0 && !applying
  async function onApply() {
    if (!canApply) return
    const mapping = {}
    for (const j of jobs) {
      const d = decisions[j._oldJobId]
      mapping[j._oldJobId] = d === DECISION.INTERNAL ? null : d
    }
    setApplying(true)
    setApplyResult(null)
    const res = await applyImport({
      jobsRaw: uploaded.Jobs?.rows || [],
      assignmentsRaw: uploaded.Assignments?.rows || [],
      billingLogRaw: uploaded.BillingLog?.rows || [],
      crewStatusRaw: uploaded.CrewStatus?.rows || [],
    }, mapping)
    setApplying(false)
    setApplyResult(res)
    if (res.ok) toast(`Import applied — ${res.counts.jobs} jobs loaded`, 'ok')
    else toast(`Import stopped: ${res.error}`, 'err')
  }

  return (
    <div className="imp">
      <div className="imp-head">
        <h1 className="imp-title">Customer Onboarding — Import</h1>
        <p className="imp-sub">Bring an existing schedule in by matching each old job to a real record. Nothing is deleted; matched rows are added.</p>
      </div>

      {/* ── Step 1 — upload ── */}
      <section className="imp-card">
        <div className="imp-step">1 · Upload the old schedule (CSV)</div>
        <div className="imp-uploads">
          {TAB_ORDER.map(tab => {
            const u = uploaded[tab]
            const v = u?.validation
            return (
              <div key={tab} className={`imp-up${u ? (v?.ok ? ' imp-up-ok' : ' imp-up-bad') : ''}`}>
                <div className="imp-up-top">
                  <span className="imp-up-name">{TAB_LABEL[tab]}{tab === 'Jobs' && <span className="imp-req"> · required</span>}</span>
                  {u && <button className="imp-x" onClick={() => clearUpload(tab)} title="Remove">✕</button>}
                </div>
                {!u ? (
                  <label className="imp-file">
                    <input type="file" accept=".csv,text/csv,application/vnd.ms-excel" onChange={e => onUpload(tab, e.target.files?.[0])} />
                    Choose file…
                  </label>
                ) : (
                  <div className="imp-up-info">
                    <div className="imp-up-file">{u.fileName}</div>
                    {v?.ok
                      ? <div className="imp-ok">✓ {u.rows.length} rows · columns OK</div>
                      : <div className="imp-bad">✗ missing: {v.missing.join(', ')}</div>}
                    {v?.ok && v.extra.length > 0 && <div className="imp-note">extra columns ignored: {v.extra.join(', ')}</div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="imp-expect">Expected Jobs columns: {YESV2_TABS.Jobs.required.slice(0, 6).join(', ')}…</div>
      </section>

      {/* ── Step 2 — match ── */}
      {jobsHeaderOk && (
        <section className="imp-card">
          <div className="imp-step">2 · Match each old job to a real record</div>
          <div className="imp-progress">
            <span className="imp-chip imp-chip-matched">{stats.matched} matched</span>
            <span className="imp-chip imp-chip-internal">{stats.internal} internal</span>
            <span className="imp-chip imp-chip-unmatched">{stats.unmatched} unmatched</span>
            <span className="imp-chip">{stats.total} total</span>
            {dupTargets.size > 0 && <span className="imp-chip imp-chip-dup">⚠ {dupTargets.size} duplicate target{dupTargets.size > 1 ? 's' : ''}</span>}
          </div>
          {rightErr && <div className="imp-bad">Could not load master records: {rightErr}</div>}
          {loadingRight && <div className="imp-note">Loading master records…</div>}

          <div className="imp-panes">
            {/* LEFT — uploaded jobs */}
            <div className="imp-left">
              <div className="imp-pane-h">Old jobs ({jobs.length})</div>
              <div className="imp-list">
                {jobs.map(j => {
                  const d = decisions[j._oldJobId]
                  const isDup = d != null && d !== DECISION.INTERNAL && dupTargets.has(d)
                  const target = d != null && d !== DECISION.INTERNAL ? rightById.get(d) : null
                  const state = d === DECISION.INTERNAL ? 'internal' : d == null ? 'unmatched' : 'matched'
                  return (
                    <div key={j._oldJobId}
                      className={`imp-row imp-row-${state}${activeJob === j._oldJobId ? ' imp-row-active' : ''}${isDup ? ' imp-row-dup' : ''}`}
                      onClick={() => { setActiveJob(j._oldJobId); setSearch('') }}>
                      <div className="imp-row-main">
                        <span className="imp-row-num">{j.job_num || '—'}</span>
                        <span className="imp-row-name">{j.job_name || '(no name)'}</span>
                      </div>
                      <div className="imp-row-meta">
                        {j.amount != null && <span>${Number(j.amount).toLocaleString()}</span>}
                        {j.status && <span>{j.status}</span>}
                        {j.start_date && <span>{j.start_date}</span>}
                      </div>
                      <div className="imp-row-state">
                        {state === 'matched' && <span className="imp-tag imp-tag-matched">→ {target ? (target.display_job_number || target.job_name) : d}{isDup ? ' ⚠' : ''}</span>}
                        {state === 'internal' && <span className="imp-tag imp-tag-internal">Internal</span>}
                        {state === 'unmatched' && <span className="imp-tag imp-tag-unmatched">Unmatched</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* RIGHT — candidates / search for the focused job */}
            <div className="imp-right">
              <div className="imp-pane-h">
                {activeJobObj ? <>Match for <b>{activeJobObj.job_num || activeJobObj.job_name}</b></> : 'Pick an old job on the left'}
              </div>
              {activeJobObj && (
                <>
                  <div className="imp-right-actions">
                    <button className="imp-btn imp-btn-internal" onClick={() => { setDecision(activeJob, DECISION.INTERNAL); focusNextUnmatched(activeJob) }}>
                      Mark Internal (no customer)
                    </button>
                    {decisions[activeJob] != null && (
                      <button className="imp-btn" onClick={() => setDecision(activeJob, undefined)}>Clear match</button>
                    )}
                  </div>

                  <div className="imp-cand-h">Suggested matches</div>
                  <div className="imp-cands">
                    {candidates.length === 0 && <div className="imp-note">No suggestions — use search below.</div>}
                    {candidates.map(c => (
                      <button key={c.candidate.id} className={`imp-cand imp-cand-${c.tier}`} onClick={() => confirmMatch(activeJob, c.candidate.id)}>
                        <span className="imp-cand-num">{c.candidate.display_job_number || c.candidate.job_number}</span>
                        <span className="imp-cand-name">{c.candidate.job_name}</span>
                        <span className="imp-cand-cust">{c.candidate.customer_name}</span>
                        <span className={`imp-cand-conf imp-conf-${c.tier}`}>{c.tier}</span>
                      </button>
                    ))}
                  </div>

                  <div className="imp-cand-h">Search all records</div>
                  <input className="imp-search" placeholder="Job # / name / customer…" value={search} onChange={e => setSearch(e.target.value)} />
                  <div className="imp-cands">
                    {searchResults.map(r => (
                      <button key={r.id} className="imp-cand" onClick={() => confirmMatch(activeJob, r.id)}>
                        <span className="imp-cand-num">{r.display_job_number || r.job_number}</span>
                        <span className="imp-cand-name">{r.job_name}</span>
                        <span className="imp-cand-cust">{r.customer_name}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Step 3 — apply ── */}
      {jobsHeaderOk && (
        <section className="imp-card">
          <div className="imp-step">3 · Apply</div>
          <p className="imp-note">
            Adds the matched jobs and their assignments, billing history and crew status. This does not delete anything.
          </p>
          {!canApply && !applying && (
            <div className="imp-blocked">
              {stats.unmatched > 0 && <div>· {stats.unmatched} job{stats.unmatched > 1 ? 's' : ''} still unmatched</div>}
              {dupTargets.size > 0 && <div>· {dupTargets.size} record{dupTargets.size > 1 ? 's are' : ' is'} matched by two old jobs — fix before applying</div>}
              {stats.total === 0 && <div>· upload a Jobs file first</div>}
            </div>
          )}
          <button className="imp-apply" disabled={!canApply} onClick={onApply}>
            {applying ? 'Applying…' : `Apply ${stats.matched + stats.internal} jobs`}
          </button>
          {applyResult && (
            <>
              <div className={applyResult.ok ? 'imp-ok' : 'imp-bad'} style={{ marginTop: 12 }}>
                {applyResult.ok
                  ? `✓ Loaded — jobs ${applyResult.counts.jobs}, assignments ${applyResult.counts.assignments}, billing ${applyResult.counts.billing_log}, crew ${applyResult.counts.crew}, crew status ${applyResult.counts.crew_status} · ${applyResult.counts.backlinked} linked to a Sales proposal`
                  : `✗ Stopped: ${applyResult.error} (partial: jobs ${applyResult.counts.jobs}, assignments ${applyResult.counts.assignments})`}
              </div>
              {applyResult.ok && applyResult.review?.length > 0 && (
                <div className="imp-note" style={{ marginTop: 8 }}>
                  <b>{applyResult.review.length} matched job{applyResult.review.length > 1 ? 's' : ''} need a Sales-proposal review</b> (no single sold proposal — left unlinked, not guessed):
                  <ul style={{ margin: '4px 0 0 18px' }}>
                    {applyResult.review.slice(0, 12).map(r => (
                      <li key={r.oldJobId}>{r.jobNum || r.oldJobId} — {r.reason}</li>
                    ))}
                    {applyResult.review.length > 12 && <li>…and {applyResult.review.length - 12} more</li>}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  )
}
