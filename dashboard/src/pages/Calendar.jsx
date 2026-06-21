import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { fmtDate } from '../lib/format';
import { Card, Field, Table, Badge, ConfirmButton, ErrorBanner } from '../components/ui.jsx';

export default function Calendar() {
  const holidays = useQuery(() => supabase.from('holidays').select('id,the_date,name,pay_multiplier').order('the_date', { ascending: false }), []);
  const leaves = useQuery(() =>
    supabase.from('leaves')
      .select('id,leave_type,start_date,end_date,status,employee:employees(emp_code,first_name)')
      .order('start_date', { ascending: false }), []);
  const employees = useQuery(() => supabase.from('employees').select('id,emp_code,first_name').order('emp_code'), []);
  const [hol, setHol] = useState({ the_date: '', name: '', pay_multiplier: 1 });
  const [lv, setLv] = useState({ employee_id: '', leave_type: 'annual', start_date: '', end_date: '', status: 'approved' });
  const [err, setErr] = useState(null);

  async function addHoliday(e) {
    e.preventDefault(); setErr(null);
    const { error } = await supabase.from('holidays').insert(hol);
    if (error) return setErr(error);
    setHol({ the_date: '', name: '', pay_multiplier: 1 }); holidays.refetch();
  }
  async function addLeave(e) {
    e.preventDefault(); setErr(null);
    const { error } = await supabase.from('leaves').insert({ ...lv, end_date: lv.end_date || lv.start_date });
    if (error) return setErr(error);
    setLv({ employee_id: '', leave_type: 'annual', start_date: '', end_date: '', status: 'approved' });
    leaves.refetch();
  }
  const del = (table, id, refetch) => async () => {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) return setErr(error); refetch();
  };

  return (
    <>
      <div className="page-title">
        <div>
          <h1>Leave &amp; Holidays</h1>
          <p className="page-intro">Approved leave and public holidays.</p>
        </div>
      </div>
      <ErrorBanner error={err} />

      <Card title="Leave" help="Approved leave for a person over a date range. While it’s approved, they aren’t counted absent on those days.">
        <form onSubmit={addLeave} className="row" style={{ marginBottom: 12 }}>
          <Field label="Employee *">
            <select required value={lv.employee_id} onChange={(e) => setLv({ ...lv, employee_id: e.target.value })}>
              <option value="">—</option>
              {(employees.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.emp_code} · {e.first_name}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select value={lv.leave_type} onChange={(e) => setLv({ ...lv, leave_type: e.target.value })}>
              {['annual', 'sick', 'casual', 'unpaid'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Start *"><input type="date" required value={lv.start_date} onChange={(e) => setLv({ ...lv, start_date: e.target.value })} /></Field>
          <Field label="End"><input type="date" value={lv.end_date} onChange={(e) => setLv({ ...lv, end_date: e.target.value })} /></Field>
          <Field label="Status">
            <select value={lv.status} onChange={(e) => setLv({ ...lv, status: e.target.value })}>
              {['approved', 'pending', 'rejected'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <button className="btn primary">Add leave</button>
        </form>
        <Table
          loading={leaves.loading} rows={leaves.data} empty="No leave recorded."
          columns={[
            { key: 'employee', label: 'Employee', render: (r) => r.employee ? `${r.employee.emp_code} · ${r.employee.first_name}` : '—' },
            { key: 'leave_type', label: 'Type' },
            { key: 'range', label: 'Dates', render: (r) => `${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}` },
            { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} kind={r.status === 'approved' ? 'Leave' : 'Incomplete'} /> },
            { key: 'act', label: '', render: (r) => <ConfirmButton onConfirm={del('leaves', r.id, leaves.refetch)} /> },
          ]}
        />
      </Card>

      <Card title="Holidays" help="Days the office is closed and everyone is excused. Pay × marks special pay days, for example 2 for double pay.">
        <form onSubmit={addHoliday} className="row" style={{ marginBottom: 12 }}>
          <Field label="Date *"><input type="date" required value={hol.the_date} onChange={(e) => setHol({ ...hol, the_date: e.target.value })} /></Field>
          <Field label="Name *"><input required value={hol.name} onChange={(e) => setHol({ ...hol, name: e.target.value })} placeholder="Independence Day" /></Field>
          <Field label="Pay ×"><input type="number" step="0.5" min="0" value={hol.pay_multiplier} onChange={(e) => setHol({ ...hol, pay_multiplier: +e.target.value })} /></Field>
          <button className="btn primary">Add holiday</button>
        </form>
        <Table
          loading={holidays.loading} rows={holidays.data} empty="No holidays recorded."
          columns={[
            { key: 'the_date', label: 'Date', render: (r) => fmtDate(r.the_date) },
            { key: 'name', label: 'Name' },
            { key: 'pay_multiplier', label: 'Pay ×', num: true },
            { key: 'act', label: '', render: (r) => <ConfirmButton onConfirm={del('holidays', r.id, holidays.refetch)} /> },
          ]}
        />
      </Card>
    </>
  );
}
