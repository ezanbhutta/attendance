import { useEffect, useState } from 'react';
import { UserCheck, Clock, Hourglass, UserX, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { todayISO, fmtDateTime, fmtTime } from '../lib/format';
import { withAutoCheckout } from '../lib/attendance';
import { Card, Table, Badge, ErrorBanner, Stat, Drawer, PersonRow } from '../components/ui.jsx';

export default function Overview() {
  const today = todayISO();
  const [, setTick] = useState(0);     // forces a re-evaluate every minute
  const [drill, setDrill] = useState(null);
  const [ignored, setIgnored] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('ignored-pins') || '[]')); } catch { return new Set(); }
  });

  const daily = useQuery(() => supabase.from('v_report_daily')
    .select('employee_id,emp_code,first_name,last_name,department,status,late_minutes,first_in,last_out,scheduled_in,scheduled_out')
    .eq('work_date', today), [today]);
  const health = useQuery(() => supabase.from('v_device_health').select('*'), []);
  const feed = useQuery(() => supabase.from('v_live_punches').select('*').limit(60), []);
  const unknown = useQuery(() => supabase.from('v_unknown_pins').select('*'), []);
  const roster = useQuery(() => supabase.from('employees').select('id,active,track_attendance'), []);

  // Realtime: refetch the moment a punch lands.
  useEffect(() => {
    const ch = supabase.channel('rt-punches')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'raw_punches' }, () => {
        feed.refetch(); daily.refetch(); unknown.refetch();
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-evaluate every minute so someone flips to "absent" exactly when their
  // shift starts (not before), and the dashboard/CEO stay correct through the day.
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60000);
    return () => clearInterval(t);
  }, []);

  const now = Date.now();
  // Gate only people (admin, CEO) and archived people must never appear in any
  // live count or drill-down, even if an attendance row lingers for them. This
  // matches Reports and the CEO view, which only ever count tracked staff.
  const excluded = new Set((roster.data ?? []).filter((e) => e.active === false || !e.track_attendance).map((e) => e.id));
  const rows = (daily.data ?? []).filter((r) => !excluded.has(r.employee_id)).map((r) => withAutoCheckout(r, now));
  const started = (r) => !r.scheduled_in || new Date(r.scheduled_in).getTime() <= now;
  const fullName = (r) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || `PIN ${r.emp_code}`;

  const present = rows.filter((r) => r.status === 'Present');
  const late = rows.filter((r) => (r.late_minutes ?? 0) > 0);
  const stillIn = rows.filter((r) => r.status === 'Incomplete');
  const absent = rows.filter((r) => r.status === 'Absent' && started(r));    // shift started + no scan
  const upcoming = rows.filter((r) => r.status === 'Absent' && !started(r));  // shift not due yet
  const counted = (roster.data ?? []).filter((e) => e.track_attendance && e.active !== false).length;
  const share = (n) => (counted ? (n / counted) * 100 : 0);   // a group's share of counted staff, for the tile bar
  const inCount = present.length + stillIn.length;            // scanned in today (done or still in)
  const rate = counted ? Math.round((inCount / counted) * 100) : 0;
  const C = 326.726;                                          // 2·π·r for r=52, the donut circumference

  const open = (title, list, right) =>
    setDrill({ title, sub: `${list.length} ${list.length === 1 ? 'person' : 'people'} · ${today}`, list, right });

  // Some PINs aren't real users (test scans, removed staff). Let HR ignore them
  // so they stop nagging. Remembered on this device, and shared once the
  // ignored_pins migration is applied.
  const unlinked = (unknown.data ?? []).filter((u) => !ignored.has(`${u.device_sn}::${u.pin}`));
  function ignorePin(device_sn, pin) {
    const next = new Set(ignored); next.add(`${device_sn}::${pin}`); setIgnored(next);
    try { localStorage.setItem('ignored-pins', JSON.stringify([...next])); } catch {}
    supabase.from('ignored_pins').insert({ device_sn, pin }).then(() => {}, () => {});
  }

  return (
    <>
      <header className="hero">
        <span className="hero-wash" aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-lede">
            <span className="eyebrow">Overview · {today}</span>
            <h1 className="hero-h">Today at a glance</h1>
            <p className="hero-sub">Live attendance across {counted} tracked {counted === 1 ? 'person' : 'people'}.</p>
          </div>
          <span className="live"><span className="p" />Live</span>
        </div>
      </header>
      <ErrorBanner error={daily.error || feed.error || health.error} />

      {(health.data ?? []).some((d) => !d.online) && (
        <div className="callout danger">
          <b>Device offline.</b> The scanner hasn’t checked in recently, so punches may not be recording right now. Make sure the office Mac (catcher) is on and connected, then press <b>Sync</b>. Last seen {fmtDateTime((health.data.find((d) => !d.online) || {}).last_seen)}.
        </div>
      )}

      {unlinked.length > 0 && (
        <div className="callout warn">
          <b>{unlinked.length} PIN{unlinked.length > 1 ? 's' : ''} scanned but not linked to anyone.</b> Link a PIN to a person on the Employees page, or ignore it if it is not a real user.
          <div className="unlinked">
            {unlinked.map((u) => (
              <span className="pin" key={`${u.device_sn}-${u.pin}`}>
                PIN <b>{u.pin}</b> · {u.punches} scan{u.punches > 1 ? 's' : ''} · <span className="when">last {fmtTime(u.last_seen)}</span>
                <button className="pin-x" onClick={() => ignorePin(u.device_sn, u.pin)} title="Not a real user. Stop showing this PIN.">Ignore</button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid overview-top">
        <div className="card rate-card">
          <svg viewBox="0 0 120 120" className="donut" role="img" aria-label={`${rate}% attendance`}>
            <circle className="donut-track" cx="60" cy="60" r="52" />
            <circle className="donut-arc" cx="60" cy="60" r="52" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - rate / 100) }} />
            <text className="donut-pct" x="60" y="60">{rate}%</text>
          </svg>
          <div className="rate-meta">
            <span className="eyebrow">Attendance today</span>
            <div className="rate-big">{inCount}<small>of {counted} in</small></div>
            <div className="rate-legend">
              <span><i className="d ok" />Present {present.length}</span>
              <span><i className="d warn" />Late {late.length}</span>
              <span><i className="d danger" />Absent {absent.length}</span>
            </div>
          </div>
        </div>
        <div className="stat-cluster">
        <Stat icon={UserCheck} tone="ok" label="Present" value={present.length} bar={share(present.length)}
          hint={`of ${counted} counted`}
          onClick={() => open('Present today', present, (r) => `in ${fmtTime(r.first_in)}`)}
          help="Scanned in and out for a shift that has started today. Click to see who." />
        <Stat icon={Clock} tone="warn" label="Late" value={late.length} bar={share(late.length)}
          hint="arrived after grace"
          onClick={() => open('Late arrivals', late, (r) => `${r.late_minutes}m late`)}
          help="Scanned in after their shift’s start time plus the grace period." />
        <Stat icon={Hourglass} tone="violet" label="Still in" value={stillIn.length} bar={share(stillIn.length)}
          hint="not scanned out"
          onClick={() => open('Still in', stillIn, (r) => `in ${fmtTime(r.first_in)}`)}
          help="Scanned in but haven’t scanned out yet." />
        <Stat icon={UserX} tone="danger" label="Absent" value={absent.length} bar={share(absent.length)}
          hint={upcoming.length ? `${upcoming.length} not due yet` : 'shift started, no scan'}
          onClick={() => open('Absent', absent, (r) => `due ${fmtTime(r.scheduled_in)}`)}
          help="Scheduled today, their shift has started, and still no scan. Weekly off and approved leave are not counted. Anyone whose shift has not started yet shows as not due yet." />
        </div>
      </div>

      <Card title="Device health" help="Your scanner and the catcher service. “Online” means a heartbeat arrived in the last 2 minutes."
        actions={<button className="btn sm" onClick={health.refetch}><RefreshCw size={14} /> Refresh</button>}>
        <Table
          loading={health.loading} empty="No devices yet." rows={health.data}
          columns={[
            { key: 'name', label: 'Device', render: (r) => <strong>{r.name || r.sn}</strong> },
            { key: 'sn', label: 'Serial', render: (r) => <span className="mono">{r.sn}</span> },
            { key: 'ip', label: 'IP' },
            { key: 'firmware', label: 'Firmware' },
            { key: 'last_seen', label: 'Last seen', render: (r) => fmtDateTime(r.last_seen) },
            { key: 'online', label: 'Status', render: (r) => <Badge value={r.online ? 'online' : 'offline'} kind={r.online ? 'online' : 'offline'} /> },
          ]}
        />
      </Card>

      <Card title="Live punch feed" help="Every scan as it happens, newest first. Updates live as people use the device."
        actions={<button className="btn sm" onClick={feed.refetch}><RefreshCw size={14} /> Refresh</button>}>
        <Table
          loading={feed.loading} empty="No punches captured yet." rows={feed.data}
          columns={[
            { key: 'punch_time', label: 'Time', render: (r) => <span className="mono">{fmtTime(r.punch_time)}</span> },
            { key: 'employee', label: 'Employee', render: (r) => r.employee?.trim() || <span className="muted">Unlinked (PIN {r.pin})</span> },
            { key: 'emp_code', label: 'PIN' },
            { key: 'method', label: 'Method', render: (r) => <Badge value={r.method} kind={r.method} /> },
          ]}
        />
      </Card>

      {drill && (
        <Drawer title={drill.title} sub={drill.sub} onClose={() => setDrill(null)}>
          {drill.list.length === 0
            ? <div className="empty">Nobody here right now.</div>
            : drill.list.map((r) => (
                <PersonRow key={r.employee_id} name={fullName(r)} meta={r.department || `PIN ${r.emp_code}`} right={drill.right?.(r)} />
              ))}
        </Drawer>
      )}
    </>
  );
}
