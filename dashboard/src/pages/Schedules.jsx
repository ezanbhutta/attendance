import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { fmtDate, todayISO } from '../lib/format';
import { Card, Field, Table, ConfirmButton, ErrorBanner } from '../components/ui.jsx';

const fullName = (e) => (e ? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() : '');

// Highest priority first (spec §7).
const SCOPES = [
  { key: 'temporary', label: 'Temporary (one date)', table: 'temporary_schedules', fk: 'employee_id', src: 'employees', dated: false },
  { key: 'employee', label: 'Employee', table: 'employee_schedules', fk: 'employee_id', src: 'employees', dated: true },
  { key: 'group', label: 'Group', table: 'group_schedules', fk: 'group_id', src: 'groups', dated: true },
  { key: 'department', label: 'Department', table: 'department_schedules', fk: 'department_id', src: 'departments', dated: true },
];

export default function Schedules() {
  const employees = useQuery(() => supabase.from('employees').select('id,emp_code,first_name,last_name').order('emp_code'), []);
  const groups = useQuery(() => supabase.from('groups').select('id,name').order('name'), []);
  const departments = useQuery(() => supabase.from('departments').select('id,name').order('name'), []);
  const shifts = useQuery(() => supabase.from('shifts').select('id,name').order('name'), []);
  const srcData = { employees: employees.data, groups: groups.data, departments: departments.data };

  const [scopeKey, setScopeKey] = useState('employee');
  const scope = SCOPES.find((s) => s.key === scopeKey);
  const [f, setF] = useState({ target: '', shift_id: '', start_date: todayISO(), end_date: '', the_date: todayISO() });
  const [err, setErr] = useState(null);

  const lists = {
    temporary: useQuery(() => supabase.from('temporary_schedules').select('id,the_date,shift:shifts(name),employee:employees(emp_code,first_name,last_name)').order('the_date', { ascending: false }), []),
    employee: useQuery(() => supabase.from('employee_schedules').select('id,start_date,end_date,shift:shifts(name),employee:employees(emp_code,first_name,last_name)').order('start_date', { ascending: false }), []),
    group: useQuery(() => supabase.from('group_schedules').select('id,start_date,end_date,shift:shifts(name),group:groups(name)').order('start_date', { ascending: false }), []),
    department: useQuery(() => supabase.from('department_schedules').select('id,start_date,end_date,shift:shifts(name),department:departments(name)').order('start_date', { ascending: false }), []),
  };

  const targetLabel = (o) => o.emp_code ? `${o.emp_code} · ${fullName(o)}` : o.name;

  async function add(e) {
    e.preventDefault(); setErr(null);
    const payload = { [scope.fk]: f.target, shift_id: f.shift_id };
    if (scope.dated) { payload.start_date = f.start_date; payload.end_date = f.end_date || null; }
    else payload.the_date = f.the_date;
    const { error } = await supabase.from(scope.table).insert(payload);
    if (error) return setErr(error);
    lists[scope.key].refetch();
  }

  const del = (table, id, refetch) => async () => {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) return setErr(error); refetch();
  };

  return (
    <>
      <div className="page-title"><h1>Schedules</h1></div>
      <p className="muted" style={{ marginTop: -8 }}>Resolution priority: <strong>temporary → employee → group → department → global</strong>.</p>
      <ErrorBanner error={err} />

      <Card title="Assign a shift">
        <form onSubmit={add} className="row">
          <Field label="Scope">
            <select value={scopeKey} onChange={(e) => { setScopeKey(e.target.value); setF({ ...f, target: '' }); }}>
              {SCOPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </Field>
          <Field label={scope.src.replace(/s$/, '')}>
            <select required value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })}>
              <option value="">—</option>
              {(srcData[scope.src] ?? []).map((o) => <option key={o.id} value={o.id}>{targetLabel(o)}</option>)}
            </select>
          </Field>
          <Field label="Shift">
            <select required value={f.shift_id} onChange={(e) => setF({ ...f, shift_id: e.target.value })}>
              <option value="">—</option>
              {(shifts.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          {scope.dated ? (
            <>
              <Field label="Start"><input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
              <Field label="End (optional)"><input type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
            </>
          ) : (
            <Field label="Date"><input type="date" value={f.the_date} onChange={(e) => setF({ ...f, the_date: e.target.value })} /></Field>
          )}
          <button className="btn primary">Assign</button>
        </form>
      </Card>

      {SCOPES.map((s) => {
        const q = lists[s.key];
        return (
          <Card key={s.key} title={`${s.label} schedules`}>
            <Table
              loading={q.loading} rows={q.data} empty="None."
              columns={[
                { key: 'target', label: 'Assigned to', render: (r) => r.employee ? `${r.employee.emp_code} · ${fullName(r.employee)}` : (r.group?.name ?? r.department?.name) },
                { key: 'shift', label: 'Shift', render: (r) => r.shift?.name },
                { key: 'when', label: 'When', render: (r) => s.dated ? `${fmtDate(r.start_date)} → ${r.end_date ? fmtDate(r.end_date) : 'ongoing'}` : fmtDate(r.the_date) },
                { key: 'act', label: '', render: (r) => <ConfirmButton onConfirm={del(s.table, r.id, q.refetch)} /> },
              ]}
            />
          </Card>
        );
      })}
    </>
  );
}
