import { useState } from 'react';
import { Search, Plus, Archive, RotateCcw } from 'lucide-react';
import { supabase, DEVICE_SN, APP_TZ } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { Card, Field, Table, ConfirmButton, ErrorBanner, Badge } from '../components/ui.jsx';

function friendlyDelete(error) {
  const msg = `${error?.message || ''} ${error?.details || ''}`;
  if (error?.code === '23503' || /foreign key/i.test(msg)) {
    return { message: 'Can’t delete this person yet — run the latest database update (so their attendance and PIN link delete with them), then try again. Tip: Archive keeps the record but stops counting them.' };
  }
  return error;
}

export default function Employees() {
  const emps = useQuery(() =>
    supabase.from('employees')
      .select('id,emp_code,first_name,last_name,track_attendance,weekly_off,department_id,shift_id,active,department:departments(name),shift:shifts(name)')
      .order('emp_code'), []);
  const depts = useQuery(() => supabase.from('departments').select('id,name').order('name'), []);
  const shifts = useQuery(() => supabase.from('shifts').select('id,name').order('name'), []);
  const methods = useQuery(() => supabase.from('v_employee_methods').select('*'), []);
  const unknown = useQuery(() => supabase.from('v_unknown_pins').select('*').order('punches', { ascending: false }), []);
  const health = useQuery(() => supabase.from('v_device_health').select('last_user_sync,last_user_sync_count').eq('sn', DEVICE_SN), []);

  const [form, setForm] = useState({ emp_code: '', first_name: '', last_name: '', department_id: '', shift_id: '' });
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
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
  async function saveName(id, value) {
    const name = (value || '').trim();
    if (!name) return;
    const sp = name.indexOf(' ');
    await updateEmp(id, { first_name: sp > 0 ? name.slice(0, sp) : name, last_name: sp > 0 ? name.slice(sp + 1) : null });
  }
  async function delEmp(id) {
    const { error } = await supabase.from('employees').delete().eq('id', id);
    if (error) return setErr(friendlyDelete(error));
    emps.refetch();
  }

  const deptOpts = depts.data ?? [];
  const shiftOpts = shifts.data ?? [];
  const methodMap = {};
  (methods.data ?? []).forEach((m) => { methodMap[m.employee_id] = m; });
  const all = emps.data ?? [];
  const activeCount = all.filter((r) => r.active !== false).length;
  const archivedCount = all.length - activeCount;
  const term = q.trim().toLowerCase();
  const rows = all
    .filter((r) => (archived ? r.active === false : r.active !== false))
    .filter((r) => !term || `${r.first_name} ${r.last_name ?? ''} ${r.emp_code}`.toLowerCase().includes(term));
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
            Everyone is imported from the device automatically. <strong>Click a name to edit it.</strong> Pick a
            <strong> Department</strong>, <strong>Shift</strong>, and <strong>Weekly off</strong>, or set
            <strong> Gate only</strong> for people who scan to open the gate but aren’t counted. <strong>Archive</strong>
            anyone who has left — they stop counting everywhere until you restore them. Last synced: <strong>{lastSyncText}</strong>{sync?.last_user_sync_count ? ` · ${sync.last_user_sync_count} on device` : ''}.
          </p>
        </div>
      </div>
      <ErrorBanner error={err || emps.error} />

      {unknown.data?.length > 0 && (
        <div className="callout warn">
          <strong>{unknown.data.length} PIN(s) scanned but not linked to a person yet</strong> ({unknown.data.map((u) => u.pin).join(', ')}).
          They link automatically on the next device sync — click <strong>Sync</strong> in the top bar. If a PIN isn’t a real user, ignore it from the Overview.
        </div>
      )}

      <Card title="All employees" help="Everyone the device knows. Counted = their attendance is tracked. Gate-only = they can open the gate but don’t count. Methods shows how they’ve scanned (face / fingerprint / card).">
        <div className="toolbar">
          <span className="search-wrap">
            <Search size={16} className="search-ico" />
            <input className="search" placeholder="Search name or PIN…" value={q} onChange={(e) => setQ(e.target.value)} />
          </span>
          <div className="tabs" style={{ margin: 0 }}>
            <button className={!archived ? 'active' : ''} onClick={() => setArchived(false)}>Active ({activeCount})</button>
            <button className={archived ? 'active' : ''} onClick={() => setArchived(true)}>Archived ({archivedCount})</button>
          </div>
          <span className="count-pill">{rows.length} {rows.length === 1 ? 'person' : 'people'}</span>
        </div>
        <Table
          loading={emps.loading} rows={rows}
          empty={term ? 'No matches.' : archived ? 'Nobody archived.' : 'No employees yet — click Sync to import them from the device.'}
          columns={[
            { key: 'emp_code', label: 'PIN', render: (r) => <span className="mono">{r.emp_code}</span> },
            { key: 'name', label: 'Name', sort: (r) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim(), render: (r) => {
              const full = `${r.first_name} ${r.last_name ?? ''}`.trim();
              return (
                <input className="compact name-edit" defaultValue={full} aria-label="Name"
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== full) saveName(r.id, v); }} />
              );
            } },
            { key: 'methods', label: 'Methods', sortable: false, render: (r) => {
              const m = methodMap[r.id];
              if (!m || (!m.has_face && !m.has_finger && !m.has_card)) return <span className="muted">—</span>;
              return (
                <span className="pill-row">
                  {m.has_face && <Badge value="face" kind="face" />}
                  {m.has_finger && <Badge value="fingerprint" kind="fingerprint" />}
                  {m.has_card && <Badge value={m.card_no ? `card ${m.card_no}` : 'card'} kind="Leave" />}
                </span>
              );
            } },
            { key: 'department', label: 'Department', sort: (r) => r.department?.name ?? '', render: (r) => (
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
            { key: 'weekly_off', label: 'Weekly off', render: (r) => (
              <select className="compact" value={r.weekly_off ?? ''} disabled={!r.track_attendance}
                      onChange={(e) => updateEmp(r.id, { weekly_off: e.target.value === '' ? null : parseInt(e.target.value, 10) })}>
                <option value="">None</option>
                <option value="6">Saturday</option>
                <option value="0">Sunday</option>
              </select>
            ) },
            { key: 'act', label: '', render: (r) => (
              r.active === false ? (
                <span className="inline-actions">
                  <button className="btn sm" onClick={() => updateEmp(r.id, { active: true })} title="Restore — start counting again"><RotateCcw size={13} /> Restore</button>
                  <ConfirmButton onConfirm={() => delEmp(r.id)} />
                </span>
              ) : (
                <button className="btn sm" onClick={() => updateEmp(r.id, { active: false })} title="Archive — stop counting until restored"><Archive size={13} /> Archive</button>
              )
            ) },
          ]}
        />
      </Card>

      <Card title="Add someone manually" help="Rarely needed — the device sync adds people automatically. Use this only to pre-create a person before they’re enrolled on the device.">
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
          <button className="btn primary"><Plus size={15} /> Add</button>
        </form>
      </Card>
    </>
  );
}
