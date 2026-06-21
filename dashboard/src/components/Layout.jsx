import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { LogOut, Menu } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { IS_DESKTOP } from '../lib/supabase';
import SyncButton from './SyncButton.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import HMLogo from './HMLogo.jsx';

const NAV = [
  ['/', 'Overview', true],
  ['/ceo', 'CEO View'],
  ['/employees', 'Employees'],
  ['/org', 'Departments'],
  ['/shifts', 'Shifts'],
  ['/reports', 'Reports'],
  ['/anomalies', 'Anomalies'],
  ['/corrections', 'Fix a punch'],
  ['/calendar', 'Leave & Holidays'],
  ...(IS_DESKTOP ? [['/settings', 'Settings']] : []),
  ['/help', 'Guide'],
];

// Top nav shell: centered horizontal navigation, content centered beneath.
// The clean, disciplined layout used by the reference sites.
export default function Layout() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const initial = (user?.email || '?').charAt(0).toUpperCase();

  return (
    <div className="app">
      <header className="topnav">
        <div className="topnav-inner">
          <div className="brand">
            <HMLogo size={28} />
            <span className="name">Attendance OS</span>
          </div>

          <nav className={`topnav-links${open ? ' open' : ''}`} onClick={() => setOpen(false)}>
            {NAV.map(([to, label, end]) => (
              <NavLink key={to} to={to} end={end}>{label}</NavLink>
            ))}
          </nav>

          <div className="topnav-actions">
            <SyncButton />
            <ThemeToggle />
            <span className="avatar no-print" title={user?.email}>{initial}</span>
            <button className="icon-btn no-print" onClick={signOut} title="Sign out" aria-label="Sign out">
              <LogOut size={16} />
            </button>
            <button className="hamburger no-print" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu">
              <Menu size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
