import { Card } from '../components/ui.jsx';

export default function Help() {
  return (
    <>
      <div className="page-title">
        <h1>Help &amp; operating guide</h1>
        <button className="btn no-print" onClick={() => window.print()}>🖶 Print</button>
      </div>

      <Card title="For staff (post near the device)" className="help-section">
        <ol>
          <li><strong>Mark attendance with your FACE or FINGERPRINT.</strong> This opens the gate and records your check-in/out.</li>
          <li><strong>The NFC card opens the gate but does NOT record attendance.</strong> Use it only for entry convenience — never as your attendance punch.</li>
          <li><strong>Your first scan of the day is check-in; your last is check-out.</strong> Nothing else to press.</li>
          <li><strong>If a scan fails,</strong> face the camera directly and retry; if it still fails, tell your team lead to add a manual entry. Never ask someone to scan for you.</li>
        </ol>
      </Card>

      <Card title="For admins" className="help-section">
        <ol>
          <li><strong>Enroll on the device first:</strong> capture face/fingerprint; for card entry, type the printed card number into the device’s User Management. This sets the device PIN.</li>
          <li><strong>Map the PIN to the employee</strong> on the Employees page so punches attach to the right person. Unmapped PINs show as “Unknown”.</li>
          <li><strong>Set up org &amp; shifts:</strong> departments (per brand), groups, timetables (hours + grace), shifts (cycles of timetables).</li>
          <li><strong>Assign schedules.</strong> Priority: <strong>temporary → employee → group → department → global</strong>.</li>
          <li><strong>Reports:</strong> Daily / Weekly / Monthly + Total Time Card, filtered by department/brand + dates. Late / early-leave / overtime / absent compute automatically and recompute on any change.</li>
          <li><strong>Corrections:</strong> add a manual log with a reason (audit-tracked). Never edit raw punches.</li>
          <li><strong>Leave &amp; holidays:</strong> record them so absent-detection respects them.</li>
        </ol>
      </Card>

      <Card title="For the listener operator" className="help-section">
        <ol>
          <li>Keep the agent machine <strong>on and on the device’s Wi-Fi</strong>, static IP <code>192.168.1.202</code>, listener on port <code>8081</code>.</li>
          <li><strong>Health:</strong> the Overview page shows the device’s last-seen. Stale &gt; 2 min = agent/Wi-Fi down; punches buffer on the device and sync when restored.</li>
          <li><strong>Long outage:</strong> run the Windows Standalone-SDK backfill to be safe; dedup prevents doubles.</li>
          <li><strong>Never expose port 8081 to the internet.</strong></li>
          <li><strong>Restarting the listener does NOT affect the gate</strong> — the device unlocks locally; the listener only records.</li>
        </ol>
      </Card>

      <Card title="How attendance is decided" className="help-section">
        <ul>
          <li>The device reports no in/out direction, so <strong>check-in = first punch of the day, check-out = last punch</strong> (repeats within ~60s are ignored).</li>
          <li>Cards never reach the attendance feed, so <strong>buddy-punching by card is impossible by design.</strong></li>
          <li>Verify method (face / fingerprint) is stored for reporting only.</li>
          <li>Config knobs (grace periods, OT mode, absent rules, dedup window, timezone) live in <code>app_config</code>.</li>
        </ul>
      </Card>
    </>
  );
}
