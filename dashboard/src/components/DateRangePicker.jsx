import { useState, useEffect, useRef } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmt = (s) => parse(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// Preset + range calendar (the csr-pulse pattern): quick ranges on the left, a
// month grid with click-start → click-end range selection, then Done to apply.
export default function DateRangePicker({ from, to, onApply }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  const [cursor, setCursor] = useState(() => { const d = parse(to); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const ref = useRef(null);

  useEffect(() => { setStart(from); setEnd(to); }, [from, to]);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const today = new Date();
  const set = (f, t) => { setStart(iso(f)); setEnd(iso(t)); setCursor(new Date(t.getFullYear(), t.getMonth(), 1)); };
  const ago = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
  const presets = [
    ['Today', () => set(today, today)],
    ['Yesterday', () => set(ago(1), ago(1))],
    ['Last 7 days', () => set(ago(6), today)],
    ['Last 30 days', () => set(ago(29), today)],
    ['This month', () => set(new Date(today.getFullYear(), today.getMonth(), 1), today)],
  ];

  function clickDay(dStr) {
    if (!start || (start && end)) { setStart(dStr); setEnd(null); }
    else if (parse(dStr) < parse(start)) { setEnd(start); setStart(dStr); }
    else setEnd(dStr);
  }
  function apply() {
    if (start) { onApply(start, end || start); setOpen(false); }
  }

  const startPad = new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay();
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));

  const inRange = (d) => start && end && parse(start) <= d && d <= parse(end);
  const isEdge = (d) => iso(d) === start || iso(d) === end;
  const isToday = (d) => iso(d) === iso(today);

  return (
    <div className="drp" ref={ref}>
      <button type="button" className="drp-trigger" onClick={() => setOpen((o) => !o)}>
        <Calendar size={15} /> {fmt(from)} – {fmt(to)}
      </button>
      {open && (
        <div className="drp-pop">
          <div className="drp-presets">
            {presets.map(([label, fn]) => <button key={label} type="button" onClick={fn}>{label}</button>)}
          </div>
          <div className="drp-cal">
            <div className="drp-cal-head">
              <button type="button" aria-label="Previous month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft size={16} /></button>
              <span>{cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>
              <button type="button" aria-label="Next month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRight size={16} /></button>
            </div>
            <div className="drp-grid">
              {DOW.map((d) => <span key={d} className="drp-dow">{d}</span>)}
              {cells.map((d, i) => d === null ? <span key={i} /> : (
                <button type="button" key={i}
                  className={`drp-day${isEdge(d) ? ' sel' : ''}${inRange(d) && !isEdge(d) ? ' in' : ''}${isToday(d) ? ' today' : ''}`}
                  onClick={() => clickDay(iso(d))}>{d.getDate()}</button>
              ))}
            </div>
            <div className="drp-foot">
              <span className="drp-range">{start ? fmt(start) : '—'} → {end ? fmt(end) : '…'}</span>
              <button type="button" className="btn sm primary" onClick={apply}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
