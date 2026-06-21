import { Card } from '../components/ui.jsx';

// Plain-language guide to every part of Attendance OS: what each section does
// and how it helps. Written for a first-time HR user — no jargon.

const SECTIONS = [
  {
    ico: '▦', name: 'Overview',
    what: 'Your home screen — today at a glance.',
    why: 'See who is currently in, watch the live punch feed update as people scan their face or finger, and confirm the device is online. Open this first each morning to check everything is flowing.',
  },
  {
    ico: '👤', name: 'Employees',
    what: 'The list of people, and the link between a person and their device PIN.',
    why: 'The device only knows a number (the PIN). Here you give that number a name, so punches show “Ayesha Khan” instead of “Unknown (PIN 7)”. Add, edit, or deactivate staff, and see who is enrolled with face or fingerprint.',
  },
  {
    ico: '🏢', name: 'Departments & Groups',
    what: 'Organise staff into departments (e.g. per brand) and groups.',
    why: 'Lets you filter every report by department, and assign one shift to a whole group at once instead of person by person. Set this up once and everything downstream gets easier.',
  },
  {
    ico: '🕘', name: 'Shifts & Timetables',
    what: 'Define working hours: a timetable is one day’s hours (start, end, grace, break); a shift strings timetables into a weekly pattern.',
    why: 'This is the “expected” schedule the system compares real punches against — so it can tell who was late, who left early, and who did overtime. Grace minutes stop someone 2 minutes late being flagged.',
  },
  {
    ico: '🗓', name: 'Schedules',
    what: 'Assign a shift to a person, group, or department for a date range.',
    why: 'Connects people to their working hours. Supports priority: a temporary schedule beats the person’s usual one, which beats their group’s, which beats the department default — so exceptions (a one-off late shift) are easy without breaking the norm.',
  },
  {
    ico: '📊', name: 'Reports',
    what: 'Daily, Weekly, Monthly and a Total Time Card — filter by department and date range.',
    why: 'The payoff. Hours worked, late arrivals, early leaves, overtime and absences are calculated for you and recompute instantly whenever anything changes. Print or Save-as-PDF straight from the page for records or sharing.',
  },
  {
    ico: '✎', name: 'Corrections',
    what: 'Add a manual entry when a scan was missed — with a reason that is logged.',
    why: 'People forget to scan, or a scan fails. Instead of editing the tamper-proof raw record, you add a tracked correction with a note. The audit trail stays clean and every change is accountable.',
  },
  {
    ico: '🌴', name: 'Leave & Holidays',
    what: 'Record approved leave and public holidays.',
    why: 'So the system does not mark someone “Absent” on a day they were on approved leave or the office was closed. Keeps reports fair and accurate.',
  },
  {
    ico: '❔', name: 'Help (this page)',
    what: 'The guide you’re reading.',
    why: 'Explains what every section does. Use the Print button to keep a copy or post it for your team.',
  },
];

export default function Help() {
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Guide</h1>
          <p className="page-intro">
            Everything Attendance OS can do, in plain language. Each section below tells you
            what it’s for and how it helps you.
          </p>
        </div>
        <button className="btn no-print" onClick={() => window.print()}>🖶 Print</button>
      </div>

      <div className="callout">
        <strong>New here? Do these 4 things, in order:</strong>
        <ol style={{ margin: '8px 0 0', paddingLeft: 20 }}>
          <li><strong>Employees</strong> — add your staff and map each person to their device PIN.</li>
          <li><strong>Departments &amp; Groups</strong> — sort staff (e.g. by brand) so you can filter reports.</li>
          <li><strong>Shifts</strong> then <strong>Schedules</strong> — set working hours and assign them.</li>
          <li><strong>Reports</strong> — pick a date and read off hours, lates and absences.</li>
        </ol>
        That’s the whole setup. After that you mostly just open <strong>Overview</strong> and <strong>Reports</strong>.
      </div>

      <Card title="What each section does">
        {SECTIONS.map((s) => (
          <div className="guide-item" key={s.name}>
            <div className="guide-ico" aria-hidden>{s.ico}</div>
            <div>
              <h3>{s.name}</h3>
              <p className="what">{s.what}</p>
              <p className="why">{s.why}</p>
            </div>
          </div>
        ))}
      </Card>

      <Card title="How attendance is decided (the 4 rules that matter)" className="help-section">
        <ul>
          <li><strong>Face or fingerprint = attendance.</strong> Those scans are the real record of who was present.</li>
          <li><strong>Cards open the gate but are never counted.</strong> So nobody can “buddy-punch” for a colleague with a card — it’s impossible by design.</li>
          <li><strong>First scan of the day is check-in, last scan is check-out.</strong> The device doesn’t send a direction, so the system derives it by time. Repeat scans within about a minute are ignored.</li>
          <li><strong>Nothing is ever silently overwritten.</strong> Raw punches are permanent; fixes are added as tracked Corrections. Reports recompute automatically on every change.</li>
        </ul>
      </Card>

      <Card title="For staff (you can print this and post it by the device)" className="help-section">
        <ol>
          <li><strong>Mark attendance with your FACE or FINGERPRINT.</strong> This opens the gate and records your check-in/out.</li>
          <li><strong>The card opens the gate but does NOT record attendance.</strong> Use it only for entry — never as your attendance punch.</li>
          <li><strong>Your first scan of the day is check-in; your last is check-out.</strong> Nothing else to press.</li>
          <li><strong>If a scan fails,</strong> face the camera directly and retry; if it still fails, ask HR to add a manual entry. Never ask someone to scan for you.</li>
        </ol>
      </Card>

      <Card title="Keeping punches flowing (the catcher)" className="help-section">
        <p className="muted" style={{ marginTop: 0 }}>
          One small program (“the catcher”) runs on the office Mac and quietly receives every
          scan from the device and saves it to the cloud, which is what this website reads.
        </p>
        <ul>
          <li><strong>Keep the Mac on and on the office Wi-Fi.</strong> While the catcher runs, punches arrive here within about a second.</li>
          <li><strong>If the Mac is asleep or off,</strong> the device safely stores punches itself and sends them the moment the catcher is back — <strong>nothing is lost</strong>, it just arrives a little later.</li>
          <li>The <strong>Overview</strong> page shows when the device was last seen, so you always know it’s connected.</li>
          <li>Restarting the catcher never locks anyone out — the gate works on its own; the catcher only records.</li>
        </ul>
      </Card>
    </>
  );
}
