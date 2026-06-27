import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { fmtTime, minutesToHM, fmtDate, todayISO, daysAgoISO } from '../lib/format';
import { downloadCSV } from '../lib/csv';
import { Download, FileText, UserCheck, UserX, Clock, Plane, Timer, TrendingUp, Gift, Hourglass } from 'lucide-react';
import { Card, Field, Table, Badge, ErrorBanner, Stat } from '../components/ui.jsx';
import DateRangePicker from '../components/DateRangePicker.jsx';
import { withAutoCheckout } from '../lib/attendance';

const STATUSES = ['Present', 'Incomplete', 'Absent', 'Late', 'Leave', 'Holiday', 'HolidayWorked', 'WeeklyOff'];
const VIEWS = [
  ['detailed', 'Day by day'],
  ['employee', 'By employee'],
  ['department', 'By department'],
  ['shift', 'By shift'],
];

const empName = (r) => r.employee?.trim() || `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim();
const hmS = (m) => (m == null ? '—' : m < 60 ? `${m}m` : minutesToHM(m));   // compact sub-hour
const wd = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const hdMins = (h) => Math.max(0, toMin(h.to_time) - toMin(h.from_time));   // absent window
const nextDayOf = (d) => { const [y, m, da] = d.split('-').map(Number); const x = new Date(y, m - 1, da + 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const REPORTS_LEGEND = [
  'Present — scanned in (and out). Incomplete — scanned in but never out. Absent — a working day with no scan.',
  'Late — first scan after the shift start plus grace. Overtime — time scanned out past the shift end.',
  'In grouped views, Attendance % is days present out of days scheduled; On-time % is the share of attended days that were not late.',
  'WeeklyOff / Holiday / Leave are not counted absent. HolidayWorked — a holiday volunteer who came in; counts as a bonus day.',
];

export default function Reports() {
  const [view, setView] = useState('detailed');
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const [dept, setDept] = useState('');
  const [shift, setShift] = useState('');
  const [emp, setEmp] = useState('');
  const [stat, setStat] = useState('');

  const depts = useQuery(() => supabase.from('departments').select('name').order('name'), []);
  const shifts = useQuery(() => supabase.from('shifts').select('name').order('name'), []);
  const emps = useQuery(() =>
    supabase.from('employees').select('id,emp_code,first_name,last_name,track_attendance,department:departments(name),shift:shifts(name)').order('emp_code'), []);

  const report = useQuery(() =>
    supabase.from('v_report_daily').select('*')
      .gte('work_date', from).lte('work_date', to)
      .order('work_date', { ascending: false }).order('emp_code'), [from, to]);
  const leaves = useQuery(() => supabase.from('leaves').select('employee_id,start_date,end_date,status,paid'), []);
  const halfdays = useQuery(() => supabase.from('half_days').select('employee_id,the_date,from_time,to_time,paid'), []);

  const shiftBy = useMemo(() => {
    const m = {};
    (emps.data ?? []).forEach((e) => { m[e.id] = e.shift?.name ?? null; });
    return m;
  }, [emps.data]);
  const halfByKey = useMemo(() => {
    const m = {}; (halfdays.data ?? []).forEach((h) => { m[`${h.employee_id}|${h.the_date}`] = h; }); return m;
  }, [halfdays.data]);
  const leavesByEmp = useMemo(() => {
    const m = {}; (leaves.data ?? []).forEach((l) => { (m[l.employee_id] ||= []).push(l); }); return m;
  }, [leaves.data]);
  // A Leave-status day is paid unless its matching leave record is marked unpaid
  // (checking the next day too, for a night shift's Leave on the previous date).
  const leaveIsPaid = (r) => {
    const list = leavesByEmp[r.employee_id] || [];
    const within = (l, d) => d >= l.start_date && d <= (l.end_date || l.start_date);
    const l = list.find((x) => within(x, r.work_date)) || list.find((x) => within(x, nextDayOf(r.work_date)));
    return l ? l.paid : true;
  };

  // Attach shift + the half-day overlay, then apply all filters. A half day keeps
  // its status but its worked hours are reduced by the absent window.
  const rows = useMemo(() => {
    const countedIds = new Set((emps.data ?? []).filter((e) => e.track_attendance).map((e) => e.id));
    return (report.data ?? [])
      .map((r) => ({ ...r, shift: shiftBy[r.employee_id] ?? null }))
      .filter((r) => countedIds.has(r.employee_id))   // gate-only (CEO/Admin) never in reports
      .map((r) => withAutoCheckout(r))
      .map((r) => {
        const h = halfByKey[`${r.employee_id}|${r.work_date}`];
        if (!h) return r;
        return { ...r, half: true, half_paid: h.paid, worked_minutes: r.worked_minutes != null ? Math.max(0, r.worked_minutes - hdMins(h)) : r.worked_minutes };
      })
      .filter((r) => !dept || r.department === dept)
      .filter((r) => !shift || r.shift === shift)
      .filter((r) => !emp || String(r.employee_id) === String(emp))
      .filter((r) => !stat || (stat === 'Late' ? (r.late_minutes ?? 0) > 0 : r.status === stat));
  }, [report.data, emps.data, shiftBy, halfByKey, dept, shift, emp, stat]);

  const totals = useMemo(() => rows.reduce((a, r) => {
    if (r.status === 'Present') a.present++;
    else if (r.status === 'Absent') a.absent++;
    else if (r.status === 'Leave') { a.leave++; if (leaveIsPaid(r)) a.paidLeave++; else a.unpaidLeave++; }
    else if (r.status === 'HolidayWorked') a.bonus++;
    if ((r.late_minutes ?? 0) > 0) a.late++;
    if (r.half) a.half++;
    a.worked += r.worked_minutes ?? 0;
    a.ot += r.overtime_minutes ?? 0;
    return a;
  }, { present: 0, absent: 0, leave: 0, bonus: 0, late: 0, worked: 0, ot: 0, half: 0, paidLeave: 0, unpaidLeave: 0 }), [rows, leavesByEmp]);

  const grouped = useMemo(() => {
    const keyFn = view === 'employee' ? (r) => r.employee_id
      : view === 'department' ? (r) => r.department || '—'
      : (r) => r.shift || 'No shift';
    const labelFn = view === 'employee' ? empName
      : view === 'department' ? (r) => r.department || '—'
      : (r) => r.shift || 'No shift';
    const g = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      if (!g.has(k)) g.set(k, { label: labelFn(r), code: r.emp_code, present: 0, absent: 0, leave: 0, incomplete: 0, bonus: 0, late: 0, lateMin: 0, worked: 0, ot: 0, half: 0, paidLeave: 0, unpaidLeave: 0 });
      const x = g.get(k);
      if (r.status === 'Present') x.present++;
      else if (r.status === 'Absent') x.absent++;
      else if (r.status === 'Leave') { x.leave++; if (leaveIsPaid(r)) x.paidLeave++; else x.unpaidLeave++; }
      else if (r.status === 'Incomplete') x.incomplete++;
      else if (r.status === 'HolidayWorked') x.bonus++;
      if ((r.late_minutes ?? 0) > 0) x.late++;
      if (r.half) x.half++;
      x.lateMin += r.late_minutes ?? 0;
      x.worked += r.worked_minutes ?? 0;
      x.ot += r.overtime_minutes ?? 0;
    }
    return [...g.values()].sort((a, b) => String(a.label).localeCompare(String(b.label)));
  }, [rows, view, leavesByEmp]);

  const detailedCols = [
    { key: 'work_date', label: 'Date', render: (r) => fmtDate(r.work_date), csv: (r) => r.work_date },
    { key: 'emp_code', label: 'PIN' },
    { key: 'name', label: 'Name', render: empName, csv: empName },
    { key: 'department', label: 'Department', render: (r) => r.department ?? '—' },
    { key: 'shift', label: 'Shift', render: (r) => r.shift ?? '—' },
    { key: 'first_in', label: 'In', render: (r) => fmtTime(r.first_in), csv: (r) => fmtTime(r.first_in) },
    { key: 'last_out', label: 'Out', render: (r) => <>{fmtTime(r.last_out)}{r.auto_out && <span className="auto-tag">auto</span>}</>, csv: (r) => r.auto_out ? `${fmtTime(r.last_out)} (auto)` : fmtTime(r.last_out) },
    { key: 'late_minutes', label: 'Late', num: true, render: (r) => minutesToHM(r.late_minutes), csv: (r) => r.late_minutes },
    { key: 'worked_minutes', label: 'Worked', num: true, render: (r) => minutesToHM(r.worked_minutes), csv: (r) => r.worked_minutes },
    { key: 'overtime_minutes', label: 'OT', num: true, render: (r) => minutesToHM(r.overtime_minutes), csv: (r) => r.overtime_minutes },
    { key: 'status', label: 'Status', render: (r) => <><Badge value={r.status} />{r.half && <span className="auto-tag">half day</span>}</>, csv: (r) => (r.half ? `${r.status} (half day)` : r.status) },
  ];
  const groupCols = [
    { key: 'label', label: view === 'employee' ? 'Employee' : view === 'department' ? 'Department' : 'Shift' },
    { key: 'present', label: 'Present', num: true },
    { key: 'absent', label: 'Absent', num: true },
    { key: 'incomplete', label: 'Incomplete', num: true },
    { key: 'leave', label: 'Leave', num: true },
    { key: 'paidLeave', label: 'Paid lv', num: true },
    { key: 'unpaidLeave', label: 'Unpaid lv', num: true },
    { key: 'half', label: 'Half days', num: true },
    { key: 'bonus', label: 'H.bonus', num: true },
    { key: 'attendance', label: 'Attendance', num: true,
      render: (r) => { const s = r.present + r.incomplete + r.absent; return s ? `${Math.round(((r.present + r.incomplete) / s) * 100)}%` : '—'; },
      csv: (r) => { const s = r.present + r.incomplete + r.absent; return s ? Math.round(((r.present + r.incomplete) / s) * 100) : ''; } },
    { key: 'punctual', label: 'On time', num: true,
      render: (r) => { const a = r.present + r.incomplete; return a ? `${Math.round(((a - r.late) / a) * 100)}%` : '—'; },
      csv: (r) => { const a = r.present + r.incomplete; return a ? Math.round(((a - r.late) / a) * 100) : ''; } },
    { key: 'late', label: 'Late days', num: true },
    { key: 'lateMin', label: 'Late', num: true, render: (r) => minutesToHM(r.lateMin), csv: (r) => r.lateMin },
    { key: 'worked', label: 'Worked', num: true, render: (r) => minutesToHM(r.worked), csv: (r) => r.worked },
    { key: 'ot', label: 'Overtime', num: true, render: (r) => minutesToHM(r.ot), csv: (r) => r.ot },
  ];

  const isDetailed = view === 'detailed';
  const cols = isDetailed ? detailedCols : groupCols;
  const data = isDetailed ? rows : grouped;
  const viewLabel = VIEWS.find(([k]) => k === view)?.[1];

  function exportCSV() {
    const csvCols = cols.map((c) => ({ label: c.label, get: c.csv ?? ((r) => r[c.key]) }));
    downloadCSV(`report_${view}_${from}_${to}.csv`, data, csvCols);
  }

  // One-click branded PDF (landscape — report tables are wide). Same letterhead,
  // logo, footer and no URL link as the Statement export.
  async function buildPdf() {
    if (!data.length) return;
    const { downloadReportPDF } = await import('../lib/pdf');
    const rangeLabel = `${fmtDate(from)} – ${fmtDate(to)}`;
    const hero = [
      { value: String(totals.present), label: 'Present', tone: 'green' },
      { value: String(totals.absent), label: 'Absent', tone: 'red' },
      { value: String(totals.late), label: 'Late', tone: 'amber' },
      { value: String(totals.leave), label: 'On leave', tone: 'blue' },
      { value: minutesToHM(totals.worked), label: 'Worked', tone: 'neutral' },
    ];
    const sched = totals.present + totals.absent;
    const ring = { pct: sched ? Math.round((totals.present / sched) * 100) : 0, label: 'Attendance' };
    const dist = [
      { label: 'Present', value: totals.present, color: [21, 145, 83] },
      { label: 'Absent', value: totals.absent, color: [206, 44, 49] },
      { label: 'Leave', value: totals.leave, color: [40, 102, 222] },
      { label: 'Half', value: totals.half, color: [176, 106, 11] },
      { label: 'Bonus', value: totals.bonus, color: [114, 41, 255] },
    ];
    const figures = [
      ['Records', isDetailed ? rows.length : `${grouped.length} group${grouped.length === 1 ? '' : 's'}`],
      ['Present', totals.present], ['Absent', totals.absent], ['Late', totals.late],
      ['On leave', totals.leave], ['Paid leave', totals.paidLeave], ['Unpaid leave', totals.unpaidLeave],
      ['Half days', totals.half], ['Holiday bonus', totals.bonus],
      ['Total worked', minutesToHM(totals.worked)], ['Total overtime', minutesToHM(totals.ot)],
      ['Date range', rangeLabel],
    ];
    // Scoped to one employee → a personal report titled with their name / dept / shift.
    const selEmp = emp ? (emps.data ?? []).find((e) => String(e.id) === String(emp)) : null;
    const baseFilters = [dept && `Dept: ${dept}`, shift && `Shift: ${shift}`, stat && `Status: ${stat}`].filter(Boolean).join('  ·  ');
    const subject = selEmp ? (empName(selEmp) || `PIN ${selEmp.emp_code}`) : viewLabel;
    const sub = selEmp
      ? `PIN ${selEmp.emp_code}  ·  ${selEmp.department?.name || 'No department'}  ·  ${selEmp.shift?.name || 'No shift'}  ·  ${rangeLabel}${baseFilters ? `  ·  ${baseFilters}` : ''}`
      : `${rangeLabel}${baseFilters ? `  ·  ${baseFilters}` : ''}`;
    const common = {
      fileName: `Attendance report - ${subject} - ${from} to ${to}`,
      kicker: 'Attendance report', subject, sub,
      orientation: 'landscape', ring, hero, dist, figures, legend: REPORTS_LEGEND,
    };
    if (isDetailed) {
      const columns = ['Date', 'PIN', 'Name', 'Department', 'Shift', 'In', 'Out', 'Late', 'Worked', 'OT', 'Status'];
      const pdfRows = rows.map((r) => [
        `${fmtDate(r.work_date)} · ${wd(r.work_date)}`, r.emp_code, empName(r), r.department ?? '—', r.shift ?? '—',
        r.first_in ? fmtTime(r.first_in) : '—', r.last_out ? fmtTime(r.last_out) : '—',
        (r.late_minutes ?? 0) > 0 ? hmS(r.late_minutes) : '—',
        minutesToHM(r.worked_minutes),
        (r.overtime_minutes ?? 0) > 0 ? hmS(r.overtime_minutes) : '—',
        r.status,
      ]);
      downloadReportPDF({ ...common,
        detail: { label: viewLabel, columns, rows: pdfRows, statusCol: 10, numCols: [7, 8, 9],
          widths: { 0: 96, 1: 32, 2: 104, 3: 86, 4: 82, 5: 42, 6: 42, 7: 46, 8: 54, 9: 44 } } });
    } else {
      const groupHead = view === 'employee' ? 'Employee' : view === 'department' ? 'Department' : 'Shift';
      const columns = [groupHead, 'Present', 'Absent', 'Leave', 'Paid lv', 'Unpaid lv', 'Half', 'Bonus', 'Att %', 'On-time %', 'Late', 'Worked', 'OT'];
      const pdfRows = grouped.map((g) => {
        const att = g.present + g.incomplete + g.absent, att2 = g.present + g.incomplete;
        return [g.label, g.present, g.absent, g.leave, g.paidLeave, g.unpaidLeave, g.half, g.bonus,
          pct(att2, att), att2 ? pct(att2 - g.late, att2) : '—',
          g.late, minutesToHM(g.worked), minutesToHM(g.ot)];
      });
      downloadReportPDF({ ...common,
        roster: { label: viewLabel, columns, rows: pdfRows, statusCol: -1,
          numCols: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], widths: { 0: 130 } } });
    }
  }

  const filterNote = [
    dept && `Dept: ${dept}`, shift && `Shift: ${shift}`,
    emp && `Employee: ${empName((emps.data ?? []).find((e) => String(e.id) === String(emp)) || {})}`,
    stat && `Status: ${stat}`,
  ].filter(Boolean).join(' · ');

  return (
    <>
      <div className="page-title">
        <div>
          <h1>Reports</h1>
          <p className="page-intro">By day, person, department or shift.</p>
        </div>
        <div className="inline-actions no-print">
          <button className="btn" onClick={exportCSV} disabled={!data.length}><Download size={15} /> CSV</button>
          <button className="btn primary" onClick={buildPdf} disabled={!data.length}><FileText size={15} /> PDF</button>
        </div>
      </div>

      <div className="tabs no-print">
        {VIEWS.map(([k, label]) => (
          <button key={k} className={k === view ? 'active' : ''} onClick={() => setView(k)}>{label}</button>
        ))}
      </div>

      <Card className="no-print overflow-visible">
        <div className="row">
          <Field label="Date range"><DateRangePicker from={from} to={to} onApply={(f, t) => { setFrom(f); setTo(t); }} /></Field>
          <Field label="Department">
            <select value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">All</option>
              {(depts.data ?? []).map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Shift">
            <select value={shift} onChange={(e) => setShift(e.target.value)}>
              <option value="">All</option>
              {(shifts.data ?? []).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Employee">
            <select value={emp} onChange={(e) => setEmp(e.target.value)}>
              <option value="">All</option>
              {(emps.data ?? []).filter((e) => e.track_attendance).map((e) => (
                <option key={e.id} value={e.id}>{e.emp_code} · {empName(e)}</option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select value={stat} onChange={(e) => setStat(e.target.value)}>
              <option value="">All</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
      </Card>

      <div className="print-section">Summary</div>
      <div className="report-summary">
        <Stat icon={UserCheck} tone="ok" label="Present" value={totals.present} />
        <Stat icon={UserX} tone="danger" label="Absent" value={totals.absent} />
        <Stat icon={Clock} tone="warn" label="Late" value={totals.late} />
        <Stat icon={Plane} tone="sky" label="On leave" value={totals.leave} hint={totals.leave ? `${totals.paidLeave} paid · ${totals.unpaidLeave} unpaid` : ''} />
        {totals.half > 0 && <Stat icon={Hourglass} tone="warn" label="Half days" value={totals.half} hint="part-day absent" />}
        {totals.bonus > 0 && <Stat icon={Gift} tone="ok" label="Holiday bonus" value={totals.bonus} hint="bonus day(s)" />}
        <Stat icon={Timer} tone="violet" label="Worked" value={minutesToHM(totals.worked)} />
        <Stat icon={TrendingUp} tone="violet" label="Overtime" value={minutesToHM(totals.ot)} />
      </div>

      <ErrorBanner error={report.error} />
      <Card title={`${viewLabel} · ${fmtDate(from)} to ${fmtDate(to)}`} help="In grouped views, Attendance % is days present divided by days scheduled. On time % is the share of attended days that were not late. Export the rows as CSV or a clean PDF.">

        <Table loading={report.loading} rows={data} columns={cols} empty="No rows for this range / filter." />
      </Card>
    </>
  );
}
