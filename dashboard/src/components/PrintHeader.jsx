import HMLogo from './HMLogo.jsx';

// Branded letterhead shown ONLY on the printed / saved-PDF page (hidden on
// screen). A clean two-tier header: the HaseebMadeit mark + wordmark and the
// generation date across the top, an accent rule, then the document title and
// its subtitle. Carefully spaced so every export reads as a proper report.
export default function PrintHeader({ title, subtitle }) {
  const now = new Date();
  const date = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="print-header">
      <div className="ph-top">
        <div className="ph-brand">
          <HMLogo size={38} />
          <div className="ph-words">
            <div className="ph-name">HaseebMadeit</div>
            <div className="ph-sub">Attendance OS</div>
          </div>
        </div>
        <div className="ph-gen"><span>Generated</span>{date}<br />{time}</div>
      </div>
      <div className="ph-title">
        <div className="ph-h">{title}</div>
        {subtitle && <div className="ph-s">{subtitle}</div>}
      </div>
    </div>
  );
}
