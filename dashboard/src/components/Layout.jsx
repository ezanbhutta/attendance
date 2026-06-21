import { useState } from 'react';
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
  const [open, setOpen] = useState(false);
  const initial = (user?.email || '?').charAt(0).toUpperCase();

  return (
    <div className="shell">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="brand">
          <HMLogo size={38} />
          <div>
            <div className="name">Attendance OS</div>
            <div className="sub">HaseebMadeIt</div>
          </div>
        </div>
        <nav className="nav" onClick={() => setOpen(false)}>
          {NAV.map(([to, ico, label, end]) => (
            <NavLink key={to} to={to} end={end}>
              <span className="ico" aria-hidden>{ico}</span>{label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="hamburger no-print" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu">☰</button>
          <strong className="topbar-title">Attendance OS</strong>
          <div className="topbar-right">
            {IS_DESKTOP && <SyncButton />}
            <span className="user-chip" title={user?.email}>
              <span className="avatar" aria-hidden>{initial}</span>
              <span className="user-email">{user?.email}</span>
            </span>
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
