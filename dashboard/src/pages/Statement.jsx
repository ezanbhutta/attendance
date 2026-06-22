import { useMemo, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { fmtTime, minutesToHM, todayISO } from '../lib/format';
import { Printer, UserCheck, UserX, Clock, Plane, CalendarOff, Timer } from 'lucide-react';
import { Card, Field, Table, Badge, ErrorBanner, Stat } from '../components/ui.jsx';
import { withAutoCheckout } from '../lib/attendance';
import PrintHeader from '../components/PrintHeader.jsx';
import MonthPicker from '../components/MonthPicker.jsx';

// A clean, stateful month statement for ONE person: every day of the month with
// its state (Present / Absent / Late / Leave / Holiday / Off), the in/out times,
// what they worked and how late they were — and, when they tapped on a day they
// were off, the scan is still shown with a note. No pay, no rates: just the facts
// of attendance, ready to save as a PDF.

const empName = (e) => (e ? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() : '');
const OFF = new Set(['WeeklyOff', 'Holiday', 'Leave']);

// Every YYYY-MM-DD in a month string 'YYYY-MM'.
function monthDays(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
// Anchored at noon so the weekday / label never rolls across a timezone.
const weekday = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
const dayNum = (d) => Number(d.slice(8, 10));
const monthName = (m) => new Date(`${m}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

// One short, plain note per day: a tap on a day off, an auto checkout, a missing
// scan out, or no record at all. Empty for an ordinary worked day.
function note(r) {
  if (r.status && OFF.has(r.status) && r.first_in) return 'Came in on a day off';
  if (r.auto_out) return 'Auto checkout at shift end';
  if (r.status === 'Incomplete') return 'No scan out';
  if (!r.status) return 'No record';
  return '';
}

export default function Statement() {
  const thisMonth = todayISO().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [emp, setEmp] = useState('');

  const emps = useQuery(() =>
    supabase.from('employees')
      .select('id,emp_code,first_name,last_name,track_attendance,department:departments(name),shift:shifts(name)')
      .order('emp_code'), []);

  // Pick the first counted person on first load so the page is never empty.
  useEffect(() => {
    if (emp || !emps.data?.length) return;
    const first = emps.data.find((e) => e.track_attendance) || emps.data[0];
    if (first) setEmp(String(first.id));
  }, [emps.data, emp]);

  // Use the month's REAL last day (June ends on the 30th, February on 28/29).
  // A hardcoded "-31" produces an impossible date like 2026-06-31, which the
  // database rejects as out of range — so query an actual valid boundary.
  const [mY, mM] = month.split('-').map(Number);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(new Date(mY, mM, 0).getDate()).padStart(2, '0')}`;
  const report = useQuery(() =>
    supabase.from('v_report_daily').select('*')
      .eq('employee_id', emp || -1)
      .gte('work_date', monthStart).lte('work_date', monthEnd)
      .order('work_date'), [emp, monthStart, monthEnd]);

  const person = (emps.data ?? []).find((e) => String(e.id) === String(emp));
  const today = todayISO();

  // Build a row for EVERY day up to today, joining the computed attendance.
  const rows = useMemo(() => {
    const byDate = {};
    (report.data ?? []).forEach((r) => { byDate[r.work_date] = withAutoCheckout(r); });
    return monthDays(month).filter((d) => d <= today).map((d) => {
      const r = byDate[d] || null;
      return {
        id: d, date: d,
        status: r?.status ?? null,
        first_in: r?.first_in ?? null,
        last_out: r?.last_out ?? null,
        worked_minutes: r?.worked_minutes ?? null,
        late_minutes: r?.late_minutes ?? 0,
        auto_out: r?.auto_out ?? false,
      };
    });
  }, [report.data, month, today]);

  const sum = useMemo(() => rows.reduce((a, r) => {
    if (r.status === 'Present') a.present++;
    else if (r.status === 'Absent') a.absent++;
    else if (r.status === 'Leave') a.leave++;
    else if (r.status === 'WeeklyOff') a.off++;
    else if (r.status === 'Holiday') a.holiday++;
    else if (r.status === 'Incomplete') a.incomplete++;
    if ((r.late_minutes ?? 0) > 0) a.late++;
    a.worked += r.worked_minutes ?? 0;
    return a;
  }, { present: 0, absent: 0, leave: 0, off: 0, holiday: 0, incomplete: 0, late: 0, worked: 0 }), [rows]);

  const cols = [
    { key: 'date', label: 'Date', render: (r) => (
      <span className={OFF.has(r.status) ? 'muted' : ''}><strong>{String(dayNum(r.date)).padStart(2, '0')}</strong> {weekday(r.date)}</span>
    ) },
    { key: 'status', label: 'Status', render: (r) => (r.status ? <Badge value={r.status} /> : <span className="muted">—</span>) },
    { key: 'first_in', label: 'In', render: (r) => fmtTime(r.first_in) },
    { key: 'last_out', label: 'Out', render: (r) => <>{fmtTime(r.last_out)}{r.auto_out && <span className="auto-tag">auto</span>}</> },
    { key: 'worked_minutes', label: 'Worked', num: true, render: (r) => minutesToHM(r.worked_minutes) },
    { key: 'late_minutes', label: 'Late', num: true, render: (r) => ((r.late_minutes ?? 0) > 0 ? minutesToHM(r.late_minutes) : '—') },
    { key: 'note', label: 'Note', sortable: false, render: (r) => (note(r) ? <span className="muted">{note(r)}</span> : '') },
  ];

  const personLine = person
    ? `PIN ${person.emp_code}${person.department?.name ? ` · ${person.department.name}` : ''}${person.shift?.name ? ` · ${person.shift.name}` : ''}`
    : 'Pick a person to see their month.';

  return (
    <>
      <PrintHeader title="Attendance statement"
        subtitle={`${empName(person) || '—'} · ${monthName(month)}`} />

      <div className="page-title">
        <div>
          <h1>Statement</h1>
          <p className="page-intro">{empName(person) ? `${empName(person)} · ${monthName(month)}` : 'Monthly attendance, one person at a time.'}</p>
        </div>
        <div className="inline-actions no-print">
          <button className="btn primary" onClick={() => window.print()} disabled={!rows.length}><Printer size={15} /> PDF</button>
        </div>
      </div>

      <Card className="no-print overflow-visible">
        <div className="row">
          <Field label="Employee">
            <select value={emp} onChange={(e) => setEmp(e.target.value)}>
              <option value="">—</option>
              {(emps.data ?? []).filter((e) => e.track_attendance).map((e) => (
                <option key={e.id} value={e.id}>{e.emp_code} · {empName(e)}</option>
              ))}
            </select>
          </Field>
          <Field label="Month">
            <MonthPicker value={month} max={thisMonth} onChange={setMonth} />
          </Field>
        </div>
      </Card>

      <p className="page-intro" style={{ marginTop: -4 }}>{personLine}</p>

      <div className="report-summary">
        <Stat icon={UserCheck} tone="ok" label="Present" value={sum.present} />
        <Stat icon={UserX} tone="danger" label="Absent" value={sum.absent} />
        <Stat icon={Clock} tone="warn" label="Late days" value={sum.late} />
        <Stat icon={Plane} tone="sky" label="On leave" value={sum.leave} />
        <Stat icon={CalendarOff} tone="violet" label="Days off" value={sum.off + sum.holiday}
          hint={sum.holiday ? `${sum.off} weekly · ${sum.holiday} holiday` : 'weekly off'} />
        <Stat icon={Timer} tone="violet" label="Worked" value={minutesToHM(sum.worked)} />
      </div>

      <ErrorBanner error={report.error || emps.error} />
      <Card title={`${empName(person) || 'Statement'} · ${monthName(month)}`}
        help="Every day of the month with its state. A holiday, approved leave or weekly off keeps that label even if the person tapped in — the scan still shows, with a note. Save as a PDF with the PDF button.">
        <Table loading={report.loading} rows={rows} columns={cols}
          empty={emp ? 'No days to show for this month yet.' : 'Pick a person above.'} />
      </Card>
    </>
  );
}
