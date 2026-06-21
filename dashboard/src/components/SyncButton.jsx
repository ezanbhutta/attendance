import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase, IS_DESKTOP, DEVICE_SN } from '../lib/supabase';
import { fmtDateTime } from '../lib/format';

// One-click "re-sync the device now".
//  • Desktop app: talks straight to the device via the Electron bridge.
//  • Web: drops a request row that the always-on Mac catcher picks up and acts
//    on (it re-pulls ATTLOG/USERINFO from the device), so HR never installs a thing.
export default function SyncButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (IS_DESKTOP) {
      window.attendance?.getStatus?.().then((s) => s?.lastSync && setMsg(`Last sync ${fmtDateTime(s.lastSync)}`)).catch(() => {});
    }
  }, []);

  async function sync() {
    setBusy(true);
    setMsg(IS_DESKTOP ? 'Fetching from device…' : 'Asking your Mac to sync…');
    try {
      if (IS_DESKTOP && window.attendance?.syncNow) {
        const r = await window.attendance.syncNow();
        setMsg(r?.ok === false ? `Sync failed: ${r.error}` : `Fetched ${r.pulled} punch(es)`);
      } else {
        const { error } = await supabase.from('device_sync_requests').insert({ device_sn: DEVICE_SN });
        setMsg(error ? `Couldn’t request sync: ${error.message}` : 'Sync requested — your Mac is pulling from the device now.');
      }
    } catch {
      setMsg('Sync failed');
    }
    setBusy(false);
    setTimeout(() => setMsg(''), 9000);
  }

  return (
    <span className="sync-wrap no-print">
      {msg && <span className="sync-msg">{msg}</span>}
      <button className="btn sm" onClick={sync} disabled={busy} title="Re-sync the device now">
        <RefreshCw size={14} className={busy ? 'spin' : ''} />
        {busy ? 'Syncing…' : 'Sync'}
      </button>
    </span>
  );
}
