export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const configuration = (value) => ({
  event: 'low_stock_alert', frequency: value.frequency, start_date: value.start_date,
  local_time: value.local_time, timezone: 'Asia/Kolkata',
  weekday: value.frequency === 'weekly' ? Number(value.weekday) : null,
  month_day: value.frequency === 'monthly' ? Number(value.month_day) : null,
  additional_emails: [...new Set(value.additional_emails.map((email) => email.trim().toLowerCase()).filter(Boolean))],
});
export const sameConfiguration = (a, b) => JSON.stringify(configuration(a)) === JSON.stringify(configuration(b));
export function validConfiguration(value) {
  if (!value || value.event !== 'low_stock_alert' || value.timezone !== 'Asia/Kolkata'
      || !['daily', 'weekly', 'monthly'].includes(value.frequency)
      || !/^\d{4}-\d{2}-\d{2}$/.test(value.start_date) || value.start_date < '0001-01-01' || value.start_date > '9998-12-31'
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.local_time)
      || !Array.isArray(value.additional_emails) || value.additional_emails.length > 20
      || value.additional_emails.some((v) => typeof v !== 'string' || v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) return false;
  const date = new Date(`${value.start_date}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.start_date
    && (value.frequency === 'weekly' ? Number.isInteger(value.weekday) && value.weekday >= 0 && value.weekday <= 6 : value.weekday === null)
    && (value.frequency === 'monthly' ? Number.isInteger(value.month_day) && value.month_day >= 1 && value.month_day <= 31 : value.month_day === null);
}
export function nextRunLabel(value, now = new Date()) {
  if (!validConfiguration(value)) return 'Complete the schedule to calculate the next run.';
  const indiaDay = new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);
  let day = new Date(`${[indiaDay, value.start_date].sort().at(-1)}T00:00:00Z`);
  for (let i = 0; i < 370; i += 1) {
    const eligible = value.frequency === 'daily'
      || (value.frequency === 'weekly' && (day.getUTCDay() + 6) % 7 === value.weekday)
      || (value.frequency === 'monthly' && day.getUTCDate() === value.month_day);
    const instant = new Date(`${day.toISOString().slice(0, 10)}T${value.local_time}:00+05:30`);
    if (eligible && instant > now) return formatRun(instant);
    day = new Date(day.getTime() + 86400000);
  }
  return 'No representable next run.';
}
export const formatRun = (instant) => `${new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(instant))} Asia/Kolkata`;
