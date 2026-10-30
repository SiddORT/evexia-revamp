/** Date-only default from the local calendar; never round-trip through UTC. */
export function expiryYearsFromToday(years, today = new Date()) {
  const year = today.getFullYear() + years;
  const month = today.getMonth() + 1;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const day = month === 2 ? Math.min(today.getDate(), leapYear ? 29 : 28) : today.getDate();
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
