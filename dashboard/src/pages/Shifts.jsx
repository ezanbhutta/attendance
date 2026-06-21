import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { Card, Field, Table, ConfirmButton, ErrorBanner, InlineEdit } from '../components/ui.jsx';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Shifts() {
  const tts = useQuery(() => supabase.from('timetables')
    .select('id,name,check_in,check_out,late_grace_min,early_leave_grace_min').order('name'), []);
  const shifts = useQuery(() => supabase.from('shifts').select('id,name').order('name'), []);
  const [err, setErr] = useState(null);
  const [tt, setTt] = useState({ name: '', check_in: '09:00', check_out: '18:00', late_grace_min: 10, early_leave_grace_min: 10 });
  const [shiftName, setShiftName] = useState('');
  const [selShift, setSelShift] = useState('');

  useEffect(() => {
    if (!selShift && shifts.data?.length) setSelShift(String(shifts.data[0].id));
  }, [shifts.data, selShift]);

  const details = useQuery(() =>
    selShift ? supabase.from('shift_details').select('id,day_index,timetable_id').eq('shift_id', selShift)
      : Promise.resolve({ data: [] }), [selShift]);

  async function addTt(e) {
    e.preventDefault(); setErr(null);
    const { error } = await supabase.from('timetables').insert({ ...tt, work_minutes: null });
    if (error) return setErr(error);
    setTt({ name: '', check_in: '09:00', check_out: '18:00', late_grace_min: 10, early_leave_grace_min: 10 });
    tts.refetch();
  }
  async function updTt(id, patch) {
    setErr(null);
    const { error } = await supabase.from('timetables').update(patch).eq('id', id);
    if (error) setErr(error); else tts.refetch();
  }

  async function addShift(e) {
    e.preventDefault(); setErr(null);
    const { data, error } = await supabase.from('shifts').insert({ name: shiftName.trim() }).select('id').single();
    if (error) return setErr(error);
    setShiftName(''); await shifts.refetch(); if (data) setSelShift(String(data.id));
  }
  async function updShift(id, patch) {
    setErr(null);
    const { error } = await supabase.from('shifts').update(patch).eq('id', id);
    if (error) setErr(error); else shifts.refetch();
  }

  const detailMap = {};
  (details.data ?? []).forEach((d) => { detailMap[d.day_index] = d; });

  async function setDay(day, timetable_id) {
    setErr(null);
    const existing = detailMap[day];
    let res;
    if (!timetable_id) res = existing ? await supabase.from('shift_details').delete().eq('id', existing.id) : {};
    else if (existing) res = await supabase.from('shift_details').update({ timetable_id }).eq('id', existing.id);
    else res = await supabase.from('shift_details').insert({ shift_id: selShift, day_index: day, timetable_id });
    if (res.error) return setErr(res.error);
    details.refetch();
  }

  return (
    <>
      <div className="page-title">
        <div>
          <h1>Shifts &amp; Timetables</h1>
          <p className="page-intro">A timetable is one day’s working hours; a shift maps a timetable to each weekday. Click any value to edit it in place.</p>
        </div>
      </div>
      <ErrorBanner error={err} />

      <Card title="Timetables" help="A timetable defines one day’s hours: when work starts and ends, plus how many minutes of grace before someone counts as late or as leaving early.">
        <form onSubmit={addTt} className="row" style={{ marginBottom: 18 }}>
          <Field label="Name *"><input required value={tt.name} onChange={(e) => setTt({ ...tt, name: e.target.value })} placeholder="General 9 to 6" /></Field>
          <Field label="Check-in"><input type="time" value={tt.check_in} onChange={(e) => setTt({ ...tt, check_in: e.target.value })} /></Field>
          <Field label="Check-out"><input type="time" value={tt.check_out} onChange={(e) => setTt({ ...tt, check_out: e.target.value })} /></Field>
          <Field label="Late grace (min)"><input type="number" min="0" value={tt.late_grace_min} onChange={(e) => setTt({ ...tt, late_grace_min: +e.target.value })} /></Field>
          <Field label="Early-leave grace"><input type="number" min="0" value={tt.early_leave_grace_min} onChange={(e) => setTt({ ...tt, early_leave_grace_min: +e.target.value })} /></Field>
          <button className="btn primary">Add</button>
        </form>
        <Table
          loading={tts.loading} rows={tts.data} empty="No timetables yet."
          columns={[
            { key: 'name', label: 'Name', render: (r) => <InlineEdit value={r.name} onSave={(v) => updTt(r.id, { name: v })} /> },
            { key: 'check_in', label: 'In', render: (r) => <InlineEdit type="time" value={r.check_in} onSave={(v) => updTt(r.id, { check_in: v })} /> },
            { key: 'check_out', label: 'Out', render: (r) => <InlineEdit type="time" value={r.check_out} onSave={(v) => updTt(r.id, { check_out: v })} /> },
            { key: 'late_grace_min', label: 'Late grace', num: true, render: (r) => <InlineEdit type="number" value={r.late_grace_min} onSave={(v) => updTt(r.id, { late_grace_min: v })} /> },
            { key: 'early_leave_grace_min', label: 'Early grace', num: true, render: (r) => <InlineEdit type="number" value={r.early_leave_grace_min} onSave={(v) => updTt(r.id, { early_leave_grace_min: v })} /> },
            { key: 'act', label: '', render: (r) => <ConfirmButton onConfirm={async () => { const { error } = await supabase.from('timetables').delete().eq('id', r.id); if (error) setErr(error); else tts.refetch(); }} /> },
          ]}
        />
      </Card>

      <Card title="Shifts" help="A shift is a named weekly pattern, like General or Night. Below you map a timetable to each weekday, or leave a day off.">
        <form onSubmit={addShift} className="row" style={{ marginBottom: 18 }}>
          <Field label="Name *"><input required value={shiftName} onChange={(e) => setShiftName(e.target.value)} placeholder="General" /></Field>
          <button className="btn primary">Add shift</button>
        </form>
        <Table
          loading={shifts.loading} rows={shifts.data} empty="No shifts yet."
          columns={[
            { key: 'name', label: 'Name', render: (r) => <InlineEdit value={r.name} onSave={(v) => updShift(r.id, { name: v })} /> },
            { key: 'act', label: '', render: (r) => <ConfirmButton onConfirm={async () => { const { error } = await supabase.from('shifts').delete().eq('id', r.id); if (error) setErr(error); else { shifts.refetch(); if (String(r.id) === selShift) setSelShift(''); } }} /> },
          ]}
        />
      </Card>

      <Card title="Weekly timetable map" help="For the selected shift, choose which timetable applies on each weekday. “Off” means no work is expected that day (so the person isn’t marked absent)." actions={
        <select value={selShift} onChange={(e) => setSelShift(e.target.value)}>
          <option value="">Pick a shift…</option>
          {(shifts.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      }>
        {!selShift ? <div className="empty">Select a shift to assign a timetable to each weekday.</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr>{DAYS.map((d) => <th key={d}>{d}</th>)}</tr></thead>
              <tbody><tr>
                {DAYS.map((d, i) => (
                  <td key={d}>
                    <select value={detailMap[i]?.timetable_id ?? ''} onChange={(e) => setDay(i, e.target.value)}>
                      <option value="">Off</option>
                      {(tts.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </td>
                ))}
              </tr></tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
