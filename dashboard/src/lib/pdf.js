import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// One-click, branded PDF export. Builds the document in-app (no browser print
// dialog, no URL footer) so a single click downloads a clean, paginated report.
// Works for one person (figures + table) or many (an aggregate summary on the
// cover, then a section per employee) — all in a single document.

const ACCENT = [114, 41, 255];   // #7229FF
const INK = [21, 20, 27];
const MUTE = [108, 106, 120];
const HAIR = [232, 230, 240];
const M = 42;

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 392.35 392.35"><rect width="392.35" height="392.35" rx="86" fill="#7229FF"/><path fill="#ffffff" d="M187.32,115.24h17.71c2.46,0,4.46,1.99,4.46,4.46v61.29c0,1.98-1.31,3.73-3.21,4.28l-17.71,5.16c-2.86.83-5.7-1.31-5.7-4.28v-66.45c0-2.46,1.99-4.46,4.46-4.46ZM167.44,142.55v50.69c0,1.98-1.31,3.73-3.21,4.28l-17.71,5.16c-2.86.83-5.7-1.31-5.7-4.28v-55.85c0-2.46,1.99-4.46,4.46-4.46h17.71c2.46,0,4.46,1.99,4.46,4.46ZM144.03,219.52l17.71-5.16c2.86-.83,5.7,1.31,5.7,4.28v31.16c0,2.46-1.99,4.46-4.46,4.46h-17.71c-2.46,0-4.46-1.99-4.46-4.46v-26c0-1.98,1.31-3.73,3.21-4.28ZM186.07,207.27l17.71-5.16c2.86-.83,5.7,1.31,5.7,4.28v66.26c0,2.46-1.99,4.46-4.46,4.46h-17.71c-2.46,0-4.46-1.99-4.46-4.46v-61.1c0-1.99,1.31-3.73,3.21-4.28ZM224.9,249.8v-50.5c0-1.98,1.31-3.73,3.21-4.28l17.71-5.16c2.86-.83,5.7,1.31,5.7,4.28v55.66c0,2.46-1.99,4.46-4.46,4.46h-17.71c-2.46,0-4.46-1.99-4.46-4.46ZM251.52,142.55v26.19c0,1.99-1.31,3.73-3.21,4.28l-17.71,5.16c-2.86.83-5.7-1.31-5.7-4.28v-31.35c0-2.46,1.99-4.46,4.46-4.46h17.71c2.46,0,4.46,1.99,4.46,4.46h0Z"/></svg>`;

function logoPng(px = 110) {
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

function letterhead(doc, logo, { title, subtitle, metaLine }) {
  const W = doc.internal.pageSize.getWidth();
  const now = new Date();
  let y = M;
  if (logo) doc.addImage(logo, 'PNG', M, y, 30, 30);
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...INK);
  doc.text('HaseebMadeit', M + 40, y + 12);
  doc.setFont('helvetica', 'bold').setFontSize(6.6).setTextColor(...ACCENT);
  doc.text('A T T E N D A N C E   O S', M + 40, y + 23);
  doc.setFont('helvetica', 'normal').setFontSize(6.4).setTextColor(160, 160, 170);
  doc.text('GENERATED', W - M, y + 5, { align: 'right' });
  doc.setFontSize(8.5).setTextColor(110, 110, 122);
  doc.text(now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }), W - M, y + 16, { align: 'right' });
  doc.text(now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), W - M, y + 27, { align: 'right' });
  y += 38;
  doc.setDrawColor(...ACCENT).setLineWidth(1.8).line(M, y, W - M, y);
  y += 24;
  doc.setFont('helvetica', 'bold').setFontSize(19).setTextColor(...INK);
  doc.text(title, M, y); y += 16;
  if (subtitle) { doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(...MUTE); doc.text(subtitle, M, y); y += 14; }
  if (metaLine) { doc.setFontSize(9.5).setTextColor(...MUTE); doc.text(metaLine, M, y); y += 6; }
  return y;
}

function summaryBlock(doc, y, figures, label = 'SUMMARY') {
  const W = doc.internal.pageSize.getWidth();
  y += 16;
  doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...ACCENT);
  doc.text(label, M, y);
  const body = [];
  for (let i = 0; i < figures.length; i += 3) {
    const row = [];
    figures.slice(i, i + 3).forEach(([l, v]) => row.push(l, String(v)));
    while (row.length < 6) row.push('');
    body.push(row);
  }
  autoTable(doc, {
    startY: y + 7, body, theme: 'plain',
    styles: { fontSize: 9, cellPadding: { top: 4.5, bottom: 4.5, left: 0, right: 10 }, textColor: INK },
    columnStyles: { 0: { textColor: MUTE, cellWidth: 92 }, 1: { fontStyle: 'bold' }, 2: { textColor: MUTE, cellWidth: 92 }, 3: { fontStyle: 'bold' }, 4: { textColor: MUTE, cellWidth: 92 }, 5: { fontStyle: 'bold' } },
    margin: { left: M, right: M },
  });
  return doc.lastAutoTable.finalY + 4;
}

function tableBlock(doc, y, columns, rows, label = 'DETAIL') {
  y += 14;
  doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...ACCENT);
  doc.text(label, M, y);
  autoTable(doc, {
    startY: y + 7, head: [columns], body: rows, theme: 'grid',
    headStyles: { fillColor: [243, 241, 250], textColor: ACCENT, fontStyle: 'bold', fontSize: 7.4, lineColor: HAIR, lineWidth: 0.5, cellPadding: 5 },
    styles: { fontSize: 8.2, cellPadding: 4.5, textColor: INK, lineColor: [237, 236, 243], lineWidth: 0.5, overflow: 'linebreak', valign: 'middle' },
    alternateRowStyles: { fillColor: [250, 249, 252] },
    margin: { left: M, right: M, top: M, bottom: M + 16 },
  });
  return doc.lastAutoTable.finalY + 12;
}

export async function downloadReportPDF({ title, subtitle, metaLine, fileName, figures, columns, rows, legend = [], sections }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const logo = await logoPng();

  let y = letterhead(doc, logo, { title, subtitle, metaLine });
  if (figures?.length) y = summaryBlock(doc, y, figures, sections?.length ? 'OVERALL SUMMARY' : 'SUMMARY');

  if (sections?.length) {
    // One section (employee) per fresh page: heading + their summary + their detail.
    sections.forEach((s) => {
      doc.addPage(); y = M;
      doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(...INK);
      doc.text(s.heading, M, y); y += 14;
      if (s.subLine) { doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...MUTE); doc.text(s.subLine, M, y); y += 4; }
      if (s.figures?.length) y = summaryBlock(doc, y, s.figures);
      if (s.columns?.length) y = tableBlock(doc, y, s.columns, s.rows);
    });
  } else if (columns?.length) {
    y = tableBlock(doc, y, columns, rows);
  }

  if (legend.length) {
    if (y > H - 110) { doc.addPage(); y = M; }
    y += 6;
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...ACCENT);
    doc.text('HOW TO READ THIS', M, y); y += 13;
    doc.setFont('helvetica', 'normal').setFontSize(8.6).setTextColor(...MUTE);
    legend.forEach((line) => {
      const wrapped = doc.splitTextToSize(line, W - 2 * M);
      if (y + wrapped.length * 11 > H - M) { doc.addPage(); y = M; }
      doc.text(wrapped, M, y); y += wrapped.length * 11 + 3;
    });
  }

  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...HAIR).setLineWidth(0.5).line(M, H - 28, W - M, H - 28);
    doc.setFont('helvetica', 'normal').setFontSize(7.4).setTextColor(165, 165, 175);
    doc.text('HaseebMadeit · Attendance OS', M, H - 17);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 17, { align: 'right' });
  }

  doc.save(`${(fileName || 'report').replace(/[\\/:*?"<>|]+/g, '-')}.pdf`);
}
