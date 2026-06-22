import { Card } from '../components/ui.jsx';
import {
  LayoutDashboard, LineChart, Users, Building2, Clock, BarChart3, FileText,
  PenLine, CalendarDays, Printer, RefreshCw, Archive, MousePointerClick,
  Moon, Info, EyeOff, Upload, UserMinus, Wifi,
} from 'lucide-react';

// Plain-language guide to every part of Attendance OS, written for someone using
// it for the first time and kept in step with the live features. No jargon: if a
// term is unavoidable it is explained in the glossary at the bottom.

const SECTIONS = [
  { icon: LayoutDashboard, name: 'Overview', what: 'Your home screen for today, live.',
    why: `Shows who is present, late, still in, or absent right now. Every tile is clickable — tap one to see exactly which people are in that group. The live feed updates the instant someone scans. Nobody is marked absent before their shift has started, and the people still due in are listed separately. If the device goes offline you get a red alarm here, and any PIN the system does not recognise yet appears so you can link it to a person or ignore it.` },
  { icon: LineChart, name: 'CEO View', what: 'The whole company at a glance, ready to print.',
    why: `Headline numbers for present, absent, late and the attendance rate, a breakdown per department, and a seven-day trend. Below that, a table of every person with their attendance and on-time scores over any date range you pick. Tiles and rows are clickable. Use Export PDF for a clean summary to share or file.` },
  { icon: Users, name: 'Employees', what: 'People, their PIN, and how they are set up.',
    why: `The device only knows a number — the PIN. Here you give that number a name. For each person set their Department, Shift and Weekly off day, and whether they are Counted (tracked in attendance) or Gate only (can open the gate, like a CEO or guard, but never counted). Methods shows how each person has scanned — face, fingerprint or card, with the card number. To device sends a person's name, PIN and card to the scanner. When someone leaves, Archive them: they stop counting everywhere but their history stays, and you can Restore them any time.` },
  { icon: Building2, name: 'Departments', what: 'Group staff so reports can be filtered.',
    why: `Click a department name to rename it in place. Assign people to departments on the Employees page, then filter any report or the CEO View by department.` },
  { icon: Clock, name: 'Shifts and Timetables', what: 'The hours each person is meant to work.',
    why: `A timetable is one day of hours: a start, an end, and the grace minutes allowed before a late or an early leave counts. A shift uses one timetable for its working days; the off days come from each person's Weekly off. Click any value to edit it in place. Every real scan is checked against this to work out late, early leave and overtime.` },
  { icon: BarChart3, name: 'Reports', what: 'Daily, or grouped by person, department or shift.',
    why: `Pick a range with the quick picker (today, last 7 or 30 days, this month, or custom). Filter, then read off hours, lates, overtime and absences. Grouped views add a scorecard with an attendance score and an on-time score for each person or shift. Export the exact rows as CSV, or save them as a PDF. Click any column heading to sort.` },
  { icon: FileText, name: 'Statement', what: 'One person, one month, ready to save as a PDF.',
    why: `Pick a person and a month and get every day of that month with its state (Present, Absent, Late, Leave, Holiday or Weekly off), the in and out times, hours worked, and how late they were. If someone tapped in on a day they were off, the scan still shows with a short note. Press PDF for a clean, branded one-person record. No pay, no rates — purely attendance.` },
  { icon: PenLine, name: 'Fix a punch', what: 'Add a scan the device missed.',
    why: `If someone forgot to scan, or a scan failed, add a manual entry with a reason. The raw record is never edited — your fix is saved separately and the reports update on their own. It even lands on the right night shift when the time is after midnight.` },
  { icon: CalendarDays, name: 'Leave and Holidays', what: 'Approved leave, and days the office is closed.',
    why: `Add approved leave for a person over a date range, and public holidays for the whole office. On those days nobody is marked absent. A holiday is a paid day off for everyone — the more holidays, the more paid days. If someone still taps in on a day off, the day keeps its Holiday / Leave / Off label and the scan is shown alongside it.` },
];

const TIPS = [
  { icon: RefreshCw, title: 'Sync', text: `The button in the top bar. It pulls the latest scans and people from the device through your office Mac, and lines the system and the device up. One click, nothing to install.` },
  { icon: Upload, title: 'To device', text: `On Employees, the upload icon (or "Send all to device") pushes a person's name, PIN and card onto the scanner. Their face and fingerprint are never touched — those are enrolled at the device.` },
  { icon: MousePointerClick, title: 'Click any number', text: `The tiles on Overview and CEO View open a panel that lists the real people behind the number.` },
  { icon: Archive, title: 'Archive, do not delete', text: `Archive takes someone out of every count and report while keeping their record. Deleting a person also removes them from the device — archive is the gentler choice.` },
  { icon: FileText, title: 'Save a PDF', text: `Reports, CEO View and Statement all have a PDF button. It opens your browser's print dialog — choose "Save as PDF" for a clean, branded file.` },
  { icon: EyeOff, title: 'Ignore a stray PIN', text: `If a PIN is not a real person (a test scan, say), click Ignore on the Overview so it stops nagging you.` },
  { icon: Wifi, title: 'Last synced', text: `The line at the top of Employees shows when the device last sent its people. Overview's Device health shows when it was last seen and whether it is online.` },
  { icon: Moon, title: 'Light or dark', text: `The sun and moon button in the top bar switches the whole app between light and dark. Your choice is remembered.` },
];

const RULES = [
  ['Face or fingerprint is attendance.', 'Those scans are the real record of who was present. They open the gate and record the time.'],
  ['A card opens the gate but is never counted.', 'So nobody can clock in for a colleague with a card — it is impossible by design.'],
  ['First scan of the day is the start, last is the finish.', 'The device does not send a direction, so it is worked out by time. Repeat scans within about a minute are treated as one.'],
  ['Checking out means your last scan at or after your shift end.', 'Stepping out and back during the day is recorded, but it does not end your day early. The scan that counts as leaving is the last one at or after your shift end time.'],
  ['Left early and never came back?', 'After four hours past the shift end, the day is closed at the shift end time and marked auto. So an early leaver is not left showing "still in" forever.'],
  ['Late means after the start plus the grace minutes.', 'If the grace is 15 minutes and the start is 9:00, arriving by 9:15 is on time; 9:16 is one minute late.'],
  ['Absent only counts once a shift has started.', 'You are marked absent only after your shift begins and you still have not scanned — never before, and never on a weekly off day, approved leave, or holiday.'],
  ['A day off keeps its label even if someone scans.', 'A holiday, approved leave or weekly off stays labelled as such. The scan is still recorded and shown in the report and the PDF — the day just does not flip to Present.'],
  ['Overtime is time worked past the scheduled end.', 'Counted only when it is switched on, and only past the shift end time.'],
  ['Nothing is overwritten quietly.', 'Raw scans are permanent. Fixes are added as tracked corrections, and every report recomputes itself whenever scans, shifts, leave or holidays change.'],
];

const NIGHT = [
  ['It is automatic — no setting to flip.', 'If a shift runs past midnight, or starts after midnight (like 1:00 am to 9:00 am), the system works that out from the hours on its own.'],
  ['The night counts under the day it belongs to.', 'The hours after midnight are filed under the correct working day, not split across two dates. So one night is one clean row in the reports.'],
  ['Why it matters.', 'A night worker who is off on, say, Sunday is not wrongly marked absent, and their night shift lands on the right day. A 1:00 am scan is their shift, not a "late" mark on the wrong day.'],
  ['It gathers the whole window.', 'Scans from a few hours before the start to a few hours after the end are pulled into the one shift, so an early arrival or a late finish is still counted with that night.'],
];

const SYNC = [
  { icon: Upload, dir: 'System → Device', title: 'Send someone to the scanner',
    text: `Add or rename a person here, then press To device. Their name, PIN and card are pushed to the scanner. Face and fingerprint are enrolled at the device and are never changed or wiped.` },
  { icon: UserMinus, dir: 'System → Device', title: 'Delete here, gone there',
    text: `Delete a person on the dashboard and they are removed from the scanner automatically on the next sync — their templates go with them.` },
  { icon: Archive, dir: 'Device → System', title: 'Removed on the device',
    text: `If someone is deleted on the scanner, a Sync archives them here. Their history is kept and never hard-deleted, so you can Restore them later.` },
  { icon: PenLine, dir: 'Device → System', title: 'Renamed on the device',
    text: `If a name is changed on the scanner, a Sync brings that new name into the system. For names, the scanner wins.` },
  { icon: RefreshCw, dir: 'Both ways', title: 'Sync lines everything up',
    text: `One press of Sync pulls the latest people and scans from the device and reconciles the two sides, so the system and the scanner stay on the same page.` },
];

const TROUBLE = [
  ['Someone is marked Absent but they were here.',
   'Check their Shift and Weekly off are set on the Employees page, and that it really was their working day. For night workers, remember the night counts under the day before. If a real scan failed, add it with Fix a punch.'],
  ['A person shows "Still in" all day.',
   'They did not scan out. The reports close it automatically at their shift end, four hours after the shift ends, and mark it auto. The raw log still shows no scan-out, which is correct.'],
  ['"Last synced" is blank or old.',
   'Press Sync. If it stays old, the office Mac or the catcher is probably off — switch the Mac on and connected to the office network, and it catches up on its own.'],
  ['A PIN says it is not linked to anyone.',
   'Press Sync to pull people from the device, then give the PIN a name on Employees. If it is a test or stray scan, click Ignore on the Overview.'],
  ['I changed a shift and the numbers look off.',
   'Reports recompute on their own when you change shifts, leave or holidays. Refresh the page; press Sync if it has not caught up.'],
  ['A name is wrong.',
   'Fix it on Employees (click the name), then press To device to push it to the scanner. Or rename it on the device and press Sync — the scanner wins.'],
  ['The device shows offline (red alarm).',
   'Check the Mac is on and on the office Wi-Fi, and the device is powered. No scans are lost meanwhile — the device stores them and sends them when the catcher is back.'],
];

const GLOSSARY = [
  ['PIN', 'The number the device gives each person — the link between a face, finger or card and a name.'],
  ['Timetable', 'One day of hours: a start, an end, and the grace minutes.'],
  ['Shift', 'Which timetable a person follows on their working days.'],
  ['Grace', 'Minutes allowed after the start before "late" counts (and before the end before "early leave" counts).'],
  ['Weekly off', 'The day each week a person is not expected. Set per person on Employees.'],
  ['Counted', 'A person whose attendance is tracked and shown in reports.'],
  ['Gate only', 'A person who can open the gate (a CEO or guard) but is never counted.'],
  ['Archive', 'Hide a person from counts and reports while keeping their history. Restore any time.'],
  ['Sync', 'Pull the latest people and scans from the device and reconcile both sides.'],
  ['Catcher', 'The small program on the office Mac that receives scans and saves them to the cloud.'],
  ['Auto checkout', 'When someone never scans out, the system fills the checkout at their shift end, four hours later, marked auto.'],
  ['Overtime', 'Time worked past the scheduled end, when it is switched on.'],
  ['Night shift', 'A shift whose hours fall after midnight — counted under the right day automatically.'],
  ['Holiday', 'A day the office is closed and everyone is paid — a paid day off.'],
  ['Leave', 'Approved time off for one person over a date range.'],
  ['Statement', 'A one-person, one-month printable record of attendance.'],
];

export default function Help() {
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Guide</h1>
          <p className="page-intro">Everything in plain language — how to set it up, how the rules work, and what to do when something looks off.</p>
        </div>
        <button className="btn no-print" onClick={() => window.print()}><Printer size={15} /> Print</button>
      </div>

      <div className="callout">
        <strong>New here? Set it up once, in this order:</strong>
        <ol style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 1.7 }}>
          <li><strong>Employees.</strong> Name each person (they arrive from the device as a PIN). Mark them Counted or Gate only, and set their Department, Shift and Weekly off.</li>
          <li><strong>Departments.</strong> Create your teams so reports can be filtered.</li>
          <li><strong>Shifts and Timetables.</strong> Set the working hours and grace, then give each person a shift on Employees.</li>
          <li><strong>Leave and Holidays.</strong> Add public holidays and any approved leave so nobody is wrongly marked absent.</li>
          <li><strong>Press Sync.</strong> Pull everyone and their scans from the device.</li>
        </ol>
        After that, day to day you mostly live in <strong>Overview</strong> (today) and <strong>Reports</strong> / <strong>Statement</strong> (history).
      </div>

      <Card title="What each section does" help="A tour of every page in the navigation, top to bottom.">
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

      <Card title="How attendance is decided (the rules that matter)" className="help-section"
        help="The exact logic the system uses, so the numbers never surprise you.">
        <ul>
          {RULES.map(([head, body]) => (
            <li key={head}><strong>{head}</strong> {body}</li>
          ))}
        </ul>
      </Card>

      <Card title="Night shifts, handled automatically" className="help-section"
        help="Why a 1 am scan lands on the right day with no extra setup.">
        <p className="muted" style={{ marginTop: 0 }}>
          Night work used to be the trickiest part of any attendance system. Here it just works — you set the hours, the system does the rest.
        </p>
        <ul>
          {NIGHT.map(([head, body]) => (
            <li key={head}><strong>{head}</strong> {body}</li>
          ))}
        </ul>
      </Card>

      <Card title="Keeping the system and the device in step (two-way sync)"
        help="Changes flow both ways, so the dashboard and the scanner never drift apart.">
        {SYNC.map((s) => (
          <div className="guide-item" key={s.title}>
            <div className="guide-ico" aria-hidden><s.icon size={18} /></div>
            <div>
              <h3>{s.title} <span className="muted" style={{ fontWeight: 500, fontSize: '.8rem' }}>· {s.dir}</span></h3>
              <p className="why">{s.text}</p>
            </div>
          </div>
        ))}
        <p className="muted" style={{ fontSize: '.86rem', marginBottom: 0 }}>
          One safety rule: a person is only ever archived (never erased) when they vanish from the device, and a half-finished upload can never wipe people — the system waits for the full list before reconciling.
        </p>
      </Card>

      <Card title="The monthly Statement, step by step" className="help-section"
        help="A clean, one-person record you can hand over or file.">
        <ol>
          <li>Open <strong>Statement</strong> and choose a <strong>person</strong> and a <strong>month</strong>.</li>
          <li>Read down the days. Each one shows its state (Present, Absent, Late, Leave, Holiday or Weekly off), the in and out times, the hours worked, and how late they were.</li>
          <li>A day off where someone tapped in shows the scan with the note <em>“Came in on a day off”</em> — the day stays labelled off, but nothing is hidden.</li>
          <li>The tiles at the top total the month: present, absent, late days, on leave, days off, and hours worked.</li>
          <li>Press <strong>PDF</strong>, then choose <strong>Save as PDF</strong> in your browser. You get a branded, one-person record with no pay or rates on it.</li>
        </ol>
      </Card>

      <Card title="Keeping punches flowing (the catcher)" className="help-section"
        help="The small program on the office Mac that feeds every scan into the cloud.">
        <p className="muted" style={{ marginTop: 0 }}>
          One small program, called the catcher, runs on the office Mac. It quietly receives every scan from the device and saves it to the cloud, which is what this website reads. Each time it starts, it also re-imports everyone and re-pulls the scans the device has stored, so nothing is missed.
        </p>
        <ul>
          <li><strong>Keep the Mac on and on the office network.</strong> While the catcher runs, scans arrive here within about a second, and the Sync button works.</li>
          <li><strong>How to tell it is working.</strong> Overview's Device health shows the device online with a recent "last seen", and the top of Employees shows a recent "Last synced". A red alarm on Overview means it is offline.</li>
          <li><strong>If the Mac is asleep or off,</strong> the device stores scans itself and sends them the moment the catcher is back. Nothing is lost — it just arrives a little later.</li>
          <li><strong>Restarting the catcher never locks anyone out.</strong> The gate works on its own; the catcher only records.</li>
        </ul>
      </Card>

      <Card title="If something looks wrong" className="help-section"
        help="The handful of things that come up, and the one-line fix for each.">
        {TROUBLE.map(([q, a]) => (
          <div key={q} style={{ margin: '14px 0' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: '1rem' }}>{q}</h3>
            <p className="why" style={{ fontSize: '.92rem' }}>{a}</p>
          </div>
        ))}
      </Card>

      <Card title="Words you will see (glossary)" help="A quick definition for every term in the app.">
        <div className="grid cols-2">
          {GLOSSARY.map(([term, def]) => (
            <div key={term} style={{ padding: '8px 0' }}>
              <h3 style={{ margin: '0 0 2px', fontSize: '.98rem' }}>{term}</h3>
              <p className="why">{def}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card title="For staff (print this and post it by the device)" className="help-section">
        <ol>
          <li><strong>Mark attendance with your FACE or FINGERPRINT.</strong> This opens the gate and records your time.</li>
          <li><strong>The card opens the gate but does NOT record attendance.</strong> Use it only to get in.</li>
          <li><strong>Your first scan of the day is your start, your last is your finish.</strong> Stepping out and back during the day is fine — it will not end your day early.</li>
          <li><strong>Scan out when you leave for the day,</strong> at or after your finish time, so your checkout is recorded.</li>
          <li><strong>If a scan fails,</strong> face the camera directly and try again. If it still fails, ask HR to add a manual entry. Never ask someone to scan for you.</li>
        </ol>
      </Card>
    </>
  );
}
