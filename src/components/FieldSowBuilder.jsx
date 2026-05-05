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

export default function FieldSowBuilder({ value, onSave, saving }) {
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
      materials: d.materials || [],
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
        </div>
      ))}
    </div>
  )
}
