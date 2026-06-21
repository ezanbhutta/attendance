import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard, LineChart, Users, Building2, Clock, BarChart3,
  PenLine, CalendarDays, BookOpen, Settings as SettingsIcon, LogOut, Menu,
} from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { IS_DESKTOP } from '../lib/supabase';
import SyncButton from './SyncButton.jsx';
import HMLogo from './HMLogo.jsx';

const NAV = [
  ['/', LayoutDashboard, 'Overview', true],
  ['/ceo', LineChart, 'CEO View'],
  ['/employees', Users, 'Employees'],
  ['/org', Building2, 'Departments'],
  ['/shifts', Clock, 'Shifts'],
  ['/reports', BarChart3, 'Reports'],
  ['/corrections', PenLine, 'Fix a punch'],
  ['/calendar', CalendarDays, 'Leave & Holidays'],
  ...(IS_DESKTOP ? [['/settings', SettingsIcon, 'Settings']] : []),
  ['/help', BookOpen, 'Guide'],
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
          <HMLogo size={36} />
          <div>
            <div className="name">Attendance OS</div>
            <div className="sub">HaseebMadeIt</div>
          </div>
        </div>
        <nav className="nav" onClick={() => setOpen(false)}>
          {NAV.map(([to, Icon, label, end]) => (
            <NavLink key={to} to={to} end={end}>
              <Icon className="ico" size={18} strokeWidth={2} aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="avatar" aria-hidden>{initial}</span>
          <span className="foot-email" title={user?.email}>{user?.email}</span>
          <button className="icon-btn" onClick={signOut} title="Sign out" aria-label="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="hamburger no-print" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu">
            <Menu size={20} />
          </button>
          <strong className="topbar-title">Attendance OS</strong>
          <div className="topbar-right">{IS_DESKTOP && <SyncButton />}</div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
