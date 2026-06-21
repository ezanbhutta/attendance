import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { IS_DESKTOP } from '../lib/supabase';
import SyncButton from './SyncButton.jsx';
import HMLogo from './HMLogo.jsx';

const NAV = [
  ['/', '▦', 'Overview', true],
  ['/employees', '👤', 'Employees'],
  ['/org', '🏢', 'Departments'],
  ['/shifts', '🕘', 'Shifts'],
  ['/reports', '📊', 'Reports'],
  ['/corrections', '✎', 'Fix a punch'],
  ['/calendar', '🌴', 'Leave & Holidays'],
  ...(IS_DESKTOP ? [['/settings', '⚙', 'Settings']] : []),
  ['/help', '❔', 'Guide'],
];

export default function Layout() {
  const { user, signOut } = useAuth();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <HMLogo size={38} />
          <div>
            <div className="name">Attendance OS</div>
            <div className="sub">HaseebMadeIt</div>
          </div>
        </div>
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
            {IS_DESKTOP && <SyncButton />}
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
