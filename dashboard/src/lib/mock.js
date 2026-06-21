// DEV-ONLY mock Supabase client, used purely for headless visual rendering of
// the real app (VITE_MOCK=1). Never imported in a normal build. It serves
// representative data so every page can be loaded in a browser to check design.
//
// The query builder honours eq / gte / lte / in / order / limit so date-scoped
// queries (today vs a range) get the right slice, the same way the real client
// would. Times are built in Asia/Karachi so they read correctly on screen.

const TZ = 'Asia/Karachi';
const _now = new Date();

// YYYY-MM-DD for `back` days ago, in the app timezone (matches todayISO()).
const dateISO = (back) => {
  const d = new Date(_now);
  d.setDate(d.getDate() - back);
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
};
const TODAY = dateISO(0);

// A UTC instant that reads as h:m on `workDate` in Karachi (UTC+5, no DST).
const ts = (workDate, h, m = 0) => {
  const [y, mo, d] = workDate.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 5, m)).toISOString();
};
// Day of week (0 Sun … 6 Sat) for a YYYY-MM-DD, stable across timezones.
const dow = (workDate) => new Date(`${workDate}T12:00:00Z`).getUTCDay();
// Deterministic 0..1 hash so renders are identical run to run.
const rng = (a, b) => { const s = Math.sin(a * 374761 + b * 99991) * 43758.5453; return s - Math.floor(s); };

// One roster, used to derive employees, methods, live feed and every daily row.
// track:false => gate only (CEO / Admin / Security), never counted or reported.
// active:false => archived, excluded from live counts until restored.
const ROSTER = [
  { id: 1,  first: 'Salman', last: 'Khan',     dept: 'Creative',   woff: 0 },
  { id: 2,  first: 'Ayesha', last: 'Malik',    dept: 'Accounts',   woff: 0 },
  { id: 3,  first: 'Bilal',  last: 'Ahmed',    dept: 'Production', woff: 5 },
  { id: 4,  first: 'Fatima', last: 'Noor',     dept: 'Creative',   woff: 0 },
  { id: 5,  first: 'Usman',  last: 'Tariq',    dept: 'Production', woff: 5 },
  { id: 6,  first: 'Hira',   last: 'Sheikh',   dept: 'Accounts',   woff: 0 },
  { id: 7,  first: 'Zain',   last: 'Abbas',    dept: 'Creative',   woff: 0 },
  { id: 8,  first: 'Imran',  last: 'Ali',      dept: 'Production', woff: 5 },
  { id: 9,  first: 'Sana',   last: 'Javed',    dept: 'Accounts',   woff: 0 },
  { id: 10, first: 'Omar',   last: 'Farooq',   dept: 'Creative',   woff: 0 },
  { id: 11, first: 'Nida',   last: 'Yousuf',   dept: 'Production', woff: 5 },
  { id: 12, first: 'Kamran', last: 'Shah',     dept: 'Production', woff: 0, night: true },
  { id: 13, first: 'Rabia',  last: 'Aslam',    dept: 'Production', woff: 0, night: true },
  { id: 14, first: 'Adnan',  last: 'Malik',    dept: 'Production', woff: 0, night: true },
  { id: 15, first: 'Tariq',  last: 'Mehmood',  dept: 'Management', woff: 0, track: false },
  { id: 16, first: 'Hassan', last: 'Iqbal',    dept: 'Security',   woff: 0, track: false },
  { id: 17, first: 'Ali',    last: 'Shakeel',  dept: 'Production', woff: 5, active: false },
];
const byId = Object.fromEntries(ROSTER.map((p) => [p.id, p]));
const code = (id) => String(1041 + id);
const startHour = (p) => (p.night ? 21 : 9);
const endHour = (p) => (p.night ? 6 : 17);

// Today's live snapshot, hand-built so the dashboard reads naturally:
// a mix of done, still in, late, absent, on leave, plus night staff not due yet.
const TODAY_PLAN = {
  1:  { status: 'Present',    in: [9, 1],  out: [17, 6] },
  2:  { status: 'Incomplete', in: [9, 14], late: 14 },
  3:  { status: 'Incomplete', in: [9, 3] },
  4:  { status: 'Incomplete', in: [8, 58] },
  5:  { status: 'Incomplete', in: [9, 6] },
  6:  { status: 'Incomplete', in: [9, 0] },
  7:  { status: 'Incomplete', in: [9, 9] },
  8:  { status: 'Absent' },
  9:  { status: 'Leave' },
  10: { status: 'Absent' },
  11: { status: 'Incomplete', in: [9, 25], late: 25 },
  12: { status: 'Absent' },   // night shift, not due yet
  13: { status: 'Absent' },
  14: { status: 'Absent' },
  15: { status: 'Present',    in: [8, 40], out: [18, 2] },   // gate only, filtered out
  16: { status: 'Present',    in: [8, 30], out: [20, 1] },   // gate only, filtered out
  17: { status: 'Absent' },                                   // archived, filtered out
};

function todayRow(p) {
  const plan = TODAY_PLAN[p.id] || { status: 'Absent' };
  const sIn = ts(TODAY, startHour(p));
  const sOut = ts(TODAY, endHour(p));
  const first_in = plan.in ? ts(TODAY, plan.in[0], plan.in[1]) : null;
  const last_out = plan.out ? ts(TODAY, plan.out[0], plan.out[1]) : null;
  let worked = null, ot = 0;
  if (first_in && last_out) {
    worked = (plan.out[0] * 60 + plan.out[1]) - (plan.in[0] * 60 + plan.in[1]) - 60;
    ot = Math.max(0, plan.out[0] * 60 + plan.out[1] - endHour(p) * 60);
  }
  return {
    work_date: TODAY, employee_id: p.id, emp_code: code(p.id),
    first_name: p.first, last_name: p.last, department: p.dept,
    status: plan.status, late_minutes: plan.late ?? 0,
    first_in, last_out, scheduled_in: sIn, scheduled_out: sOut,
    worked_minutes: worked, overtime_minutes: ot,
  };
}

// A past day for one person: weekly off, else a seeded present / late / absent / leave.
function historyRow(p, back) {
  const date = dateISO(back);
  const sIn = ts(date, startHour(p));
  const sOut = ts(date, endHour(p));
  const base = { work_date: date, employee_id: p.id, emp_code: code(p.id),
    first_name: p.first, last_name: p.last, department: p.dept,
    scheduled_in: sIn, scheduled_out: sOut, late_minutes: 0,
    first_in: null, last_out: null, worked_minutes: null, overtime_minutes: 0 };

  if (dow(date) === p.woff) return { ...base, status: 'WeeklyOff' };

  const roll = rng(p.id, back);
  const absentRate = 0.03 + (p.id % 4) * 0.015;   // 3%..7.5%
  const lateRate = 0.08 + (p.id % 5) * 0.05;       // 8%..28%
  if (roll < absentRate) return { ...base, status: 'Absent' };
  if (roll < absentRate + 0.035) return { ...base, status: 'Leave' };

  const late = rng(p.id, back + 100) < lateRate ? Math.round(5 + rng(p.id, back + 7) * 35) : 0;
  const outExtra = Math.round(rng(p.id, back + 200) * 35);
  const sh = startHour(p), eh = endHour(p);
  const first_in = ts(date, sh, late);
  const last_out = ts(date, eh, outExtra);
  const worked = (eh * 60 + outExtra) - (sh * 60 + late) - 60;
  return { ...base, status: 'Present', late_minutes: late, first_in, last_out,
    worked_minutes: worked, overtime_minutes: outExtra > 15 ? outExtra - 15 : 0 };
}

const daily = [];
for (const p of ROSTER) {
  daily.push(todayRow(p));
  for (let back = 1; back <= 29; back++) daily.push(historyRow(p, back));
}

const employees = ROSTER.map((p) => ({
  id: p.id, emp_code: code(p.id), first_name: p.first, last_name: p.last,
  track_attendance: p.track !== false, weekly_off: p.woff,
  department_id: p.dept === 'Creative' ? 1 : p.dept === 'Accounts' ? 2 : p.dept === 'Production' ? 3 : p.dept === 'Management' ? 4 : 5,
  shift_id: p.night ? 2 : 1, active: p.active !== false,
  department: { name: p.dept }, shift: { name: p.night ? 'Night' : 'General' },
}));

const F = {
  v_report_daily: daily,
  employees,
  departments: [
    { id: 1, name: 'Creative' }, { id: 2, name: 'Accounts' }, { id: 3, name: 'Production' },
    { id: 4, name: 'Management' }, { id: 5, name: 'Security' },
  ],
  shifts: [{ id: 1, name: 'General' }, { id: 2, name: 'Night' }],
  v_device_health: [
    { id: 1, name: 'SenseFace 2A', sn: 'NYU7253801246', ip: '192.168.1.22',
      firmware: 'ZAM70-Ver3.3.12', last_seen: new Date().toISOString(), online: true },
  ],
  v_live_punches: [
    { id: 1, punch_time: new Date(Date.now() - 1 * 60000).toISOString(),  employee: 'Salman Khan',  pin: '1042', emp_code: '1042', method: 'face' },
    { id: 2, punch_time: new Date(Date.now() - 7 * 60000).toISOString(),  employee: 'Ayesha Malik', pin: '1043', emp_code: '1043', method: 'face' },
    { id: 3, punch_time: new Date(Date.now() - 12 * 60000).toISOString(), employee: 'Bilal Ahmed',  pin: '1044', emp_code: '1044', method: 'fingerprint' },
    { id: 4, punch_time: new Date(Date.now() - 21 * 60000).toISOString(), employee: 'Fatima Noor',  pin: '1045', emp_code: '1045', method: 'face' },
    { id: 5, punch_time: new Date(Date.now() - 34 * 60000).toISOString(), employee: '',             pin: '21',   emp_code: '21',   method: 'fingerprint' },
    { id: 6, punch_time: new Date(Date.now() - 51 * 60000).toISOString(), employee: 'Usman Tariq',  pin: '1046', emp_code: '1046', method: 'face' },
  ],
  v_unknown_pins: [
    { device_sn: 'NYU7253801246', pin: '21', punches: 3, first_seen: ts(TODAY, 8, 12), last_seen: ts(TODAY, 14, 33) },
    { device_sn: 'NYU7253801246', pin: '9',  punches: 1, first_seen: ts(TODAY, 13, 2), last_seen: ts(TODAY, 13, 2) },
  ],
  v_employee_methods: [
    { employee_id: 1, has_face: true,  has_finger: false, has_card: false, card_no: null },
    { employee_id: 2, has_face: true,  has_finger: true,  has_card: false, card_no: null },
    { employee_id: 3, has_face: false, has_finger: true,  has_card: true,  card_no: '0098213' },
    { employee_id: 4, has_face: true,  has_finger: true,  has_card: false, card_no: null },
    { employee_id: 5, has_face: true,  has_finger: false, has_card: true,  card_no: '0044190' },
  ],
  timetables: [
    { id: 1, name: 'General 09 to 17', check_in: '09:00', check_out: '17:00', late_grace_min: 10, early_leave_grace_min: 10 },
    { id: 2, name: 'Night 21 to 06',   check_in: '21:00', check_out: '06:00', late_grace_min: 10, early_leave_grace_min: 10 },
  ],
  shift_details: [
    { id: 1, shift_id: 1, day_index: 1, timetable_id: 1 },
    { id: 2, shift_id: 1, day_index: 2, timetable_id: 1 },
    { id: 3, shift_id: 1, day_index: 3, timetable_id: 1 },
    { id: 4, shift_id: 1, day_index: 4, timetable_id: 1 },
    { id: 5, shift_id: 1, day_index: 5, timetable_id: 1 },
  ],
  holidays: [{ id: 1, the_date: '2026-08-14', name: 'Independence Day', pay_multiplier: 2 }],
  leaves: [
    { id: 1, leave_type: 'annual', start_date: dateISO(1), end_date: dateISO(-1), status: 'approved', employee: { emp_code: '1050', first_name: 'Sana' } },
    { id: 2, leave_type: 'sick',   start_date: TODAY,      end_date: TODAY,        status: 'pending',  employee: { emp_code: '1044', first_name: 'Bilal' } },
  ],
  manual_logs: [
    { id: 1, punch_time: ts(TODAY, 9), reason: 'Scanner missed the scan, verified by lead', created_by: 'hr@haseebmadeit.com', created_at: ts(TODAY, 9, 5), employee: { emp_code: '1044', first_name: 'Bilal' } },
  ],
};

// Minimal query builder: chainable, filter aware, awaitable.
function builder(rows) {
  const state = { data: Array.isArray(rows) ? [...rows] : rows };
  const where = (fn) => { if (Array.isArray(state.data)) state.data = state.data.filter(fn); return proxy; };
  const settle = () => Promise.resolve({ data: state.data, error: null, count: Array.isArray(state.data) ? state.data.length : 0 });
  const known = {
    eq: (c, v) => where((r) => String(r?.[c]) === String(v)),
    neq: (c, v) => where((r) => String(r?.[c]) !== String(v)),
    gte: (c, v) => where((r) => r?.[c] >= v),
    lte: (c, v) => where((r) => r?.[c] <= v),
    gt: (c, v) => where((r) => r?.[c] > v),
    lt: (c, v) => where((r) => r?.[c] < v),
    in: (c, vs) => where((r) => vs.includes(r?.[c])),
    order: (c, opts) => {
      if (Array.isArray(state.data)) {
        const asc = !opts || opts.ascending !== false;
        state.data = [...state.data].sort((a, b) => {
          const x = a?.[c], y = b?.[c];
          return (x > y ? 1 : x < y ? -1 : 0) * (asc ? 1 : -1);
        });
      }
      return proxy;
    },
    limit: (n) => { if (Array.isArray(state.data)) state.data = state.data.slice(0, n); return proxy; },
    single: () => builder(Array.isArray(state.data) ? state.data[0] ?? null : state.data),
    maybeSingle: () => builder(Array.isArray(state.data) ? state.data[0] ?? null : state.data),
    then: (res, rej) => settle().then(res, rej),
    catch: (rej) => settle().catch(rej),
    finally: (f) => settle().finally(f),
  };
  const proxy = new Proxy(known, {
    get(t, prop) { return prop in t ? t[prop] : () => proxy; },  // select / insert / update / … just chain
  });
  return proxy;
}

export const mockClient = {
  from(table) { return builder(F[table] ?? []); },
  rpc() { return builder([]); },
  auth: {
    async getSession() { return { data: { session: { user: { email: 'hr@haseebmadeit.com' } } } }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    async signInWithPassword() { return { data: {}, error: null }; },
    async signOut() { return { error: null }; },
  },
  channel() { const c = { on() { return c; }, subscribe() { return c; } }; return c; },
  removeChannel() {},
};
