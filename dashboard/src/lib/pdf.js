import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { interRegular, interMedium, interSemiBold, interBold } from './pdfFonts';

// One-click, art-directed PDF export. A premium attendance document set in real
// Inter type: a violet hero panel with a white attendance ring, tinted stat
// cards, a plain-English summary of how the person is doing, a day-breakdown
// bar, the full figures and a clean day-by-day ledger. Built in-app (no print
// dialog, no URL footer). Renders one person, or a whole shift / department
// (an aggregate cover, then a section per person) — all in one document.

const M = 50;                          // page margin
const INK = [17, 17, 21];
const SOFT = [92, 91, 102];
const MUTE = [120, 119, 132];
const FAINT = [150, 149, 161];
const HAIR = [225, 224, 233];
const HAIRX = [238, 237, 244];
const ACCENT = [114, 41, 255];         // #7229FF brand violet
const ACCENT2 = [150, 110, 255];       // lighter violet (ring track)
const PANEL_SUB = [223, 212, 250];     // text on violet
const PANEL_DIM = [201, 183, 252];

// Soft tint / strong pairs for stat cards, chips and the breakdown bar.
const TONE = {
  green: { bg: [236, 247, 240], fg: [21, 145, 83] },
  red: { bg: [252, 239, 239], fg: [206, 44, 49] },
  amber: { bg: [253, 246, 233], fg: [176, 106, 11] },
  blue: { bg: [236, 242, 252], fg: [40, 102, 222] },
  violet: { bg: [243, 239, 252], fg: [114, 41, 255] },
  neutral: { bg: [243, 243, 247], fg: [29, 28, 36] },
};
const STATUS_TONE = {
  Present: 'green', HolidayWorked: 'green', Incomplete: 'amber', Absent: 'red',
  Leave: 'blue', WeeklyOff: 'neutral', Holiday: 'violet',
};
const STATUS_COLOR = Object.fromEntries(Object.entries(STATUS_TONE).map(([k, t]) => [k, TONE[t].fg]));
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
function eyebrow(doc, y, label, color = FAINT) {
  set(doc, 'semibold', 7.6, color);
  tracked(doc, label.toUpperCase(), M, y, 1.3);
  return y + 6;
}

// A donut ring with a percentage arc, drawn as round-capped segments.
function ring(doc, cx, cy, r, t, pct, { track, arc, text }) {
  doc.setLineCap('round'); doc.setLineJoin('round');
  doc.setLineWidth(t).setDrawColor(...track).circle(cx, cy, r, 'S');
  const p = Math.max(0, Math.min(100, pct || 0));
  if (p > 0) {
    doc.setDrawColor(...arc);
    const steps = Math.max(2, Math.round((p / 100) * 84));
    const start = -Math.PI / 2, total = (p / 100) * 2 * Math.PI;
    let px = cx + r * Math.cos(start), py = cy + r * Math.sin(start);
    for (let i = 1; i <= steps; i++) {
      const a = start + total * (i / steps);
      const nx = cx + r * Math.cos(a), ny = cy + r * Math.sin(a);
      doc.line(px, py, nx, ny); px = nx; py = ny;
    }
  }
  doc.setLineCap('butt');
  set(doc, 'bold', r * 0.52, text);
  doc.text(`${Math.round(p)}%`, cx, cy + r * 0.2, { align: 'center' });
}

// The violet hero panel: brand, the subject as the headline, and an attendance
// ring. The signature element of every document.
function heroPanel(doc, logo, { kicker, subject, sub, ring: ringOpt, generated, compact }) {
  const W = pageW(doc), x = M, y = M, w = W - 2 * M, h = compact ? 116 : 150, pad = 26;
  doc.setFillColor(...ACCENT); doc.roundedRect(x, y, w, h, 16, 16, 'F');
  if (!compact) {
    doc.setFillColor(255, 255, 255); doc.roundedRect(x + pad, y + 22, 22, 22, 6, 6, 'F');
    if (logo) doc.addImage(logo, 'PNG', x + pad + 3.5, y + 25.5, 15, 15);
    set(doc, 'semibold', 11, [255, 255, 255]); doc.text('HaseebMadeit', x + pad + 30, y + 37);
    if (generated) { set(doc, 'normal', 8, PANEL_DIM); doc.text(generated, x + w - pad, y + 31, { align: 'right' }); }
  }
  let ty = compact ? y + 42 : y + 80;
  set(doc, 'semibold', 8, PANEL_DIM); tracked(doc, kicker.toUpperCase(), x + pad, ty, 1.5);
  ty += compact ? 22 : 26;
  set(doc, 'bold', compact ? 22 : 27, [255, 255, 255]); tracked(doc, subject, x + pad, ty, -0.4);
  ty += compact ? 15 : 17;
  if (sub) { set(doc, 'normal', 9.5, PANEL_SUB); doc.text(sub, x + pad, ty); }
  if (ringOpt) {
    const r = compact ? 33 : 39, cx = x + w - pad - r - 4, cy = y + h / 2;
    ring(doc, cx, cy, r, compact ? 8 : 9, ringOpt.pct, { track: ACCENT2, arc: [255, 255, 255], text: [255, 255, 255] });
    set(doc, 'medium', 6.8, PANEL_DIM); tracked(doc, (ringOpt.label || '').toUpperCase(), cx, cy + r + 13, 0.8, { align: 'center' });
  }
  return y + h;
}

// A row of soft tinted metric cards.
function statCards(doc, y, cards) {
  if (!cards?.length) return y;
  const W = pageW(doc), gap = 10, n = cards.length;
  const cw = (W - 2 * M - gap * (n - 1)) / n, h = 54;
  y += 16;
  cards.forEach((c, i) => {
    const x = M + i * (cw + gap), tone = TONE[c.tone] || TONE.neutral;
    doc.setFillColor(...tone.bg); doc.roundedRect(x, y, cw, h, 9, 9, 'F');
    doc.setFillColor(...tone.fg); doc.circle(x + 15, y + 17.5, 2.4, 'F');
    set(doc, 'semibold', 6.8, MUTE); tracked(doc, c.label.toUpperCase(), x + 23, y + 20, 0.4);
    set(doc, 'bold', 18, tone.fg); doc.text(String(c.value), x + 15, y + 43);
  });
  return y + h;
}

// The plain-English assessment — "how this person is" — in a soft card.
function proseCard(doc, y, text, label = 'Summary') {
  if (!text) return y;
  const W = pageW(doc), H = pageH(doc), pad = 18, lh = 14.4;
  set(doc, 'normal', 9.6, INK);
  const wrapped = doc.splitTextToSize(text, W - 2 * M - 2 * pad);
  const cardH = pad + 13 + wrapped.length * lh + pad - 4;
  y += 22;
  if (y + cardH > H - M - 20) { doc.addPage(); y = M; }
  doc.setFillColor(247, 246, 251); doc.roundedRect(M, y, W - 2 * M, cardH, 12, 12, 'F');
  let iy = y + pad + 3;
  set(doc, 'semibold', 7.6, ACCENT); tracked(doc, label.toUpperCase(), M + pad, iy, 1.3);
  iy += 15;
  set(doc, 'normal', 9.6, [44, 43, 52]); doc.text(wrapped, M + pad, iy, { lineHeightFactor: 1.5 });
  return y + cardH;
}

// A stacked horizontal bar of the day breakdown, with a legend.
function distBar(doc, y, segs, label = 'Breakdown') {
  const items = (segs || []).filter((s) => s.value > 0);
  if (!items.length) return y;
  const W = pageW(doc);
  y += 26;
  y = eyebrow(doc, y, label) + 12;
  const total = items.reduce((a, s) => a + s.value, 0);
  const barW = W - 2 * M, h = 13;
  let x = M;
  items.forEach((s) => {
    const segW = (s.value / total) * barW;
    doc.setFillColor(...s.color); doc.rect(x, y, Math.max(segW, 0.6), h, 'F');
    x += segW;
    if (x < M + barW - 0.6) { doc.setFillColor(255, 255, 255); doc.rect(x - 0.9, y, 1.8, h, 'F'); }
  });
  y += h + 16;
  let lx = M;
  items.forEach((s) => {
    doc.setFillColor(...s.color); doc.circle(lx + 3, y - 3, 2.6, 'F');
    set(doc, 'medium', 8.4, INK); doc.text(s.label, lx + 10, y);
    const lw = doc.getTextWidth(s.label);
    set(doc, 'semibold', 8.4, MUTE); doc.text(String(s.value), lx + 10 + lw + 6, y);
    lx += 10 + lw + 6 + doc.getTextWidth(String(s.value)) + 22;
  });
  return y + 4;
}

// The full figures, as a clean three-column definition grid with hairline rows.
function summaryGrid(doc, y, figures, label = 'Key figures') {
  y += 28;
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
    didDrawCell: (d) => { if (d.column.index === 0 && d.row.index < body.length) rule(doc, d.cell.y + d.cell.height, HAIRX, 0.5); },
  });
  return doc.lastAutoTable.finalY;
}

// Clean ledger. No grid — ruled header, light row rules, right-aligned numbers,
// a coloured status chip and quietly muted off-days.
function detailTable(doc, y, columns, rows, { label = 'Day by day', statusCol = 1, numCols = [], widths = {}, compact = false } = {}) {
  y += compact ? 22 : 26;
  if (y > pageH(doc) - 150) { doc.addPage(); y = M; }   // never orphan the header at a page foot
  y = eyebrow(doc, y, label) + 9;
  const colStyles = {};
  numCols.forEach((i) => { colStyles[i] = { halign: 'right' }; });
  Object.entries(widths).forEach(([i, w]) => { colStyles[i] = { ...(colStyles[i] || {}), cellWidth: w }; });
  if (statusCol >= 0) colStyles[statusCol] = { ...(colStyles[statusCol] || {}), cellPadding: { top: 6.5, bottom: 6.5, left: 9, right: 5 } };
  autoTable(doc, {
    startY: y, head: [columns], body: rows, theme: 'plain',
    headStyles: { font: 'Inter', fontStyle: 'semibold', fontSize: 6.8, textColor: FAINT, cellPadding: { top: 0, bottom: 8, left: 5, right: 5 }, halign: 'left' },
    styles: { font: 'Inter', fontStyle: 'normal', fontSize: 8.3, textColor: INK, cellPadding: { top: 6.5, bottom: 6.5, left: 5, right: 5 }, overflow: 'linebreak', valign: 'middle', lineWidth: 0 },
    columnStyles: colStyles,
    margin: { left: M, right: M, bottom: M + 28 },
    didParseCell: (d) => {
      if (d.section === 'head') { d.cell.text = d.cell.text.map((t) => t.toUpperCase()); d.cell.styles.charSpace = 0.6; }
      if (d.section === 'body') {
        const st = d.row.raw[statusCol];
        if (OFF.has(st)) d.cell.styles.textColor = SOFT;
        if (numCols.includes(d.column.index)) d.cell.styles.textColor = OFF.has(st) ? FAINT : INK;
        if (d.column.index === 0) d.cell.styles.fontStyle = 'semibold';
        if (d.column.index === statusCol) { d.cell.styles.fontStyle = 'semibold'; const t = TONE[STATUS_TONE[st]]; if (t) d.cell.styles.textColor = t.fg; }
      }
    },
    willDrawCell: (d) => {
      if (d.section === 'body' && d.column.index === statusCol) {
        const t = TONE[STATUS_TONE[d.row.raw[statusCol]]];
        if (t) {
          set(doc, 'semibold', 8.3); const tw = doc.getTextWidth(d.row.raw[statusCol]);
          doc.setFillColor(...t.bg);
          doc.roundedRect(d.cell.x + 5, d.cell.y + d.cell.height / 2 - 8, tw + 16, 16, 8, 8, 'F');
        }
      }
    },
    didDrawCell: (d) => {
      if (d.section === 'head' && d.column.index === 0) rule(doc, d.cell.y + d.cell.height, HAIR, 0.7);
      if (d.section === 'body' && d.column.index === 0) rule(doc, d.cell.y + d.cell.height, HAIRX, 0.5);
    },
  });
  return doc.lastAutoTable.finalY;
}

function footers(doc, subjectName) {
  const W = pageW(doc), H = pageH(doc), pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    rule(doc, H - 32, HAIR, 0.5);
    set(doc, 'semibold', 7.4, SOFT); doc.text('HaseebMadeit', M, H - 20);
    const wb = doc.getTextWidth('HaseebMadeit');
    set(doc, 'normal', 7.4, FAINT); doc.text('Attendance OS', M + wb + 7, H - 20);
    doc.text(`${subjectName}    ·    ${i} / ${pages}`, W - M, H - 20, { align: 'right' });
  }
}

function legendBlock(doc, y, legend) {
  if (!legend?.length) return y;
  const W = pageW(doc), H = pageH(doc);
  if (y > H - 150) { doc.addPage(); y = M; }
  y += 28;
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

// Auto-derive the panel ring from an "Attendance"/"On-time" % card if not given.
function deriveRing(ringOpt, cards) {
  if (ringOpt) return ringOpt;
  const c = (cards || []).find((m) => /attendance|on-?time|rate/i.test(m.label) && /%$/.test(String(m.value)));
  return c ? { pct: parseInt(c.value, 10) || 0, label: c.label } : null;
}

function renderUnit(doc, logo, { kicker, subject, sub, generated, ring: ringOpt, hero, summary, dist, figures, detail, roster, tables }, compact) {
  let y = heroPanel(doc, logo, { kicker, subject, sub, generated, ring: deriveRing(ringOpt, hero), compact });
  y = statCards(doc, y, hero);
  if (summary) y = proseCard(doc, y, summary, 'Summary');
  if (dist?.length) y = distBar(doc, y, dist, 'Day breakdown');
  if (figures?.length) y = summaryGrid(doc, y, figures, 'Key figures');
  if (roster) y = detailTable(doc, y, roster.columns, roster.rows, { label: roster.label || 'Roster', statusCol: roster.statusCol ?? -1, numCols: roster.numCols || [], widths: roster.widths || {} });
  if (detail) y = detailTable(doc, y, detail.columns, detail.rows, { label: detail.label || 'Day by day', statusCol: detail.statusCol ?? 1, numCols: detail.numCols || [], widths: detail.widths || {}, compact });
  if (tables?.length) tables.forEach((t) => { y = detailTable(doc, y, t.columns, t.rows, { label: t.label || 'Detail', statusCol: t.statusCol ?? -1, numCols: t.numCols || [], widths: t.widths || {} }); });
  return y;
}

export async function downloadReportPDF(opts) {
  const { fileName, subject, orientation = 'portrait', sections, legend = [], generated } = opts;
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation });
  registerFonts(doc);
  doc.setFont('Inter', 'normal');
  const logo = await logoPng();
  const gen = generated || new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    '  ·  ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  let y = renderUnit(doc, logo, { ...opts, generated: `Generated ${gen}` }, false);

  if (sections?.length) {
    sections.forEach((s) => {
      doc.addPage();
      y = renderUnit(doc, logo, { kicker: s.kicker, subject: s.subject, sub: s.sub, ring: s.ring, hero: s.hero, summary: s.summary, dist: s.dist, figures: s.figures, detail: s.detail }, true);
    });
  }

  legendBlock(doc, y, legend);
  footers(doc, subject);
  doc.save(`${(fileName || 'report').replace(/[\\/:*?"<>|]+/g, '-')}.pdf`);
}
