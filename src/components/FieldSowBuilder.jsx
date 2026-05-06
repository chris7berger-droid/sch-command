import { useState, useCallback, useMemo } from 'react'

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

  const matKey = (m) => String(m.material_id ?? m.wtc_material_id ?? m.name ?? '')

  const addMaterialToDay = (dayId, source) => update(days.map(d => {
    if (d.id !== dayId) return d
    const existing = d.materials || []
    const entry = source
      ? {
          wtc_material_id: source.id != null ? String(source.id) : null,
          material_id: source.id ?? null,
          name: source.product || source.name || 'Unnamed material',
          kit_size: source.kit_size || source.kit || '',
          qty_planned: 0, mils: 0, coverage_rate: source.coverage || '', mix_time: 0, mix_speed: '', cure_time: '',
        }
      : {
          material_id: null,
          name: '',
          kit_size: '',
          qty_planned: 0, mils: 0, coverage_rate: '', mix_time: 0, mix_speed: '', cure_time: '',
        }
    return { ...d, materials: [...existing, entry] }
  }))

  const removeMaterialFromDay = (dayId, idx) => update(days.map(d =>
    d.id === dayId ? { ...d, materials: (d.materials || []).filter((_, i) => i !== idx) } : d
  ))

  const updateMaterialField = (dayId, idx, key, val) => update(days.map(d => {
    if (d.id !== dayId) return d
    const numericKeys = ['qty_planned', 'mils', 'mix_time']
    const next = numericKeys.includes(key) ? (parseFloat(val) || 0) : val
    return {
      ...d,
      materials: (d.materials || []).map((m, i) => i === idx ? { ...m, [key]: next } : m),
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
            availableMaterials={availableMaterials}
            onAdd={(src) => addMaterialToDay(day.id, src)}
            onRemove={(idx) => removeMaterialFromDay(day.id, idx)}
            onUpdate={(idx, key, val) => updateMaterialField(day.id, idx, key, val)}
          />
        </div>
      ))}
    </div>
  )
}

function DayMaterials({ day, availableMaterials, onAdd, onRemove, onUpdate }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const matName = m => m.product || m.name || ''
  const usedNames = new Set((day.materials || []).map(m => (m.name || '').toLowerCase()).filter(Boolean))
  const pickable = (availableMaterials || []).filter(m => m && matName(m) && !usedNames.has(matName(m).toLowerCase()))

  return (
    <div className="fsb-mats">
      <div className="fsb-mats-label">Materials for this day</div>
      {(day.materials || []).length > 0 && (
        <div className="fsb-mats-list">
          {(day.materials || []).map((m, idx) => (
            <div key={idx} className="fsb-mat-card">
              <div className="fsb-mat-head">
                <input
                  type="text"
                  className="fsb-input fsb-mat-name"
                  placeholder="Material name"
                  value={m.name || ''}
                  onChange={e => onUpdate(idx, 'name', e.target.value)}
                />
                {m.kit_size && <span className="fsb-mat-kit">{m.kit_size}</span>}
                <button className="fsb-remove-task" onClick={() => onRemove(idx)} title="Remove material">×</button>
              </div>
              <div className="fsb-mat-grid">
                <div className="fsb-mat-field">
                  <label className="fsb-label">Qty</label>
                  <input type="number" className="fsb-input fsb-input-num" value={m.qty_planned || ''}
                    onChange={e => onUpdate(idx, 'qty_planned', e.target.value)} placeholder="0" />
                </div>
                <div className="fsb-mat-field">
                  <label className="fsb-label">Mils</label>
                  <input type="number" className="fsb-input fsb-input-num" value={m.mils || ''}
                    onChange={e => onUpdate(idx, 'mils', e.target.value)} placeholder="0" />
                </div>
                <div className="fsb-mat-field fsb-mat-field-grow">
                  <label className="fsb-label">Coverage</label>
                  <input type="text" className="fsb-input" value={m.coverage_rate || ''}
                    onChange={e => onUpdate(idx, 'coverage_rate', e.target.value)} placeholder="e.g. 200 sqft/gal" />
                </div>
                <div className="fsb-mat-field">
                  <label className="fsb-label">Mix Time</label>
                  <input type="number" className="fsb-input fsb-input-num" value={m.mix_time || ''}
                    onChange={e => onUpdate(idx, 'mix_time', e.target.value)} placeholder="min" />
                </div>
                <div className="fsb-mat-field fsb-mat-field-grow">
                  <label className="fsb-label">Mix Speed</label>
                  <input type="text" className="fsb-input" value={m.mix_speed || ''}
                    onChange={e => onUpdate(idx, 'mix_speed', e.target.value)} placeholder="e.g. Low" />
                </div>
                <div className="fsb-mat-field fsb-mat-field-grow">
                  <label className="fsb-label">Cure Time</label>
                  <input type="text" className="fsb-input" value={m.cure_time || ''}
                    onChange={e => onUpdate(idx, 'cure_time', e.target.value)} placeholder="e.g. 24 hrs" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="fsb-mat-add-wrap">
        <button
          className="fsb-add-task"
          onClick={() => setPickerOpen(o => !o)}
        >
          {pickerOpen ? '− Close' : '+ Add Material'}
        </button>
        {pickerOpen && (
          <div className="fsb-mat-picker">
            <div className="fsb-mat-picker-hdr">From proposal materials</div>
            {pickable.length === 0 && (
              <div className="fsb-mat-picker-empty">
                {(availableMaterials || []).length === 0
                  ? 'No proposal materials on this job — use Custom below.'
                  : 'All proposal materials added to this day.'}
              </div>
            )}
            {pickable.map(m => (
              <button key={m.id} className="fsb-mat-picker-row" onClick={() => { onAdd(m); setPickerOpen(false) }}>
                <span>{matName(m)}</span>
                {(m.kit_size || m.kit) && <span className="fsb-mat-picker-kit">{m.kit_size || m.kit}</span>}
              </button>
            ))}
            <button className="fsb-mat-picker-row fsb-mat-picker-custom" onClick={() => { onAdd(null); setPickerOpen(false) }}>
              + Custom material…
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
