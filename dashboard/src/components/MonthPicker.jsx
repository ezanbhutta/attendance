import { useState, useEffect, useRef } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Month picker in the same popover style as DateRangePicker: a pill trigger that
// opens a year header (‹ 2026 ›) over a 12-month grid. value / onChange use
// 'YYYY-MM'; `max` (also 'YYYY-MM') greys out any month after it.
export default function MonthPicker({ value, max, onChange }) {
  const [open, setOpen] = useState(false);
  const [vy, setVy] = useState(() => Number((value || '').slice(0, 4)) || new Date().getFullYear());
  const ref = useRef(null);

  const selY = Number((value || '').slice(0, 4));
  const selM = Number((value || '').slice(5, 7)); // 1-12
  const now = new Date();
  const maxY = max ? Number(max.slice(0, 4)) : null;
  const maxM = max ? Number(max.slice(5, 7)) : null;

  useEffect(() => { if (value) setVy(Number(value.slice(0, 4))); }, [value]);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const label = value ? `${LONG[selM - 1]} ${selY}` : 'Pick a month';
  const monthDisabled = (m) => maxY != null && (vy > maxY || (vy === maxY && m > maxM));
  const pick = (m) => { onChange(`${vy}-${String(m).padStart(2, '0')}`); setOpen(false); };

  return (
    <div className="drp" ref={ref}>
      <button type="button" className="drp-trigger" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Calendar size={15} /> {label}
      </button>
      {open && (
        <div className="drp-pop">
          <div className="drp-cal" style={{ width: 244 }}>
            <div className="drp-cal-head">
              <button type="button" aria-label="Previous year" onClick={() => setVy((y) => y - 1)}><ChevronLeft size={16} /></button>
              <span>{vy}</span>
              <button type="button" aria-label="Next year" disabled={maxY != null && vy >= maxY} onClick={() => setVy((y) => y + 1)}><ChevronRight size={16} /></button>
            </div>
            <div className="drp-months">
              {MONTHS.map((mn, i) => {
                const m = i + 1;
                const cls = ['drp-month'];
                if (vy === selY && m === selM) cls.push('sel');
                else if (vy === now.getFullYear() && m === now.getMonth() + 1) cls.push('now');
                return (
                  <button type="button" key={mn} className={cls.join(' ')} disabled={monthDisabled(m)} onClick={() => pick(m)}>{mn}</button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
