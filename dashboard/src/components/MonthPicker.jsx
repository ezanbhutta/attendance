import { useState, useEffect, useRef } from 'react';
import { Calendar } from 'lucide-react';

const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// Month picker for the Statement: month + year dropdowns (the filters) over a
// real day-to-day calendar grid (the same look as the date pickers elsewhere),
// with the whole chosen month highlighted. value / onChange use 'YYYY-MM';
// `max` (also 'YYYY-MM') caps the future. Changing a dropdown applies at once.
export default function MonthPicker({ value, max, onChange }) {
  const [open, setOpen] = useState(false);
  const [vy, setVy] = useState(() => Number((value || '').slice(0, 4)) || new Date().getFullYear());
  const [vm, setVm] = useState(() => Number((value || '').slice(5, 7)) || new Date().getMonth() + 1);
  const ref = useRef(null);

  useEffect(() => {
    if (!value) return;
    setVy(Number(value.slice(0, 4)));
    setVm(Number(value.slice(5, 7)));
  }, [value]);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const now = new Date();
  const maxY = max ? Number(max.slice(0, 4)) : null;
  const maxM = max ? Number(max.slice(5, 7)) : null;
  const baseYear = maxY ?? now.getFullYear();
  const years = Array.from({ length: 7 }, (_, i) => baseYear - i);
  const monthDisabled = (m) => maxY != null && vy === maxY && m > maxM;

  // Apply a month (clamped to the max) and tell the parent immediately.
  const commit = (y, m) => {
    if (maxY != null && (y > maxY || (y === maxY && m > maxM))) { y = maxY; m = maxM; }
    setVy(y); setVm(m);
    onChange(`${y}-${String(m).padStart(2, '0')}`);
  };

  // The viewed month's day grid.
  const startPad = new Date(vy, vm - 1, 1).getDay();
  const daysInMonth = new Date(vy, vm, 0).getDate();
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const isToday = (d) => vy === now.getFullYear() && vm === now.getMonth() + 1 && d === now.getDate();

  const label = value ? `${LONG[Number(value.slice(5, 7)) - 1]} ${value.slice(0, 4)}` : 'Pick a month';

  return (
    <div className="drp" ref={ref}>
      <button type="button" className="drp-trigger" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Calendar size={15} /> {label}
      </button>
      {open && (
        <div className="drp-pop">
          <div className="drp-cal" style={{ width: 282 }}>
            <div className="mp-head">
              <select value={vm} onChange={(e) => commit(vy, Number(e.target.value))} aria-label="Month">
                {LONG.map((mn, i) => <option key={mn} value={i + 1} disabled={monthDisabled(i + 1)}>{mn}</option>)}
              </select>
              <select value={vy} onChange={(e) => commit(Number(e.target.value), vm)} aria-label="Year">
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="drp-grid">
              {DOW.map((d) => <span key={d} className="drp-dow">{d}</span>)}
              {cells.map((d, i) => {
                if (d === null) return <span key={i} />;
                const cls = ['drp-day', 'in', 'band'];
                if (d === 1) cls.push('rs', 'mstart');
                if (d === daysInMonth) cls.push('re', 'mend');
                if (i % 7 === 0) cls.push('wstart');
                if (i % 7 === 6) cls.push('wend');
                if (isToday(d)) cls.push('today');
                return <button type="button" key={i} className={cls.join(' ')} onClick={() => { commit(vy, vm); setOpen(false); }}>{d}</button>;
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
