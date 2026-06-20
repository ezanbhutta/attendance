import { useState } from 'react';
import { Card, Field, ErrorBanner } from '../components/ui.jsx';

// Desktop-only settings (Supabase + device). On first run this is shown full-screen
// before login; later it's a normal page. Saves via the Electron preload bridge,
// then reloads so the new Supabase config takes effect.
export default function Settings({ firstRun }) {
  const cfg = (typeof window !== 'undefined' && window.attendance && window.attendance.config) || {};
  const [f, setF] = useState({
    supabaseUrl: cfg.supabaseUrl || '',
    anonKey: cfg.anonKey || '',
    serviceKey: '', // write-only; blank = keep existing
    deviceIp: cfg.deviceIp || '192.168.1.201',
    devicePort: cfg.devicePort || 4370,
    deviceSn: cfg.deviceSn || 'NYU7253801246',
    timezone: cfg.timezone || 'Asia/Karachi',
    tzOffset: cfg.tzOffset || '+05:00',
    autoSyncOnOpen: cfg.autoSyncOnOpen ?? true,
    pushEnabled: cfg.pushEnabled ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const set = (k) => (e) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await window.attendance.saveConfig(f);
      if (res?.ok === false) {
        setErr(res.error || 'Could not save settings');
        setBusy(false);
        return;
      }
      window.location.reload(); // pick up the new Supabase config
    } catch (e2) {
      setErr(String(e2?.message || e2));
      setBusy(false);
    }
  }

  const form = (
    <form onSubmit={save} className="grid" style={{ gap: 14 }}>
      <h3 style={{ margin: 0 }}>Supabase (your cloud database)</h3>
      <Field label="Project URL">
        <input required placeholder="https://xxxx.supabase.co" value={f.supabaseUrl} onChange={set('supabaseUrl')} />
      </Field>
      <Field label="Anon / publishable key (for viewing reports)">
        <input required value={f.anonKey} onChange={set('anonKey')} />
      </Field>
      <Field label={`Service-role / secret key (for saving punches)${cfg.hasServiceKey ? ' — leave blank to keep current' : ''}`}>
        <input type="password" required={!cfg.hasServiceKey} placeholder={cfg.hasServiceKey ? '•••••• saved' : ''} value={f.serviceKey} onChange={set('serviceKey')} />
      </Field>

      <h3 style={{ margin: '6px 0 0' }}>Device</h3>
      <div className="row">
        <Field label="Device IP"><input value={f.deviceIp} onChange={set('deviceIp')} /></Field>
        <Field label="Port"><input type="number" value={f.devicePort} onChange={set('devicePort')} style={{ width: 90 }} /></Field>
        <Field label="Serial (SN)"><input value={f.deviceSn} onChange={set('deviceSn')} /></Field>
        <Field label="Time offset"><input value={f.tzOffset} onChange={set('tzOffset')} style={{ width: 90 }} /></Field>
      </div>

      <h3 style={{ margin: '6px 0 0' }}>Options</h3>
      <label className="row" style={{ gap: 8, alignItems: 'center' }}>
        <input type="checkbox" style={{ minHeight: 'auto', width: 18, height: 18 }} checked={f.autoSyncOnOpen} onChange={set('autoSyncOnOpen')} />
        Fetch from device automatically when I open the app
      </label>
      <label className="row" style={{ gap: 8, alignItems: 'center' }}>
        <input type="checkbox" style={{ minHeight: 'auto', width: 18, height: 18 }} checked={f.pushEnabled} onChange={set('pushEnabled')} />
        Also run the always-on catcher in the background (backup — proven on this device)
      </label>

      <ErrorBanner error={err ? { message: err } : null} />
      <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
    </form>
  );

  if (firstRun) {
    return (
      <div className="login-wrap">
        <Card className="login-card" title="Welcome — set up Attendance OS" style={{ maxWidth: 460 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            Enter your Supabase keys (Settings → API in Supabase) and confirm the device address. You only do this once.
          </p>
          {form}
        </Card>
      </div>
    );
  }
  return (
    <>
      <div className="page-title"><h1>Settings</h1></div>
      <Card title="App &amp; device settings">{form}</Card>
    </>
  );
}
