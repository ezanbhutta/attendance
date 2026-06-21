import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { fmtDate, fmtTime, minutesToHM, todayISO, daysAgoISO } from '../lib/format';
import { LogOut, Clock, Hourglass, Timer, CalendarOff } from 'lucide-react';
import { Card, Field, Table, ErrorBanner, Stat } from '../components/ui.jsx';
import DateRangePicker from '../components/DateRangePicker.jsx';
import PrintHeader from '../components/PrintHeader.jsx';

const SHORT_MIN = 240;     // under 4 hours on a completed day
const LONG_MIN = 12 * 60;  // over 12 hours, usually a missed scan out
const VERY_LATE = 30;      // more than half an hour late

// Each kind of thing HR should look at, with its tone and a plain explanation.
const ISSUES = {
  'No scan out':     { tone: 'danger', icon: LogOut,     help: 'Scanned in but never scanned out on a past day. Add the missing scan on Fix a punch.' },
  'Very late':       { tone: 'warn',   icon: Clock,      help: 'Arrived more than 30 minutes after the shift start plus grace.' },
  'Short shift':     { tone: 'warn',   icon: Hourglass,  help: 'Scanned in and out but worked under four hours.' },
  'Long shift':      { tone: 'sky',    icon: Timer,      help: 'Recorded over twelve hours, often a missed scan out earlier in the day.' },
  'Came on day off': { tone: 'info',   icon: CalendarOff,help: 'Scanned on a day with no scheduled shift, like a weekly off. The day still counts as worked.' },
};
const ORDER = ['No scan out', 'Very late', 'Short shift', 'Long shift', 'Came on day off'];

const empName = (r) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || `PIN ${r.emp_code}`;

function detail(f) {
  switch (f.issue) {
    case 'No scan out':     return `in ${fmtTime(f.first_in)}, no out`;
    case 'Very late':       return `${f.late_minutes}m late, in ${fmtTime(f.first_in)}`;
    case 'Short shift':     return `${minutesToHM(f.worked_minutes)} worked`;
    case 'Long shift':      return `${minutesToHM(f.worked_minutes)} worked`;
    case 'Came on day off': return `in ${fmtTime(f.first_in)}${f.last_out ? `, out ${fmtTime(f.last_out)}` : ''}`;
    default:                return '';
  }
}

export default function Anomalies() {
  const today = todayISO();
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(today);
  const [dept, setDept] = useState('');
  const [kind, setKind] = useState('');

  const depts = useQuery(() => supabase.from('departments').select('name').order('name'), []);
  const emps = useQuery(() => supabase.from('employees').select('id,track_attendance,shift_id'), []);
  const report = useQuery(() => supabase.from('v_report_daily')
    .select('employee_id,emp_code,first_name,last_name,department,work_date,status,late_minutes,first_in,last_out,scheduled_in,scheduled_out,worked_minutes')
    .gte('work_date', from).lte('work_date', to)
    .order('work_date', { ascending: false }), [from, to]);

  // Build one row per issue found. Gate only people are never included.
  const flags = useMemo(() => {
    const counted = new Set((emps.data ?? []).filter((e) => e.track_attendance).map((e) => e.id));
    const hasShift = new Set((emps.data ?? []).filter((e) => e.shift_id != null).map((e) => e.id));
    const out = [];
    for (const r of (report.data ?? [])) {
      if (!counted.has(r.employee_id)) continue;
      const past = r.work_date < today;
      const worked = r.worked_minutes ?? 0;
      const issues = [];
      if (r.first_in && !r.last_out && past) issues.push('No scan out');
      if ((r.late_minutes ?? 0) > VERY_LATE) issues.push('Very late');
      if (r.first_in && r.last_out && worked > 0 && worked < SHORT_MIN) issues.push('Short shift');
      if (worked > LONG_MIN) issues.push('Long shift');
      if (r.first_in && !r.scheduled_in && hasShift.has(r.employee_id)) issues.push('Came on day off');
      for (const issue of issues) out.push({ id: `${r.employee_id}-${r.work_date}-${issue}`, ...r, issue });
    }
    return out;
  }, [report.data, emps.data, today]);

  const counts = useMemo(() => {
    const m = {};
    flags.forEach((f) => { m[f.issue] = (m[f.issue] || 0) + 1; });
    return m;
  }, [flags]);

  const shown = flags
    .filter((f) => !dept || f.department === dept)
    .filter((f) => !kind || f.issue === kind);

  const cols = [
    { key: 'work_date', label: 'Date', render: (r) => fmtDate(r.work_date) },
    { key: 'name', label: 'Person', sort: empName, render: (r) => <strong>{empName(r)}</strong> },
    { key: 'department', label: 'Department', render: (r) => r.department ?? '—' },
    { key: 'issue', label: 'Issue', render: (r) => (
      <span className={`flag ${ISSUES[r.issue]?.tone ?? ''}`}><span className="d" />{r.issue}</span>
    ) },
    { key: 'detail', label: 'Detail', sortable: false, render: (r) => <span className="muted">{detail(r)}</span> },
  ];

  return (
    <>
      <PrintHeader title="Anomalies to review" subtitle={`${fmtDate(from)} to ${fmtDate(to)}`} />
      <div className="page-title">
        <div>
          <h1>Anomalies</h1>
          <p className="page-intro">Days worth a second look, so nothing odd slips through. Gate only people are left out. Pick a range and a department, then click a tile to focus on one kind.</p>
        </div>
        <button className="btn no-print" onClick={() => window.print()}>Print</button>
      </div>

      <ErrorBanner error={report.error || emps.error} />

      <div className="grid cols-3">
        {ORDER.map((name) => {
          const { icon, tone, help } = ISSUES[name];
          const map = { danger: 'danger', warn: 'warn', sky: 'sky', info: 'violet' };
          return (
            <Stat key={name} icon={icon} tone={map[tone]} label={name} value={counts[name] ?? 0} help={help}
              onClick={() => setKind((k) => (k === name ? '' : name))} />
          );
        })}
      </div>

      <Card title={kind ? kind : 'All anomalies'}
        help="Each row is one day for one person that tripped a check. Fix missing scans on the Fix a punch page; the rest are just for your eyes."
        actions={
          <div className="inline-actions">
            <DateRangePicker from={from} to={to} onApply={(f, t) => { setFrom(f); setTo(t); }} />
            <select className="compact" value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">All departments</option>
              {(depts.data ?? []).map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
            {kind && <button className="btn sm" onClick={() => setKind('')}>Clear</button>}
          </div>
        }>
        <Table loading={report.loading} rows={shown} columns={cols}
          empty="Nothing to review in this range. All clean." />
      </Card>
    </>
  );
}
