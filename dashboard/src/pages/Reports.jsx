import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { fmtTime, minutesToHM, todayISO, daysAgoISO } from '../lib/format';
import { downloadCSV } from '../lib/csv';
import { Card, Field, Table, Badge, ErrorBanner } from '../components/ui.jsx';

const nameCol = { key: 'employee', label: 'Employee', render: (r) => r.employee ?? `${r.first_name} ${r.last_name ?? ''}`.trim() };
const status = { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} />, csv: (r) => r.status };

const TABS = {
  timecard: {
    label: 'Total Time Card', view: 'v_total_time_card', dateCol: 'work_date',
    columns: [
      { key: 'work_date', label: 'Date' }, { key: 'emp_code', label: 'Code' }, nameCol,
      { key: 'department', label: 'Dept' },
      { key: 'first_in', label: 'In', render: (r) => fmtTime(r.first_in), csv: (r) => fmtTime(r.first_in) },
      { key: 'last_out', label: 'Out', render: (r) => fmtTime(r.last_out), csv: (r) => fmtTime(r.last_out) },
      { key: 'in_method', label: 'In via', render: (r) => <Badge value={r.in_method} kind={r.in_method} />, csv: (r) => r.in_method },
      { key: 'out_method', label: 'Out via', render: (r) => <Badge value={r.out_method} kind={r.out_method} />, csv: (r) => r.out_method },
      { key: 'worked_hours', label: 'Hours', num: true },
      { key: 'late_minutes', label: 'Late', num: true }, { key: 'overtime_minutes', label: 'OT', num: true },
      status,
    ],
  },
  daily: {
    label: 'Daily', view: 'v_report_daily', dateCol: 'work_date',
    columns: [
      { key: 'work_date', label: 'Date' }, { key: 'emp_code', label: 'Code' }, nameCol,
      { key: 'department', label: 'Dept' },
      { key: 'first_in', label: 'In', render: (r) => fmtTime(r.first_in), csv: (r) => fmtTime(r.first_in) },
      { key: 'last_out', label: 'Out', render: (r) => fmtTime(r.last_out), csv: (r) => fmtTime(r.last_out) },
      { key: 'late_minutes', label: 'Late', num: true, render: (r) => minutesToHM(r.late_minutes), csv: (r) => r.late_minutes },
      { key: 'worked_minutes', label: 'Worked', num: true, render: (r) => minutesToHM(r.worked_minutes), csv: (r) => r.worked_minutes },
      { key: 'overtime_minutes', label: 'OT', num: true, render: (r) => minutesToHM(r.overtime_minutes), csv: (r) => r.overtime_minutes },
      status,
    ],
  },
  weekly: {
    label: 'Weekly', view: 'v_report_weekly', dateCol: 'week_start',
    columns: [
      { key: 'week_start', label: 'Week of' }, { key: 'emp_code', label: 'Code' }, nameCol, { key: 'department', label: 'Dept' },
      { key: 'present_days', label: 'Present', num: true }, { key: 'absent_days', label: 'Absent', num: true },
      { key: 'leave_days', label: 'Leave', num: true },
      { key: 'worked_minutes', label: 'Worked', num: true, render: (r) => minutesToHM(r.worked_minutes), csv: (r) => r.worked_minutes },
      { key: 'late_minutes', label: 'Late', num: true }, { key: 'overtime_minutes', label: 'OT', num: true },
    ],
  },
  monthly: {
    label: 'Monthly', view: 'v_report_monthly', dateCol: 'month', isMonth: true,
    columns: [
      { key: 'month', label: 'Month' }, { key: 'emp_code', label: 'Code' }, nameCol, { key: 'department', label: 'Dept' },
      { key: 'present_days', label: 'Present', num: true }, { key: 'absent_days', label: 'Absent', num: true },
      { key: 'leave_days', label: 'Leave', num: true },
      { key: 'worked_minutes', label: 'Worked', num: true, render: (r) => minutesToHM(r.worked_minutes), csv: (r) => r.worked_minutes },
      { key: 'late_minutes', label: 'Late', num: true }, { key: 'overtime_minutes', label: 'OT', num: true },
    ],
  },
};

export default function Reports() {
  const [tab, setTab] = useState('timecard');
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const [dept, setDept] = useState('');
  const [brand, setBrand] = useState('');
  const cfg = TABS[tab];

  const depts = useQuery(() => supabase.from('departments').select('name,brand').order('name'), []);
  const brands = useMemo(() => [...new Set((depts.data ?? []).map((d) => d.brand).filter(Boolean))], [depts.data]);

  const report = useQuery(() => {
    let q = supabase.from(cfg.view).select('*');
    if (cfg.isMonth) q = q.gte('month', from.slice(0, 7)).lte('month', to.slice(0, 7));
    else q = q.gte(cfg.dateCol, from).lte(cfg.dateCol, to);
    if (dept) q = q.eq('department', dept);
    if (brand) q = q.eq('brand', brand);
    return q.order(cfg.dateCol, { ascending: false }).order('emp_code');
  }, [tab, from, to, dept, brand]);

  function exportCSV() {
    const csvCols = cfg.columns.map((c) => ({ label: c.label, get: c.csv ?? ((r) => r[c.key]) }));
    downloadCSV(`${tab}_${from}_${to}.csv`, report.data ?? [], csvCols);
  }

  return (
    <>
      <div className="page-title">
        <h1>Reports</h1>
        <div className="inline-actions no-print">
          <button className="btn" onClick={exportCSV} disabled={!report.data?.length}>⬇ CSV</button>
          <button className="btn" onClick={() => window.print()} disabled={!report.data?.length}>🖶 Print / PDF</button>
        </div>
      </div>

      <div className="tabs no-print">
        {Object.entries(TABS).map(([k, v]) => (
          <button key={k} className={k === tab ? 'active' : ''} onClick={() => setTab(k)}>{v.label}</button>
        ))}
      </div>

      <Card className="no-print">
        <div className="row">
          <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Department">
            <select value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">All</option>
              {(depts.data ?? []).map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Brand">
            <select value={brand} onChange={(e) => setBrand(e.target.value)}>
              <option value="">All</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
        </div>
      </Card>

      <ErrorBanner error={report.error} />
      <Card title={`${cfg.label} — ${from} to ${to}`}>
        <Table loading={report.loading} rows={report.data} columns={cfg.columns}
          empty="No rows for this range/filter." />
      </Card>
    </>
  );
}
