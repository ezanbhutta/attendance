import { useState } from 'react';
import { supabase, APP_TZ } from '../lib/supabase';
import { useAuth } from '../lib/auth.jsx';
import { useQuery } from '../lib/useData';
import { fmtDateTime } from '../lib/format';
import { Card, Field, Table, ErrorBanner } from '../components/ui.jsx';

export default function Corrections() {
  const { user } = useAuth();
  const employees = useQuery(() => supabase.from('employees').select('id,emp_code,first_name').order('emp_code'), []);
  const logs = useQuery(() =>
    supabase.from('manual_logs')
      .select('id,punch_time,reason,created_by,created_at,employee:employees(emp_code,first_name)')
      .order('created_at', { ascending: false }).limit(100), []);
  const [f, setF] = useState({ employee_id: '', when: '', reason: '' });
  const [err, setErr] = useState(null);

  async function add(e) {
    e.preventDefault(); setErr(null);
    if (!f.when) return setErr(new Error('Pick a date & time'));
    // datetime-local is wall-clock; record it as the device-local instant (+05:00).
    const punch_time = `${f.when}:00+05:00`;
    const { error } = await supabase.from('manual_logs').insert({
      employee_id: f.employee_id, punch_time, reason: f.reason, created_by: user?.email ?? 'dashboard',
    });
    if (error) return setErr(error);
    setF({ employee_id: '', when: '', reason: '' });
    logs.refetch();
  }

  return (
    <>
      <div className="page-title">
        <div>
          <h1>Fix a punch</h1>
          <p className="page-intro">Missed or failed scan? Add a manual entry with a reason. The raw record is never changed. Every fix is logged and feeds the reports. Times are {APP_TZ}.</p>
        </div>
      </div>
      <ErrorBanner error={err} />

      <Card title="Add a manual punch" help="Add a punch the device missed (a failed or forgotten scan). It feeds attendance just like a real scan, but stays clearly marked as a manual correction.">
        <form onSubmit={add} className="row">
          <Field label="Employee *">
            <select required value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })}>
              <option value="">—</option>
              {(employees.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.emp_code} · {e.first_name}</option>)}
            </select>
          </Field>
          <Field label="Date &amp; time *"><input type="datetime-local" required value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} /></Field>
          <Field label="Reason *"><input required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Scanner failed, verified by lead" /></Field>
          <button className="btn primary">Add</button>
        </form>
      </Card>

      <Card title="Recent corrections" help="Every manual entry, who added it, when, and why. A clean record you can trust.">
        <Table
          loading={logs.loading} rows={logs.data} empty="No corrections recorded."
          columns={[
            { key: 'punch_time', label: 'Punch time', render: (r) => fmtDateTime(r.punch_time) },
            { key: 'employee', label: 'Employee', render: (r) => r.employee ? `${r.employee.emp_code} · ${r.employee.first_name}` : '—' },
            { key: 'reason', label: 'Reason' },
            { key: 'created_by', label: 'By' },
            { key: 'created_at', label: 'Logged', render: (r) => fmtDateTime(r.created_at) },
          ]}
        />
      </Card>
    </>
  );
}
