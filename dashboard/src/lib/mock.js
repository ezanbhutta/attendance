// DEV-ONLY mock Supabase client, used purely for headless visual rendering of
// the real app (VITE_MOCK=1). Never imported in a normal build. Lets us load
// every page with representative data in a browser to verify the design.
const _now = new Date();
const _at = (h, m = 0) => { const d = new Date(_now); d.setHours(h, m, 0, 0); return d.toISOString(); };
let _id = 0;
const _p = (first, last, dept, status, extra = {}) => ({
  employee_id: ++_id, emp_code: String(1040 + _id), first_name: first, last_name: last,
  department: dept, status, late_minutes: 0, first_in: null, scheduled_in: _at(9), ...extra,
});
const F = {
  v_report_daily: [
    _p('Salman', 'Khan', 'Creative', 'Present', { first_in: _at(9, 1) }),
    _p('Ayesha', 'Malik', 'Accounts', 'Present', { first_in: _at(9, 14), late_minutes: 14 }),
    _p('Bilal', 'Ahmed', 'Production', 'Incomplete', { first_in: _at(9, 3) }),
    _p('Fatima', 'Noor', 'Creative', 'Incomplete', { first_in: _at(8, 58) }),
    _p('Usman', 'Tariq', 'Production', 'Incomplete', { first_in: _at(9, 6) }),
    _p('Hira', 'Sheikh', 'Accounts', 'Incomplete', { first_in: _at(9, 0) }),
    _p('Zain', 'Abbas', 'Creative', 'Incomplete', { first_in: _at(9, 9) }),
    _p('Imran', 'Ali', 'Production', 'Absent'),
    _p('Sana', 'Javed', 'Accounts', 'Absent'),
    _p('Omar', 'Farooq', 'Creative', 'Absent'),
    _p('Nida', 'Yousuf', 'Production', 'Absent'),
    // Night shift — scheduled 21:00, not due yet, so must NOT count as absent now:
    _p('Kamran', 'Shah', 'Production', 'Absent', { scheduled_in: _at(21) }),
    _p('Rabia', 'Aslam', 'Production', 'Absent', { scheduled_in: _at(21) }),
    _p('Tariq', 'Mehmood', 'Production', 'Absent', { scheduled_in: _at(21) }),
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
  v_unknown_pins: [
    { device_sn: 'NYU7253801246', pin: '21', punches: 3, first_seen: _at(8, 12), last_seen: _at(14, 33) },
    { device_sn: 'NYU7253801246', pin: '9', punches: 1, first_seen: _at(13, 2), last_seen: _at(13, 2) },
  ],
  employees: [
    { id: 1, name: 'Salman Khan', emp_code: '1042', department: 'Creative', active: true, methods: 'face' },
    { id: 2, name: 'Ayesha Malik', emp_code: '1108', department: 'Accounts', active: true, methods: 'face,fingerprint' },
    { id: 3, name: 'Bilal Ahmed', emp_code: '1067', department: 'Production', active: true, methods: 'fingerprint' },
  ],
  departments: [{ id: 1, name: 'Creative' }, { id: 2, name: 'Accounts' }, { id: 3, name: 'Production' }],
  shifts: [{ id: 1, name: 'General' }, { id: 2, name: 'Night' }],
  timetables: [
    { id: 1, name: 'General 09–18', check_in: '09:00', check_out: '18:00', late_grace_min: 10, early_leave_grace_min: 10 },
    { id: 2, name: 'Night 21–06', check_in: '21:00', check_out: '06:00', late_grace_min: 10, early_leave_grace_min: 10 },
  ],
  shift_details: [
    { id: 1, shift_id: 1, day_index: 1, timetable_id: 1 },
    { id: 2, shift_id: 1, day_index: 2, timetable_id: 1 },
    { id: 3, shift_id: 1, day_index: 3, timetable_id: 1 },
  ],
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
