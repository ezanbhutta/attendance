import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { Card, Field, Table, ConfirmButton, ErrorBanner, InlineEdit } from '../components/ui.jsx';

export default function Shifts() {
  const tts = useQuery(() => supabase.from('timetables')
    .select('id,name,check_in,check_out,late_grace_min,early_leave_grace_min,next_day').order('name'), []);
  const shifts = useQuery(() => supabase.from('shifts').select('id,name').order('name'), []);
  const details = useQuery(() => supabase.from('shift_details').select('shift_id,day_index,timetable_id'), []);
  const [err, setErr] = useState(null);
  const [tt, setTt] = useState({ name: '', check_in: '09:00', check_out: '18:00', late_grace_min: 10, early_leave_grace_min: 10 });
  const [shiftName, setShiftName] = useState('');

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
    const { error } = await supabase.from('shifts').insert({ name: shiftName.trim() });
    if (error) return setErr(error);
    setShiftName(''); shifts.refetch();
  }
  async function updShift(id, patch) {
    setErr(null);
    const { error } = await supabase.from('shifts').update(patch).eq('id', id);
    if (error) setErr(error); else shifts.refetch();
  }

  // Each shift uses one timetable, applied every day. The off day is set per
  // person on the Employees page (Weekly off), so there is no weekday grid here.
  const shiftTt = {};
  (details.data ?? []).forEach((d) => { if (shiftTt[d.shift_id] == null) shiftTt[d.shift_id] = d.timetable_id; });

  async function setShiftTimetable(shiftId, timetableId) {
    setErr(null);
    const del = await supabase.from('shift_details').delete().eq('shift_id', shiftId);
    if (del.error) return setErr(del.error);
    if (timetableId) {
      const rows = [0, 1, 2, 3, 4, 5, 6].map((day_index) => ({ shift_id: shiftId, day_index, timetable_id: timetableId }));
      const ins = await supabase.from('shift_details').insert(rows);
      if (ins.error) return setErr(ins.error);
    }
    details.refetch();
  }

  // A timetable that starts after midnight and ends that morning is a night
  // shift counted under the previous day (derived from the hours, no toggle).
  const prevDay = (r) => r.check_out > r.check_in && r.check_in < '06:00';

  return (
    <>
      <div className="page-title">
        <div>
          <h1>Shifts &amp; Timetables</h1>
          <p className="page-intro">Working hours and shifts.</p>
        </div>
      </div>
      <ErrorBanner error={err} />

      <Card title="Timetables" help="A timetable defines one day’s hours: when work starts and ends, plus the minutes of grace before someone counts as late or as leaving early. A night shift that starts after midnight, like 01:00 to 09:00, is counted automatically under the previous day, no toggle needed.">
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
            { key: 'counts', label: 'Counts for', sortable: false, render: (r) => (
              <span className={prevDay(r) ? '' : 'muted'}>{prevDay(r) ? 'Previous day' : 'This day'}</span>
            ) },
            { key: 'act', label: '', sortable: false, render: (r) => <ConfirmButton onConfirm={async () => { const { error } = await supabase.from('timetables').delete().eq('id', r.id); if (error) setErr(error); else tts.refetch(); }} /> },
          ]}
        />
      </Card>

      <Card title="Shifts" help="A shift is a named set of hours, like General or Night. Give it one timetable here, then assign people to it on the Employees page. Each person picks their own weekly off day there.">
        <form onSubmit={addShift} className="row" style={{ marginBottom: 18 }}>
          <Field label="Name *"><input required value={shiftName} onChange={(e) => setShiftName(e.target.value)} placeholder="General" /></Field>
          <button className="btn primary">Add shift</button>
        </form>
        <Table
          loading={shifts.loading || details.loading} rows={shifts.data} empty="No shifts yet."
          columns={[
            { key: 'name', label: 'Name', render: (r) => <InlineEdit value={r.name} onSave={(v) => updShift(r.id, { name: v })} /> },
            { key: 'timetable', label: 'Timetable', sortable: false, render: (r) => (
              <select className="compact" value={shiftTt[r.id] ?? ''} onChange={(e) => setShiftTimetable(r.id, e.target.value)}>
                <option value="">Not set</option>
                {(tts.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            ) },
            { key: 'act', label: '', sortable: false, render: (r) => <ConfirmButton onConfirm={async () => { const { error } = await supabase.from('shifts').delete().eq('id', r.id); if (error) setErr(error); else shifts.refetch(); }} /> },
          ]}
        />
      </Card>
    </>
  );
}
