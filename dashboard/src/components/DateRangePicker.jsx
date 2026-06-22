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
  const [hover, setHover] = useState(null);
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

  // Effective range for styling. While picking the end, preview start → hovered day.
  const selecting = start && !end;
  const effEnd = end || (selecting ? hover : null);
  const lo = start && effEnd ? (parse(start) <= parse(effEnd) ? start : effEnd) : start;
  const hi = start && effEnd ? (parse(start) <= parse(effEnd) ? effEnd : start) : null;
  const within = (d) => lo && hi && parse(lo) <= d && d <= parse(hi);
  const isToday = (d) => iso(d) === iso(today);

  return (
    <div className="drp" ref={ref}>
      <button type="button" className="drp-trigger" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Calendar size={15} /> {fmt(from)} to {fmt(to)}
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
            <div className="drp-grid" onMouseLeave={() => setHover(null)}>
              {DOW.map((d) => <span key={d} className="drp-dow">{d}</span>)}
              {cells.map((d, i) => {
                if (d === null) return <span key={i} />;
                const s = iso(d);
                const committed = s === start || s === end;   // solid endpoint
                const banded = within(d);
                const cls = ['drp-day'];
                if (committed) cls.push('sel'); else if (banded) cls.push('in');
                if (isToday(d)) cls.push('today');
                if (banded) {                  // continuous band; round only where it truly ends
                  cls.push('band');
                  if (s === lo) cls.push('rs');
                  if (s === hi) cls.push('re');
                  if (i % 7 === 0) cls.push('wstart');
                  if (i % 7 === 6) cls.push('wend');
                  if (d.getDate() === 1) cls.push('mstart');
                  if (d.getDate() === daysInMonth) cls.push('mend');
                }
                return <button type="button" key={i} className={cls.join(' ')}
                  onMouseEnter={() => selecting && setHover(s)}
                  onClick={() => clickDay(s)}>{d.getDate()}</button>;
              })}
            </div>
            <div className="drp-foot">
              <span className="drp-range">{start ? fmt(start) : '—'} → {end ? fmt(end) : '…'}</span>
              <button type="button" className="btn sm primary" onClick={apply} disabled={!start}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
