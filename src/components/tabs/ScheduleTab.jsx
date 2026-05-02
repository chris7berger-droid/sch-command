import Schedule from '../../views/Schedule'

// Embed the existing /schedule weekly crew grid as a tab on the Jobs lifecycle.
// Schedule.jsx owns its own data fetch and chrome — do not fork it.
export default function ScheduleTab() {
  return <Schedule />
}
