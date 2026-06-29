// Client-side CSV export (spec §8). columns: [{ key, label, get?(row) }]
export function toCSV(rows, columns) {
  // Neutralize CSV formula/macro injection: a cell beginning with = + - @ (or a
  // tab/CR that some spreadsheets treat as a formula lead) is prefixed with a
  // single quote so Excel/Sheets render it as text, not execute it. Device-
  // controlled values (employee names etc.) flow into these exports.
  const esc = (v) => {
    if (v == null) return '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label ?? c.key)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(c.get ? c.get(r) : r[c.key])).join(',')).join('\n');
  return `${head}\n${body}`;
}

export function downloadCSV(filename, rows, columns) {
  const blob = new Blob([toCSV(rows, columns)], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}
