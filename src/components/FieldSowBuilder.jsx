import { useState, useCallback, useMemo, useRef, useEffect } from 'react'

const safeName = m => m.product || m.name || 'Unnamed material'
const safeKit  = m => m.kit_size || m.kit || ''
const safeId   = m => String(m.id)

const newCustomId = () => {
  const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  return `custom_${rand}`
}
const isCustomId = (id) => String(id || '').startsWith('custom_')

const newTask = () => ({ id: Date.now() + Math.random(), description: '', pct_complete: 0 })
const newDay = (idx) => ({
  id: Date.now() + Math.random(),
  day_label: `Day ${idx + 1}`,
  tasks: [newTask()],
  crew_count: 0,
  hours_planned: 0,
  materials: [],
})

export default function FieldSowBuilder({ value, onSave, saving, availableMaterials = [] }) {
  const [days, setDays] = useState(() => Array.isArray(value) ? value : [])
  const [dirty, setDirty] = useState(false)

  const update = useCallback((next) => {
    setDays(next)
    setDirty(true)
  }, [])

  const addDay = () => update([...days, newDay(days.length)])
  const removeDay = (id) => update(days.filter(d => d.id !== id))
  const updateDayField = (id, key, val) => update(days.map(d =>
    d.id === id ? { ...d, [key]: key === 'day_label' ? val : (parseFloat(val) || 0) } : d
  ))

  const addTask = (dayId) => update(days.map(d =>
    d.id === dayId ? { ...d, tasks: [...(d.tasks || []), newTask()] } : d
  ))
  const removeTask = (dayId, taskId) => update(days.map(d =>
    d.id === dayId ? { ...d, tasks: (d.tasks || []).filter(t => t.id !== taskId) } : d
  ))
  const updateTask = (dayId, taskId, key, val) => update(days.map(d =>
    d.id === dayId ? {
      ...d,
      tasks: (d.tasks || []).map(t =>
        t.id === taskId ? { ...t, [key]: key === 'description' ? val : (parseFloat(val) || 0) } : t
      ),
    } : d
  ))

  const addMaterialToDay = (dayId, source) => update(days.map(d => {
    if (d.id !== dayId) return d
    const entry = {
      wtc_material_id: safeId(source),
      material_id: null,
      name: safeName(source),
      kit_size: safeKit(source),
      qty_planned: 0, mils: 0, coverage_rate: source.coverage || '', mix_time: 0, mix_speed: '', cure_time: '',
    }
    return { ...d, materials: [...(d.materials || []), entry] }
  }))

  const addCustomMaterialToDay = (dayId) => update(days.map(d => {
    if (d.id !== dayId) return d
    const entry = {
      wtc_material_id: newCustomId(),
      material_id: null,
      name: '',
      kit_size: '',
      qty_planned: 0, mils: 0, coverage_rate: '', mix_time: 0, mix_speed: '', cure_time: '',
    }
    return { ...d, materials: [...(d.materials || []), entry] }
  }))

  const removeMaterialFromDay = (dayId, wtcId) => update(days.map(d =>
    d.id === dayId ? { ...d, materials: (d.materials || []).filter(m => String(m.wtc_material_id) !== String(wtcId)) } : d
  ))

  const updateMaterialField = (dayId, wtcId, key, val) => update(days.map(d => {
    if (d.id !== dayId) return d
    const numericKeys = ['qty_planned', 'mils', 'mix_time']
    const next = numericKeys.includes(key) ? (parseFloat(val) || 0) : val
    return {
      ...d,
      materials: (d.materials || []).map(m =>
        String(m.wtc_material_id) === String(wtcId) ? { ...m, [key]: next } : m
      ),
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
    // Strip transient ids before save (keep stable shape: tasks, materials, day fields)
    const clean = days.map(d => ({
      day_label: d.day_label,
      crew_count: d.crew_count || 0,
      hours_planned: d.hours_planned || 0,
      tasks: (d.tasks || []).map(t => ({
        description: t.description || '',
        pct_complete: parseFloat(t.pct_complete) || 0,
      })),
      materials: (d.materials || []).map(m => ({
        material_id: m.material_id ?? null,
        wtc_material_id: m.wtc_material_id ?? null,
        name: m.name || '',
        kit_size: m.kit_size || '',
        qty_planned: parseFloat(m.qty_planned) || 0,
        mils: parseFloat(m.mils) || 0,
        coverage_rate: m.coverage_rate || '',
        mix_time: parseFloat(m.mix_time) || 0,
        mix_speed: m.mix_speed || '',
        cure_time: m.cure_time || '',
      })),
    }))
    await onSave(clean)
    setDirty(false)
  }

  return (
    <div className="fsb-wrap">
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

      {days.length === 0 && (
        <div className="fsb-empty">
          No day entries yet. Click <strong>+ Add Day</strong> to define the field plan.
        </div>
      )}

      {days.map((day, dayIdx) => (
        <div key={day.id} className="fsb-day">
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
                onChange={e => updateDayField(day.id, 'hours_planned', e.target.value)}
              />
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
            onAdd={(src) => addMaterialToDay(day.id, src)}
            onAddCustom={() => addCustomMaterialToDay(day.id)}
            onRemove={(wtcId) => removeMaterialFromDay(day.id, wtcId)}
            onUpdate={(wtcId, key, val) => updateMaterialField(day.id, wtcId, key, val)}
          />
        </div>
      ))}
    </div>
  )
}

function DayMaterials({ day, wtcMaterials, onAdd, onAddCustom, onRemove, onUpdate }) {
  const [open, setOpen] = useState(false)
  const [dropUp, setDropUp] = useState(false)
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
    setOpen(o => !o)
  }

  const safeMaterials = (wtcMaterials || []).filter(m => m && m.id != null)
  const selectedIds = new Set((day.materials || []).map(m => String(m.wtc_material_id)))
  const available = safeMaterials.filter(m => !selectedIds.has(safeId(m)))

  const dayMats = (day.materials || []).filter(m => m && m.wtc_material_id != null)

  const specInput = (m, key, placeholder, type = 'text') => (
    <input
      type={type}
      className="fsb-input"
      value={m[key] ?? ''}
      placeholder={placeholder}
      onChange={e => onUpdate(m.wtc_material_id, key, e.target.value)}
    />
  )

  const btnRect = btnRef.current?.getBoundingClientRect()
  const pickerStyle = btnRect ? {
    position: 'fixed',
    left: btnRect.left,
    ...(dropUp
      ? { bottom: window.innerHeight - btnRect.top + 4 }
      : { top: btnRect.bottom + 4 }),
  } : { position: 'fixed' }

  let btnLabel
  if (safeMaterials.length === 0) btnLabel = '+ Add custom material'
  else if (available.length === 0) btnLabel = '+ Add material (custom only)'
  else btnLabel = '+ Add material from this job'

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
                    {specInput(m, 'mils', '0', 'number')}
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
                    {specInput(m, 'mix_time', '0', 'number')}
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
            <button
              className="fsb-mat-picker-row fsb-mat-picker-custom"
              onMouseDown={() => { onAddCustom(); setOpen(false) }}
            >
              + Custom material…
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
