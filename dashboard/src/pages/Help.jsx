import { Card } from '../components/ui.jsx';
import {
  LayoutDashboard, LineChart, Users, Building2, Clock, BarChart3,
  PenLine, CalendarDays, Printer, RefreshCw, Archive, MousePointerClick,
  Moon, Info, EyeOff,
} from 'lucide-react';

// Plain-language guide to every part of Attendance OS — written for a
// first-time HR user, kept in sync with the live features.

const SECTIONS = [
  { icon: LayoutDashboard, name: 'Overview', what: 'Your home screen — today, live.',
    why: 'See who’s present, late, still in, or absent right now. Every tile is clickable — tap one to see exactly which people are in that group. The feed updates the instant someone scans. Absences are shift-aware: nobody counts as absent until their shift has actually started (people not due yet are shown separately). If the device drops offline you get a red alarm here, and unrecognised PINs appear so you can link or ignore them.' },
  { icon: LineChart, name: 'CEO View', what: 'The whole company at a glance — built to print.',
    why: 'Headline numbers (present, absent, attendance rate), a per-department breakdown, and a 7-day trend. Tiles are clickable here too. Use “Export PDF” for a clean one-page summary to share or file.' },
  { icon: Users, name: 'Employees', what: 'People, their PIN, and how they’re set up.',
    why: 'The device only knows a number (the PIN); here you give it a name. Set each person’s Department, Shift and Weekly off. “Counted” people are tracked; “Gate only” (CEO/Admin) open the gate but aren’t counted. Methods shows how they scan — face, fingerprint or card (with the card number). Archive anyone who leaves — they stop counting everywhere until you Restore them, with their history intact.' },
  { icon: Building2, name: 'Departments', what: 'Group staff so reports can be filtered.',
    why: 'Click a department name to rename it in place. Assign people to departments on the Employees page, then filter any report by department.' },
  { icon: Clock, name: 'Shifts & Timetables', what: 'The expected working hours.',
    why: 'A timetable is one day’s hours (start, end, and the grace minutes before late/early-leave counts). A shift maps a timetable to each weekday — or marks a day Off. Click any value to edit it in place. This is what real scans are compared against to decide late, early-leave and overtime.' },
  { icon: BarChart3, name: 'Reports', what: 'Daily, by person, department or shift — export-ready.',
    why: 'Pick a range with the quick picker (Today, Last 7/30 days, This month, or a custom range), filter, and read off hours, lates, overtime and absences. Grouped views add a scorecard — Attendance % and On-time % per person or shift. Export the exact rows as CSV, or Save-as-PDF.' },
  { icon: PenLine, name: 'Fix a punch', what: 'Add a punch the device missed.',
    why: 'Someone forgot to scan, or a scan failed? Add a manual entry with a reason. The tamper-proof raw record is never edited — your fix is logged separately and the reports recompute automatically.' },
  { icon: CalendarDays, name: 'Leave & Holidays', what: 'Approved leave and office-closed days.',
    why: 'So nobody is marked absent on a day they were on approved leave or the office was shut. Keeps reports fair.' },
];

const TIPS = [
  { icon: RefreshCw, title: 'Sync', text: 'Top-right button. Pulls the latest punches and people from the device through your office Mac — one click, nothing to install.' },
  { icon: MousePointerClick, title: 'Click any number', text: 'The stat tiles on Overview and CEO View open a panel listing the actual people behind the number.' },
  { icon: Archive, title: 'Archive, don’t delete', text: 'On Employees, Archive removes someone from every count and report while keeping their record. Restore them anytime.' },
  { icon: EyeOff, title: 'Ignore a stray PIN', text: 'If a PIN isn’t a real person (a test scan), click Ignore on the Overview to stop it nagging you.' },
  { icon: Moon, title: 'Light / dark', text: 'The sun/moon button in the top bar switches the whole app between light and dark. Your choice is remembered.' },
  { icon: Info, title: 'The ⓘ marks', text: 'Hover the little ⓘ next to any heading or number for a plain-language explanation of what it means.' },
];

export default function Help() {
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Guide</h1>
          <p className="page-intro">Everything Attendance OS can do, in plain language. Each section tells you what it’s for and how it helps.</p>
        </div>
        <button className="btn no-print" onClick={() => window.print()}><Printer size={15} /> Print</button>
      </div>

      <div className="callout">
        <strong>New here? Do these four things, in order:</strong>
        <ol style={{ margin: '8px 0 0', paddingLeft: 20 }}>
          <li><strong>Employees</strong> — name each person (they’re imported from the device by PIN), and set Counted vs Gate-only.</li>
          <li><strong>Departments</strong> — sort staff so you can filter reports.</li>
          <li><strong>Shifts &amp; Timetables</strong> — set working hours, then give each person a shift on Employees.</li>
          <li><strong>Reports</strong> — pick a date range and read off hours, lates and absences.</li>
        </ol>
        After that you mostly just open <strong>Overview</strong> and <strong>Reports</strong>.
      </div>

      <Card title="What each section does" help="A tour of every page in the sidebar.">
        {SECTIONS.map((s) => (
          <div className="guide-item" key={s.name}>
            <div className="guide-ico" aria-hidden><s.icon size={18} /></div>
            <div>
              <h3>{s.name}</h3>
              <p className="what">{s.what}</p>
              <p className="why">{s.why}</p>
            </div>
          </div>
        ))}
      </Card>

      <Card title="Handy things to know" help="Small features that make the day-to-day faster.">
        <div className="grid cols-2">
          {TIPS.map((t) => (
            <div className="guide-item" key={t.title} style={{ borderBottom: 'none', padding: '10px 0' }}>
              <div className="guide-ico" aria-hidden><t.icon size={17} /></div>
              <div><h3>{t.title}</h3><p className="why">{t.text}</p></div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="How attendance is decided (the rules that matter)" className="help-section">
        <ul>
          <li><strong>Face or fingerprint = attendance.</strong> Those scans are the real record of who was present.</li>
          <li><strong>Cards open the gate but are never counted.</strong> So nobody can “buddy-punch” for a colleague with a card — impossible by design.</li>
          <li><strong>First scan of the day is check-in, last is check-out.</strong> The device doesn’t send a direction, so it’s derived by time. Repeat scans within about a minute are ignored.</li>
          <li><strong>Absent is shift-aware.</strong> You’re only marked absent once your shift has started and you haven’t scanned — never before, and never on a weekly-off day or approved leave.</li>
          <li><strong>Nothing is silently overwritten.</strong> Raw punches are permanent; fixes are added as tracked corrections, and reports recompute on every change.</li>
        </ul>
      </Card>

      <Card title="For staff (print this and post it by the device)" className="help-section">
        <ol>
          <li><strong>Mark attendance with your FACE or FINGERPRINT.</strong> This opens the gate and records your check-in/out.</li>
          <li><strong>The card opens the gate but does NOT record attendance.</strong> Use it only for entry.</li>
          <li><strong>Your first scan of the day is check-in; your last is check-out.</strong> Nothing else to press.</li>
          <li><strong>If a scan fails,</strong> face the camera directly and retry; if it still fails, ask HR to add a manual entry. Never ask someone to scan for you.</li>
        </ol>
      </Card>

      <Card title="Keeping punches flowing (the catcher)" className="help-section">
        <p className="muted" style={{ marginTop: 0 }}>
          One small program (“the catcher”) runs on the office Mac, quietly receives every scan from the device, and saves it to the cloud — which is what this website reads.
        </p>
        <ul>
          <li><strong>Keep the Mac on and on the office Wi-Fi.</strong> While the catcher runs, punches arrive here within about a second, and the <strong>Sync</strong> button works.</li>
          <li><strong>If the Mac is asleep or off,</strong> the device stores punches itself and sends them the moment the catcher is back — <strong>nothing is lost</strong>, it just arrives later. Overview shows a red alarm while it’s offline.</li>
          <li>Restarting the catcher never locks anyone out — the gate works on its own; the catcher only records.</li>
        </ul>
      </Card>
    </>
  );
}
