import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { interRegular, interMedium, interSemiBold, interBold } from './pdfFonts';

// One-click, art-directed PDF export — a "Minimal Swiss" attendance document:
// real Inter typography, generous whitespace, hairline rules and restrained
// colour. Built in-app (no print dialog, no URL footer). Renders one person
// (masthead + hero metrics + summary + day-by-day) or a whole shift /
// department (an aggregate cover, then a section per person) in one document.

const M = 54;                          // page margin
const INK = [17, 17, 21];              // near-black, primary
const SOFT = [92, 91, 102];            // secondary text
const FAINT = [150, 149, 161];         // captions / labels
const HAIR = [225, 224, 233];          // hairline
const HAIRX = [238, 237, 244];         // softer hairline (row rules)
const ACCENT = [114, 41, 255];         // #7229FF — the one spot of colour

const STATUS_COLOR = {
  Present: [22, 150, 86], HolidayWorked: [22, 150, 86],
  Incomplete: [200, 120, 10], Absent: [214, 45, 50],
  Leave: [42, 104, 224], WeeklyOff: [150, 149, 161], Holiday: [124, 58, 237],
};
const OFF = new Set(['WeeklyOff', 'Holiday', 'Leave', '—', '']);

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 392.35 392.35"><rect width="392.35" height="392.35" rx="86" fill="#7229FF"/><path fill="#ffffff" d="M187.32,115.24h17.71c2.46,0,4.46,1.99,4.46,4.46v61.29c0,1.98-1.31,3.73-3.21,4.28l-17.71,5.16c-2.86.83-5.7-1.31-5.7-4.28v-66.45c0-2.46,1.99-4.46,4.46-4.46ZM167.44,142.55v50.69c0,1.98-1.31,3.73-3.21,4.28l-17.71,5.16c-2.86.83-5.7-1.31-5.7-4.28v-55.85c0-2.46,1.99-4.46,4.46-4.46h17.71c2.46,0,4.46,1.99,4.46,4.46ZM144.03,219.52l17.71-5.16c2.86-.83,5.7,1.31,5.7,4.28v31.16c0,2.46-1.99,4.46-4.46,4.46h-17.71c-2.46,0-4.46-1.99-4.46-4.46v-26c0-1.98,1.31-3.73,3.21-4.28ZM186.07,207.27l17.71-5.16c2.86-.83,5.7,1.31,5.7,4.28v66.26c0,2.46-1.99,4.46-4.46,4.46h-17.71c-2.46,0-4.46-1.99-4.46-4.46v-61.1c0-1.99,1.31-3.73,3.21-4.28ZM224.9,249.8v-50.5c0-1.98,1.31-3.73,3.21-4.28l17.71-5.16c2.86-.83,5.7,1.31,5.7,4.28v55.66c0,2.46-1.99,4.46-4.46,4.46h-17.71c-2.46,0-4.46-1.99-4.46-4.46ZM251.52,142.55v26.19c0,1.99-1.31,3.73-3.21,4.28l-17.71,5.16c-2.86.83-5.7-1.31-5.7-4.28v-31.35c0-2.46,1.99-4.46,4.46-4.46h17.71c2.46,0,4.46,1.99,4.46,4.46h0Z"/></svg>`;

function logoPng(px = 96) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = px; c.height = px;
        c.getContext('2d').drawImage(img, 0, 0, px, px);
        resolve(c.toDataURL('image/png'));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(LOGO_SVG);
  });
}

function registerFonts(doc) {
  doc.addFileToVFS('Inter-Regular.ttf', interRegular); doc.addFont('Inter-Regular.ttf', 'Inter', 'normal');
  doc.addFileToVFS('Inter-Medium.ttf', interMedium); doc.addFont('Inter-Medium.ttf', 'Inter', 'medium');
  doc.addFileToVFS('Inter-SemiBold.ttf', interSemiBold); doc.addFont('Inter-SemiBold.ttf', 'Inter', 'semibold');
  doc.addFileToVFS('Inter-Bold.ttf', interBold); doc.addFont('Inter-Bold.ttf', 'Inter', 'bold');
}

// ── small drawing helpers ───────────────────────────────────────────────────
const pageW = (doc) => doc.internal.pageSize.getWidth();
const pageH = (doc) => doc.internal.pageSize.getHeight();
const rule = (doc, y, color = HAIR, w = 0.6, x1 = M, x2 = null) =>
  doc.setDrawColor(...color).setLineWidth(w).line(x1, y, x2 == null ? pageW(doc) - M : x2, y);
const set = (doc, weight, size, color) => {
  doc.setFont('Inter', weight).setFontSize(size);
  if (color) doc.setTextColor(...color);
};
const tracked = (doc, text, x, y, space, opts) => {
  doc.setCharSpace(space); doc.text(text, x, y, opts); doc.setCharSpace(0);
};

function mastheadTop(doc, logo, generated) {
  const y = M;
  if (logo) doc.addImage(logo, 'PNG', M, y, 15, 15);
  set(doc, 'semibold', 10.5, INK);
  doc.text('HaseebMadeit', M + 21, y + 11.4);
  set(doc, 'normal', 8.4, FAINT);
  doc.text(generated, pageW(doc) - M, y + 10, { align: 'right' });
  rule(doc, y + 25, HAIR, 0.6);
  return y + 25;
}

// Eyebrow kicker, big subject name, quiet subline. The subject (person / shift /
// department) is the hero of the page.
function subjectBlock(doc, y, { kicker, subject, sub }, compact = false) {
  y += compact ? 6 : 40;
  set(doc, 'semibold', 8, ACCENT);
  tracked(doc, kicker.toUpperCase(), M, y, 1.4);
  y += compact ? 20 : 26;
  set(doc, 'bold', compact ? 21 : 29, INK);
  tracked(doc, subject, M, y, compact ? -0.3 : -0.5);
  y += compact ? 15 : 17;
  if (sub) { set(doc, 'normal', 10, SOFT); doc.text(sub, M, y); y += 6; }
  return y;
}

// A band of up to four big metrics, hairline-ruled top and bottom with quiet
// vertical separators — the at-a-glance headline numbers.
function heroBand(doc, y, metrics) {
  if (!metrics?.length) return y;
  y += 26;
  const usable = pageW(doc) - 2 * M, col = usable / metrics.length, bh = 58;
  rule(doc, y, INK, 0.8);
  metrics.forEach((m, i) => {
    const x = M + col * i;
    if (i > 0) doc.setDrawColor(...HAIRX).setLineWidth(0.6).line(x, y + 13, x, y + bh - 8); // quiet column separator
    set(doc, 'semibold', 20, INK);
    tracked(doc, String(m.value), x + (i ? 16 : 0), y + 32, -0.4);
    set(doc, 'medium', 7.4, FAINT);
    tracked(doc, m.label.toUpperCase(), x + (i ? 16 : 0), y + 47, 0.8);
  });
  rule(doc, y + bh, HAIR, 0.6);
  return y + bh;
}

function eyebrow(doc, y, label) {
  set(doc, 'semibold', 7.6, FAINT);
  tracked(doc, label.toUpperCase(), M, y, 1.3);
  return y + 6;
}

// Full figure list as a clean three-column definition grid, hairline rows.
function summaryGrid(doc, y, figures, label = 'Summary') {
  y += 30;
  y = eyebrow(doc, y, label) + 6;
  const body = [];
  for (let i = 0; i < figures.length; i += 3) {
    const row = [];
    figures.slice(i, i + 3).forEach(([l, v]) => row.push(l, String(v)));
    while (row.length < 6) row.push('');
    body.push(row);
  }
  autoTable(doc, {
    startY: y, body, theme: 'plain',
    styles: { font: 'Inter', fontStyle: 'normal', fontSize: 8.6, textColor: INK, cellPadding: { top: 6.5, bottom: 6.5, left: 0, right: 8 } },
    columnStyles: {
      0: { font: 'Inter', fontStyle: 'medium', textColor: FAINT, cellWidth: 96 },
      1: { font: 'Inter', fontStyle: 'semibold' },
      2: { font: 'Inter', fontStyle: 'medium', textColor: FAINT, cellWidth: 96 },
      3: { font: 'Inter', fontStyle: 'semibold' },
      4: { font: 'Inter', fontStyle: 'medium', textColor: FAINT, cellWidth: 96 },
      5: { font: 'Inter', fontStyle: 'semibold' },
    },
    margin: { left: M, right: M },
    didDrawCell: (d) => {
      if (d.column.index === 0 && d.row.index < body.length)
        rule(doc, d.cell.y + d.cell.height, HAIRX, 0.5);
    },
  });
  return doc.lastAutoTable.finalY;
}

// Minimal "ledger": no grid, just a ruled header and light row rules. Numeric
// columns right-aligned, the status carries a small colour dot, and off days
// (weekly off / holiday / leave) are quietly muted so worked days stand out.
function detailTable(doc, y, columns, rows, { label = 'Day by day', statusCol = 1, numCols = [], widths = {}, compact = false } = {}) {
  y += compact ? 22 : 28;
  y = eyebrow(doc, y, label) + 9;
  const colStyles = {};
  numCols.forEach((i) => { colStyles[i] = { halign: 'right' }; });
  Object.entries(widths).forEach(([i, w]) => { colStyles[i] = { ...(colStyles[i] || {}), cellWidth: w }; });
  if (statusCol >= 0) colStyles[statusCol] = { ...(colStyles[statusCol] || {}), cellPadding: { top: 7, bottom: 7, left: 12, right: 5 } };
  autoTable(doc, {
    startY: y, head: [columns], body: rows, theme: 'plain',
    headStyles: { font: 'Inter', fontStyle: 'semibold', fontSize: 6.8, textColor: FAINT, cellPadding: { top: 0, bottom: 8, left: 5, right: 5 }, halign: 'left' },
    styles: { font: 'Inter', fontStyle: 'normal', fontSize: 8.3, textColor: INK, cellPadding: { top: 7, bottom: 7, left: 5, right: 5 }, overflow: 'linebreak', valign: 'middle', lineWidth: 0 },
    columnStyles: colStyles,
    margin: { left: M, right: M, bottom: M + 30 },
    didParseCell: (d) => {
      if (d.section === 'head') { d.cell.text = d.cell.text.map((t) => t.toUpperCase()); d.cell.styles.charSpace = 0.6; }
      if (d.section === 'body') {
        const st = d.row.raw[statusCol];
        if (OFF.has(st)) d.cell.styles.textColor = SOFT;
        if (d.column.index === statusCol) d.cell.styles.fontStyle = 'medium';
        if (numCols.includes(d.column.index)) d.cell.styles.textColor = OFF.has(st) ? FAINT : INK;
        if (d.column.index === 0) d.cell.styles.fontStyle = 'semibold';
      }
    },
    didDrawCell: (d) => {
      if (d.section === 'head' && d.column.index === 0) rule(doc, d.cell.y + d.cell.height, HAIR, 0.7);
      if (d.section === 'body' && d.column.index === 0) rule(doc, d.cell.y + d.cell.height, HAIRX, 0.5);
      if (d.section === 'body' && d.column.index === statusCol) {
        const st = d.row.raw[statusCol];
        const c = STATUS_COLOR[st];
        if (c) { doc.setFillColor(...c); doc.circle(d.cell.x + 5.5, d.cell.y + d.cell.height / 2, 2.1, 'F'); }
      }
    },
  });
  return doc.lastAutoTable.finalY;
}

function footers(doc, subjectName) {
  const W = pageW(doc), H = pageH(doc);
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    rule(doc, H - 34, HAIR, 0.5);
    set(doc, 'semibold', 7.4, SOFT);
    doc.text('HaseebMadeit', M, H - 22);
    const wb = doc.getTextWidth('HaseebMadeit');
    set(doc, 'normal', 7.4, FAINT);
    doc.text('Attendance OS', M + wb + 7, H - 22);
    doc.text(`${subjectName}    ·    ${i} / ${pages}`, W - M, H - 22, { align: 'right' });
  }
}

function legendBlock(doc, y, legend) {
  if (!legend?.length) return y;
  const W = pageW(doc), H = pageH(doc);
  if (y > H - 150) { doc.addPage(); y = M - 28; }
  y += 30;
  y = eyebrow(doc, y, 'Notes') + 12;
  set(doc, 'normal', 8.6, SOFT);
  legend.forEach((line) => {
    const wrapped = doc.splitTextToSize(line, W - 2 * M);
    if (y + wrapped.length * 12 > H - M) { doc.addPage(); y = M; }
    doc.text(wrapped, M, y, { lineHeightFactor: 1.4 });
    y += wrapped.length * 12 + 4;
  });
  return y;
}

export async function downloadReportPDF({ fileName, kicker, subject, sub, generated, orientation = 'portrait', hero = [], figures = [], detail, roster, tables, sections, legend = [] }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation });
  registerFonts(doc);
  doc.setFont('Inter', 'normal');
  const logo = await logoPng();
  const gen = generated || new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    '  ·  ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  let y = mastheadTop(doc, logo, `Generated ${gen}`);
  y = subjectBlock(doc, y, { kicker, subject, sub });
  y = heroBand(doc, y, hero);
  if (figures.length) y = summaryGrid(doc, y, figures, sections?.length ? 'Overall summary' : 'Summary');
  if (roster) y = detailTable(doc, y, roster.columns, roster.rows, { label: roster.label || 'Roster', statusCol: roster.statusCol ?? -1, numCols: roster.numCols || [], widths: roster.widths || {} });
  if (detail) y = detailTable(doc, y, detail.columns, detail.rows, { label: detail.label || 'Day by day', statusCol: detail.statusCol ?? 1, numCols: detail.numCols || [], widths: detail.widths || {} });
  if (tables?.length) tables.forEach((t) => {
    y = detailTable(doc, y, t.columns, t.rows, { label: t.label || 'Detail', statusCol: t.statusCol ?? -1, numCols: t.numCols || [], widths: t.widths || {} });
  });

  if (sections?.length) {
    sections.forEach((s) => {
      doc.addPage();
      let py = subjectBlock(doc, M - 26, { kicker: s.kicker, subject: s.subject, sub: s.sub }, true);
      py = heroBand(doc, py, s.hero || []);
      if (s.figures?.length) py = summaryGrid(doc, py, s.figures);
      if (s.detail) detailTable(doc, py, s.detail.columns, s.detail.rows, { label: 'Day by day', statusCol: s.detail.statusCol ?? 1, numCols: s.detail.numCols || [], widths: s.detail.widths || {}, compact: true });
    });
  }

  legendBlock(doc, y, legend);
  footers(doc, subject);
  doc.save(`${(fileName || 'report').replace(/[\\/:*?"<>|]+/g, '-')}.pdf`);
}
