import { useMemo, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { fmtTime, fmtDate, minutesToHM, todayISO } from '../lib/format';
import { Printer, UserCheck, UserX, Clock, Plane, CalendarOff, Timer, TrendingUp, Gift } from 'lucide-react';
import { Card, Field, Table, Badge, ErrorBanner, Stat } from '../components/ui.jsx';
import { withAutoCheckout } from '../lib/attendance';
import DateRangePicker from '../components/DateRangePicker.jsx';
import PrintHeader from '../components/PrintHeader.jsx';

// A clean, fully detailed attendance statement for ONE person over a date range:
// every day with its state, the scheduled shift, in/out (and how scanned), worked,
// late and overtime — plus a full summary of every factor and a legend. No pay,
// no rates: just the complete facts of attendance, ready to save as a PDF.

const empName = (e) => (e ? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() : '');
const OFF = new Set(['WeeklyOff', 'Holiday', 'Leave']);

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

function note(r) {
  if (r.status && OFF.has(r.status) && r.first_in) return 'Came in on a day off';
  if (r.auto_out) return 'Auto checkout at shift end';
  if (r.status === 'Incomplete') return 'No scan out';
  if (!r.status) return 'No record';
  return '';
}

export default function Statement() {
  const today = todayISO();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [emp, setEmp] = useState('');

  const emps = useQuery(() =>
    supabase.from('employees')
      .select('id,emp_code,first_name,last_name,track_attendance,department:departments(name),shift:shifts(name)')
      .order('emp_code'), []);

  useEffect(() => {
    if (emp || !emps.data?.length) return;
    const first = emps.data.find((e) => e.track_attendance) || emps.data[0];
    if (first) setEmp(String(first.id));
  }, [emps.data, emp]);

  const report = useQuery(() =>
    supabase.from('v_report_daily').select('*')
      .eq('employee_id', emp || -1)
      .gte('work_date', from).lte('work_date', to)
      .order('work_date'), [emp, from, to]);

  const person = (emps.data ?? []).find((e) => String(e.id) === String(emp));

  // Build a row for EVERY day in range (up to today), carrying every factor.
  const rows = useMemo(() => {
    const byDate = {};
    (report.data ?? []).forEach((r) => { byDate[r.work_date] = withAutoCheckout(r); });
    const end = to < today ? to : today;
    return daysInRange(from, end).map((d) => {
      const r = byDate[d] || null;
      return {
        id: d, date: d,
        status: r?.status ?? null,
        scheduled_in: r?.scheduled_in ?? null,
        scheduled_out: r?.scheduled_out ?? null,
        first_in: r?.first_in ?? null,
        last_out: r?.last_out ?? null,
        in_method: r?.first_in_method ?? null,
        out_method: r?.last_out_method ?? null,
        worked_minutes: r?.worked_minutes ?? null,
        late_minutes: r?.late_minutes ?? 0,
        overtime_minutes: r?.overtime_minutes ?? 0,
        break_minutes: r?.break_minutes ?? 0,
        auto_out: r?.auto_out ?? false,
      };
    });
  }, [report.data, from, to, today]);

  const s = useMemo(() => rows.reduce((a, r) => {
    if (r.status === 'Present') a.present++;
    else if (r.status === 'Incomplete') a.incomplete++;
    else if (r.status === 'Absent') a.absent++;
    else if (r.status === 'Leave') a.leave++;
    else if (r.status === 'WeeklyOff') a.off++;
    else if (r.status === 'Holiday') a.holiday++;
    else if (r.status === 'HolidayWorked') a.bonus++;
    else if (!r.status) a.norecord++;
    if ((r.late_minutes ?? 0) > 0) { a.lateDays++; a.lateMin += r.late_minutes; }
    a.overtime += r.overtime_minutes ?? 0;
    a.breakMin += r.break_minutes ?? 0;
    a.worked += r.worked_minutes ?? 0;
    if (r.auto_out) a.autoOut++;
    return a;
  }, { present: 0, incomplete: 0, absent: 0, leave: 0, off: 0, holiday: 0, bonus: 0, norecord: 0,
       lateDays: 0, lateMin: 0, overtime: 0, breakMin: 0, worked: 0, autoOut: 0 }), [rows]);

  const presentTotal = s.present + s.incomplete;          // days attended
  const scheduledDays = presentTotal + s.absent;          // working days that were due
  const attendanceRate = scheduledDays ? Math.round((presentTotal / scheduledDays) * 100) : null;
  const ontimeRate = presentTotal ? Math.round(((presentTotal - s.lateDays) / presentTotal) * 100) : null;
  const avgWorked = presentTotal ? Math.round(s.worked / presentTotal) : 0;

  const shiftLabel = (r) => (r.scheduled_in ? `${fmtTime(r.scheduled_in)}–${fmtTime(r.scheduled_out)}` : '—');
  const timeWithMethod = (t, m) => {
    if (!t) return '—';
    const n = methodName(m);
    return <>{fmtTime(t)}{n && <span className="muted" style={{ fontSize: '.68rem', marginLeft: 4 }}>{n}</span>}</>;
  };

  const cols = [
    { key: 'date', label: 'Date', render: (r) => (
      <span className={OFF.has(r.status) ? 'muted' : ''}><strong>{dlabel(r.date)}</strong> {weekday(r.date)}</span>
    ) },
    { key: 'status', label: 'Status', render: (r) => (r.status ? <Badge value={r.status} /> : <span className="muted">—</span>) },
    { key: 'shift', label: 'Shift', sortable: false, render: (r) => <span className="muted">{shiftLabel(r)}</span> },
    { key: 'first_in', label: 'In', render: (r) => timeWithMethod(r.first_in, r.in_method) },
    { key: 'last_out', label: 'Out', render: (r) => <>{timeWithMethod(r.last_out, r.out_method)}{r.auto_out && <span className="auto-tag">auto</span>}</> },
    { key: 'worked_minutes', label: 'Worked', num: true, render: (r) => minutesToHM(r.worked_minutes) },
    { key: 'late_minutes', label: 'Late', num: true, render: (r) => ((r.late_minutes ?? 0) > 0 ? minutesToHM(r.late_minutes) : '—') },
    { key: 'overtime_minutes', label: 'Overtime', num: true, render: (r) => ((r.overtime_minutes ?? 0) > 0 ? minutesToHM(r.overtime_minutes) : '—') },
    { key: 'note', label: 'Note', sortable: false, render: (r) => (note(r) ? <span className="muted">{note(r)}</span> : '') },
  ];

  // Exhaustive key figures for the summary / PDF.
  const figures = [
    ['Days in period', rows.length],
    ['Scheduled working days', scheduledDays],
    ['Days present', presentTotal],
    ['Days absent', s.absent],
    ['Attendance rate', attendanceRate == null ? '—' : `${attendanceRate}%`],
    ['On-time rate', ontimeRate == null ? '—' : `${ontimeRate}%`],
    ['Late days', s.lateDays],
    ['Total late', minutesToHM(s.lateMin)],
    ['Total worked', minutesToHM(s.worked)],
    ['Average per day', minutesToHM(avgWorked)],
    ['Total overtime', minutesToHM(s.overtime)],
    ['Breaks deducted', minutesToHM(s.breakMin)],
    ['Auto check-outs', s.autoOut],
    ['Incomplete (no scan out)', s.incomplete],
    ['On leave', s.leave],
    ['Holidays', s.holiday],
    ['Holiday bonus days', s.bonus],
    ['Weekly offs', s.off],
    ['No record yet', s.norecord],
  ];

  const rangeLabel = `${fmtDate(from)} – ${fmtDate(to)}`;
  const personLine = person
    ? `PIN ${person.emp_code}${person.department?.name ? ` · ${person.department.name}` : ''}${person.shift?.name ? ` · ${person.shift.name}` : ''}`
    : 'Pick a person to see their record.';

  return (
    <>
      <PrintHeader title="Attendance statement"
        subtitle={`${empName(person) || '—'} · ${rangeLabel}`} />

      <div className="page-title">
        <div>
          <h1>Statement</h1>
          <p className="page-intro">{empName(person) ? `${empName(person)} · ${rangeLabel}` : 'One person, day by day, over any dates.'}</p>
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
          <Field label="Dates">
            <DateRangePicker from={from} to={to} onApply={(f, t) => { setFrom(f); setTo(t); }} />
          </Field>
        </div>
      </Card>

      <p className="page-intro" style={{ marginTop: -4 }}>{personLine}</p>

      <div className="report-summary">
        <Stat icon={UserCheck} tone="ok" label="Present" value={presentTotal} hint={attendanceRate == null ? '' : `${attendanceRate}% attendance`} />
        <Stat icon={UserX} tone="danger" label="Absent" value={s.absent} />
        <Stat icon={Clock} tone="warn" label="Late days" value={s.lateDays} hint={s.lateMin ? minutesToHM(s.lateMin) : ''} />
        <Stat icon={TrendingUp} tone="violet" label="On-time" value={ontimeRate == null ? '—' : `${ontimeRate}%`} />
        <Stat icon={Plane} tone="sky" label="On leave" value={s.leave} />
        <Stat icon={CalendarOff} tone="violet" label="Days off" value={s.off + s.holiday}
          hint={s.holiday ? `${s.off} weekly · ${s.holiday} holiday` : 'weekly off'} />
        <Stat icon={Timer} tone="ok" label="Worked" value={minutesToHM(s.worked)} />
        <Stat icon={Timer} tone="violet" label="Overtime" value={minutesToHM(s.overtime)} />
        {s.bonus > 0 && <Stat icon={Gift} tone="ok" label="Holiday bonus" value={s.bonus} hint="bonus day(s) earned" />}
      </div>

      <ErrorBanner error={report.error || emps.error} />

      <Card title="Summary" help="Every figure for this person over the selected range. Attendance rate is days present out of days scheduled; on-time rate is the share of attended days that were not late.">
        <div className="keyfig">
          {figures.map(([label, value]) => (
            <div key={label}><span className="kf-label">{label}</span><span className="kf-value">{value}</span></div>
          ))}
        </div>
      </Card>

      <Card title={`Day by day · ${rangeLabel}`}
        help="Every day with its state, scheduled shift, the in/out times (and how they scanned — face, finger or card), hours worked, lateness and overtime. A holiday, approved leave or weekly off keeps its label even if the person tapped in.">
        <Table loading={report.loading} rows={rows} columns={cols}
          empty={emp ? 'No days to show for this range yet.' : 'Pick a person above.'} />
      </Card>

      <Card title="How to read this statement" className="help-section">
        <ul>
          <li><strong>Present</strong> — scanned in (and out) on a working day. <strong>Incomplete</strong> — scanned in but never out.</li>
          <li><strong>Absent</strong> — a working day, the shift had started, and there was no scan.</li>
          <li><strong>Late</strong> — the first scan came after the shift start plus the grace minutes.</li>
          <li><strong>Overtime</strong> — time scanned out past the shift end.</li>
          <li><strong>Auto</strong> — the person never scanned out, so the day was closed at the shift end, four hours later. The raw log still shows no scan-out.</li>
          <li><strong>Leave / Holiday / Weekly off</strong> — not counted absent. Any scan on these days is still shown, with a note.</li>
          <li><strong>HolidayWorked</strong> — a holiday volunteer who came in. It counts as a bonus day (one extra day, counted by you); their hours still add to the worked total.</li>
          <li><strong>face / finger / card</strong> next to a time shows how that scan was made. A card opens the gate but, on its own, never counts as attendance.</li>
        </ul>
      </Card>
    </>
  );
}
