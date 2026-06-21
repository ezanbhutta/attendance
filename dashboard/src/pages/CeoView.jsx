import { useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { todayISO, daysAgoISO, fmtDate } from '../lib/format';
import { Card, Table, ErrorBanner } from '../components/ui.jsx';
import PrintHeader from '../components/PrintHeader.jsx';

export default function CeoView() {
  const today = todayISO();

  const emps = useQuery(() =>
    supabase.from('employees').select('id,track_attendance,department:departments(name)'), []);
  const todayRows = useQuery(() =>
    supabase.from('v_report_daily').select('employee_id,department,status,late_minutes').eq('work_date', today), [today]);
  const week = useQuery(() =>
    supabase.from('v_report_daily').select('work_date,status').gte('work_date', daysAgoISO(6)).lte('work_date', today), [today]);

  const counted = (emps.data ?? []).filter((e) => e.track_attendance);
  const rows = todayRows.data ?? [];
  const present = rows.filter((r) => r.status === 'Present').length;
  const incomplete = rows.filter((r) => r.status === 'Incomplete').length;
  const absent = rows.filter((r) => r.status === 'Absent').length;
  const late = rows.filter((r) => (r.late_minutes ?? 0) > 0).length;
  const leave = rows.filter((r) => r.status === 'Leave').length;
  const rate = counted.length ? Math.round(((present + incomplete) / counted.length) * 100) : 0;

  // headcount per department (counted staff)
  const headByDept = useMemo(() => {
    const m = new Map();
    counted.forEach((e) => {
      const d = e.department?.name || '—';
      m.set(d, (m.get(d) || 0) + 1);
    });
    return m;
  }, [emps.data]);

  const byDept = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const d = r.department || '—';
      if (!m.has(d)) m.set(d, { department: d, present: 0, absent: 0, late: 0, leave: 0 });
      const x = m.get(d);
      if (r.status === 'Present' || r.status === 'Incomplete') x.present++;
      else if (r.status === 'Absent') x.absent++;
      else if (r.status === 'Leave') x.leave++;
      if ((r.late_minutes ?? 0) > 0) x.late++;
    }
    return [...m.entries()].map(([d, x]) => ({ ...x, headcount: headByDept.get(d) || 0 }))
      .sort((a, b) => a.department.localeCompare(b.department));
  }, [rows, headByDept]);

  const trend = useMemo(() => {
    const m = new Map();
    (week.data ?? []).forEach((r) => {
      if (!m.has(r.work_date)) m.set(r.work_date, { date: r.work_date, present: 0, absent: 0 });
      const x = m.get(r.work_date);
      if (r.status === 'Present' || r.status === 'Incomplete') x.present++;
      else if (r.status === 'Absent') x.absent++;
    });
    return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [week.data]);
  const trendMax = Math.max(1, ...trend.map((t) => t.present + t.absent));

  return (
    <>
      <PrintHeader title="CEO Summary" subtitle={fmtDate(today)} />
      <div className="page-title">
        <div>
          <h1>CEO View</h1>
          <p className="page-intro">Today at a glance across the company. Gate-only people (CEO/Admin) aren’t counted.</p>
        </div>
        <button className="btn primary no-print" onClick={() => window.print()}>🖶 PDF</button>
      </div>

      <ErrorBanner error={todayRows.error || emps.error} />

      <div className="grid cols-4">
        <div className="stat"><div className="label">Counted staff</div><div className="value">{counted.length}</div></div>
        <div className="stat"><div className="label">Present today</div><div className="value" style={{ color: 'var(--ok)' }}>{present + incomplete}</div></div>
        <div className="stat"><div className="label">Absent</div><div className="value" style={{ color: 'var(--danger)' }}>{absent}</div></div>
        <div className="stat"><div className="label">Attendance rate</div><div className="value" style={{ color: 'var(--primary)' }}>{rate}%</div></div>
      </div>
      <div className="grid cols-3">
        <div className="stat"><div className="label">Late arrivals</div><div className="value" style={{ color: 'var(--warn)' }}>{late}</div></div>
        <div className="stat"><div className="label">On leave</div><div className="value">{leave}</div></div>
        <div className="stat"><div className="label">Still in (incomplete)</div><div className="value">{incomplete}</div></div>
      </div>

      <Card title="By department — today">
        <Table loading={todayRows.loading} rows={byDept} empty="No attendance yet today."
          columns={[
            { key: 'department', label: 'Department' },
            { key: 'headcount', label: 'Staff', num: true },
            { key: 'present', label: 'Present', num: true },
            { key: 'absent', label: 'Absent', num: true },
            { key: 'late', label: 'Late', num: true },
            { key: 'leave', label: 'On leave', num: true },
          ]} />
      </Card>

      <Card title="Last 7 days">
        {trend.length === 0 ? <div className="empty">No data yet.</div> : (
          <div className="trend">
            {trend.map((t) => (
              <div className="trend-row" key={t.date}>
                <span className="trend-day">{fmtDate(t.date)}</span>
                <span className="trend-bar">
                  <span className="bar-present" style={{ width: `${(t.present / trendMax) * 100}%` }} />
                  <span className="bar-absent" style={{ width: `${(t.absent / trendMax) * 100}%` }} />
                </span>
                <span className="trend-num">{t.present} in · {t.absent} absent</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
