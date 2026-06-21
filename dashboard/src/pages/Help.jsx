import { Card } from '../components/ui.jsx';
import {
  LayoutDashboard, LineChart, Users, Building2, Clock, BarChart3,
  PenLine, CalendarDays, Printer, RefreshCw, Archive, MousePointerClick,
  Moon, Info, EyeOff,
} from 'lucide-react';

// Plain language guide to every part of Attendance OS, written for someone
// using it for the first time and kept in step with the live features.

const SECTIONS = [
  { icon: LayoutDashboard, name: 'Overview', what: 'Your home screen for today, live.',
    why: 'See who is present, late, still in, or absent right now. Every tile is clickable, so you can tap one and see exactly which people are in that group. The feed updates the instant someone scans. Absences only count once a shift has started, so nobody is marked absent before they are due, and the people still to come are listed on their own. If the device goes offline you get a red alarm here, and any PIN the system does not recognise shows up so you can link it to a person or ignore it.' },
  { icon: LineChart, name: 'CEO View', what: 'The whole company at a glance, ready to print.',
    why: 'Headline numbers for present, absent, late and the attendance rate, a breakdown for each department, and a trend for the last seven days. Below that is a table of every person with their attendance and on time scores over any date range you choose. Tiles and rows are clickable. Use Export PDF for a clean summary to share or file.' },
  { icon: Users, name: 'Employees', what: 'People, their PIN, and how they are set up.',
    why: 'The device only knows a number, the PIN. Here you give that number a name. Set each person and their department, shift and weekly off day. Counted people are tracked in reports. Gate only people, like the CEO or admin, open the gate but are never counted. Methods shows how each person scans, by face, fingerprint or card, with the card number if they have one. When someone leaves, Archive them. They stop counting everywhere until you Restore them, and their history stays intact.' },
  { icon: Building2, name: 'Departments', what: 'Group staff so reports can be filtered.',
    why: 'Click a department name to rename it in place. Put people in departments on the Employees page, then filter any report by department.' },
  { icon: Clock, name: 'Shifts and Timetables', what: 'The hours each person is meant to work.',
    why: 'A timetable is one day of hours: a start, an end, and the grace minutes allowed before a late or an early leave counts. A shift maps a timetable to each weekday, or marks a day off. Click any value to edit it in place. Real scans are checked against this to work out late, early leave and overtime.' },
  { icon: BarChart3, name: 'Reports', what: 'Daily, or grouped by person, department or shift.',
    why: 'Pick a range with the quick picker for today, the last 7 or 30 days, this month, or any custom dates. Filter, then read off hours, lates, overtime and absences. Grouped views add a scorecard with an attendance score and an on time score for each person or shift. Export the exact rows as CSV, or save them as a PDF. Click any column heading to sort.' },
  { icon: PenLine, name: 'Fix a punch', what: 'Add a scan the device missed.',
    why: 'If someone forgot to scan, or a scan failed, add a manual entry with a reason. The raw record is never edited. Your fix is saved separately and the reports update on their own.' },
  { icon: CalendarDays, name: 'Leave and Holidays', what: 'Approved leave and days the office is closed.',
    why: 'So nobody is marked absent on a day they were on approved leave or the office was shut. It keeps reports fair.' },
];

const TIPS = [
  { icon: RefreshCw, title: 'Sync', text: 'The button in the top bar. It pulls the latest scans and people from the device through your office Mac. One click, nothing to install.' },
  { icon: MousePointerClick, title: 'Click any number', text: 'The tiles on Overview and CEO View open a panel that lists the real people behind the number.' },
  { icon: Archive, title: 'Archive, do not delete', text: 'On Employees, Archive takes someone out of every count and report while keeping their record. Restore them any time.' },
  { icon: EyeOff, title: 'Ignore a stray PIN', text: 'If a PIN is not a real person, like a test scan, click Ignore on the Overview so it stops nagging you.' },
  { icon: Moon, title: 'Light or dark', text: 'The sun and moon button in the top bar switches the whole app between light and dark. Your choice is remembered.' },
  { icon: Info, title: 'The info marks', text: 'Hover the small mark next to any heading or number for a short explanation of what it means.' },
];

export default function Help() {
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Guide</h1>
          <p className="page-intro">Everything in plain language.</p>
        </div>
        <button className="btn no-print" onClick={() => window.print()}><Printer size={15} /> Print</button>
      </div>

      <div className="callout">
        <strong>New here? Do these four things, in order:</strong>
        <ol style={{ margin: '8px 0 0', paddingLeft: 20 }}>
          <li><strong>Employees.</strong> Name each person. They arrive from the device as a PIN. Set Counted or Gate only.</li>
          <li><strong>Departments.</strong> Sort staff so you can filter reports.</li>
          <li><strong>Shifts and Timetables.</strong> Set the working hours, then give each person a shift on Employees.</li>
          <li><strong>Reports.</strong> Pick a date range and read off hours, lates and absences.</li>
        </ol>
        After that you mostly just open <strong>Overview</strong> and <strong>Reports</strong>.
      </div>

      <Card title="What each section does" help="A tour of every page in the navigation.">
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

      <Card title="Handy things to know" help="Small features that make the everyday faster.">
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
          <li><strong>Face or fingerprint is attendance.</strong> Those scans are the real record of who was present.</li>
          <li><strong>Cards open the gate but are never counted.</strong> So nobody can scan in for a colleague with a card. It is impossible by design.</li>
          <li><strong>The first scan of the day is the start, the last is the finish.</strong> The device does not send a direction, so it is worked out by time. Repeat scans within about a minute are ignored.</li>
          <li><strong>Absent only counts once a shift has started.</strong> You are marked absent only after your shift begins and you still have not scanned. Never before, and never on a weekly off day or approved leave.</li>
          <li><strong>No scan out for hours?</strong> If someone scans in but never scans out, the reports and CEO view fill the checkout at their shift end time and mark it auto, four hours after the shift ends. The raw log still shows no scan out, so the real record stays honest.</li>
          <li><strong>Nothing is overwritten quietly.</strong> Raw scans are permanent. Fixes are added as tracked corrections, and reports update on every change.</li>
        </ul>
      </Card>

      <Card title="For staff (print this and post it by the device)" className="help-section">
        <ol>
          <li><strong>Mark attendance with your FACE or FINGERPRINT.</strong> This opens the gate and records your time.</li>
          <li><strong>The card opens the gate but does NOT record attendance.</strong> Use it only to get in.</li>
          <li><strong>Your first scan of the day is your start, your last is your finish.</strong> Nothing else to press.</li>
          <li><strong>If a scan fails,</strong> face the camera directly and try again. If it still fails, ask HR to add a manual entry. Never ask someone to scan for you.</li>
        </ol>
      </Card>

      <Card title="Keeping punches flowing (the catcher)" className="help-section">
        <p className="muted" style={{ marginTop: 0 }}>
          One small program, called the catcher, runs on the office Mac. It quietly receives every scan from the device and saves it to the cloud, which is what this website reads.
        </p>
        <ul>
          <li><strong>Keep the Mac on and on the office network.</strong> While the catcher runs, scans arrive here within about a second, and the <strong>Sync</strong> button works.</li>
          <li><strong>If the Mac is asleep or off,</strong> the device stores scans itself and sends them the moment the catcher is back. <strong>Nothing is lost</strong>, it just arrives a little later. Overview shows a red alarm while it is offline.</li>
          <li>Restarting the catcher never locks anyone out. The gate works on its own. The catcher only records.</li>
        </ul>
      </Card>
    </>
  );
}
