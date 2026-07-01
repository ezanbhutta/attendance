import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { fmtDate } from '../lib/format';
import { Card, Field, Table, Badge, ConfirmButton, ErrorBanner, Drawer, PersonRow } from '../components/ui.jsx';

const fullName = (e) => (e ? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() : '');
const hm = (t) => (t ? String(t).slice(0, 5) : '—');   // "13:00:00" → "13:00"

export default function Calendar() {
  const holidays = useQuery(() => supabase.from('holidays').select('id,the_date,name').order('the_date', { ascending: false }), []);
  const leaves = useQuery(() =>
    supabase.from('leaves')
      .select('id,leave_type,start_date,end_date,status,paid,employee:employees(emp_code,first_name,last_name)')
      .order('start_date', { ascending: false }), []);
  const employees = useQuery(() => supabase.from('employees').select('id,emp_code,first_name,last_name').order('emp_code'), []);
  const workers = useQuery(() => supabase.from('holiday_workers').select('the_date,employee_id,employee:employees(emp_code,first_name,last_name)'), []);
  const halfDays = useQuery(() =>
    supabase.from('half_days')
      .select('id,the_date,from_time,to_time,reason,paid,employee:employees(emp_code,first_name,last_name)')
      .order('the_date', { ascending: false }), []);
  const [hol, setHol] = useState({ the_date: '', name: '' });
  const [lv, setLv] = useState({ employee_id: '', leave_type: 'annual', start_date: '', end_date: '', status: 'approved', paid: true });
  const [hd, setHd] = useState({ employee_id: '', the_date: '', from_time: '', to_time: '', reason: '', paid: false });
  const [err, setErr] = useState(null);
  const [workHol, setWorkHol] = useState(null);   // holiday whose "who's working" drawer is open

  async function addHoliday(e) {
    e.preventDefault(); setErr(null);
    const { error } = await supabase.from('holidays').insert(hol);
    if (error) return setErr(error);
    setHol({ the_date: '', name: '' }); holidays.refetch();
  }
  async function addLeave(e) {
    e.preventDefault(); setErr(null);
    const { error } = await supabase.from('leaves').insert({ ...lv, end_date: lv.end_date || lv.start_date });
    if (error) return setErr(error);
    setLv({ employee_id: '', leave_type: 'annual', start_date: '', end_date: '', status: 'approved', paid: true });
    leaves.refetch();
  }
  async function addHalfDay(e) {
    e.preventDefault(); setErr(null);
    const { error } = await supabase.from('half_days').insert(hd);
    if (error) return setErr(error);
    setHd({ employee_id: '', the_date: '', from_time: '', to_time: '', reason: '', paid: false });
    halfDays.refetch();
  }
  const del = (table, id, refetch) => async () => {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) return setErr(error); refetch();
  };

  // Holiday workers, grouped by date.
  const workersByDate = {};
  (workers.data ?? []).forEach((w) => { (workersByDate[w.the_date] ||= []).push(w); });
  const workerList = (date) => workersByDate[date] ?? [];

  async function addWorker(the_date, employee_id) {
    setErr(null);
    const { error } = await supabase.from('holiday_workers').insert({ the_date, employee_id: Number(employee_id) });
    if (error) return setErr(error);
    workers.refetch();
  }
  async function removeWorker(the_date, employee_id) {
    setErr(null);
    const { error } = await supabase.from('holiday_workers').delete().eq('the_date', the_date).eq('employee_id', employee_id);
    if (error) return setErr(error);
    workers.refetch();
  }

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
              {(employees.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.emp_code} · {fullName(e)}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select value={lv.leave_type} onChange={(e) => setLv({ ...lv, leave_type: e.target.value })}>
              {['annual', 'sick', 'casual'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Start *"><input type="date" required value={lv.start_date} onChange={(e) => setLv({ ...lv, start_date: e.target.value })} /></Field>
          <Field label="End"><input type="date" value={lv.end_date} onChange={(e) => setLv({ ...lv, end_date: e.target.value })} /></Field>
          <Field label="Status">
            <select value={lv.status} onChange={(e) => setLv({ ...lv, status: e.target.value })}>
              {['approved', 'pending', 'rejected'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Pay">
            <div className="inline-actions">
              <button type="button" className={`btn sm ${lv.paid ? 'primary' : ''}`} onClick={() => setLv({ ...lv, paid: true })}>Paid</button>
              <button type="button" className={`btn sm ${!lv.paid ? 'primary' : ''}`} onClick={() => setLv({ ...lv, paid: false })}>Unpaid</button>
            </div>
          </Field>
          <button className="btn primary">Add leave</button>
        </form>
        <Table
          loading={leaves.loading} rows={leaves.data} empty="No leave recorded."
          columns={[
            { key: 'employee', label: 'Employee', render: (r) => r.employee ? `${r.employee.emp_code} · ${fullName(r.employee)}` : '—' },
            { key: 'leave_type', label: 'Type' },
            { key: 'range', label: 'Dates', render: (r) => `${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}` },
            { key: 'paid', label: 'Pay', render: (r) => <Badge value={r.paid ? 'Paid' : 'Unpaid'} kind={r.paid ? 'Leave' : 'Incomplete'} /> },
            { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} kind={r.status === 'approved' ? 'Leave' : 'Incomplete'} /> },
            { key: 'act', label: '', render: (r) => <ConfirmButton onConfirm={del('leaves', r.id, leaves.refetch)} /> },
          ]}
        />
      </Card>

      <Card title="Half days" help="Mark that someone was away for part of a working day — the date and the hours they were absent. The day stays Present but is flagged a half day, and the report reduces its worked hours by this window. The system records it; it computes no pay.">
        <form onSubmit={addHalfDay} className="row" style={{ marginBottom: 12 }}>
          <Field label="Employee *">
            <select required value={hd.employee_id} onChange={(e) => setHd({ ...hd, employee_id: e.target.value })}>
              <option value="">—</option>
              {(employees.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.emp_code} · {fullName(e)}</option>)}
            </select>
          </Field>
          <Field label="Date *"><input type="date" required value={hd.the_date} onChange={(e) => setHd({ ...hd, the_date: e.target.value })} /></Field>
          <Field label="Absent from *"><input type="time" required value={hd.from_time} onChange={(e) => setHd({ ...hd, from_time: e.target.value })} /></Field>
          <Field label="Absent to *"><input type="time" required value={hd.to_time} onChange={(e) => setHd({ ...hd, to_time: e.target.value })} /></Field>
          <Field label="Reason"><input value={hd.reason} onChange={(e) => setHd({ ...hd, reason: e.target.value })} placeholder="personal" /></Field>
          <Field label="Pay">
            <div className="inline-actions">
              <button type="button" className={`btn sm ${hd.paid ? 'primary' : ''}`} onClick={() => setHd({ ...hd, paid: true })}>Paid</button>
              <button type="button" className={`btn sm ${!hd.paid ? 'primary' : ''}`} onClick={() => setHd({ ...hd, paid: false })}>Unpaid</button>
            </div>
          </Field>
          <button className="btn primary">Add half day</button>
        </form>
        <Table
          loading={halfDays.loading} rows={halfDays.data} empty="No half days recorded."
          columns={[
            { key: 'employee', label: 'Employee', render: (r) => r.employee ? `${r.employee.emp_code} · ${fullName(r.employee)}` : '—' },
            { key: 'the_date', label: 'Date', render: (r) => fmtDate(r.the_date) },
            { key: 'hours', label: 'Absent', sortable: false, render: (r) => `${hm(r.from_time)} → ${hm(r.to_time)}` },
            { key: 'reason', label: 'Reason', render: (r) => r.reason || '—' },
            { key: 'paid', label: 'Pay', render: (r) => <Badge value={r.paid ? 'Paid' : 'Unpaid'} kind={r.paid ? 'Leave' : 'Incomplete'} /> },
            { key: 'act', label: '', render: (r) => <ConfirmButton onConfirm={del('half_days', r.id, halfDays.refetch)} /> },
          ]}
        />
      </Card>

      <Card title="Holidays" help="Days the office is closed and everyone is paid. Each holiday counts as a paid day off. If someone is willing to come in, add them under Working — when they scan that day they earn a bonus day, shown in the reports and the PDF.">
        <form onSubmit={addHoliday} className="row" style={{ marginBottom: 12 }}>
          <Field label="Date *"><input type="date" required value={hol.the_date} onChange={(e) => setHol({ ...hol, the_date: e.target.value })} /></Field>
          <Field label="Name *"><input required value={hol.name} onChange={(e) => setHol({ ...hol, name: e.target.value })} placeholder="Independence Day" /></Field>
          <button className="btn primary">Add holiday</button>
        </form>
        <Table
          loading={holidays.loading} rows={holidays.data} empty="No holidays recorded."
          columns={[
            { key: 'the_date', label: 'Date', render: (r) => fmtDate(r.the_date) },
            { key: 'name', label: 'Name' },
            { key: 'workers', label: 'Working (bonus)', sortable: false, render: (r) => {
              const n = workerList(r.the_date).length;
              return <button className="btn sm" onClick={() => setWorkHol(r)}>{n ? `${n} working` : 'Add workers'}</button>;
            } },
            { key: 'act', label: '', render: (r) => <ConfirmButton onConfirm={del('holidays', r.id, holidays.refetch)} /> },
          ]}
        />
      </Card>

      {workHol && (
        <Drawer title={`Working on ${workHol.name}`}
          sub={`${fmtDate(workHol.the_date)} · each person here earns a bonus day when they scan`}
          onClose={() => setWorkHol(null)}>
          <div className="field" style={{ marginBottom: 16 }}>
            <label>Add someone willing to work</label>
            <select value="" onChange={(e) => { if (e.target.value) addWorker(workHol.the_date, e.target.value); }}>
              <option value="">— pick a person —</option>
              {(employees.data ?? [])
                .filter((e) => !workerList(workHol.the_date).some((w) => String(w.employee_id) === String(e.id)))
                .map((e) => <option key={e.id} value={e.id}>{e.emp_code} · {fullName(e)}</option>)}
            </select>
          </div>
          {workerList(workHol.the_date).length === 0
            ? <div className="empty">Nobody added yet. Pick the people who will come in for the bonus.</div>
            : workerList(workHol.the_date).map((w) => (
              <PersonRow key={w.employee_id}
                name={fullName(w.employee) || `PIN ${w.employee?.emp_code}`}
                meta={`PIN ${w.employee?.emp_code}`}
                right={<button className="btn sm danger" onClick={() => removeWorker(workHol.the_date, w.employee_id)}>Remove</button>} />
            ))}
          <p className="muted" style={{ fontSize: '.85rem', marginTop: 16 }}>
            On the holiday, anyone here who scans is marked <strong>HolidayWorked</strong> — counted as a bonus day in the reports and the PDF. The bonus pay is counted by you; the system just flags who earned it.
          </p>
        </Drawer>
      )}
    </>
  );
}
