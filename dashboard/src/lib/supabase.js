import { createClient } from '@supabase/supabase-js';

// Config comes from one of two places:
//  • Desktop app: injected at runtime by the Electron preload (entered in Settings).
//  • Web build:    build-time env vars (VITE_*).
const rc = (typeof window !== 'undefined' && window.attendance && window.attendance.config) || {};

const url = rc.supabaseUrl || import.meta.env.VITE_SUPABASE_URL;
const anon = rc.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY;

export const IS_DESKTOP = !!(typeof window !== 'undefined' && window.attendance && window.attendance.isElectron);
export const IS_CONFIGURED = !!(url && anon);

if (!IS_CONFIGURED) {
  console.error('Supabase not configured yet (set it in Settings, or via VITE_* env on the web).');
}

// Browser/renderer client: anon (publishable) key + the logged-in user's JWT =>
// requests run as `authenticated`, gated by RLS. The service-role key never lives here.
export const supabase = createClient(url || 'http://localhost', anon || 'public-anon-placeholder');
export const DEVICE_SN = rc.deviceSn || import.meta.env.VITE_DEVICE_SN || 'NYU7253801246';
export const APP_TZ = rc.timezone || import.meta.env.VITE_APP_TZ || 'Asia/Karachi';
