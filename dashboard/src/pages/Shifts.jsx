import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { Card, Field, Table, ConfirmButton, ErrorBanner, InlineEdit } from '../components/ui.jsx';
import { WEEKDAYS } from '../lib/format';

export default function Shifts() {
  const tts = useQuery(() => supabase.from('timetables')
    .select('id,name,check_in,check_out,late_grace_min,early_leave_grace_min,next_day').order('name'), []);
  const shifts = useQuery(() => supabase.from('shifts').select('id,name').order('name'), []);
  const details = useQuery(() => supabase.from('shift_details').select('shift_id,day_index,timetable_id'), []);
  const [err, setErr] = useState(null);
  const [tt, setTt] = useState({ name: '', check_in: '09:00', check_out: '18:00', late_grace_min: 10, early_leave_grace_min: 10 });
  const [shiftName, setShiftName] = useState('');
  const [dayShift, setDayShift] = useState('');   // shift being edited day by day

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

  // A shift holds one timetable PER WEEKDAY, so a single day can keep its own
  // hours (a short Friday, a half-day Saturday) while the rest of the week is
  // unchanged. dayTt[shiftId][dayIndex] = timetable_id.
  const dayTt = {};
  (details.data ?? []).forEach((d) => { (dayTt[d.shift_id] ||= {})[d.day_index] = d.timetable_id; });

  // The timetable shared by all seven days, or undefined when the days differ.
  function uniformTt(shiftId) {
    const m = dayTt[shiftId] ?? {};
    const vals = WEEKDAYS.map((d) => m[d.value] ?? null);
    return vals.every((v) => String(v) === String(vals[0])) ? vals[0] : undefined;
  }

  // Apply one timetable to the whole week (the quick path).
  async function setShiftTimetable(shiftId, timetableId) {
    setErr(null);
    const del = await supabase.from('shift_details').delete().eq('shift_id', shiftId);
    if (del.error) return setErr(del.error);
    if (timetableId) {
      const rows = WEEKDAYS.map((d) => ({ shift_id: shiftId, day_index: d.value, timetable_id: timetableId }));
      const ins = await supabase.from('shift_details').insert(rows);
      if (ins.error) return setErr(ins.error);
    }
    details.refetch();
  }

  // Change ONE weekday's hours, leaving the rest of the week alone. Clearing a day
  // (no timetable) makes it a non-working day for this shift: the compute reads
  // "no timetable" as a day off, so nobody is ever marked absent for it.
  async function setDayTimetable(shiftId, dayIndex, timetableId) {
    setErr(null);
    const del = await supabase.from('shift_details')
      .delete().eq('shift_id', shiftId).eq('day_index', dayIndex);
    if (del.error) return setErr(del.error);
    if (timetableId) {
      const ins = await supabase.from('shift_details')
        .insert({ shift_id: shiftId, day_index: dayIndex, timetable_id: timetableId });
      if (ins.error) return setErr(ins.error);
    }
    details.refetch();
  }

  const ttById = {};
  (tts.data ?? []).forEach((t) => { ttById[t.id] = t; });
  const hours = (id) => (ttById[id] ? `${ttById[id].check_in?.slice(0, 5)} – ${ttById[id].check_out?.slice(0, 5)}` : '—');

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

      <Card title="Shifts" help="A shift is a named set of hours, like General or Night. Give it a timetable here and it applies to every day of the week; if one day runs on different hours, set that day on its own below. Then assign people to the shift on the Employees page, where each person also picks their weekly off day.">
        <form onSubmit={addShift} className="row" style={{ marginBottom: 18 }}>
          <Field label="Name *"><input required value={shiftName} onChange={(e) => setShiftName(e.target.value)} placeholder="General" /></Field>
          <button className="btn primary">Add shift</button>
        </form>
        <Table
          loading={shifts.loading || details.loading} rows={shifts.data} empty="No shifts yet."
          columns={[
            { key: 'name', label: 'Name', render: (r) => <InlineEdit value={r.name} onSave={(v) => updShift(r.id, { name: v })} /> },
            { key: 'timetable', label: 'Timetable', sortable: false, render: (r) => {
              const u = uniformTt(r.id);
              return (
                <select className="compact" value={u === undefined ? '__mixed' : (u ?? '')}
                        onChange={(e) => { if (e.target.value !== '__mixed') setShiftTimetable(r.id, e.target.value); }}>
                  {u === undefined && <option value="__mixed">Different by day ↓</option>}
                  <option value="">Not set</option>
                  {(tts.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              );
            } },
            { key: 'act', label: '', sortable: false, render: (r) => <ConfirmButton onConfirm={async () => { const { error } = await supabase.from('shifts').delete().eq('id', r.id); if (error) setErr(error); else shifts.refetch(); }} /> },
          ]}
        />
      </Card>

      <Card title="Different hours on a day"
            help="When one day of the week runs on different hours — a short Friday, a half-day Saturday — pick the shift and give that day its own timetable. Every other day is left exactly as it is. Set a day to “Day off” and nobody on this shift is expected that day: it shows as a day off, never as absent. Create the hours first under Timetables above.">
        <div className="row" style={{ marginBottom: 14 }}>
          <Field label="Shift">
            <select value={dayShift} onChange={(e) => setDayShift(e.target.value)}>
              <option value="">Choose a shift…</option>
              {(shifts.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </div>
        {!dayShift ? (
          <div className="empty">Choose a shift to set its hours day by day.</div>
        ) : (
          <Table
            loading={details.loading || tts.loading}
            rows={WEEKDAYS.map((d) => ({ ...d, id: d.value, timetable_id: dayTt[dayShift]?.[d.value] ?? null }))}
            empty=""
            columns={[
              { key: 'label', label: 'Day', sortable: false, render: (r) => <strong>{r.label}</strong> },
              { key: 'tt', label: 'Hours', sortable: false, render: (r) => (
                <select className="compact" value={r.timetable_id ?? ''}
                        onChange={(e) => setDayTimetable(dayShift, r.value, e.target.value)}>
                  <option value="">Day off — not expected</option>
                  {(tts.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              ) },
              { key: 'when', label: 'In – Out', sortable: false, render: (r) => (
                <span className={r.timetable_id ? 'mono' : 'muted'}>{r.timetable_id ? hours(r.timetable_id) : 'no hours'}</span>
              ) },
            ]}
          />
        )}
      </Card>
    </>
  );
}
