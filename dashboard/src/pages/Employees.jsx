import { useState } from 'react';
import { supabase, DEVICE_SN, APP_TZ } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { Card, Field, Table, ConfirmButton, ErrorBanner } from '../components/ui.jsx';

// A foreign-key delete error, in plain words.
function friendlyDelete(error) {
  const msg = `${error?.message || ''} ${error?.details || ''}`;
  if (error?.code === '23503' || /foreign key/i.test(msg)) {
    return { message: 'Can’t delete this person yet — run the latest database update (so their attendance and PIN link delete with them), then try again.' };
  }
  return error;
}

export default function Employees() {
  const emps = useQuery(() =>
    supabase.from('employees')
      .select('id,emp_code,first_name,last_name,track_attendance,department_id,shift_id,department:departments(name),shift:shifts(name)')
      .order('emp_code'), []);
  const depts = useQuery(() => supabase.from('departments').select('id,name').order('name'), []);
  const shifts = useQuery(() => supabase.from('shifts').select('id,name').order('name'), []);
  const unknown = useQuery(() => supabase.from('v_unknown_pins').select('*').order('punches', { ascending: false }), []);
  const health = useQuery(() => supabase.from('v_device_health').select('last_user_sync,last_user_sync_count').eq('sn', DEVICE_SN), []);

  const [form, setForm] = useState({ emp_code: '', first_name: '', last_name: '', department_id: '', shift_id: '' });
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function addEmp(e) {
    e.preventDefault(); setErr(null);
    const payload = { ...form, department_id: form.department_id || null, shift_id: form.shift_id || null };
    const { error } = await supabase.from('employees').insert(payload);
    if (error) return setErr(error);
    setForm({ emp_code: '', first_name: '', last_name: '', department_id: '', shift_id: '' });
    emps.refetch();
  }
  async function updateEmp(id, patch) {
    setErr(null);
    const { error } = await supabase.from('employees').update(patch).eq('id', id);
    if (error) return setErr(error);
    emps.refetch();
  }
  async function delEmp(id) {
    const { error } = await supabase.from('employees').delete().eq('id', id);
    if (error) return setErr(friendlyDelete(error));
    emps.refetch();
  }

  const deptOpts = depts.data ?? [];
  const shiftOpts = shifts.data ?? [];
  const sync = health.data?.[0];
  const lastSyncText = sync?.last_user_sync
    ? new Date(sync.last_user_sync).toLocaleString('en-GB', { timeZone: APP_TZ, dateStyle: 'medium', timeStyle: 'short' })
    : 'not yet';

  return (
    <>
      <div className="page-title">
        <div>
          <h1>Employees</h1>
          <p className="page-intro">
            Everyone is imported from the device automatically. For each person, pick a
            <strong> Department</strong> and <strong>Shift</strong> — or set <strong>Gate only</strong> for
            people who scan to open the gate but shouldn’t be counted (CEO/Admin).
            Last synced: <strong>{lastSyncText}</strong>{sync?.last_user_sync_count ? ` · ${sync.last_user_sync_count} on device` : ''}.
          </p>
        </div>
      </div>
      <ErrorBanner error={err || emps.error} />

      {unknown.data?.length > 0 && (
        <div className="callout warn">
          <strong>{unknown.data.length} PIN(s) have punched but aren’t linked to a person yet.</strong>{' '}
          Restart the catcher to import them (PIN{unknown.data.length > 1 ? 's' : ''}: {unknown.data.map((u) => u.pin).join(', ')}).
        </div>
      )}

      <Card title="All employees">
        <Table
          loading={emps.loading} rows={emps.data} empty="No employees yet — start the catcher to import them from the device."
          columns={[
            { key: 'emp_code', label: 'PIN' },
            { key: 'name', label: 'Name', render: (r) => `${r.first_name} ${r.last_name ?? ''}`.trim() },
            { key: 'department', label: 'Department', render: (r) => (
              <select className="compact" value={r.department_id ?? ''} onChange={(e) => updateEmp(r.id, { department_id: e.target.value || null })}>
                <option value="">—</option>
                {deptOpts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            ) },
            { key: 'counted', label: 'Counted?', render: (r) => (
              <select className="compact" value={r.track_attendance ? '1' : '0'} onChange={(e) => updateEmp(r.id, { track_attendance: e.target.value === '1' })}>
                <option value="1">Counted</option>
                <option value="0">Gate only</option>
              </select>
            ) },
            { key: 'shift', label: 'Shift', render: (r) => (
              <select className="compact" value={r.shift_id ?? ''} disabled={!r.track_attendance}
                      onChange={(e) => updateEmp(r.id, { shift_id: e.target.value || null })}>
                <option value="">—</option>
                {shiftOpts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) },
            { key: 'act', label: '', render: (r) => <ConfirmButton onConfirm={() => delEmp(r.id)} /> },
          ]}
        />
      </Card>

      <Card title="Add someone manually (rarely needed — the device sync adds people for you)">
        <form onSubmit={addEmp} className="row">
          <Field label="PIN / Code *"><input required value={form.emp_code} onChange={set('emp_code')} placeholder="e.g. 28" /></Field>
          <Field label="First name *"><input required value={form.first_name} onChange={set('first_name')} /></Field>
          <Field label="Last name"><input value={form.last_name} onChange={set('last_name')} /></Field>
          <Field label="Department">
            <select value={form.department_id} onChange={set('department_id')}>
              <option value="">—</option>
              {deptOpts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Shift">
            <select value={form.shift_id} onChange={set('shift_id')}>
              <option value="">—</option>
              {shiftOpts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <button className="btn primary">Add</button>
        </form>
      </Card>
    </>
  );
}
