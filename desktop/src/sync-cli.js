#!/usr/bin/env node
'use strict';

// Standalone device-sync test tool. Run this on the office PC (on the same
// Wi-Fi as the device) to confirm the "fetch from device" path works BEFORE
// building it into the app.
//
//   # just read from the device, write nothing (safest first test):
//   node src/sync-cli.js --dry-run
//
//   # read from the device AND save to Supabase:
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node src/sync-cli.js
//
// Optional env: DEVICE_IP (default 192.168.1.201), DEVICE_PORT (4370),
// DEVICE_SN (NYU7253801246), DEVICE_TZ_OFFSET (+05:00).

const { syncFromDevice } = require('./sync');

const dryRun = process.argv.includes('--dry-run');
const cfg = {
  deviceIp: process.env.DEVICE_IP || '192.168.1.201',
  devicePort: parseInt(process.env.DEVICE_PORT || '4370', 10),
  deviceSn: process.env.DEVICE_SN || 'NYU7253801246',
  tzOffset: process.env.DEVICE_TZ_OFFSET || '+05:00',
  supabaseUrl: process.env.SUPABASE_URL,
  serviceKey: process.env.SUPABASE_SERVICE_KEY,
  dryRun,
};

(async () => {
  console.log(`\nAttendance OS — device sync test`);
  console.log(`Device: ${cfg.deviceIp}:${cfg.devicePort}   Mode: ${dryRun ? 'DRY RUN (no writes)' : 'live (writes to Supabase)'}\n`);

  if (!dryRun && (!cfg.supabaseUrl || !cfg.serviceKey)) {
    console.error('To write to the database, set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
    console.error('Or run with --dry-run to just test the device connection.\n');
    process.exit(1);
  }

  try {
    const r = await syncFromDevice(cfg, { log: (m) => console.log('  ·', m) });
    console.log('');
    if (r.dryRun) {
      console.log(`✅ Connected and read ${r.pulled} record(s) from the device. The fetch method WORKS on your device. 🎉`);
      if (r.sample.length) {
        console.log('   Sample of what it read:');
        r.sample.forEach((s) => console.log(`     PIN ${s.pin} @ ${s.punch_time}`));
      }
      console.log('\n   Next: run again without --dry-run (with your Supabase keys) to save them.');
    } else {
      console.log(`✅ Pulled ${r.pulled}, sent ${r.stored} to the database (duplicates ignored). Done.`);
    }
  } catch (e) {
    console.error(`\n❌ Sync failed: ${e.message}`);
    console.error('   Common causes:');
    console.error('   • Not on the same Wi-Fi as the device, or wrong DEVICE_IP.');
    console.error('   • The device blocks pull reads on port 4370 (some firmware does).');
    console.error('     -> If so, use the built-in catcher (push) instead — it is already proven on your device.');
    process.exit(2);
  }
})();
