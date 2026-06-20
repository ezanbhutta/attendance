import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  // Surfaced in the console + the login screen rather than a blank white page.
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env');
}

// Browser client: anon (publishable) key + the logged-in user's JWT => requests
// run as `authenticated`, gated by RLS. The service-role key never lives here.
export const supabase = createClient(url || 'http://localhost', anon || 'anon');
export const DEVICE_SN = import.meta.env.VITE_DEVICE_SN || 'NYU7253801246';
export const APP_TZ = import.meta.env.VITE_APP_TZ || 'Asia/Karachi';
