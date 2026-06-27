import { useMemo, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { todayISO, daysAgoISO, fmtDate, fmtTime, minutesToHM } from '../lib/format';
import { Users, UserCheck, UserX, TrendingUp, Clock, Plane, Hourglass, FileText } from 'lucide-react';
import { Card, Field, Table, Badge, ErrorBanner, Stat, Drawer, PersonRow } from '../components/ui.jsx';
import { withAutoCheckout } from '../lib/attendance';
import DateRangePicker from '../components/DateRangePicker.jsx';

export default function CeoView() {
  const today = todayISO();
  const [tick, setTick] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [drill, setDrill] = useState(null);
  const [from, setFrom] = useState(daysAgoISO(6));   // default: last 7 days
  const [to, setTo] = useState(today);
  const [dept, setDept] = useState('');
  const [shift, setShift] = useState('');

  const emps = useQuery(() => supabase.from('employees').select('id,emp_code,first_name,last_name,track_attendance,active,department:departments(name),shift:shifts(name)'), []);
  const depts = useQuery(() => supabase.from('departments').select('name').order('name'), []);
  const shifts = useQuery(() => supabase.from('shifts').select('name').order('name'), []);
  const range = useQuery(() => supabase.from('v_report_daily')
    .select('employee_id,emp_code,first_name,last_name,department,work_date,status,late_minutes,first_in,last_out,scheduled_in,scheduled_out,worked_minutes,overtime_minutes')
    .gte('work_date', from).lte('work_date', to), [from, to]);

  // Re-evaluate each minute so today's absences and auto checkouts track the clock.
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 60000); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 80); return () => clearTimeout(t); }, []);

  const now = Date.now();
  const started = (r) => !r.scheduled_in || new Date(r.scheduled_in).getTime() <= now;
  const fullName = (r) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || `PIN ${r.emp_code}`;

  const oneDay = from === to;                  // single day -> tiles are people, drill-downs make sense
  const isToday = oneDay && to === today;

  // Counted staff, scoped by the department + shift filters.
  const counted = useMemo(() => (emps.data ?? []).filter((e) =>
    e.track_attendance && e.active !== false
    && (!dept || (e.department?.name || '—') === dept)
    && (!shift || (e.shift?.name || '') === shift)), [emps.data, dept, shift]);
  const countedIds = useMemo(() => new Set(counted.map((e) => e.id)), [counted]);

  // Every report row in range for those people, with auto-checkout applied.
  const rows = useMemo(() => (range.data ?? [])
    .filter((r) => countedIds.has(r.employee_id))
    .map((r) => withAutoCheckout(r, Date.now())), [range.data, countedIds, tick]);

  // Status buckets (person-days over the range; people when it is one day).
  const present = rows.filter((r) => r.status === 'Present' || r.status === 'Incomplete');
  const incomplete = rows.filter((r) => r.status === 'Incomplete');
  const absent = rows.filter((r) => r.status === 'Absent' && started(r));
  const upcoming = rows.filter((r) => r.status === 'Absent' && !started(r));
  const late = rows.filter((r) => (r.late_minutes ?? 0) > 0);
  const leave = rows.filter((r) => r.status === 'Leave');
  const scheduled = present.length + absent.length;
  const rate = scheduled ? Math.round((present.length / scheduled) * 100) : 0;
  const share = (n) => (scheduled ? (n / Math.max(scheduled, 1)) * 100 : 0);

  const headByDept = useMemo(() => {
    const m = new Map();
    counted.forEach((e) => { const d = e.department?.name || '—'; m.set(d, (m.get(d) || 0) + 1); });
    return m;
  }, [counted]);

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

  // Same breakdown by shift, with a "Not due" column — people whose shift has not
  // started yet, who are NOT counted absent. This is what makes the rate read high
  // when, say, the night shift has not begun.
  const shiftBy = useMemo(() => {
    const m = {};
    (emps.data ?? []).forEach((e) => { m[e.id] = e.shift?.name || 'No shift'; });
    return m;
  }, [emps.data]);
  const headByShift = useMemo(() => {
    const m = new Map();
    counted.forEach((e) => { const s = e.shift?.name || 'No shift'; m.set(s, (m.get(s) || 0) + 1); });
    return m;
  }, [counted]);
  const byShift = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const s = shiftBy[r.employee_id] || 'No shift';
      if (!m.has(s)) m.set(s, { shift: s, present: 0, absent: 0, notdue: 0, late: 0 });
      const x = m.get(s);
      if (r.status === 'Present' || r.status === 'Incomplete') x.present++;
      else if (r.status === 'Absent') { if (started(r)) x.absent++; else x.notdue++; }
      if ((r.late_minutes ?? 0) > 0) x.late++;
    }
    return [...m.values()].map((x) => ({ ...x, headcount: headByShift.get(x.shift) || 0 }))
      .sort((a, b) => a.shift.localeCompare(b.shift));
  }, [rows, shiftBy, headByShift]);

  // Present vs absent per day across the chosen range.
  const trend = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.work_date)) m.set(r.work_date, { date: r.work_date, present: 0, absent: 0 });
      const x = m.get(r.work_date);
      if (r.status === 'Present' || r.status === 'Incomplete') x.present++;
      else if (r.status === 'Absent' && started(r)) x.absent++;
    }
    return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [rows]);
  const trendMax = Math.max(1, ...trend.map((t) => t.present + t.absent));

  // Per person performance across the chosen range.
  const perPerson = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
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
  }, [rows]);

  // Build drawer rows from a list of report rows. On a single day each entry is a
  // person; over a range each is a person-day, so we show the date in the meta.
  const peopleItems = (list, right) => [...list]
    .sort((a, b) => fullName(a).localeCompare(fullName(b)) || String(a.work_date).localeCompare(String(b.work_date)))
    .map((r, i) => ({
      key: i,
      name: fullName(r),
      meta: oneDay ? (r.department || `PIN ${r.emp_code}`) : `${fmtDate(r.work_date)}${r.department ? ` · ${r.department}` : ''}`,
      right: right?.(r),
    }));
  const openPeople = (title, list, right) =>
    setDrill({ title, sub: `${list.length} ${oneDay ? (list.length === 1 ? 'person' : 'people') : 'day-entries'} · ${oneDay ? fmtDate(to) : `${fmtDate(from)} – ${fmtDate(to)}`}`, items: peopleItems(list, right) });
  // Counted staff: the distinct people (not person-days), regardless of range.
  const openCounted = () => setDrill({
    title: 'Counted staff', sub: `${counted.length} ${counted.length === 1 ? 'person' : 'people'}${filterNote ? ` · ${filterNote}` : ''}`,
    items: [...counted].sort((a, b) => fullName(a).localeCompare(fullName(b))).map((e, i) => ({ key: i, name: fullName(e), meta: e.department?.name || '—' })),
  });
  // Attendance rate: per-person attendance %, worst first, so the CEO sees who is pulling it down.
  const openRate = () => setDrill({
    title: 'Attendance rate', sub: `${rate}% · ${fmtDate(from)} – ${fmtDate(to)}`,
    items: [...perPerson].sort((a, b) => (a.attendance ?? 101) - (b.attendance ?? 101))
      .map((p, i) => ({ key: i, name: p.name, meta: p.department, right: p.attendance == null ? '—' : `${p.attendance}%` })),
  });
  const openPerson = (p) => {
    const days = rows.filter((r) => r.employee_id === p.employee_id)
      .sort((a, b) => String(b.work_date).localeCompare(String(a.work_date)));
    setDrill({ title: p.name, sub: `${p.department} · ${fmtDate(from)} to ${fmtDate(to)}`, days });
  };

  const bar = (pct) => {
    const color = pct == null ? 'var(--dim)' : pct >= 90 ? 'var(--ok)' : pct >= 70 ? 'var(--accent)' : 'var(--danger)';
    return <span className="mini-bar"><span className="track"><i style={{ width: `${pct ?? 0}%`, background: color }} /></span><span className="pct">{pct == null ? '—' : `${pct}%`}</span></span>;
  };

  const filterNote = [dept && `Dept: ${dept}`, shift && `Shift: ${shift}`].filter(Boolean).join(' · ');
  const dayWord = isToday ? 'today' : oneDay ? 'that day' : 'in range';
  const clickHint = oneDay ? 'Click any tile to see who.' : 'Totals over the range — click any tile to drill in.';

  // One-click branded PDF — same letterhead, logo, footer and no URL link as the
  // other exports: hero metrics, the full summary, then the dept / shift / person
  // breakdowns.
  async function buildPdf() {
    const { downloadReportPDF } = await import('../lib/pdf');
    const rangeLabel = `${fmtDate(from)} – ${fmtDate(to)}`;
    const hero = [
      { value: `${rate}%`, label: 'Attendance' },
      { value: String(present.length), label: isToday ? 'Present today' : 'Present' },
      { value: String(absent.length), label: 'Absent' },
      { value: String(counted.length), label: 'Counted staff' },
    ];
    const figures = [
      ['Counted staff', counted.length], ['Days scheduled', scheduled], ['Attendance rate', `${rate}%`],
      ['Present', present.length], ['Absent', absent.length], ['Still in', incomplete.length],
      ['Late arrivals', late.length], ['On leave', leave.length], ['Not due yet', upcoming.length],
      ['Departments', headByDept.size], ['Date range', rangeLabel], ['Filters', filterNote || 'All'],
    ];
    const deptTable = {
      label: 'By department', statusCol: -1, numCols: [1, 2, 3, 4, 5], widths: { 0: 150 },
      columns: ['Department', 'Staff', 'Present', 'Absent', 'Late', 'Leave'],
      rows: byDept.map((d) => [d.department, d.headcount, d.present, d.absent, d.late, d.leave]),
    };
    const shiftTable = {
      label: 'By shift', statusCol: -1, numCols: [1, 2, 3, 4, 5], widths: { 0: 150 },
      columns: ['Shift', 'Staff', 'Present', 'Absent', 'Not due', 'Late'],
      rows: byShift.map((s) => [s.shift, s.headcount, s.present, s.absent, s.notdue, s.late]),
    };
    const peopleTable = {
      label: 'Per person', statusCol: -1, numCols: [1, 2, 3, 4, 5, 6], widths: { 0: 150 },
      columns: ['Person', 'Present', 'Absent', 'Late', 'Att %', 'On-time %', 'Hours'],
      rows: perPerson.map((p) => [p.name, p.present, p.absent, p.late,
        p.attendance == null ? '—' : `${p.attendance}%`, p.ontime == null ? '—' : `${p.ontime}%`, minutesToHM(p.worked)]),
    };
    downloadReportPDF({
      fileName: `CEO overview - ${from} to ${to}`,
      kicker: 'CEO overview', subject: 'Company attendance',
      sub: `${rangeLabel}${filterNote ? `  ·  ${filterNote}` : ''}`,
      hero, figures, tables: [deptTable, shiftTable, peopleTable],
    });
  }

  return (
    <>
      <div className="page-title">
        <div>
          <h1>CEO View</h1>
          <p className="page-intro">The whole company at a glance. {clickHint}</p>
        </div>
        <button className="btn primary no-print" onClick={buildPdf}><FileText size={15} /> Export PDF</button>
      </div>

      <Card className="no-print overflow-visible">
        <div className="row">
          <Field label="Date range"><DateRangePicker from={from} to={to} onApply={(f, t) => { setFrom(f); setTo(t); }} /></Field>
          <Field label="Department">
            <select value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">All departments</option>
              {(depts.data ?? []).map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Shift">
            <select value={shift} onChange={(e) => setShift(e.target.value)}>
              <option value="">All shifts</option>
              {(shifts.data ?? []).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </Field>
        </div>
      </Card>

      <ErrorBanner error={range.error || emps.error} />

      <div className="grid overview-top">
        <div className="card rate-card clickable" role="button" tabIndex={0} onClick={openRate}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRate(); } }}>
          <svg viewBox="0 0 120 120" className="donut" role="img" aria-label={`${rate}% attendance`}>
            <defs>
              <linearGradient id="donutGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="var(--accent)" />
                <stop offset="1" stopColor="var(--accent-2)" />
              </linearGradient>
            </defs>
            <circle className="donut-track" cx="60" cy="60" r="52" />
            <circle className="donut-arc" cx="60" cy="60" r="52"
              style={{ strokeDasharray: 326.726, strokeDashoffset: mounted ? 326.726 * (1 - rate / 100) : 326.726 }} />
            <text className="donut-pct" x="60" y="60">{rate}%</text>
          </svg>
          <div className="rate-meta">
            <span className="eyebrow">Attendance rate</span>
            <div className="rate-big">{present.length}<small>of {scheduled} due{counted.length > scheduled ? ` · ${counted.length - scheduled} not due/off` : ''}</small></div>
            <div className="rate-legend">
              <span><i className="d ok" />Present {present.length}</span>
              <span><i className="d warn" />Late {late.length}</span>
              <span><i className="d danger" />Absent {absent.length}</span>
            </div>
          </div>
        </div>
        <div className="stat-cluster">
        <Stat icon={Users} tone="violet" label="Counted staff" value={counted.length}
          hint={`${headByDept.size} department${headByDept.size === 1 ? '' : 's'}`}
          onClick={openCounted}
          help="Active staff whose attendance is tracked, within the current filters. Gate only and archived people are left out." />
        <Stat icon={UserCheck} tone="ok" label={isToday ? 'Present today' : 'Present'} value={present.length} bar={share(present.length)}
          hint={`${rate}% of those due`}
          onClick={() => openPeople('Present', present, (r) => `in ${fmtTime(r.first_in)}`)}
          help="Days attended (present or still in), as a share of those whose shift was due — not of all staff. People whose shift has not started are excluded." />
        <Stat icon={UserX} tone="danger" label="Absent" value={absent.length} bar={share(absent.length)}
          hint={upcoming.length ? `${upcoming.length} not due yet` : `no scan, ${dayWord}`}
          onClick={() => openPeople('Absent', absent, (r) => `due ${fmtTime(r.scheduled_in)}`)}
          help="Scheduled, shift started, and no scan. Weekly off and approved leave are left out." />
        <Stat icon={TrendingUp} tone={rate >= 90 ? 'ok' : 'violet'} label="Attendance rate" value={`${rate}%`} bar={rate}
          hint={`${present.length} of ${scheduled} days`}
          onClick={openRate}
          help="Days attended divided by days scheduled, over the selected range and filters. Opens each person's rate, worst first." />
        </div>
      </div>
      <div className="grid cols-3">
        <Stat icon={Clock} tone="warn" label="Late arrivals" value={late.length} bar={share(late.length)}
          hint="after shift start" onClick={() => openPeople('Late arrivals', late, (r) => `${r.late_minutes}m late`)}
          help="Scans after shift start plus grace." />
        <Stat icon={Plane} tone="sky" label="On leave" value={leave.length} bar={share(leave.length)}
          hint={`approved ${dayWord}`} onClick={() => openPeople('On leave', leave)}
          help="On approved leave." />
        <Stat icon={Hourglass} tone="violet" label="Still in" value={incomplete.length} bar={share(incomplete.length)}
          hint="not scanned out" onClick={() => openPeople('Still in', incomplete, (r) => `in ${fmtTime(r.first_in)}`)}
          help="Scanned in but not out yet (mostly today's open shifts)." />
      </div>

      <div className="grid cols-2">
        <Card title="By department" help="Headcount per department against who was present, absent, late, or on leave over the selected range.">
          <Table loading={range.loading} rows={byDept} empty="No attendance in this range."
            columns={[
              { key: 'department', label: 'Department' },
              { key: 'headcount', label: 'Staff', num: true },
              { key: 'present', label: 'Present', num: true },
              { key: 'absent', label: 'Absent', num: true },
              { key: 'late', label: 'Late', num: true },
              { key: 'leave', label: 'Leave', num: true },
            ]} />
        </Card>

        <Card title="By shift" help="Headcount per shift. 'Not due' is people whose shift has not started yet — they are not counted absent, so the rate reflects only those due. That is why the rate can read 100% while only part of the staff is in.">
          <Table loading={range.loading} rows={byShift} empty="No attendance in this range."
            columns={[
              { key: 'shift', label: 'Shift' },
              { key: 'headcount', label: 'Staff', num: true },
              { key: 'present', label: 'Present', num: true },
              { key: 'absent', label: 'Absent', num: true },
              { key: 'notdue', label: 'Not due', num: true },
              { key: 'late', label: 'Late', num: true },
            ]} />
        </Card>
      </div>

      <Card title="Attendance by day" help="Present against absent for each day in the range. The violet bar is present, the rose bar absent.">
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

      <Card title="Per person performance"
        help="Each person's record over the selected range and filters. Attendance is days present out of days scheduled. On time is the share of attended days that were not late. Click a row to open their full record.">
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
          {drill.items && (drill.items.length
            ? drill.items.map((it) => <PersonRow key={it.key} name={it.name} meta={it.meta} right={it.right} />)
            : <div className="empty">Nobody here.</div>)}
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
