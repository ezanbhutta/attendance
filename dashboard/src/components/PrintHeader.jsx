import HMLogo from './HMLogo.jsx';

// Branded header that appears ONLY on the printed / saved-PDF page (hidden on
// screen). Gives every export a clean, structured letterhead.
export default function PrintHeader({ title, subtitle }) {
  return (
    <div className="print-header">
      <div className="ph-brand">
        <HMLogo size={34} />
        <div>
          <div className="ph-name">Attendance OS</div>
          <div className="ph-sub">HaseebMadeIt</div>
        </div>
      </div>
      <div className="ph-title">
        <div className="ph-h">{title}</div>
        {subtitle && <div className="ph-s">{subtitle}</div>}
      </div>
      <div className="ph-date">Generated<br />{new Date().toLocaleString('en-GB')}</div>
    </div>
  );
}
