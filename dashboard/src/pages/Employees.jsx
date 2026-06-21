import { useState } from 'react';
import { supabase, DEVICE_SN, APP_TZ } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { Card, Field, Table, ConfirmButton, ErrorBanner } from '../components/ui.jsx';

// A foreign-key delete error, in plain words.
function friendlyDelete(error) {
  const msg = `${error?.message || ''} ${error?.details || ''}`;
  if (error?.code === '23503' || /foreign key/i.test(msg)) {
    return { message: 'Can’t delete this employee yet — apply the latest database update (so an employee’s attendance and mappings delete with them), then try again.' };
  }
  return error;
}

export default function Employees() {
  const emps = useQuery(() =>
    supabase.from('employees')
      .select('id,emp_code,first_name,last_name,active,department:departments(name),group:groups(name)')
      .order('emp_code'), []);
  const depts = useQuery(() => supabase.from('departments').select('id,name').order('name'), []);
  const groups = useQuery(() => supabase.from('groups').select('id,name').order('name'), []);
  const maps = useQuery(() =>
    supabase.from('device_user_map')
      .select('device_sn,pin,employee:employees(emp_code,first_name,last_name)')
      .order('pin'), []);
  const unknown = useQuery(() => supabase.from('v_unknown_pins').select('*').order('punches', { ascending: false }), []);
  const health = useQuery(() => supabase.from('v_device_health').select('last_user_sync,last_user_sync_count').eq('sn', DEVICE_SN), []);

  const [form, setForm] = useState({ emp_code: '', first_name: '', last_name: '', department_id: '', group_id: '' });
  const [map, setMap] = useState({ pin: '', employee_id: '' });
  const [err, setErr] = useState(null);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function addEmp(e) {
    e.preventDefault();
    setErr(null);
    const payload = { ...form, department_id: form.department_id || null, group_id: form.group_id || null };
    const { error } = await supabase.from('employees').insert(payload);
    if (error) return setErr(error);
    setForm({ emp_code: '', first_name: '', last_name: '', department_id: '', group_id: '' });
    emps.refetch();
  }

  async function delEmp(id) {
    const { error } = await supabase.from('employees').delete().eq('id', id);
    if (error) return setErr(friendlyDelete(error));
    emps.refetch(); maps.refetch();
  }

  async function addMap(e) {
    e.preventDefault();
    setErr(null);
    const { error } = await supabase.from('device_user_map')
      .upsert({ device_sn: DEVICE_SN, pin: map.pin, employee_id: map.employee_id || null });
    if (error) return setErr(error);
    setMap({ pin: '', employee_id: '' });
    maps.refetch(); unknown.refetch();
  }

  async function delMap(pin) {
    const { error } = await supabase.from('device_user_map').delete().eq('device_sn', DEVICE_SN).eq('pin', pin);
    if (error) return setErr(error);
    maps.refetch(); unknown.refetch();
  }

  const empName = (e) => e?.employee ? `${e.employee.first_name ?? ''} ${e.employee.last_name ?? ''}`.trim() : '';

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
            People are imported automatically from the device every time the catcher starts.
            Last synced from device: <strong>{lastSyncText}</strong>
            {sync?.last_user_sync_count ? ` · ${sync.last_user_sync_count} on device` : ''}.
          </p>
        </div>
      </div>
      <ErrorBanner error={err || emps.error} />

      <Card title="Add employee">
        <form onSubmit={addEmp} className="row">
          <Field label="Code *"><input required value={form.emp_code} onChange={set('emp_code')} placeholder="EMP002" /></Field>
          <Field label="First name *"><input required value={form.first_name} onChange={set('first_name')} /></Field>
          <Field label="Last name"><input value={form.last_name} onChange={set('last_name')} /></Field>
          <Field label="Department">
            <select value={form.department_id} onChange={set('department_id')}>
              <option value="">—</option>
              {(depts.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Group">
            <select value={form.group_id} onChange={set('group_id')}>
              <option value="">—</option>
              {(groups.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
          <button className="btn primary">Add</button>
        </form>
      </Card>

      <Card title="All employees">
        <Table
          loading={emps.loading} rows={emps.data} empty="No employees yet."
          columns={[
            { key: 'emp_code', label: 'Code' },
            { key: 'name', label: 'Name', render: (r) => `${r.first_name} ${r.last_name ?? ''}`.trim() },
            { key: 'department', label: 'Department', render: (r) => r.department?.name ?? '—' },
            { key: 'group', label: 'Group', render: (r) => r.group?.name ?? '—' },
            { key: 'active', label: 'Active', render: (r) => (r.active ? 'Yes' : 'No') },
            { key: 'act', label: '', render: (r) => <ConfirmButton onConfirm={() => delEmp(r.id)} /> },
          ]}
        />
      </Card>

      <div className="grid cols-2">
        <Card title="Device PIN → employee">
          <form onSubmit={addMap} className="row" style={{ marginBottom: 12 }}>
            <Field label="PIN *"><input required value={map.pin} onChange={(e) => setMap({ ...map, pin: e.target.value })} placeholder="2" /></Field>
            <Field label="Employee">
              <select value={map.employee_id} onChange={(e) => setMap({ ...map, employee_id: e.target.value })}>
                <option value="">—</option>
                {(emps.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.emp_code} — {e.first_name}</option>)}
              </select>
            </Field>
            <button className="btn primary">Map</button>
          </form>
          <Table
            loading={maps.loading} rows={maps.data} empty="No mappings yet."
            columns={[
              { key: 'pin', label: 'PIN' },
              { key: 'employee', label: 'Employee', render: (r) => empName(r) || <span className="muted">Unmapped</span> },
              { key: 'code', label: 'Code', render: (r) => r.employee?.emp_code ?? '—' },
              { key: 'act', label: '', render: (r) => <ConfirmButton onConfirm={() => delMap(r.pin)} /> },
            ]}
          />
        </Card>

        <Card title="Unmapped PINs (seen on device)">
          <p className="muted" style={{ marginTop: 0 }}>Punches from these PINs show as “Unknown” until mapped above.</p>
          <Table
            loading={unknown.loading} rows={unknown.data} empty="Every PIN that has punched is mapped. 🎉"
            columns={[
              { key: 'pin', label: 'PIN' },
              { key: 'punches', label: 'Punches', num: true },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
