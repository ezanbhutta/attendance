import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

// Ease a number from its previous value to the new one (count-up animation).
export function useCountUp(target, dur = 750) {
  const [val, setVal] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current, to = target;
    if (from === to) { setVal(to); return; }
    let raf, t0;
    const step = (t) => {
      if (!t0) t0 = t;
      const p = Math.min(1, (t - t0) / dur);
      setVal(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step); else prev.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);
  return val;
}

function sparkPoints(a) {
  if (!a || a.length < 2) return '';
  const mn = Math.min(...a), mx = Math.max(...a), r = (mx - mn) || 1;
  return a.map((v, i) => `${(i / (a.length - 1) * 100).toFixed(1)},${(24 - ((v - mn) / r) * 20).toFixed(1)}`).join(' ');
}

export function Card({ title, actions, children, className = '', help }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <h2>{title}{help && <InfoTip text={help} />}</h2>
          {actions && <div className="inline-actions">{actions}</div>}
        </div>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function Field({ label, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

// Inline-editable cell: click, type, then blur or Enter to save (Esc cancels).
// Used in tables to make names / times / numbers editable in place.
export function InlineEdit({ value, type = 'text', onSave, placeholder }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  const auto = type === 'number' ? { minWidth: 56, maxWidth: 76 }
    : type === 'time' ? { minWidth: 102, maxWidth: 120 } : undefined;
  function commit() {
    const nv = type === 'number' ? (v === '' ? null : Number(v)) : (typeof v === 'string' ? v.trim() : v);
    if (String(nv ?? '') !== String(value ?? '')) onSave(nv);
  }
  return (
    <input
      className="name-edit" type={type} value={v} placeholder={placeholder} style={auto}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setV(value ?? ''); }}
    />
  );
}

// "Know mark": a small ⓘ icon that reveals a plain-language explanation on
// hover or focus. Pass help="…" to a Card or Stat, or use <InfoTip> directly.
export function InfoTip({ text, label = 'What is this?' }) {
  if (!text) return null;
  return (
    <span className="infotip" tabIndex={0} role="button" aria-label={label}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></svg>
      <span className="infotip-bubble" role="tooltip">{text}</span>
    </span>
  );
}

// Metric tile: eyebrow label + small icon on top, then a large medium-weight
// metric. tone: ok | danger | warn | violet | sky. Optional onClick → drill-in.
export function Stat({ icon: Icon, label, value, tone = 'violet', hint, delta, onClick, help, bar, spark }) {
  const Tag = onClick ? 'button' : 'div';
  const num = typeof value === 'number';
  const shown = useCountUp(num ? value : 0);
  return (
    <Tag className={`stat${onClick ? ' clickable' : ''}`} onClick={onClick}>
      <div className="stat-top">
        <span className="label">{label}{help && <InfoTip text={help} />}</span>
        {Icon && <span className={`stat-icon ${tone}`}><Icon size={16} strokeWidth={2} /></span>}
      </div>
      <div className="stat-body">
        <div className="value">{num ? shown : value}</div>
        {(delta || hint) && (
          <div className="hint">{delta && <span className={`delta ${delta.dir}`}>{delta.text}</span>}{hint}</div>
        )}
      </div>
      {spark && spark.length > 1 ? (
        <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
          <polyline className={`spark-line ${tone}`} points={sparkPoints(spark)} />
        </svg>
      ) : typeof bar === 'number' ? (
        <span className="stat-bar"><i className={tone} style={{ width: `${Math.max(2, Math.min(100, bar))}%` }} /></span>
      ) : null}
    </Tag>
  );
}

export function Spinner() {
  return <div className="center"><div className="spinner" role="status" aria-label="Loading" /></div>;
}

export function ErrorBanner({ error }) {
  if (!error) return null;
  const msg = error.message || String(error);
  return <div className="error-banner" role="alert">⚠ {msg}</div>;
}

export function Badge({ value, kind }) {
  if (value == null || value === '') return <span className="muted">—</span>;
  return <span className={`badge ${kind ?? value}`}><span className="dot" aria-hidden />{value}</span>;
}

function SortArrow({ dir }) {
  return (
    <span className="sort-arrow" aria-hidden>
      <svg width="8" height="12" viewBox="0 0 8 12">
        <path d="M4 0 L7 4 L1 4 Z" className={dir === 'asc' ? 'on' : ''} />
        <path d="M4 12 L1 8 L7 8 Z" className={dir === 'desc' ? 'on' : ''} />
      </svg>
    </span>
  );
}

// Generic table. columns: [{ key, label, num?, render?(row), get?(row), sort?(row), sortable? }]
// Click a header to sort (asc → desc → off). Sorting is on by default for any
// labelled column; pass sortable:false to opt a column out (e.g. an actions col).
export function Table({ columns, rows, loading, empty = 'Nothing here yet.', onRowClick }) {
  const [sort, setSort] = useState(null); // { key, dir }
  if (loading) return <Spinner />;
  if (!rows || rows.length === 0) return <div className="empty">{empty}</div>;

  const value = (c, r) => (c.sort ? c.sort(r) : c.get ? c.get(r) : r[c.key]);
  const canSort = (c) => c.sortable !== false && c.key !== 'act' && (c.label ?? c.key) !== '';

  let data = rows;
  if (sort) {
    const col = columns.find((c) => c.key === sort.key);
    if (col) {
      const sign = sort.dir === 'asc' ? 1 : -1;
      data = [...rows].sort((a, b) => {
        const x = value(col, a), y = value(col, b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign;
        return String(x).localeCompare(String(y), undefined, { numeric: true }) * sign;
      });
    }
  }

  const toggle = (c) => {
    if (!canSort(c)) return;
    setSort((s) => (s && s.key === c.key ? (s.dir === 'asc' ? { key: c.key, dir: 'desc' } : null) : { key: c.key, dir: 'asc' }));
  };

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((c) => {
            const sortable = canSort(c);
            const active = sort?.key === c.key;
            return (
              <th key={c.key} className={`${c.num ? 'num' : ''}${sortable ? ' sortable' : ''}${active ? ' sorted' : ''}`}
                  onClick={sortable ? () => toggle(c) : undefined}
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                <span className="th-in">{c.label ?? c.key}{sortable && <SortArrow dir={active ? sort.dir : null} />}</span>
              </th>
            );
          })}</tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={r.id ?? i} className={onRowClick ? 'row-click' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c) => (
                <td key={c.key} className={c.num ? 'num' : ''}>
                  {c.render ? c.render(r) : (c.get ? c.get(r) : r[c.key]) ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Delete button with a one-click confirm step (no window.confirm).
export function ConfirmButton({ onConfirm, children = 'Delete', label = 'Confirm?' }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      className={`btn sm ${armed ? 'danger' : ''}`}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
      onBlur={() => setArmed(false)}
    >
      {armed ? label : children}
    </button>
  );
}

// Slide-in detail panel for drill-downs. Click scrim or press Esc to close.
export function Drawer({ title, sub, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div><h2>{title}</h2>{sub && <div className="sub">{sub}</div>}</div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

// One person line inside a drill-down drawer: initials avatar + name + meta.
export function PersonRow({ name, meta, right }) {
  const initials = (name || '?').split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="drill-row">
      <span className="av">{initials}</span>
      <div className="who"><div className="nm">{name}</div>{meta && <div className="meta">{meta}</div>}</div>
      {right && <div className="t">{right}</div>}
    </div>
  );
}
