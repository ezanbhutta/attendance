import { useEffect, useState } from 'react';
import { fmtDateTime } from '../lib/format';

// Desktop-only: "fetch from the device now" button + last-sync time.
// Talks to the Electron main process via the preload bridge (window.attendance).
export default function SyncButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [last, setLast] = useState(null);

  useEffect(() => {
    window.attendance?.getStatus?.().then((s) => s?.lastSync && setLast(s.lastSync)).catch(() => {});
  }, []);

  async function sync() {
    setBusy(true);
    setMsg('Fetching from device…');
    try {
      const r = await window.attendance.syncNow();
      if (r?.ok === false) setMsg(`Sync failed: ${r.error}`);
      else {
        setMsg(`Fetched ${r.pulled} punch(es)`);
        setLast(new Date().toISOString());
      }
    } catch {
      setMsg('Sync failed');
    }
    setBusy(false);
    setTimeout(() => setMsg(''), 7000);
  }

  return (
    <div className="row" style={{ alignItems: 'center', gap: 8 }}>
      <span className="muted" style={{ fontSize: '.78rem' }}>
        {msg || (last ? `Last sync: ${fmtDateTime(last)}` : 'Not synced yet')}
      </span>
      <button className="btn sm primary" onClick={sync} disabled={busy}>
        {busy ? 'Fetching…' : '⟳ Sync device'}
      </button>
    </div>
  );
}
