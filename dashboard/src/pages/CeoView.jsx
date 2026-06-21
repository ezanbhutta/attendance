import { useMemo, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { todayISO, daysAgoISO, fmtDate, fmtTime } from '../lib/format';
import { Users, UserCheck, UserX, TrendingUp, Clock, Plane, Hourglass } from 'lucide-react';
import { Card, Table, ErrorBanner, Stat, Drawer, PersonRow } from '../components/ui.jsx';
import PrintHeader from '../components/PrintHeader.jsx';

export default function CeoView() {
  const today = todayISO();
  const [, setTick] = useState(0);
  const [drill, setDrill] = useState(null);

  const emps = useQuery(() =>
    supabase.from('employees').select('id,track_attendance,active,department:departments(name)'), []);
  const todayRows = useQuery(() =>
    supabase.from('v_report_daily')
      .select('employee_id,emp_code,first_name,last_name,department,status,late_minutes,first_in,scheduled_in')
      .eq('work_date', today), [today]);
  const week = useQuery(() =>
    supabase.from('v_report_daily').select('work_date,status,scheduled_in').gte('work_date', daysAgoISO(6)).lte('work_date', today), [today]);

  // Re-evaluate every minute so absences track the start of each shift.
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 60000); return () => clearInterval(t); }, []);

  const now = Date.now();
  const started = (r) => !r.scheduled_in || new Date(r.scheduled_in).getTime() <= now;
  const fullName = (r) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || `PIN ${r.emp_code}`;

  const inactive = new Set((emps.data ?? []).filter((e) => e.active === false).map((e) => e.id));
  const counted = (emps.data ?? []).filter((e) => e.track_attendance && e.active !== false);
  const rows = (todayRows.data ?? []).filter((r) => !inactive.has(r.employee_id));
  const present = rows.filter((r) => r.status === 'Present');
  const incomplete = rows.filter((r) => r.status === 'Incomplete');
  const absent = rows.filter((r) => r.status === 'Absent' && started(r));
  const upcoming = rows.filter((r) => r.status === 'Absent' && !started(r));
  const late = rows.filter((r) => (r.late_minutes ?? 0) > 0);
  const leave = rows.filter((r) => r.status === 'Leave');
  const inBuilding = [...present, ...incomplete];
  const rate = counted.length ? Math.min(100, Math.round((inBuilding.length / counted.length) * 100)) : 0;

  const headByDept = useMemo(() => {
    const m = new Map();
    counted.forEach((e) => { const d = e.department?.name || '—'; m.set(d, (m.get(d) || 0) + 1); });
    return m;
  }, [emps.data]);

  const byDept = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const d = r.department || '—';
      if (!m.has(d)) m.set(d, { department: d, present: 0, absent: 0, late: 0, leave: 0 });
      const x = m.get(d);
      if (r.status === 'Present' || r.status === 'Incomplete') x.present++;
      else if (r.status === 'Absent' && started(r)) x.absent++;
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

  const open = (title, list, right) =>
    setDrill({ title, sub: `${list.length} ${list.length === 1 ? 'person' : 'people'} · ${today}`, list, right });

  return (
    <>
      <PrintHeader title="CEO Summary" subtitle={fmtDate(today)} />
      <div className="page-title">
        <div>
          <h1>CEO View</h1>
          <p className="page-intro">Today at a glance across the company. Gate-only people (CEO/Admin) aren’t counted, and absences only count once a shift has started.</p>
        </div>
        <button className="btn primary no-print" onClick={() => window.print()}>Export PDF</button>
      </div>

      <ErrorBanner error={todayRows.error || emps.error} />

      <div className="grid cols-4">
        <Stat icon={Users} tone="violet" label="Counted staff" value={counted.length}
          help="Active employees whose attendance is tracked (excludes gate-only CEO/Admin and archived people)." />
        <Stat icon={UserCheck} tone="ok" label="Present today" value={inBuilding.length} onClick={() => open('Present today', inBuilding, (r) => `in ${fmtTime(r.first_in)}`)}
          help="Scanned in today — currently in or already completed." />
        <Stat icon={UserX} tone="danger" label="Absent" value={absent.length} hint={upcoming.length ? `${upcoming.length} not due yet` : null}
          onClick={() => open('Absent', absent, (r) => `due ${fmtTime(r.scheduled_in)}`)}
          help="Scheduled, shift started, no scan yet — excluding weekly-off and approved leave. Not-yet-due shifts aren’t counted." />
        <Stat icon={TrendingUp} tone="violet" label="Attendance rate" value={`${rate}%`}
          help="Present (in building or completed) ÷ counted staff." />
      </div>
      <div className="grid cols-3">
        <Stat icon={Clock} tone="warn" label="Late arrivals" value={late.length} onClick={() => open('Late arrivals', late, (r) => `${r.late_minutes}m late`)}
          help="Scanned in after their shift start + grace." />
        <Stat icon={Plane} tone="sky" label="On leave" value={leave.length} onClick={() => open('On leave', leave)}
          help="On an approved leave today." />
        <Stat icon={Hourglass} tone="violet" label="Still in" value={incomplete.length} onClick={() => open('Still in', incomplete, (r) => `in ${fmtTime(r.first_in)}`)}
          help="Scanned in but not out yet." />
      </div>

      <Card title="By department — today" help="Per-department headcount vs. who’s present, absent, late, or on leave today.">
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

      <Card title="Last 7 days" help="Daily present vs. absent over the past week — the violet bar is present, the rose bar absent.">
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

      {drill && (
        <Drawer title={drill.title} sub={drill.sub} onClose={() => setDrill(null)}>
          {drill.list.length === 0
            ? <div className="empty">Nobody here right now.</div>
            : drill.list.map((r) => (
                <PersonRow key={r.employee_id} name={fullName(r)} meta={r.department || `PIN ${r.emp_code}`} right={drill.right?.(r)} />
              ))}
        </Drawer>
      )}
    </>
  );
}
