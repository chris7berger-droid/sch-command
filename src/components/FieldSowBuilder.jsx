import { useState, useCallback, useMemo, useRef, useEffect } from 'react'

const safeName = m => m.product || m.name || 'Unnamed material'
const safeKit  = m => m.kit_size || m.kit || ''
const safeId   = m => String(m.id)

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const newCustomId = () => `custom_${uid()}`
const isCustomId = (id) => String(id || '').startsWith('custom_')

const nowIso = () => new Date().toISOString()
// A catalog/source row "carries specs" if any spec field is a non-empty value.
// Drives the tri-state confirm init (§2 F1): stamp specs_confirmed=false only when
// there's actually a spec to confirm — blank-spec rows stay absent (no click ritual).
// NOTE: keys mirror the confirmable SPEC_KEYS (+ 'coverage', which both material
// constructors map onto coverage_rate). 'unit' is EXCLUDED — it's never a SPEC_KEY
// and never renders a confirmable field, so a unit-only material must not trip the
// confirm affordance (T4 buildvsplan Tier-2).
const hasAnySpec = (o = {}) =>
  ['mils', 'coverage_rate', 'coverage', 'mix_time', 'mix_speed', 'cure_time']
    .some(k => o[k] != null && String(o[k]).trim() !== '')

// DMS-1 Phase 3 Step 7 — the locked application specs. `unit` is EXCLUDED (audit
// item 5): it's a task-level SQFT/LF concept, not a per-material application spec.
export const SPEC_KEYS = ['mils', 'coverage_rate', 'mix_time', 'mix_speed', 'cure_time']

// Print-gate predicate (defined now, ENFORCED in Phase 4): a material blocks the
// crew ticket iff it carries specs that were never confirmed.
export const materialBlocksPrint = (m = {}) => m.specs_confirmed !== true && hasAnySpec(m)

// DMS-1 Phase 3 Step 1: mirror Sales' task shape — size (null when blank) + unit.
// Read-only in Schedule (scope is frozen from the sale); feeds the §2 Needed rollup.
const newTask = () => ({ id: uid(), description: '', pct_complete: 0, size: null, unit: 'SQFT' })
const newDay = (idx) => ({
  id: uid(),
  day_label: `Day ${idx + 1}`,
  date: null,           // Schedule sets the calendar date (SCH2); null = TBD
  tasks: [newTask()],
  crew_count: 0,
  hours_planned: 0,
  materials: [],
})

// Assign stable ids to loaded days/tasks that lack them. CRITICAL: updateDayField/
// updateTask match by id (days.map(d => d.id === id ? …)). Persisted SOW that was
// saved without ids comes back with id===undefined on EVERY day, so a single-day
// edit would hit ALL days (observed: editing Day 2 set all 3 days to one date).
// Normalizing on load guarantees each day/task is uniquely addressable.
const withIds = (val) => (Array.isArray(val) ? val : []).map(d => ({
  ...d,
  id: d.id ?? uid(),
  tasks: (Array.isArray(d.tasks) ? d.tasks : []).map(t => ({ ...t, id: t.id ?? uid() })),
}))

export default function FieldSowBuilder({ value, onSave, saving, availableMaterials = [], catalog = [], focusDayIndex = null, changedBy = 'unknown', mobilizations = [] }) {
  const [days, setDays] = useState(() => withIds(value))
  const [dirty, setDirty] = useState(false)
  const wrapRef = useRef(null)

  // Option-3 day focus: scroll the requested day into view on mount (best-effort;
  // no-op if the index is out of range). Set by the DaysModal click-to-edit handoff.
  useEffect(() => {
    if (focusDayIndex == null || !wrapRef.current) return
    const el = wrapRef.current.querySelector(`[data-day-idx="${focusDayIndex}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusDayIndex])

  const update = useCallback((next) => {
    setDays(next)
    setDirty(true)
  }, [])

  const addDay = () => update([...days, newDay(days.length)])
  const removeDay = (id) => update(days.filter(d => d.id !== id))
  const updateDayField = (id, key, val) => update(days.map(d =>
    // 'date' is exempt from numeric coercion (it's an ISO string, not a number);
    // without this the per-day date would NaN→0 on any other day-field edit (SCH2).
    d.id === id ? { ...d, [key]: ['day_label', 'date'].includes(key) ? val : (parseFloat(val) || 0) } : d
  ))
  // Phase F (F2b) — tag a day to a mobilization by seq. Kept OUT of updateDayField
  // (which coerces to parseFloat||0) so "— none —" persists as null, not 0, and a
  // valid seq persists as an int. The value round-trips through the passthrough in
  // handleSave and out to job_wtcs.field_sow → job_mobilizations.seq.
  const setDayMob = (id, val) => update(days.map(d =>
    d.id === id ? { ...d, mobilization_seq: (val === '' || val == null) ? null : parseInt(val, 10) } : d
  ))

  const addTask = (dayId) => update(days.map(d =>
    d.id === dayId ? { ...d, tasks: [...(d.tasks || []), newTask()] } : d
  ))
  const removeTask = (dayId, taskId) => update(days.map(d =>
    d.id === dayId ? { ...d, tasks: (d.tasks || []).filter(t => t.id !== taskId) } : d
  ))
  // Keyed task coercion (Step 1) mirrors Sales: description/unit raw, size blank→null
  // (never 0/""), all OTHER keys keep the parseFloat fallthrough (pct_complete).
  const TASK_COERCE = {
    description: v => v,
    unit:        v => v,
    size:        v => v === '' ? null : (parseFloat(v) || null),
  }
  const updateTask = (dayId, taskId, key, val) => update(days.map(d =>
    d.id === dayId ? {
      ...d,
      tasks: (d.tasks || []).map(t =>
        t.id === taskId ? { ...t, [key]: (TASK_COERCE[key] || (v => parseFloat(v) || 0))(val) } : t
      ),
    } : d
  ))

  const addMaterialToDay = (dayId, source) => update(days.map(d => {
    if (d.id !== dayId) return d
    const entry = {
      wtc_material_id: safeId(source),
      material_id: null,
      catalog_id: source.catalog_id ?? null,
      task_ref: '',
      name: safeName(source),
      kit_size: safeKit(source),
      qty_planned: 0,
      mils: source.mils || '',
      coverage_rate: source.coverage_rate || source.coverage || '',
      mix_time: source.mix_time || '',
      mix_speed: source.mix_speed || '',
      cure_time: source.cure_time || '',
      unit: source.unit || '',
      specs_stamped_at: source.specs_stamped_at ?? null,
      ...(hasAnySpec(source) ? { specs_confirmed: false } : {}),
    }
    return { ...d, materials: [...(d.materials || []), entry] }
  }))

  // Add a saved material from the Material Memory (materials_catalog). Populates
  // name/kit/coverage from the catalog row but does NOT link material_id (the SOW
  // stores denormalized specs; matches addMaterialToDay). A `cat_` id keeps it
  // out of both the proposal-id namespace (dedup) and the custom-id namespace
  // (so the name renders locked, like a proposal material, not an editable input).
  const addCatalogMaterialToDay = (dayId, item) => update(days.map(d => {
    if (d.id !== dayId) return d
    // One-hop catalog stamp (§4.2): pick straight from the catalog, so stamp
    // catalog_id + every spec + specs_stamped_at = now() right here. specs_confirmed
    // per the §2 F1 init rule (false only when the row actually carries specs).
    const stamped = {
      mils: item.mils || '',
      coverage_rate: item.coverage || '',
      mix_time: item.mix_time || '',
      mix_speed: item.mix_speed || '',
      cure_time: item.cure_time || '',
      unit: item.unit || '',
    }
    const entry = {
      wtc_material_id: `cat_${uid()}`,
      material_id: null,
      catalog_id: item.id ?? null,
      task_ref: '',
      name: item.name || 'Unnamed material',
      kit_size: item.kit_size || '',
      qty_planned: 0,
      ...stamped,
      specs_stamped_at: nowIso(),
      ...(hasAnySpec(stamped) ? { specs_confirmed: false } : {}),
    }
    return { ...d, materials: [...(d.materials || []), entry] }
  }))

  const addCustomMaterialToDay = (dayId) => update(days.map(d => {
    if (d.id !== dayId) return d
    const entry = {
      wtc_material_id: newCustomId(),
      material_id: null,
      catalog_id: null,
      task_ref: '',
      name: '',
      kit_size: '',
      qty_planned: 0, mils: '', coverage_rate: '', mix_time: '', mix_speed: '', cure_time: '', unit: '',
      specs_stamped_at: null,
    }
    return { ...d, materials: [...(d.materials || []), entry] }
  }))

  const removeMaterialFromDay = (dayId, wtcId) => update(days.map(d =>
    d.id === dayId ? { ...d, materials: (d.materials || []).filter(m => String(m.wtc_material_id) !== String(wtcId)) } : d
  ))

  const updateMaterialField = (dayId, wtcId, key, val) => update(days.map(d => {
    if (d.id !== dayId) return d
    // Only true numerics coerce. Specs (mils/mix_time/cure_time) stay TEXT so a
    // range like "20-25 mils" survives a keystroke (was corrupting to 20).
    const numericKeys = ['qty_planned']
    const next = numericKeys.includes(key) ? (parseFloat(val) || 0) : val
    return {
      ...d,
      materials: (d.materials || []).map(m => {
        if (String(m.wtc_material_id) !== String(wtcId)) return m
        // Step 7 lock: a confirmed material's specs are read-only here — edits must
        // go through overrideSpec (typed reason). Reject the write (belt to the
        // read-only UI). Non-spec fields (qty_planned/name/kit_size) stay editable.
        // Exception: a confirmed material can still be confirmed with SOME specs
        // blank (confirm unlocks the moment any one spec is non-empty). A blank
        // field has no confirmed value to protect, so leave it editable — else the
        // only way to fill a missing mils/mix_time is the override-with-reason hatch.
        if (SPEC_KEYS.includes(key) && m.specs_confirmed === true && String(m[key] ?? '') !== '') return m
        return { ...m, [key]: next }
      }),
    }
  }))

  // Step 7 — confirm/lock a material's specs (new/swapped confirm in Schedule).
  const confirmMaterialSpecs = (dayId, wtcId) => update(days.map(d =>
    d.id === dayId ? {
      ...d,
      materials: (d.materials || []).map(m =>
        String(m.wtc_material_id) === String(wtcId) ? { ...m, specs_confirmed: true } : m
      ),
    } : d
  ))

  // Step 7 — override escape hatch: change LOCKED spec value(s) with a typed reason.
  // Multi-field (its OWN handler, not updateMaterialField): writes the value(s),
  // appends a {by,at,old,new,reason} record to spec_overrides[], and re-confirms as
  // warehouse-confirmed so it stays locked + prints, but the change is on the record.
  const overrideMaterialSpec = (dayId, wtcId, changes, reason) => update(days.map(d => {
    if (d.id !== dayId) return d
    return {
      ...d,
      materials: (d.materials || []).map(m => {
        if (String(m.wtc_material_id) !== String(wtcId)) return m
        const overrides = Array.isArray(m.spec_overrides) ? m.spec_overrides : []
        const diff = {}
        for (const [k, v] of Object.entries(changes)) {
          if (SPEC_KEYS.includes(k) && String(m[k] ?? '') !== String(v ?? '')) diff[k] = { old: m[k] ?? null, new: v }
        }
        if (Object.keys(diff).length === 0) return m
        const applied = {}
        for (const k of Object.keys(diff)) applied[k] = changes[k]
        return {
          ...m, ...applied,
          specs_confirmed: true,
          spec_overrides: [...overrides, { by: changedBy, at: nowIso(), reason, changes: diff }],
        }
      }),
    }
  }))

  // Cross-day % committed for a task name
  const getCommittedPct = useCallback((taskName, currentDayId) => {
    if (!taskName) return 0
    return days
      .filter(d => d.id !== currentDayId)
      .flatMap(d => d.tasks || [])
      .filter(t => t.description && t.description.toLowerCase() === taskName.toLowerCase())
      .reduce((s, t) => s + (parseFloat(t.pct_complete) || 0), 0)
  }, [days])

  const priorTaskNames = useMemo(() => {
    const all = []
    for (const d of days) {
      for (const t of (d.tasks || [])) {
        if (t.description && !all.includes(t.description)) all.push(t.description)
      }
    }
    return all
  }, [days])

  const handleSave = async () => {
    // PERSIST stable day/task ids (do NOT strip) so a later reload can address
    // each day individually — stripping caused id===undefined collisions where a
    // single-day edit hit every day. ids are durable, render+update keys.
    // PASSTHROUGH, not whitelist. A whitelist silently dropped live fields the
    // builder doesn't render — mobilization_seq, sq_ft, linear_ft (shipped
    // Screen-1·A) were erased on every save (§0.2b live bug), and it would strip
    // scope_notes/task_ref/catalog_id/specs_stamped_at too. Spread the day/material
    // and coerce ONLY the true numerics; specs stay TEXT (mils/mix_time/cure_time).
    const clean = days.map(d => ({
      ...d,
      date: d.date || null,   // Schedule calendar layer (SCH2) — preserve per-day date
      crew_count: parseFloat(d.crew_count) || 0,
      hours_planned: parseFloat(d.hours_planned) || 0,
      tasks: (d.tasks || []).map(t => ({
        ...t,
        pct_complete: parseFloat(t.pct_complete) || 0,
      })),
      materials: (d.materials || []).map(m => ({
        ...m,
        qty_planned: parseFloat(m.qty_planned) || 0,
      })),
    }))
    await onSave(clean)
    setDirty(false)
  }

  return (
    <div className="fsb-wrap" ref={wrapRef}>
      <div className="fsb-header">
        <div className="fsb-title">Field SOW · {days.length} day{days.length !== 1 ? 's' : ''} planned</div>
        <div className="fsb-header-actions">
          <button className="fsb-add-day" onClick={addDay}>+ Add Day</button>
          <button
            className={`jh-confirm-btn${!dirty ? ' disabled' : ''}`}
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? 'Saving…' : dirty ? 'Save Field SOW' : '✓ Saved'}
          </button>
        </div>
      </div>

      <div className="fsb-scope-note" style={{ fontSize: 12, color: 'var(--sand-dark)', margin: '0 0 12px', lineHeight: 1.4 }}>
        <strong>Scope is frozen (from the sale).</strong> You're setting the calendar — per-day dates, crew, and hours. Editing here never changes the bid.
      </div>

      {/* D6 clarifiers — entered values feed the go-back cost rollup, so what a
          number MEANS has to be explicit (not left to convention). */}
      <div className="fsb-scope-note" style={{ fontSize: 11.5, color: 'var(--text-light)', margin: '0 0 12px', lineHeight: 1.45, background: 'rgba(48,207,172,0.08)', border: '1px solid rgba(28,24,20,0.12)', borderRadius: 7, padding: '7px 10px' }}>
        ⓘ <strong>Hours</strong> = total work hours for the day, all crew combined (e.g. 16 = two people × 8h, or four × 4h) — not hours per person. &nbsp;<strong>Qty Planned</strong> = number of priced units (kits/boxes), not gallons. &nbsp;Tag each day to a <strong>Mobilization</strong> so its work rolls up to the right trip (and go-back cost).
      </div>

      {days.length === 0 && (
        <div className="fsb-empty">
          No day entries yet. Click <strong>+ Add Day</strong> to define the field plan.
        </div>
      )}

      {days.map((day, dayIdx) => (
        <div key={day.id} className="fsb-day" data-day-idx={dayIdx}>
          <div className="fsb-day-header">
            <div className="fsb-field">
              <label className="fsb-label">Day Label</label>
              <input
                type="text"
                className="fsb-input fsb-input-sm"
                value={day.day_label || ''}
                onChange={e => updateDayField(day.id, 'day_label', e.target.value)}
              />
            </div>
            <div className="fsb-field">
              <label className="fsb-label">Date{!day.date && ' (TBD)'}</label>
              <input
                type="date"
                className="fsb-input fsb-input-sm"
                value={day.date || ''}
                onChange={e => updateDayField(day.id, 'date', e.target.value)}
              />
            </div>
            <div className="fsb-field">
              <label className="fsb-label">Crew</label>
              <input
                type="number"
                className="fsb-input fsb-input-num"
                value={day.crew_count || ''}
                onChange={e => updateDayField(day.id, 'crew_count', e.target.value)}
              />
            </div>
            <div className="fsb-field">
              <label className="fsb-label">Hours</label>
              <input
                type="number"
                className="fsb-input fsb-input-num"
                value={day.hours_planned || ''}
                title="Total work hours for the day, all crew combined (e.g. 16 = two people × 8h, or four × 4h) — not hours per person."
                onChange={e => updateDayField(day.id, 'hours_planned', e.target.value)}
              />
            </div>
            {/* F2b — per-day mobilization picker. Options come from a FRESH
                job_mobilizations load (passed from CardSowModal), so a just-added
                dayless go-back is taggable in the same session (audit D2). A day
                tagged to a seq no longer in the list keeps a synthetic option so
                the controlled select still round-trips it. */}
            <div className="fsb-field">
              <label className="fsb-label">Mobilization</label>
              <select
                className="fsb-input fsb-input-sm"
                value={day.mobilization_seq == null ? '' : String(day.mobilization_seq)}
                onChange={e => setDayMob(day.id, e.target.value)}
              >
                <option value="">— none —</option>
                {mobilizations.map(m => (
                  <option key={m.seq} value={String(m.seq)}>
                    Mob {m.seq}{m.label ? ` — ${m.label}` : ''}{m.is_go_back ? ' (go back)' : ''}
                  </option>
                ))}
                {day.mobilization_seq != null && !mobilizations.some(m => m.seq === day.mobilization_seq) && (
                  <option value={String(day.mobilization_seq)}>Mob {day.mobilization_seq}</option>
                )}
              </select>
            </div>
            <button className="fsb-remove-day" onClick={() => removeDay(day.id)} title="Remove day">×</button>
          </div>

          <div className="fsb-tasks">
            {(day.tasks || []).map((task, ti) => {
              const committed = getCommittedPct(task.description, day.id)
              const cap = task.description ? Math.max(0, 100 - committed) : 100
              const isKnown = committed > 0
              const pct = parseFloat(task.pct_complete) || 0
              const isOver = isKnown && pct > cap
              return (
                <div key={task.id} className="fsb-task-row">
                  <span className="fsb-task-num">{ti + 1}.</span>
                  <input
                    type="text"
                    className="fsb-input fsb-task-desc"
                    placeholder={ti === 0 ? 'Describe task…' : `Task ${ti + 1}`}
                    value={task.description || ''}
                    onChange={e => updateTask(day.id, task.id, 'description', e.target.value)}
                    list={`fsb-task-suggest-${day.id}-${task.id}`}
                  />
                  <datalist id={`fsb-task-suggest-${day.id}-${task.id}`}>
                    {priorTaskNames
                      .filter(n => n !== task.description)
                      .map(n => <option key={n} value={n} />)}
                  </datalist>
                  {/* Step 1: read-only task size + unit (frozen from the sale) — feeds §2 Needed */}
                  <span
                    className="fsb-task-size"
                    title="Task size (set in Sales; drives material Needed = size ÷ coverage)"
                    style={{ fontSize: 12, fontWeight: 600, color: 'var(--sand-dark)', whiteSpace: 'nowrap', flexShrink: 0, minWidth: 64, textAlign: 'right' }}
                  >
                    {task.size != null ? `${task.size} ${task.unit || 'SQFT'}` : '— size'}
                  </span>
                  <div className="fsb-pct-wrap">
                    <input
                      type="number"
                      className={`fsb-input fsb-pct${isOver ? ' over' : isKnown ? ' known' : ''}`}
                      value={task.pct_complete || ''}
                      onChange={e => {
                        const val = parseFloat(e.target.value) || 0
                        if (isKnown && val > cap) return
                        updateTask(day.id, task.id, 'pct_complete', e.target.value)
                      }}
                      placeholder="0"
                    />
                    <span className="fsb-pct-sym">%</span>
                    {isKnown && (
                      <span className={`fsb-cap${cap === 0 ? ' done' : ''}`}>
                        {cap === 0 ? 'done' : `max ${cap}%`}
                      </span>
                    )}
                  </div>
                  <button
                    className="fsb-remove-task"
                    onClick={() => removeTask(day.id, task.id)}
                    disabled={(day.tasks || []).length <= 1}
                    title="Remove task"
                  >×</button>
                </div>
              )
            })}
            <button className="fsb-add-task" onClick={() => addTask(day.id)}>+ Add Task</button>
          </div>

          <DayMaterials
            day={day}
            wtcMaterials={availableMaterials}
            catalog={catalog}
            onAdd={(src) => addMaterialToDay(day.id, src)}
            onAddCatalog={(item) => addCatalogMaterialToDay(day.id, item)}
            onAddCustom={() => addCustomMaterialToDay(day.id)}
            onRemove={(wtcId) => removeMaterialFromDay(day.id, wtcId)}
            onUpdate={(wtcId, key, val) => updateMaterialField(day.id, wtcId, key, val)}
            onConfirmSpecs={(wtcId) => confirmMaterialSpecs(day.id, wtcId)}
            onOverrideSpec={(wtcId, changes, reason) => overrideMaterialSpec(day.id, wtcId, changes, reason)}
          />
        </div>
      ))}
    </div>
  )
}

function DayMaterials({ day, wtcMaterials, catalog = [], onAdd, onAddCatalog, onAddCustom, onRemove, onUpdate, onConfirmSpecs, onOverrideSpec }) {
  const [overrideId, setOverrideId] = useState(null)     // wtc_material_id being overridden
  const [overrideDraft, setOverrideDraft] = useState({}) // staged SPEC_KEYS edits
  const [overrideReason, setOverrideReason] = useState('')

  const startOverride = (m) => {
    const draft = {}
    for (const k of SPEC_KEYS) draft[k] = m[k] ?? ''
    setOverrideDraft(draft)
    setOverrideReason('')
    setOverrideId(m.wtc_material_id)
  }
  const cancelOverride = () => { setOverrideId(null); setOverrideDraft({}); setOverrideReason('') }
  const saveOverride = (m) => {
    if (!overrideReason.trim()) return   // reason is non-skippable
    onOverrideSpec(m.wtc_material_id, overrideDraft, overrideReason.trim())
    cancelOverride()
  }
  const [open, setOpen] = useState(false)
  const [dropUp, setDropUp] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef(null)
  const btnRef = useRef(null)

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setDropUp(window.innerHeight - rect.bottom < 240)
    }
    setQ('')
    setOpen(o => !o)
  }

  const safeMaterials = (wtcMaterials || []).filter(m => m && m.id != null)
  const selectedIds = new Set((day.materials || []).map(m => String(m.wtc_material_id)))
  const available = safeMaterials.filter(m => !selectedIds.has(safeId(m)))

  const dayMats = (day.materials || []).filter(m => m && m.wtc_material_id != null)

  // Material Memory (materials_catalog) — search-filtered, excluding names already
  // on this day, capped at 12 like Sales' picker. Read-only pull; picking one just
  // populates a day material entry.
  const hasCatalog = (catalog || []).length > 0
  const dayNames = new Set(dayMats.map(m => (m.name || '').toLowerCase()).filter(Boolean))
  const catalogMatches = (catalog || [])
    .filter(m => m && m.name && !dayNames.has(m.name.toLowerCase()))
    .filter(m => {
      const query = q.trim().toLowerCase()
      if (!query) return true
      return `${m.name} ${m.kit_size || ''} ${m.supplier || ''}`.toLowerCase().includes(query)
    })
    .slice(0, 12)

  const specInput = (m, key, placeholder, type = 'text') => {
    const isSpec = SPEC_KEYS.includes(key)
    // Only lock a confirmed spec that actually carries a value. Blank fields on a
    // confirmed material stay editable so a missing mils/mix_time/mix_speed can be
    // filled directly (mirrors updateMaterialField's blank exception).
    const locked = isSpec && m.specs_confirmed === true && (m[key] ?? '') !== ''
    const overriding = isSpec && overrideId === m.wtc_material_id
    const readOnly = locked && !overriding
    const value = overriding ? (overrideDraft[key] ?? '') : (m[key] ?? '')
    return (
      <input
        type={type}
        className={`fsb-input${readOnly ? ' fsb-input-locked' : ''}`}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        title={readOnly ? 'Confirmed spec — use Override to change (needs a reason)' : undefined}
        style={readOnly ? { opacity: 0.7, cursor: 'not-allowed' } : undefined}
        onChange={e => {
          if (readOnly) return
          if (overriding) setOverrideDraft(prev => ({ ...prev, [key]: e.target.value }))
          else onUpdate(m.wtc_material_id, key, e.target.value)
        }}
      />
    )
  }

  const btnRect = btnRef.current?.getBoundingClientRect()
  const pickerStyle = btnRect ? {
    position: 'fixed',
    left: btnRect.left,
    ...(dropUp
      ? { bottom: window.innerHeight - btnRect.top + 4 }
      : { top: btnRect.bottom + 4 }),
  } : { position: 'fixed' }

  // With the catalog available there's always something to pick, so the button
  // reads generically; it only collapses to "custom" when there's truly nothing
  // to choose (no proposal materials AND no memory).
  let btnLabel
  if (available.length === 0 && !hasCatalog) btnLabel = '+ Add custom material'
  else btnLabel = '+ Add material'

  return (
    <div className="fsb-mats">
      <div className="fsb-mats-label">Materials for this day</div>
      {dayMats.length > 0 && (
        <div className="fsb-mats-list">
          {dayMats.map(m => {
            const isCustom = isCustomId(m.wtc_material_id)
            return (
            <div key={String(m.wtc_material_id)} className="fsb-mat-card">
              <div className="fsb-mat-head">
                {isCustom ? (
                  <input
                    className="fsb-input fsb-mat-name-input"
                    placeholder="Material name"
                    value={m.name || ''}
                    onChange={e => onUpdate(m.wtc_material_id, 'name', e.target.value)}
                  />
                ) : (
                  <span className="fsb-mat-name">{m.name}</span>
                )}
                {isCustom ? (
                  <input
                    className="fsb-input fsb-mat-kit-input"
                    placeholder="Kit size"
                    value={m.kit_size || ''}
                    onChange={e => onUpdate(m.wtc_material_id, 'kit_size', e.target.value)}
                  />
                ) : (
                  m.kit_size && <span className="fsb-mat-kit">{m.kit_size}</span>
                )}
                <button className="fsb-remove-task" onClick={() => onRemove(m.wtc_material_id)} title="Remove material">×</button>
              </div>
              <div className="fsb-mat-grid">
                <div className="fsb-mat-field">
                  <label className="fsb-label">Qty Planned</label>
                  <div className="fsb-mat-spec">
                    {specInput(m, 'qty_planned', '0', 'number')}
                    <span className="fsb-mat-suffix">kits</span>
                  </div>
                </div>
                <div className="fsb-mat-field">
                  <label className="fsb-label">Mils</label>
                  <div className="fsb-mat-spec">
                    {specInput(m, 'mils', 'e.g. 20-25')}
                    <span className="fsb-mat-suffix">mil</span>
                  </div>
                </div>
                <div className="fsb-mat-field">
                  <label className="fsb-label">Coverage Rate</label>
                  {specInput(m, 'coverage_rate', 'e.g. 200 sqft/gal')}
                </div>
              </div>
              <div className="fsb-mat-grid" style={{ marginTop: 8 }}>
                <div className="fsb-mat-field">
                  <label className="fsb-label">Mix Time</label>
                  <div className="fsb-mat-spec">
                    {specInput(m, 'mix_time', 'e.g. 3 min')}
                    <span className="fsb-mat-suffix">min</span>
                  </div>
                </div>
                <div className="fsb-mat-field">
                  <label className="fsb-label">Mix Speed</label>
                  {specInput(m, 'mix_speed', 'e.g. Low')}
                </div>
                <div className="fsb-mat-field">
                  <label className="fsb-label">Cure Time</label>
                  {specInput(m, 'cure_time', 'e.g. 24 hrs')}
                </div>
              </div>
              {hasAnySpec(m) && (
                <div className="fsb-mat-confirm" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {m.specs_confirmed === true ? (
                    overrideId === m.wtc_material_id ? (
                      <>
                        <input
                          className="fsb-input"
                          style={{ flex: 1, minWidth: 160 }}
                          placeholder="Reason for override (required)…"
                          value={overrideReason}
                          onChange={e => setOverrideReason(e.target.value)}
                        />
                        <button className="fsb-add-task" disabled={!overrideReason.trim()} onClick={() => saveOverride(m)}>Save override</button>
                        <button className="fsb-remove-task" onClick={cancelOverride} title="Cancel override">Cancel</button>
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#5BBD3F' }}>✓ Specs confirmed</span>
                        <button className="fsb-add-task" onClick={() => startOverride(m)}>Override</button>
                      </>
                    )
                  ) : (
                    <>
                      <span style={{ fontSize: 12, color: 'var(--sand-dark)' }}>Specs not confirmed</span>
                      <button className="fsb-add-task" onClick={() => onConfirmSpecs(m.wtc_material_id)}>Confirm specs</button>
                    </>
                  )}
                </div>
              )}
            </div>
          )})}
        </div>
      )}
      <div className="fsb-mat-add-wrap" ref={ref}>
        <button
          ref={btnRef}
          className="fsb-add-task"
          onClick={handleOpen}
        >
          {btnLabel}
        </button>
        {open && (
          <div className="fsb-mat-picker" style={pickerStyle}>
            {hasCatalog && (
              <input
                className="fsb-mat-picker-search"
                autoFocus
                value={q}
                placeholder="Search material memory…"
                onChange={e => setQ(e.target.value)}
              />
            )}

            {available.length > 0 && (
              <div className="fsb-mat-picker-hdr">FROM PROPOSAL MATERIALS</div>
            )}
            {available.map(m => (
              <button
                key={safeId(m)}
                className="fsb-mat-picker-row"
                onMouseDown={() => { onAdd(m); setOpen(false) }}
              >
                <span>{safeName(m)}</span>
                {safeKit(m) && <span className="fsb-mat-picker-kit">{safeKit(m)}</span>}
              </button>
            ))}

            {hasCatalog && (
              <>
                <div className="fsb-mat-picker-hdr">FROM MATERIAL MEMORY</div>
                {catalogMatches.length === 0 ? (
                  <div className="fsb-mat-picker-empty">
                    {q.trim() ? 'No saved materials match.' : 'No saved materials.'}
                  </div>
                ) : catalogMatches.map(m => (
                  <button
                    key={`cat-${m.id}`}
                    className="fsb-mat-picker-row"
                    onMouseDown={() => { onAddCatalog(m); setOpen(false) }}
                  >
                    <span>{m.name}</span>
                    {m.kit_size && <span className="fsb-mat-picker-kit">{m.kit_size}</span>}
                  </button>
                ))}
              </>
            )}

            <button
              className="fsb-mat-picker-row fsb-mat-picker-custom"
              onMouseDown={() => { onAddCustom(); setOpen(false) }}
            >
              + Custom material…
            </button>
            <div className="fsb-mat-picker-note">
              Custom materials stay on this job. To save one for reuse, add it in Sales Command.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
