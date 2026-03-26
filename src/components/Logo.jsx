export function ScheduleCommandMark({ size = 34 }) {
  const teal = "#30cfac"
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="17" stroke={teal} strokeWidth="1.5" fill="none"/>
      <circle cx="20" cy="20" r="11" stroke={teal} strokeWidth="1" fill="rgba(48,207,172,0.06)"/>
      <line x1="20" y1="3"  x2="20" y2="8"  stroke={teal} strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="20" y1="32" x2="20" y2="37" stroke={teal} strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="3"  y1="20" x2="8"  y2="20" stroke={teal} strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="32" y1="20" x2="37" y2="20" stroke={teal} strokeWidth="1.5" strokeLinecap="round"/>
      <text x="20" y="24" textAnchor="middle" fontFamily="Barlow Condensed, sans-serif" fontWeight="800" fontSize="10" fill="#ffffff" letterSpacing="0.5">SCH</text>
    </svg>
  )
}

export function AppWordmark({ size = 13 }) {
  return (
    <div style={{ lineHeight: 1 }}>
      <div style={{
        fontFamily: "'Barlow Condensed', sans-serif",
        fontWeight: 800,
        fontSize: size + 1,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "#fff",
      }}>
        Schedule <span style={{ color: "#30cfac" }}>Command</span>
      </div>
      <div style={{
        fontFamily: "'Barlow Condensed', sans-serif",
        fontWeight: 600,
        fontSize: 9,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "rgba(255,255,255,0.35)",
        marginTop: 2,
      }}>
        Command Suite
      </div>
    </div>
  )
}
