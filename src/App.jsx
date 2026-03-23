import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import './App.css'
import Jobs from './views/Jobs'
import Schedule from './views/Schedule'
import Billing from './views/Billing'
import Materials from './views/Materials'
import Calendar from './views/Calendar'
import Daily from './views/Daily'
import Schedules from './views/Schedules'

const NAV_ITEMS = [
  { path: '/jobs', label: 'Jobs' },
  { path: '/schedule', label: 'Schedule' },
  { path: '/billing', label: 'Billing' },
  { path: '/materials', label: 'Materials' },
  { path: '/calendar', label: 'Calendar' },
  { path: '/daily', label: 'Daily' },
  { path: '/schedules', label: 'Schedules' },
]

export default function App() {
  return (
    <>
      <header className="app-header">
        <div className="app-title">
          Schedule <span className="green">Commander</span>
        </div>
        <nav className="app-nav">
          {NAV_ITEMS.map(item => (
            <NavLink key={item.path} to={item.path}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to="/jobs" replace />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="/materials" element={<Materials />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/daily" element={<Daily />} />
          <Route path="/schedules" element={<Schedules />} />
        </Routes>
      </main>
    </>
  )
}
