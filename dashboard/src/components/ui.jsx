import { useState, useEffect } from 'react';

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
export function Stat({ icon: Icon, label, value, tone = 'violet', hint, delta, onClick, help }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`stat${onClick ? ' clickable' : ''}`} onClick={onClick}>
      <div className="stat-top">
        <span className="label">{label}{help && <InfoTip text={help} />}</span>
        {Icon && <span className={`stat-icon ${tone}`}><Icon size={16} strokeWidth={2} /></span>}
      </div>
      <div className="stat-body">
        <div className="value">{value}</div>
        {(delta || hint) && (
          <div className="hint">{delta && <span className={`delta ${delta.dir}`}>{delta.text}</span>} {hint}</div>
        )}
      </div>
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

// Generic table. columns: [{ key, label, num?, render?(row), get?(row) }]
export function Table({ columns, rows, loading, empty = 'Nothing here yet.' }) {
  if (loading) return <Spinner />;
  if (!rows || rows.length === 0) return <div className="empty">{empty}</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={c.num ? 'num' : ''}>{c.label ?? c.key}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i}>
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
