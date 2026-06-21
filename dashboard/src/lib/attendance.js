// Auto checkout
//
// If someone checked in but never scanned out, and it is more than four hours
// past their shift end, we fill the checkout in at the shift end time. This only
// changes what Reports, the CEO view and the Overview show. The raw log is never
// touched and still shows no checkout. Someone with no shift gets no fill in,
// because there is no end time to use.
//
// Rules confirmed by the client:
//  - four hours after shift end
//  - cap at the shift end, so no overtime is counted
//  - keep them in Still in for those four hours, then mark it an auto checkout

const AUTO_AFTER_MS = 4 * 60 * 60 * 1000;

export function withAutoCheckout(row, now = Date.now()) {
  const onlyIn = row.status === 'Incomplete' || (row.first_in && !row.last_out);
  if (!onlyIn || !row.scheduled_out) return row; // no shift end means no fill in
  const end = new Date(row.scheduled_out).getTime();
  if (Number.isNaN(end) || now <= end + AUTO_AFTER_MS) return row; // still inside the 4 hour window
  const worked = row.first_in
    ? Math.max(0, Math.round((end - new Date(row.first_in).getTime()) / 60000))
    : (row.worked_minutes ?? 0);
  return {
    ...row,
    last_out: row.scheduled_out,
    worked_minutes: worked,
    overtime_minutes: 0,
    status: 'Present',
    auto_out: true,
  };
}
