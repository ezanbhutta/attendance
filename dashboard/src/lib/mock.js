// DEV-ONLY mock Supabase client, used purely for headless visual rendering of
// the real app (VITE_MOCK=1). Never imported in a normal build. Lets us load
// every page with representative data in a browser to verify the design.
const F = {
  v_report_daily: [
    { status: 'Present', late_minutes: 0 }, { status: 'Present', late_minutes: 14 },
    { status: 'Incomplete', late_minutes: 0 }, { status: 'Incomplete', late_minutes: 0 },
    { status: 'Incomplete', late_minutes: 0 }, { status: 'Incomplete', late_minutes: 0 },
    { status: 'Incomplete', late_minutes: 0 },
    { status: 'Absent', late_minutes: 0 }, { status: 'Absent', late_minutes: 0 },
    { status: 'Absent', late_minutes: 0 }, { status: 'Absent', late_minutes: 0 },
    { status: 'Absent', late_minutes: 0 }, { status: 'Absent', late_minutes: 0 },
    { status: 'Absent', late_minutes: 0 },
  ],
  v_device_health: [
    { id: 1, name: 'SenseFace 2A', sn: 'NYU7253801246', ip: '192.168.1.22',
      firmware: 'ZAM70-Ver3.3.12', last_seen: new Date().toISOString(), online: true },
  ],
  v_live_punches: [
    { id: 1, punch_time: new Date(Date.now() - 1 * 60000).toISOString(), employee: 'Salman Khan', pin: '1042', emp_code: '1042', method: 'face' },
    { id: 2, punch_time: new Date(Date.now() - 7 * 60000).toISOString(), employee: 'Ayesha Malik', pin: '1108', emp_code: '1108', method: 'face' },
    { id: 3, punch_time: new Date(Date.now() - 12 * 60000).toISOString(), employee: 'Bilal Ahmed', pin: '1067', emp_code: '1067', method: 'fingerprint' },
    { id: 4, punch_time: new Date(Date.now() - 21 * 60000).toISOString(), employee: 'Fatima Noor', pin: '1131', emp_code: '1131', method: 'face' },
    { id: 5, punch_time: new Date(Date.now() - 34 * 60000).toISOString(), employee: '', pin: '21', emp_code: '21', method: 'fingerprint' },
    { id: 6, punch_time: new Date(Date.now() - 51 * 60000).toISOString(), employee: 'Usman Tariq', pin: '1090', emp_code: '1090', method: 'face' },
  ],
  employees: [
    { id: 1, name: 'Salman Khan', emp_code: '1042', department: 'Creative', active: true, methods: 'face' },
    { id: 2, name: 'Ayesha Malik', emp_code: '1108', department: 'Accounts', active: true, methods: 'face,fingerprint' },
    { id: 3, name: 'Bilal Ahmed', emp_code: '1067', department: 'Production', active: true, methods: 'fingerprint' },
  ],
  departments: [{ id: 1, name: 'Creative' }, { id: 2, name: 'Accounts' }, { id: 3, name: 'Production' }],
  shifts: [{ id: 1, name: 'Morning', start: '09:00', end: '17:00' }, { id: 2, name: 'Night', start: '21:00', end: '05:00' }],
};

function thenable(data) {
  const result = Promise.resolve({ data, error: null, count: Array.isArray(data) ? data.length : 0 });
  const chain = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return result.then.bind(result);
      if (prop === 'catch') return result.catch.bind(result);
      if (prop === 'finally') return result.finally.bind(result);
      if (prop === 'single' || prop === 'maybeSingle')
        return () => thenable(Array.isArray(data) ? data[0] ?? null : data);
      return () => chain; // select / eq / order / limit / insert / update / ... → keep chaining
    },
    apply() { return chain; },
  });
  return chain;
}

export const mockClient = {
  from(table) { return thenable(F[table] ?? []); },
  rpc() { return thenable([]); },
  auth: {
    async getSession() { return { data: { session: { user: { email: 'hr@haseebmadeit.com' } } } }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    async signInWithPassword() { return { data: {}, error: null }; },
    async signOut() { return { error: null }; },
  },
  channel() { const c = { on() { return c; }, subscribe() { return c; } }; return c; },
  removeChannel() {},
};
