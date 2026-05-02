const TABS = [
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'active', label: 'Active' },
  { key: 'ready-to-bill', label: 'Ready to Bill' },
]

export default function JobsTabBar({ active, onChange }) {
  return (
    <div className="jh-tabs">
      {TABS.map(t => (
        <button
          key={t.key}
          className={`jh-tab${active === t.key ? ' active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export const JOBS_TABS = TABS.map(t => t.key)
