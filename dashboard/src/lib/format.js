import { APP_TZ } from './supabase';

export const pad = (n) => String(n).padStart(2, '0');

export function minutesToHM(min) {
  if (min == null) return '—';
  const m = Math.round(min);
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

export function fmtTime(ts, tz = APP_TZ) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });
}

export function fmtDateTime(ts, tz = APP_TZ) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz,
  });
}

export function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: APP_TZ }); // YYYY-MM-DD
export const daysAgoISO = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA', { timeZone: APP_TZ });
};
