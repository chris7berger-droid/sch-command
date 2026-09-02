import { useNavigate } from 'react-router-dom'

const DAYS_LONG = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

// Weekly Crew Capacity — the full-width charcoal strip (§8 composition #2). Left:
// three circular summary badges. Right: six per-day capacity indicators (assigned
// / available + bar + %) with a TODAY marker. All numbers come from
// computeHomeDashboard (§11); this component is presentation only.
function pctColor(pct) {
  if (pct >= 80) return 'var(--sig-green)'
  if (pct >= 50) return 'var(--sig-orange)'
  return 'var(--sig-red)'
}

function Badge({ value, label, color }) {
  return (
    <div className="hcs-badge">
      <div className="hcs-badge-circle" style={{ borderColor: color, color }}>{value}</div>
      <div className="hcs-badge-text">
        <div className="hcs-badge-value">{label}</div>
      </div>
    </div>
  )
}

export default function HomeCapacityStrip({ data, weekLabel }) {
  const navigate = useNavigate()
  const days = data?.capacityDays || []

  return (
    <section className="hcs">
      <div className="hcs-head">
        <div className="hcs-title-block">
          <div className="hcs-title">Weekly Crew Capacity</div>
          {weekLabel && <div className="hcs-week">{weekLabel}</div>}
        </div>
        <button className="hcs-view-btn" onClick={() => navigate('/schedule')}>View Crew Schedule →</button>
      </div>

      <div className="hcs-body">
        <div className="hcs-badges">
          <Badge value={data?.crewAvailable ?? 0} label="Crew Available" color="var(--teal)" />
          <Badge value={data?.assignedCount ?? 0} label="Assigned" color="var(--sig-orange)" />
          <Badge value={data?.openSpots ?? 0} label="Open Crew Spots" color="var(--sig-purple)" />
        </div>

        <div className="hcs-days">
          {days.map((d, i) => {
            const [, mm, dd] = d.date.split('-')
            const color = pctColor(d.pct)
            return (
              <div key={d.date} className={`hcs-day${d.isToday ? ' hcs-day-today' : ''}`}>
                <div className="hcs-day-label">{DAYS_LONG[i]} {parseInt(dd, 10)}</div>
                <div className="hcs-day-count">{d.assigned} / {d.avail}</div>
                <div className="hcs-day-bar">
                  <div className="hcs-day-bar-fill" style={{ width: `${Math.min(100, d.pct)}%`, background: color }} />
                </div>
                <div className="hcs-day-pct" style={{ color }}>{d.pct}%</div>
                {d.isToday && <div className="hcs-day-today-tag">TODAY</div>}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
