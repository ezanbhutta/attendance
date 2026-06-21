import { useMemo, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { todayISO, daysAgoISO, fmtDate, fmtTime, minutesToHM } from '../lib/format';
import { Users, UserCheck, UserX, TrendingUp, Clock, Plane, Hourglass } from 'lucide-react';
import { Card, Table, Badge, ErrorBanner, Stat, Drawer, PersonRow } from '../components/ui.jsx';
import { withAutoCheckout } from '../lib/attendance';
import DateRangePicker from '../components/DateRangePicker.jsx';
import PrintHeader from '../components/PrintHeader.jsx';

export default function CeoView() {
  const today = todayISO();
  const [, setTick] = useState(0);
  const [drill, setDrill] = useState(null);
  const [from, setFrom] = useState(daysAgoISO(29));
  const [to, setTo] = useState(today);
  const [deptFilter, setDeptFilter] = useState('');

  const emps = useQuery(() => supabase.from('employees').select('id,track_attendance,active,department:departments(name)'), []);
  const depts = useQuery(() => supabase.from('departments').select('name').order('name'), []);
  const todayRows = useQuery(() => supabase.from('v_report_daily')
    .select('employee_id,emp_code,first_name,last_name,department,status,late_minutes,first_in,last_out,scheduled_in,scheduled_out')
    .eq('work_date', today), [today]);
  const week = useQuery(() => supabase.from('v_report_daily').select('work_date,status').gte('work_date', daysAgoISO(6)).lte('work_date', today), [today]);
  const range = useQuery(() => supabase.from('v_report_daily')
    .select('employee_id,emp_code,first_name,last_name,department,work_date,status,late_minutes,first_in,last_out,scheduled_out,worked_minutes,overtime_minutes')
    .gte('work_date', from).lte('work_date', to), [from, to]);

  // Re-evaluate each minute so absences and auto checkouts track the clock.
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 60000); return () => clearInterval(t); }, []);

  const now = Date.now();
  const started = (r) => !r.scheduled_in || new Date(r.scheduled_in).getTime() <= now;
  const fullName = (r) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || `PIN ${r.emp_code}`;

  const counted = (emps.data ?? []).filter((e) => e.track_attendance && e.active !== false);
  const countedIds = new Set(counted.map((e) => e.id));
  const rows = (todayRows.data ?? []).filter((r) => countedIds.has(r.employee_id)).map((r) => withAutoCheckout(r, now));

  const present = rows.filter((r) => r.status === 'Present');
  const incomplete = rows.filter((r) => r.status === 'Incomplete');
  const absent = rows.filter((r) => r.status === 'Absent' && started(r));
  const upcoming = rows.filter((r) => r.status === 'Absent' && !started(r));
  const late = rows.filter((r) => (r.late_minutes ?? 0) > 0);
  const leave = rows.filter((r) => r.status === 'Leave');
  const inBuilding = [...present, ...incomplete];
  const rate = counted.length ? Math.min(100, Math.round((inBuilding.length / counted.length) * 100)) : 0;
  const share = (n) => (counted.length ? (n / counted.length) * 100 : 0);   // share of counted staff, for tile bars

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

  // Per person performance across the chosen range.
  const perPerson = useMemo(() => {
    const m = new Map();
    for (const r0 of (range.data ?? [])) {
      if (!countedIds.has(r0.employee_id)) continue;
      const r = withAutoCheckout(r0);
      if (deptFilter && (r.department || '—') !== deptFilter) continue;
      const k = r.employee_id;
      if (!m.has(k)) m.set(k, { id: k, employee_id: k, name: fullName(r), emp_code: r.emp_code, department: r.department || '—', present: 0, absent: 0, late: 0, worked: 0, ot: 0 });
      const x = m.get(k);
      if (r.status === 'Present' || r.status === 'Incomplete') x.present++;
      else if (r.status === 'Absent') x.absent++;
      if ((r.late_minutes ?? 0) > 0) x.late++;
      x.worked += r.worked_minutes ?? 0;
      x.ot += r.overtime_minutes ?? 0;
    }
    return [...m.values()].map((x) => {
      const sched = x.present + x.absent;
      return { ...x, attendance: sched ? Math.round((x.present / sched) * 100) : null, ontime: x.present ? Math.round(((x.present - x.late) / x.present) * 100) : null };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [range.data, countedIds, deptFilter]);

  const openPeople = (title, list, right) =>
    setDrill({ title, sub: `${list.length} ${list.length === 1 ? 'person' : 'people'} · ${today}`, people: list, right });
  const openPerson = (p) => {
    const days = (range.data ?? []).filter((r) => r.employee_id === p.employee_id).map((r) => withAutoCheckout(r))
      .sort((a, b) => String(b.work_date).localeCompare(String(a.work_date)));
    setDrill({ title: p.name, sub: `${p.department} · ${fmtDate(from)} to ${fmtDate(to)}`, days });
  };

  const bar = (pct) => {
    const color = pct == null ? 'var(--dim)' : pct >= 90 ? 'var(--ok)' : pct >= 70 ? 'var(--accent)' : 'var(--danger)';
    return <span className="mini-bar"><span className="track"><i style={{ width: `${pct ?? 0}%`, background: color }} /></span><span className="pct">{pct == null ? '—' : `${pct}%`}</span></span>;
  };

  return (
    <>
      <PrintHeader title="CEO Summary" subtitle={fmtDate(today)} />
      <div className="page-title">
        <div>
          <h1>CEO View</h1>
          <p className="page-intro">Today across the company, then every person's record over any range. Gate only people do not count, and absences only count once a shift has started.</p>
        </div>
        <button className="btn primary no-print" onClick={() => window.print()}>Export PDF</button>
      </div>

      <ErrorBanner error={todayRows.error || emps.error} />

      <div className="grid cols-4">
        <Stat icon={Users} tone="violet" label="Counted staff" value={counted.length}
          hint={`${headByDept.size} department${headByDept.size === 1 ? '' : 's'}`}
          help="Active staff whose attendance is tracked. Gate only and archived people are left out." />
        <Stat icon={UserCheck} tone="ok" label="Present today" value={inBuilding.length} bar={share(inBuilding.length)}
          hint={`${rate}% of staff`}
          onClick={() => openPeople('Present today', inBuilding, (r) => `in ${fmtTime(r.first_in)}`)}
          help="Scanned in today, either still here or already done." />
        <Stat icon={UserX} tone="danger" label="Absent" value={absent.length} bar={share(absent.length)}
          hint={upcoming.length ? `${upcoming.length} not due yet` : 'shift started, no scan'}
          onClick={() => openPeople('Absent', absent, (r) => `due ${fmtTime(r.scheduled_in)}`)}
          help="Scheduled, shift started, and no scan yet. Weekly off and approved leave are left out." />
        <Stat icon={TrendingUp} tone={rate >= 90 ? 'ok' : 'violet'} label="Attendance rate" value={`${rate}%`} bar={rate}
          hint={`${inBuilding.length} of ${counted.length} in`}
          help="Present, whether still here or done, divided by counted staff." />
      </div>
      <div className="grid cols-3">
        <Stat icon={Clock} tone="warn" label="Late arrivals" value={late.length} bar={share(late.length)}
          hint="after shift start" onClick={() => openPeople('Late arrivals', late, (r) => `${r.late_minutes}m late`)}
          help="Scanned in after their shift start plus grace." />
        <Stat icon={Plane} tone="sky" label="On leave" value={leave.length} bar={share(leave.length)}
          hint="approved today" onClick={() => openPeople('On leave', leave)}
          help="On approved leave today." />
        <Stat icon={Hourglass} tone="violet" label="Still in" value={incomplete.length} bar={share(incomplete.length)}
          hint="not scanned out" onClick={() => openPeople('Still in', incomplete, (r) => `in ${fmtTime(r.first_in)}`)}
          help="Scanned in but not out yet." />
      </div>

      <div className="grid cols-2">
        <Card title="By department today" help="Headcount per department against who is present, absent, late, or on leave today.">
          <Table loading={todayRows.loading} rows={byDept} empty="No attendance yet today."
            columns={[
              { key: 'department', label: 'Department' },
              { key: 'headcount', label: 'Staff', num: true },
              { key: 'present', label: 'Present', num: true },
              { key: 'absent', label: 'Absent', num: true },
              { key: 'late', label: 'Late', num: true },
              { key: 'leave', label: 'Leave', num: true },
            ]} />
        </Card>

        <Card title="Last 7 days" help="Present against absent each day this week. The violet bar is present, the rose bar absent.">
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
      </div>

      <Card title="Per person performance"
        help="Each person's record over the chosen range. Attendance is days present out of days scheduled. On time is the share of attended days that were not late. Click a row to open their full record."
        actions={
          <div className="inline-actions">
            <DateRangePicker from={from} to={to} onApply={(f, t) => { setFrom(f); setTo(t); }} />
            <select className="compact" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
              <option value="">All departments</option>
              {(depts.data ?? []).map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
          </div>
        }>
        <Table loading={range.loading} rows={perPerson} onRowClick={openPerson}
          empty="No records in this range."
          columns={[
            { key: 'name', label: 'Person', render: (r) => <strong>{r.name}</strong> },
            { key: 'department', label: 'Department' },
            { key: 'present', label: 'Present', num: true },
            { key: 'absent', label: 'Absent', num: true },
            { key: 'late', label: 'Late', num: true },
            { key: 'attendance', label: 'Attendance', num: true, render: (r) => bar(r.attendance), sort: (r) => r.attendance ?? -1 },
            { key: 'ontime', label: 'On time', num: true, render: (r) => bar(r.ontime), sort: (r) => r.ontime ?? -1 },
            { key: 'worked', label: 'Hours', num: true, render: (r) => minutesToHM(r.worked) },
          ]} />
      </Card>

      {drill && (
        <Drawer title={drill.title} sub={drill.sub} onClose={() => setDrill(null)}>
          {drill.people && (drill.people.length
            ? drill.people.map((r) => <PersonRow key={r.employee_id} name={fullName(r)} meta={r.department || `PIN ${r.emp_code}`} right={drill.right?.(r)} />)
            : <div className="empty">Nobody here right now.</div>)}
          {drill.days && (drill.days.length
            ? <div className="table-wrap"><table>
                <thead><tr><th>Date</th><th>In</th><th>Out</th><th>Status</th></tr></thead>
                <tbody>{drill.days.map((d, i) => (
                  <tr key={i}>
                    <td>{fmtDate(d.work_date)}</td>
                    <td className="mono">{fmtTime(d.first_in)}</td>
                    <td className="mono">{fmtTime(d.last_out)}{d.auto_out && <span className="auto-tag">auto</span>}</td>
                    <td><Badge value={d.status} /></td>
                  </tr>
                ))}</tbody>
              </table></div>
            : <div className="empty">No days in this range.</div>)}
        </Drawer>
      )}
    </>
  );
}
