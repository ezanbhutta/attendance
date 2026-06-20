import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '../lib/useData';
import { todayISO, fmtDateTime, fmtTime } from '../lib/format';
import { Card, Table, Badge, ErrorBanner } from '../components/ui.jsx';

export default function Overview() {
  const today = todayISO();

  const daily = useQuery(() =>
    supabase.from('v_report_daily').select('status,late_minutes').eq('work_date', today), [today]);

  const health = useQuery(() => supabase.from('v_device_health').select('*'), []);

  const feed = useQuery(() =>
    supabase.from('v_live_punches').select('*').limit(50), []);

  // Realtime: refetch the feed (and today's stats) whenever a punch lands.
  useEffect(() => {
    const ch = supabase
      .channel('rt-punches')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'raw_punches' }, () => {
        feed.refetch();
        daily.refetch();
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = daily.data ?? [];
  const stat = {
    present: rows.filter((r) => r.status === 'Present').length,
    incomplete: rows.filter((r) => r.status === 'Incomplete').length,
    absent: rows.filter((r) => r.status === 'Absent').length,
    late: rows.filter((r) => (r.late_minutes ?? 0) > 0).length,
  };

  return (
    <>
      <div className="page-title"><h1>Overview</h1><span className="muted">{today}</span></div>
      <ErrorBanner error={daily.error || feed.error || health.error} />

      <div className="grid cols-4">
        <div className="stat"><div className="label">Present today</div><div className="value">{stat.present}</div></div>
        <div className="stat"><div className="label">Late</div><div className="value">{stat.late}</div></div>
        <div className="stat"><div className="label">Incomplete</div><div className="value">{stat.incomplete}</div></div>
        <div className="stat"><div className="label">Absent</div><div className="value">{stat.absent}</div></div>
      </div>

      <Card title="Device health" actions={<button className="btn sm" onClick={health.refetch}>Refresh</button>}>
        <Table
          loading={health.loading}
          empty="No devices yet — seed the device row."
          rows={health.data}
          columns={[
            { key: 'name', label: 'Device', render: (r) => r.name || r.sn },
            { key: 'sn', label: 'Serial' },
            { key: 'ip', label: 'IP' },
            { key: 'firmware', label: 'Firmware' },
            { key: 'last_seen', label: 'Last seen', render: (r) => fmtDateTime(r.last_seen) },
            { key: 'online', label: 'Status', render: (r) => <Badge value={r.online ? 'online' : 'offline'} kind={r.online ? 'online' : 'offline'} /> },
          ]}
        />
      </Card>

      <Card title="Live punch feed" actions={<button className="btn sm" onClick={feed.refetch}>Refresh</button>}>
        <Table
          loading={feed.loading}
          empty="No punches captured yet."
          rows={feed.data}
          columns={[
            { key: 'punch_time', label: 'Time', render: (r) => fmtTime(r.punch_time) },
            { key: 'employee', label: 'Employee', render: (r) => r.employee?.trim() || <span className="muted">Unknown (PIN {r.pin})</span> },
            { key: 'emp_code', label: 'Code' },
            { key: 'method', label: 'Method', render: (r) => <Badge value={r.method} kind={r.method} /> },
          ]}
        />
      </Card>
    </>
  );
}
