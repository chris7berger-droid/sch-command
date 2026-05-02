const TABS = [
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'ready', label: 'Ready' },
  { key: 'active', label: 'Active' },
  { key: 'billing', label: 'Billing' },
]

// Old slugs from the initial tabs PR — silently mapped to the new keys so
// external links don't 404. Remove once we're confident no live URLs use them.
export const LEGACY_TAB_SLUG_MAP = {
  schedule: 'ready',
  'ready-to-bill': 'billing',
}

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
