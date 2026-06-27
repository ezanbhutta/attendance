import { useMemo, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { fmtTime, fmtDate, minutesToHM, todayISO } from '../lib/format';
import { Download, UserCheck, UserX, Clock, Plane, CalendarOff, Timer, TrendingUp, Gift } from 'lucide-react';
import { Card, Field, Table, Badge, ErrorBanner, Stat } from '../components/ui.jsx';
import { withAutoCheckout } from '../lib/attendance';
import DateRangePicker from '../components/DateRangePicker.jsx';
import PrintHeader from '../components/PrintHeader.jsx';
import { downloadReportPDF } from '../lib/pdf';

// A complete, shareable attendance record for ONE person, a whole SHIFT, or a
// whole DEPARTMENT over any date range — every day with its state, the reason it
// was off (holiday name, leave type + approval, weekly off), the in/out, hours,
// lateness, overtime and remarks. One click downloads it as a branded PDF.

const empName = (e) => (e ? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() : '');
const OFF = new Set(['WeeklyOff', 'Holiday', 'Leave']);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
function daysInRange(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const out = [];
  for (let d = new Date(fy, fm - 1, fd), end = new Date(ty, tm - 1, td); d <= end; d.setDate(d.getDate() + 1)) out.push(iso(d));
  return out;
}
const dlabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const weekday = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
const methodName = (m) => (m === 15 ? 'face' : m === 1 ? 'finger' : m == null ? '' : 'card');
const shiftLabel = (r) => (r.scheduled_in ? `${fmtTime(r.scheduled_in)}–${fmtTime(r.scheduled_out)}` : '—');

function plainNote(r) {
  if (r.auto_out) return 'Auto checkout at shift end';
  if (r.status === 'Incomplete') return 'No scan out';
  if (!r.status) return 'No record';
  if (r.status && OFF.has(r.status) && r.first_in) return 'Came in on a day off';
  return '';
}

const FIG = (s) => [
  ['Days in period', s.total], ['Scheduled working days', s.scheduled], ['Days present', s.presentTotal],
  ['Days absent', s.absent], ['Attendance rate', s.attendanceRate == null ? '—' : `${s.attendanceRate}%`],
  ['On-time rate', s.ontimeRate == null ? '—' : `${s.ontimeRate}%`],
  ['Late days', s.lateDays], ['Total late', minutesToHM(s.lateMin)], ['Total worked', minutesToHM(s.worked)],
  ['Average per day', minutesToHM(s.avgWorked)], ['Total overtime', minutesToHM(s.overtime)], ['Breaks deducted', minutesToHM(s.breakMin)],
  ['Auto check-outs', s.autoOut], ['Incomplete (no scan out)', s.incomplete], ['On leave', s.leave],
  ['Holidays', s.holiday], ['Holiday bonus days', s.bonus], ['Weekly offs', s.off],
];

const LEGEND = [
  'Present — scanned in (and out) on a working day. Incomplete — scanned in but never out.',
  'Absent — a working day, the shift had started, and there was no scan.',
  'Late — the first scan came after the shift start plus the grace minutes.',
  'Overtime — time scanned out past the shift end.',
  'Auto — never scanned out, so the day was closed at the shift end, four hours later.',
  'WeeklyOff / Holiday / Leave — not counted absent. The Remarks column gives the reason (holiday name, leave type and whether it was approved).',
  'HolidayWorked — a holiday volunteer who came in; counts as a bonus day, and their hours still add to the worked total.',
  'face / finger / card next to a time shows how that scan was made.',
];

export default function Statement() {
  const today = todayISO();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [scope, setScope] = useState('employee');   // employee | shift | department
  const [emp, setEmp] = useState('');
  const [shiftName, setShiftName] = useState('');
  const [deptName, setDeptName] = useState('');

  const emps = useQuery(() =>
    supabase.from('employees')
      .select('id,emp_code,first_name,last_name,track_attendance,weekly_off,department:departments(name),shift:shifts(name)')
      .order('emp_code'), []);
  const shifts = useQuery(() => supabase.from('shifts').select('name').order('name'), []);
  const depts = useQuery(() => supabase.from('departments').select('name').order('name'), []);
  const holidays = useQuery(() => supabase.from('holidays').select('the_date,name'), []);
  const leaves = useQuery(() => supabase.from('leaves').select('employee_id,leave_type,status,start_date,end_date'), []);
  const report = useQuery(() =>
    supabase.from('v_report_daily').select('*').gte('work_date', from).lte('work_date', to).order('work_date'), [from, to]);

  const counted = useMemo(() => (emps.data ?? []).filter((e) => e.track_attendance), [emps.data]);
  // Default selections once the lists load.
  useEffect(() => { if (!emp && counted.length) setEmp(String(counted[0].id)); }, [counted, emp]);
  useEffect(() => { if (!shiftName && shifts.data?.length) setShiftName(shifts.data[0].name); }, [shifts.data, shiftName]);
  useEffect(() => { if (!deptName && depts.data?.length) setDeptName(depts.data[0].name); }, [depts.data, deptName]);

  const holidaysByDate = useMemo(() => {
    const m = {}; (holidays.data ?? []).forEach((h) => { m[h.the_date] = h.name; }); return m;
  }, [holidays.data]);
  const leavesByEmp = useMemo(() => {
    const m = {}; (leaves.data ?? []).forEach((l) => { (m[l.employee_id] ||= []).push(l); }); return m;
  }, [leaves.data]);
  const reportByEmp = useMemo(() => {
    const m = {}; (report.data ?? []).forEach((r) => { (m[r.employee_id] ||= []).push(r); }); return m;
  }, [report.data]);

  // The reason a day was off / any note, as a plain remark.
  const remark = (e, r) => {
    const parts = [];
    if ((r.status === 'Holiday' || r.status === 'HolidayWorked') && holidaysByDate[r.date]) parts.push(holidaysByDate[r.date]);
    if (r.status === 'HolidayWorked') parts.push('worked · bonus day');
    const lv = (leavesByEmp[e.id] ?? []).find((l) => r.date >= l.start_date && r.date <= (l.end_date || l.start_date));
    if (lv) parts.push(`${cap(lv.leave_type)} leave (${lv.status})`);
    if (r.status === 'WeeklyOff') parts.push('Weekly off');
    const n = plainNote(r);
    if (n) parts.push(n);
    return parts.join(' · ');
  };

  // Build a person's day-by-day rows + summary.
  function buildPerson(e) {
    const byDate = {};
    (reportByEmp[e.id] ?? []).forEach((r) => { byDate[r.work_date] = withAutoCheckout(r); });
    const end = to < today ? to : today;
    const days = daysInRange(from, end).map((d) => {
      const r = byDate[d] || null;
      const row = {
        date: d, status: r?.status ?? null, scheduled_in: r?.scheduled_in ?? null, scheduled_out: r?.scheduled_out ?? null,
        first_in: r?.first_in ?? null, last_out: r?.last_out ?? null, in_method: r?.first_in_method ?? null, out_method: r?.last_out_method ?? null,
        worked_minutes: r?.worked_minutes ?? null, late_minutes: r?.late_minutes ?? 0, overtime_minutes: r?.overtime_minutes ?? 0,
        break_minutes: r?.break_minutes ?? 0, auto_out: r?.auto_out ?? false,
      };
      row.remark = remark(e, row);
      return row;
    });
    const s = days.reduce((a, r) => {
      if (r.status === 'Present') a.present++;
      else if (r.status === 'Incomplete') a.incomplete++;
      else if (r.status === 'Absent') a.absent++;
      else if (r.status === 'Leave') a.leave++;
      else if (r.status === 'WeeklyOff') a.off++;
      else if (r.status === 'Holiday') a.holiday++;
      else if (r.status === 'HolidayWorked') a.bonus++;
      else if (!r.status) a.norecord++;
      if ((r.late_minutes ?? 0) > 0) { a.lateDays++; a.lateMin += r.late_minutes; }
      a.overtime += r.overtime_minutes ?? 0; a.breakMin += r.break_minutes ?? 0; a.worked += r.worked_minutes ?? 0;
      if (r.auto_out) a.autoOut++;
      return a;
    }, { present: 0, incomplete: 0, absent: 0, leave: 0, off: 0, holiday: 0, bonus: 0, norecord: 0, lateDays: 0, lateMin: 0, overtime: 0, breakMin: 0, worked: 0, autoOut: 0 });
    s.total = days.length;
    s.presentTotal = s.present + s.incomplete;
    s.scheduled = s.presentTotal + s.absent;
    s.attendanceRate = s.scheduled ? Math.round((s.presentTotal / s.scheduled) * 100) : null;
    s.ontimeRate = s.presentTotal ? Math.round(((s.presentTotal - s.lateDays) / s.presentTotal) * 100) : null;
    s.avgWorked = s.presentTotal ? Math.round(s.worked / s.presentTotal) : 0;
    return { e, days, s };
  }

  const inScope = useMemo(() => {
    if (scope === 'shift') return counted.filter((e) => (e.shift?.name || '') === shiftName);
    if (scope === 'department') return counted.filter((e) => (e.department?.name || '') === deptName);
    return counted.filter((e) => String(e.id) === String(emp));
  }, [counted, scope, emp, shiftName, deptName]);

  const people = useMemo(() => inScope.map(buildPerson), [inScope, reportByEmp, holidaysByDate, leavesByEmp, from, to]);

  // Aggregate summary across everyone in scope (used for shift / department).
  const agg = useMemo(() => {
    const a = { present: 0, incomplete: 0, absent: 0, leave: 0, off: 0, holiday: 0, bonus: 0, norecord: 0, lateDays: 0, lateMin: 0, overtime: 0, breakMin: 0, worked: 0, autoOut: 0, total: 0 };
    people.forEach(({ s }) => { for (const k in a) a[k] += s[k] || 0; });
    a.presentTotal = a.present + a.incomplete;
    a.scheduled = a.presentTotal + a.absent;
    a.attendanceRate = a.scheduled ? Math.round((a.presentTotal / a.scheduled) * 100) : null;
    a.ontimeRate = a.presentTotal ? Math.round(((a.presentTotal - a.lateDays) / a.presentTotal) * 100) : null;
    a.avgWorked = a.presentTotal ? Math.round(a.worked / a.presentTotal) : 0;
    return a;
  }, [people]);

  const single = scope === 'employee';
  const one = people[0];                 // the person, in employee scope
  const sumForTiles = single ? (one?.s ?? agg) : agg;
  const rangeLabel = `${fmtDate(from)} – ${fmtDate(to)}`;
  const scopeLabel = scope === 'shift' ? (shiftName || '—') : scope === 'department' ? (deptName || '—') : (empName(one?.e) || '—');
  const personLine = single && one?.e
    ? `PIN ${one.e.emp_code}${one.e.department?.name ? ` · ${one.e.department.name}` : ''}${one.e.shift?.name ? ` · ${one.e.shift.name}` : ''}`
    : `${people.length} ${people.length === 1 ? 'person' : 'people'} · ${rangeLabel}`;

  // Day-by-day rows for one person, formatted for screen / PDF.
  const dayCols = [
    { key: 'date', label: 'Date', render: (r) => (<span className={OFF.has(r.status) ? 'muted' : ''}><strong>{dlabel(r.date)}</strong> {weekday(r.date)}</span>) },
    { key: 'status', label: 'Status', render: (r) => (r.status ? <Badge value={r.status} /> : <span className="muted">—</span>) },
    { key: 'shift', label: 'Shift', sortable: false, render: (r) => <span className="muted">{shiftLabel(r)}</span> },
    { key: 'first_in', label: 'In', render: (r) => (r.first_in ? <>{fmtTime(r.first_in)}{methodName(r.in_method) && <span className="muted" style={{ fontSize: '.68rem', marginLeft: 4 }}>{methodName(r.in_method)}</span>}</> : '—') },
    { key: 'last_out', label: 'Out', render: (r) => (r.last_out ? <>{fmtTime(r.last_out)}{r.auto_out && <span className="auto-tag">auto</span>}</> : '—') },
    { key: 'worked_minutes', label: 'Worked', num: true, render: (r) => minutesToHM(r.worked_minutes) },
    { key: 'late_minutes', label: 'Late', num: true, render: (r) => ((r.late_minutes ?? 0) > 0 ? minutesToHM(r.late_minutes) : '—') },
    { key: 'overtime_minutes', label: 'OT', num: true, render: (r) => ((r.overtime_minutes ?? 0) > 0 ? minutesToHM(r.overtime_minutes) : '—') },
    { key: 'remark', label: 'Remarks', sortable: false, render: (r) => (r.remark ? <span className="muted">{r.remark}</span> : '') },
  ];

  // Roster summary rows (shift / department on screen).
  const rosterRows = people.map(({ e, s }) => ({
    id: e.id, name: empName(e) || `PIN ${e.emp_code}`, dept: e.department?.name ?? '—',
    present: s.presentTotal, absent: s.absent, late: s.lateDays, leave: s.leave, bonus: s.bonus,
    worked: s.worked, attendance: s.attendanceRate,
  }));
  const rosterCols = [
    { key: 'name', label: 'Person', render: (r) => <strong>{r.name}</strong> },
    { key: 'dept', label: 'Department' },
    { key: 'present', label: 'Present', num: true },
    { key: 'absent', label: 'Absent', num: true },
    { key: 'late', label: 'Late', num: true },
    { key: 'leave', label: 'Leave', num: true },
    { key: 'bonus', label: 'H.bonus', num: true },
    { key: 'attendance', label: 'Attendance', num: true, render: (r) => (r.attendance == null ? '—' : `${r.attendance}%`), sort: (r) => r.attendance ?? -1 },
    { key: 'worked', label: 'Worked', num: true, render: (r) => minutesToHM(r.worked) },
  ];

  // ── One-click PDF ──────────────────────────────────────────────────────────
  const meth = (m) => { const n = methodName(m); return n ? ` ${n}` : ''; };
  const pdfRow = (r) => [
    `${dlabel(r.date)}, ${weekday(r.date)}`,
    r.status || '—',
    shiftLabel(r),
    r.first_in ? fmtTime(r.first_in) + meth(r.in_method) : '—',
    r.last_out ? fmtTime(r.last_out) + meth(r.out_method) + (r.auto_out ? ' (auto)' : '') : '—',
    minutesToHM(r.worked_minutes),
    (r.late_minutes ?? 0) > 0 ? minutesToHM(r.late_minutes) : '—',
    (r.overtime_minutes ?? 0) > 0 ? minutesToHM(r.overtime_minutes) : '—',
    r.remark || '',
  ];
  const PDF_COLS = ['Date', 'Status', 'Shift', 'In', 'Out', 'Worked', 'Late', 'OT', 'Remarks'];

  function buildPdf() {
    if (!people.length) return;
    if (single) {
      downloadReportPDF({
        title: 'Attendance statement',
        subtitle: `${scopeLabel} · ${rangeLabel}`, metaLine: personLine,
        fileName: `Statement - ${scopeLabel} - ${from} to ${to}`,
        figures: FIG(one.s), columns: PDF_COLS, rows: one.days.map(pdfRow), legend: LEGEND,
      });
    } else {
      const kind = scope === 'shift' ? 'Shift' : 'Department';
      downloadReportPDF({
        title: `Attendance — ${scopeLabel}`,
        subtitle: `${kind} · ${rangeLabel}`, metaLine: `${people.length} ${people.length === 1 ? 'person' : 'people'}`,
        fileName: `${kind} - ${scopeLabel} - ${from} to ${to}`,
        figures: FIG(agg),
        sections: people.map(({ e, s, days }) => ({
          heading: empName(e) || `PIN ${e.emp_code}`,
          subLine: `PIN ${e.emp_code}${e.department?.name ? ` · ${e.department.name}` : ''}${e.shift?.name ? ` · ${e.shift.name}` : ''}`,
          figures: FIG(s), columns: PDF_COLS, rows: days.map(pdfRow),
        })),
        legend: LEGEND,
      });
    }
  }

  const tiles = (
    <div className="report-summary">
      <Stat icon={UserCheck} tone="ok" label="Present" value={sumForTiles.presentTotal} hint={sumForTiles.attendanceRate == null ? '' : `${sumForTiles.attendanceRate}% attendance`} />
      <Stat icon={UserX} tone="danger" label="Absent" value={sumForTiles.absent} />
      <Stat icon={Clock} tone="warn" label="Late days" value={sumForTiles.lateDays} hint={sumForTiles.lateMin ? minutesToHM(sumForTiles.lateMin) : ''} />
      <Stat icon={TrendingUp} tone="violet" label="On-time" value={sumForTiles.ontimeRate == null ? '—' : `${sumForTiles.ontimeRate}%`} />
      <Stat icon={Plane} tone="sky" label="On leave" value={sumForTiles.leave} />
      <Stat icon={CalendarOff} tone="violet" label="Days off" value={sumForTiles.off + sumForTiles.holiday} hint={sumForTiles.holiday ? `${sumForTiles.off} weekly · ${sumForTiles.holiday} holiday` : 'weekly off'} />
      <Stat icon={Timer} tone="ok" label="Worked" value={minutesToHM(sumForTiles.worked)} />
      <Stat icon={Timer} tone="violet" label="Overtime" value={minutesToHM(sumForTiles.overtime)} />
      {sumForTiles.bonus > 0 && <Stat icon={Gift} tone="ok" label="Holiday bonus" value={sumForTiles.bonus} hint="bonus day(s)" />}
    </div>
  );

  return (
    <>
      <PrintHeader title="Attendance statement" subtitle={`${scopeLabel} · ${rangeLabel}`} />

      <div className="page-title">
        <div>
          <h1>Statement</h1>
          <p className="page-intro">One person, a shift, or a department — day by day, over any dates, ready to share.</p>
        </div>
        <div className="inline-actions no-print">
          <button className="btn primary" onClick={buildPdf} disabled={!people.length}><Download size={15} /> Download PDF</button>
        </div>
      </div>

      <Card className="no-print overflow-visible">
        <div className="row">
          <Field label="For">
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="employee">An employee</option>
              <option value="shift">A whole shift</option>
              <option value="department">A whole department</option>
            </select>
          </Field>
          {scope === 'employee' && (
            <Field label="Employee">
              <select value={emp} onChange={(e) => setEmp(e.target.value)}>
                <option value="">—</option>
                {counted.map((e) => <option key={e.id} value={e.id}>{e.emp_code} · {empName(e)}</option>)}
              </select>
            </Field>
          )}
          {scope === 'shift' && (
            <Field label="Shift">
              <select value={shiftName} onChange={(e) => setShiftName(e.target.value)}>
                {(shifts.data ?? []).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </Field>
          )}
          {scope === 'department' && (
            <Field label="Department">
              <select value={deptName} onChange={(e) => setDeptName(e.target.value)}>
                {(depts.data ?? []).map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Dates">
            <DateRangePicker from={from} to={to} onApply={(f, t) => { setFrom(f); setTo(t); }} />
          </Field>
        </div>
      </Card>

      <p className="page-intro" style={{ marginTop: -4 }}>{personLine}</p>

      <div className="print-section">Summary</div>
      {tiles}

      <ErrorBanner error={report.error || emps.error} />

      <Card title="Summary" help="Every figure for the selection over the range. Attendance rate is days present out of days scheduled; on-time rate is the share of attended days that were not late.">
        <div className="keyfig">
          {FIG(sumForTiles).map(([label, value]) => (
            <div key={label}><span className="kf-label">{label}</span><span className="kf-value">{value}</span></div>
          ))}
        </div>
      </Card>

      {single ? (
        <Card title={`Day by day · ${scopeLabel} · ${rangeLabel}`}
          help="Every day with its state, scheduled shift, in/out (and how scanned), hours, lateness, overtime, and the Remarks — including why a day was off (holiday name, leave type and approval, weekly off).">
          <Table loading={report.loading} rows={one?.days ?? []} columns={dayCols}
            empty={emp ? 'No days to show for this range yet.' : 'Pick a person above.'} />
        </Card>
      ) : (
        <Card title={`${scopeLabel} · ${people.length} ${people.length === 1 ? 'person' : 'people'}`}
          help="A line per person. Download the PDF for each person's full day-by-day record with remarks.">
          <Table loading={report.loading} rows={rosterRows} columns={rosterCols}
            empty="Nobody in this selection." />
        </Card>
      )}

      <Card title="How to read this statement" className="help-section">
        <ul>{LEGEND.map((l) => <li key={l}>{l}</li>)}</ul>
      </Card>
    </>
  );
}
