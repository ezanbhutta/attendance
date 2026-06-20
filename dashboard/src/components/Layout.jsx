import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

const NAV = [
  ['/', '▦', 'Overview', true],
  ['/employees', '👤', 'Employees'],
  ['/org', '🏢', 'Departments & Groups'],
  ['/shifts', '🕘', 'Shifts & Timetables'],
  ['/schedules', '🗓', 'Schedules'],
  ['/reports', '📊', 'Reports'],
  ['/corrections', '✎', 'Corrections'],
  ['/calendar', '🌴', 'Leave & Holidays'],
  ['/help', '❔', 'Help'],
];

export default function Layout() {
  const { user, signOut } = useAuth();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="dot" /> Attendance OS</div>
        <nav className="nav">
          {NAV.map(([to, ico, label, end]) => (
            <NavLink key={to} to={to} end={end}>
              <span className="ico" aria-hidden>{ico}</span>{label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <strong>Self-hosted biometric attendance</strong>
          <div className="row" style={{ alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: '.85rem' }}>{user?.email}</span>
            <button className="btn sm" onClick={signOut}>Sign out</button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
