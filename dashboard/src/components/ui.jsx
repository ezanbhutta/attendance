import { useState } from 'react';

export function Card({ title, actions, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <h2>{title}</h2>
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

// Metric card with a colored icon tile. tone: ok | danger | warn | violet | sky.
export function Stat({ icon: Icon, label, value, tone = 'violet', hint }) {
  return (
    <div className="stat">
      {Icon && <span className={`stat-icon ${tone}`}><Icon size={19} strokeWidth={2.2} /></span>}
      <div className="stat-body">
        <div className="label">{label}</div>
        <div className="value">{value}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
    </div>
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
