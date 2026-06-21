import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { fmtTime, minutesToHM, fmtDate, todayISO, daysAgoISO } from '../lib/format';
import { downloadCSV } from '../lib/csv';
import { Download, Printer, UserCheck, UserX, Clock, Plane, Timer, TrendingUp } from 'lucide-react';
import { Card, Field, Table, Badge, ErrorBanner, Stat } from '../components/ui.jsx';
import DateRangePicker from '../components/DateRangePicker.jsx';
import PrintHeader from '../components/PrintHeader.jsx';

const STATUSES = ['Present', 'Incomplete', 'Absent', 'Late', 'Leave', 'Holiday', 'WeeklyOff'];
const VIEWS = [
  ['detailed', 'Day by day'],
  ['employee', 'By employee'],
  ['department', 'By department'],
  ['shift', 'By shift'],
];

const empName = (r) => r.employee?.trim() || `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim();

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
    supabase.from('employees').select('id,emp_code,first_name,last_name,track_attendance,shift:shifts(name)').order('emp_code'), []);

  const report = useQuery(() =>
    supabase.from('v_report_daily').select('*')
      .gte('work_date', from).lte('work_date', to)
      .order('work_date', { ascending: false }).order('emp_code'), [from, to]);

  const shiftBy = useMemo(() => {
    const m = {};
    (emps.data ?? []).forEach((e) => { m[e.id] = e.shift?.name ?? null; });
    return m;
  }, [emps.data]);

  // Attach shift, then apply all filters. "Late" status = any positive late mins.
  const rows = useMemo(() => {
    const countedIds = new Set((emps.data ?? []).filter((e) => e.track_attendance).map((e) => e.id));
    return (report.data ?? [])
      .map((r) => ({ ...r, shift: shiftBy[r.employee_id] ?? null }))
      .filter((r) => countedIds.has(r.employee_id))   // gate-only (CEO/Admin) never in reports
      .filter((r) => !dept || r.department === dept)
      .filter((r) => !shift || r.shift === shift)
      .filter((r) => !emp || String(r.employee_id) === String(emp))
      .filter((r) => !stat || (stat === 'Late' ? (r.late_minutes ?? 0) > 0 : r.status === stat));
  }, [report.data, emps.data, shiftBy, dept, shift, emp, stat]);

  const totals = useMemo(() => rows.reduce((a, r) => {
    if (r.status === 'Present') a.present++;
    else if (r.status === 'Absent') a.absent++;
    else if (r.status === 'Leave') a.leave++;
    if ((r.late_minutes ?? 0) > 0) a.late++;
    a.worked += r.worked_minutes ?? 0;
    a.ot += r.overtime_minutes ?? 0;
    return a;
  }, { present: 0, absent: 0, leave: 0, late: 0, worked: 0, ot: 0 }), [rows]);

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
      if (!g.has(k)) g.set(k, { label: labelFn(r), code: r.emp_code, present: 0, absent: 0, leave: 0, incomplete: 0, late: 0, lateMin: 0, worked: 0, ot: 0 });
      const x = g.get(k);
      if (r.status === 'Present') x.present++;
      else if (r.status === 'Absent') x.absent++;
      else if (r.status === 'Leave') x.leave++;
      else if (r.status === 'Incomplete') x.incomplete++;
      if ((r.late_minutes ?? 0) > 0) x.late++;
      x.lateMin += r.late_minutes ?? 0;
      x.worked += r.worked_minutes ?? 0;
      x.ot += r.overtime_minutes ?? 0;
    }
    return [...g.values()].sort((a, b) => String(a.label).localeCompare(String(b.label)));
  }, [rows, view]);

  const detailedCols = [
    { key: 'work_date', label: 'Date', render: (r) => fmtDate(r.work_date), csv: (r) => r.work_date },
    { key: 'emp_code', label: 'PIN' },
    { key: 'name', label: 'Name', render: empName, csv: empName },
    { key: 'department', label: 'Department', render: (r) => r.department ?? '—' },
    { key: 'shift', label: 'Shift', render: (r) => r.shift ?? '—' },
    { key: 'first_in', label: 'In', render: (r) => fmtTime(r.first_in), csv: (r) => fmtTime(r.first_in) },
    { key: 'last_out', label: 'Out', render: (r) => fmtTime(r.last_out), csv: (r) => fmtTime(r.last_out) },
    { key: 'late_minutes', label: 'Late', num: true, render: (r) => minutesToHM(r.late_minutes), csv: (r) => r.late_minutes },
    { key: 'worked_minutes', label: 'Worked', num: true, render: (r) => minutesToHM(r.worked_minutes), csv: (r) => r.worked_minutes },
    { key: 'overtime_minutes', label: 'OT', num: true, render: (r) => minutesToHM(r.overtime_minutes), csv: (r) => r.overtime_minutes },
    { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} />, csv: (r) => r.status },
  ];
  const groupCols = [
    { key: 'label', label: view === 'employee' ? 'Employee' : view === 'department' ? 'Department' : 'Shift' },
    { key: 'present', label: 'Present', num: true },
    { key: 'absent', label: 'Absent', num: true },
    { key: 'incomplete', label: 'Incomplete', num: true },
    { key: 'leave', label: 'Leave', num: true },
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

  const filterNote = [
    dept && `Dept: ${dept}`, shift && `Shift: ${shift}`,
    emp && `Employee: ${empName((emps.data ?? []).find((e) => String(e.id) === String(emp)) || {})}`,
    stat && `Status: ${stat}`,
  ].filter(Boolean).join(' · ');

  return (
    <>
      <PrintHeader title={`Attendance report: ${viewLabel}`}
        subtitle={`${fmtDate(from)} to ${fmtDate(to)}${filterNote ? ` · ${filterNote}` : ''}`} />

      <div className="page-title">
        <div>
          <h1>Reports</h1>
          <p className="page-intro">Pick a view and filters, then export a clean PDF or CSV. Gate only people are never included.</p>
        </div>
        <div className="inline-actions no-print">
          <button className="btn" onClick={exportCSV} disabled={!data.length}><Download size={15} /> CSV</button>
          <button className="btn primary" onClick={() => window.print()} disabled={!data.length}><Printer size={15} /> PDF</button>
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

      <div className="report-summary">
        <Stat icon={UserCheck} tone="ok" label="Present" value={totals.present} />
        <Stat icon={UserX} tone="danger" label="Absent" value={totals.absent} />
        <Stat icon={Clock} tone="warn" label="Late" value={totals.late} />
        <Stat icon={Plane} tone="sky" label="On leave" value={totals.leave} />
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
