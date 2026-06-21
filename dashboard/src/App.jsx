import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import { IS_DESKTOP, IS_CONFIGURED } from './lib/supabase';
import Login from './components/Login.jsx';
import Layout from './components/Layout.jsx';
import Settings from './pages/Settings.jsx';
import Overview from './pages/Overview.jsx';
import Employees from './pages/Employees.jsx';
import Org from './pages/Org.jsx';
import Shifts from './pages/Shifts.jsx';
import Reports from './pages/Reports.jsx';
import Corrections from './pages/Corrections.jsx';
import Calendar from './pages/Calendar.jsx';
import Help from './pages/Help.jsx';

export default function App() {
  const { session } = useAuth();

  // Desktop first run: collect Supabase + device config before anything else.
  if (IS_DESKTOP && !IS_CONFIGURED) return <Settings firstRun />;

  if (session === undefined) return <div className="center"><div className="spinner" aria-label="Loading" /></div>;
  if (!session) return <Login />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Overview />} />
        {IS_DESKTOP && <Route path="settings" element={<Settings />} />}
        <Route path="employees" element={<Employees />} />
        <Route path="org" element={<Org />} />
        <Route path="shifts" element={<Shifts />} />
        <Route path="reports" element={<Reports />} />
        <Route path="corrections" element={<Corrections />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="help" element={<Help />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
